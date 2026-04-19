import json
import math
import secrets
import uuid

from django.contrib.auth.hashers import check_password, make_password

from django.db import connection, transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from coziyoo.utils import _dictfetchone, _dictfetchall

# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

TRANSITIONS = {
    "pending":     ["preparing", "cancelled", "rejected"],
    "pending_seller_approval": ["seller_approved", "pending_buyer_confirmation", "cancelled", "rejected"],
    "pending_buyer_confirmation": ["seller_approved", "awaiting_payment", "cancelled"],
    "seller_approved": ["awaiting_payment", "paid", "preparing", "cancelled"],
    "awaiting_payment": ["paid", "cancelled"],
    "paid": ["preparing", "cancelled"],
    "preparing":   ["ready", "cancelled"],
    "ready":       ["in_delivery", "cancelled"],
    "in_delivery": ["approaching"],
    "approaching": ["at_door"],
    "at_door":     ["delivered"],
    "delivered":   ["completed"],
    "completed":   [],
    "cancelled":   [],
}
TERMINAL = {"delivered", "completed", "cancelled"}


def can_transition(current: str, next_status: str) -> bool:
    return next_status in TRANSITIONS.get(current, [])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _check_app_auth(request):
    """Return (user, error_response) tuple."""
    if not getattr(request.user, "is_authenticated", False):
        return None, Response(
            {"error": {"code": "UNAUTHORIZED", "message": "Authentication required"}},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    if getattr(request.user, "realm", None) != "app":
        return None, Response(
            {"error": {"code": "FORBIDDEN", "message": "App realm required"}},
            status=status.HTTP_403_FORBIDDEN,
        )
    return request.user, None



def _json_dumps(value):
    return json.dumps(value, ensure_ascii=False)


def _json_object(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _selected_addons_total(selected_addons):
    if not isinstance(selected_addons, dict):
        return 0.0

    paid_addons = selected_addons.get("paid")
    if not isinstance(paid_addons, list):
        return 0.0

    total = 0.0
    for addon in paid_addons:
        if not isinstance(addon, dict):
            continue
        try:
            price = float(addon.get("price") or 0)
            quantity = int(addon.get("quantity") or 1)
        except (TypeError, ValueError):
            continue
        if quantity > 0 and price > 0:
            total += price * quantity
    return total


def _gated_delivery_address(address_json, *, caller_is_seller: bool, active_delivery_type: str):
    """Return delivery address JSON, hiding street details from seller until delivery is confirmed."""
    if not address_json:
        return address_json
    addr = _json_object(address_json) if isinstance(address_json, str) else address_json
    if not addr:
        return addr
    # Seller only gets the full address once delivery is actively confirmed.
    if caller_is_seller and active_delivery_type != "delivery":
        return {"distanceKm": addr.get("distanceKm"), "durationMinutes": addr.get("durationMinutes")}
    return addr


def _haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km between two (lat, lon) pairs."""
    R = 6371.0
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    dphi = math.radians(float(lat2) - float(lat1))
    dlambda = math.radians(float(lon2) - float(lon1))
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _to_finite_number(value):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _estimate_delivery_metrics_from_radius(radius_km):
    """Return (distance_km, duration_minutes) estimate when precise coordinates are unavailable."""
    radius = _to_finite_number(radius_km)
    if radius is None or radius <= 0:
        radius = 5.0
    distance_km = round(max(0.5, min(radius, radius * 0.6)), 2)
    duration_minutes = int(max(5, round(distance_km / 30 * 60 + 5)))
    return distance_km, duration_minutes


def _normalize_seller_decision(value):
    raw = str(value or "").strip().lower()
    if raw == "approve":
        return "approved"
    if raw == "reject":
        return "rejected"
    if raw == "revise":
        return "revised"
    return raw


def _create_notification(cursor, user_id, notif_type, title, body, data=None):
    cursor.execute(
        """
        INSERT INTO notification_events (id, user_id, type, title, body, data_json, is_read, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, FALSE, now())
        """,
        [
            str(uuid.uuid4()),
            user_id,
            notif_type,
            title,
            body,
            _json_dumps(data or {}),
        ],
    )


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

class OrderListCreateView(APIView):
    """
    GET  /v1/orders/  — list orders
    POST /v1/orders/  — create order
    """

    def get(self, request):
        user, err = _check_app_auth(request)
        if err:
            return err

        role = request.query_params.get("role", "buyer")
        filter_status = request.query_params.get("status")
        try:
            page = max(1, int(request.query_params.get("page", 1)))
            page_size = max(1, min(100, int(request.query_params.get("pageSize", 20))))
        except (ValueError, TypeError):
            page, page_size = 1, 20

        offset = (page - 1) * page_size
        user_id = str(user.id)

        if role == "seller":
            where_clause = "o.seller_id = %s"
        else:
            where_clause = "o.buyer_id = %s"

        params = [user_id]

        if filter_status:
            where_clause += " AND o.status = %s"
            params.append(filter_status)

        params.extend([page_size, offset])

        sql = f"""
            SELECT o.id, o.status, o.total_price, o.delivery_type, o.created_at, o.updated_at,
                   o.requested_delivery_type, o.active_delivery_type, o.seller_decision_state,
                   o.buyer_id, o.seller_id,
                   ub.display_name AS buyer_name,
                   us.display_name AS seller_name,
                   (
                       SELECT json_agg(json_build_object(
                           'name', f.name,
                           'quantity', oi.quantity,
                           'unitPrice', oi.unit_price,
                           'lineTotal', oi.line_total
                       ) ORDER BY oi.created_at)
                       FROM order_items oi
                       JOIN foods f ON f.id = oi.food_id
                       WHERE oi.order_id = o.id
                   ) AS items_json,
                   (
                       SELECT oe.payload_json->>'message'
                       FROM order_events oe
                       WHERE oe.order_id = o.id AND oe.event_type = 'seller_note'
                       ORDER BY oe.created_at DESC
                       LIMIT 1
                   ) AS last_seller_note
            FROM orders o
            JOIN users ub ON ub.id = o.buyer_id
            JOIN users us ON us.id = o.seller_id
            WHERE {where_clause}
            ORDER BY o.created_at DESC
            LIMIT %s OFFSET %s
        """

        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            rows = _dictfetchall(cursor)

        orders = [
            {
                "id": str(r["id"]),
                "orderId": str(r["id"]),
                "status": r["status"],
                "totalPrice": float(r["total_price"]),
                "deliveryType": r["delivery_type"],
                "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
                "updatedAt": r["updated_at"].isoformat() if r["updated_at"] else None,
                "requestedDeliveryType": r["requested_delivery_type"],
                "activeDeliveryType": r["active_delivery_type"],
                "sellerDecisionState": r["seller_decision_state"],
                "buyerId": str(r["buyer_id"]),
                "sellerId": str(r["seller_id"]),
                "buyerName": r["buyer_name"],
                "sellerName": r["seller_name"],
                "items": r["items_json"] or [],
                "lastSellerNote": r["last_seller_note"],
            }
            for r in rows
        ]

        return Response({"data": orders})

    def post(self, request):
        user, err = _check_app_auth(request)
        if err:
            return err

        body = request.data
        seller_id = body.get("sellerId")
        items = body.get("items")
        delivery_type = body.get("deliveryType", "pickup")
        note = body.get("note", "")

        # --- Basic validation ---
        if not seller_id:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "sellerId is required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not items or not isinstance(items, list) or len(items) == 0:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "items must be a non-empty list"}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if delivery_type not in ("pickup", "delivery"):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "deliveryType must be pickup or delivery"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        buyer_id = str(user.id)

        with connection.cursor() as cursor:
            # 1. Validate seller exists and is a seller
            cursor.execute(
                "SELECT id FROM users WHERE id = %s AND user_type IN ('seller','both') AND is_active = TRUE",
                [seller_id],
            )
            if cursor.fetchone() is None:
                return Response(
                    {"error": {"code": "NOT_FOUND", "message": "Seller not found or not active"}},
                    status=status.HTTP_404_NOT_FOUND,
                )

            normalized_items = []
            lot_ids = []
            food_ids = []
            for item in items:
                if not isinstance(item, dict):
                    return Response(
                        {"error": {"code": "VALIDATION_ERROR", "message": "Each item must be an object"}},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                lot_id = item.get("lotId")
                food_id = item.get("foodId")
                if not lot_id and not food_id:
                    return Response(
                        {"error": {"code": "VALIDATION_ERROR", "message": "Each item must have a lotId or foodId"}},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                normalized_items.append(
                    {
                        "lotId": str(lot_id) if lot_id else None,
                        "foodId": str(food_id) if food_id else None,
                        "quantity": item.get("quantity"),
                        "selectedAddons": item.get("selectedAddons"),
                    }
                )
                if lot_id:
                    lot_ids.append(str(lot_id))
                elif food_id:
                    food_ids.append(str(food_id))

            lot_details = {}
            if lot_ids:
                placeholders = ", ".join(["%s"] * len(lot_ids))
                cursor.execute(
                    f"""
                    SELECT l.id, l.food_id, f.price
                    FROM production_lots l
                    JOIN foods f ON f.id = l.food_id
                    WHERE l.id IN ({placeholders})
                      AND l.seller_id = %s
                      AND f.seller_id = %s
                      AND f.is_active = TRUE
                    """,
                    lot_ids + [seller_id, seller_id],
                )
                lot_details = {
                    str(row[0]): {"foodId": str(row[1]), "unitPrice": float(row[2])}
                    for row in cursor.fetchall()
                }

                invalid_lots = [lot_id for lot_id in lot_ids if lot_id not in lot_details]
                if invalid_lots:
                    return Response(
                        {
                            "error": {
                                "code": "VALIDATION_ERROR",
                                "message": f"Lot(s) not found or not active: {invalid_lots}",
                            }
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            food_prices = {}
            if food_ids:
                placeholders = ", ".join(["%s"] * len(food_ids))
                cursor.execute(
                    f"SELECT id, price FROM foods WHERE id IN ({placeholders}) AND seller_id = %s AND is_active = TRUE",
                    food_ids + [seller_id],
                )
                food_prices = {str(row[0]): float(row[1]) for row in cursor.fetchall()}

                invalid = [food_id for food_id in food_ids if food_id not in food_prices]
                if invalid:
                    return Response(
                        {
                            "error": {
                                "code": "VALIDATION_ERROR",
                                "message": f"Food(s) not found or not active: {invalid}",
                            }
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        # 3. Validate quantities and inject prices from DB
        for item in normalized_items:
            if item["lotId"]:
                item["foodId"] = lot_details[item["lotId"]]["foodId"]
                item["unitPrice"] = lot_details[item["lotId"]]["unitPrice"]
            else:
                item["unitPrice"] = food_prices.get(item["foodId"], 0.0)

            try:
                item["quantity"] = int(item["quantity"])
            except (ValueError, TypeError):
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "Invalid quantity"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if item["quantity"] <= 0:
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "quantity must be > 0"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            addons_total = _selected_addons_total(item.get("selectedAddons"))
            item["lineTotal"] = (item["quantity"] * item["unitPrice"]) + addons_total

        total_price = sum(i["lineTotal"] for i in normalized_items)

        with transaction.atomic():
            with connection.cursor() as cursor:
                # 4. Insert order
                cursor.execute(
                    """
                    INSERT INTO orders (buyer_id, seller_id, status, total_price,
                                       delivery_type, requested_delivery_type, active_delivery_type,
                                       seller_decision_state)
                    VALUES (%s, %s, 'pending_seller_approval', %s, %s, %s, %s, 'pending')
                    RETURNING id, created_at
                    """,
                    [buyer_id, seller_id, total_price, delivery_type, delivery_type, delivery_type],
                )
                order_row = cursor.fetchone()
                order_id = str(order_row[0])
                created_at = order_row[1]

                # 5. Insert order items
                for item in normalized_items:
                    cursor.execute(
                        """
                        INSERT INTO order_items (id, order_id, lot_id, food_id, quantity, unit_price, line_total, selected_addons_json)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        [
                            str(uuid.uuid4()),
                            order_id,
                            item["lotId"],
                            item["foodId"],
                            item["quantity"],
                            item["unitPrice"],
                            item["lineTotal"],
                            _json_dumps(item.get("selectedAddons")) if item.get("selectedAddons") is not None else None,
                        ],
                    )

                # 6. Insert order event
                cursor.execute(
                    """
                    INSERT INTO order_events (id, order_id, event_type, actor_user_id, payload_json)
                    VALUES (%s, %s, 'order_created', %s, %s)
                    """,
                    [str(uuid.uuid4()), order_id, buyer_id, _json_dumps({"note": note, "itemCount": len(normalized_items)})],
                )
                first_food_name = ""
                if normalized_items and normalized_items[0].get("foodId"):
                    cursor.execute(
                        "SELECT name FROM foods WHERE id = %s LIMIT 1",
                        [normalized_items[0]["foodId"]],
                    )
                    food_row = cursor.fetchone()
                    first_food_name = str(food_row[0] or "").strip() if food_row else ""

                food_label = first_food_name or "Bu ürün"
                _create_notification(
                    cursor,
                    seller_id,
                    "order_created",
                    f"{food_label} için teklif geldi",
                    "Bir alıcı teklif gönderdi. İnceleyip onaylayabilirsin.",
                    {
                        "orderId": order_id,
                        "foodName": first_food_name or None,
                        "sellerId": seller_id,
                        "buyerId": buyer_id,
                        "status": "pending_seller_approval",
                        "deliveryType": delivery_type,
                    },
                )

        return Response(
            {
                "data": {
                    "id": order_id,
                    "orderId": order_id,
                    "sellerId": seller_id,
                    "status": "pending_seller_approval",
                    "totalPrice": total_price,
                    "createdAt": created_at.isoformat() if created_at else None,
                }
            },
            status=status.HTTP_201_CREATED,
        )


class OrderDetailView(APIView):
    """GET /v1/orders/:order_id"""

    def get(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        user_id = str(user.id)
        order_id_str = str(order_id)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT o.id, o.status, o.total_price, o.delivery_type, o.seller_delivery_note,
                       o.requested_delivery_type, o.active_delivery_type, o.seller_decision_state,
                       o.seller_eta_minutes, o.seller_promised_at, o.approved_at, o.payment_captured_at,
                       o.created_at, o.updated_at, o.delivery_address_json,
                       o.buyer_id, o.seller_id,
                       ub.display_name AS buyer_name,
                       us.display_name AS seller_name,
                       sa.title AS seller_address_title,
                       sa.address_line AS seller_address_line,
                       us.latitude AS seller_lat,
                       us.longitude AS seller_lng,
                       ub.latitude AS buyer_lat,
                       ub.longitude AS buyer_lng
                FROM orders o
                JOIN users ub ON ub.id = o.buyer_id
                JOIN users us ON us.id = o.seller_id
                LEFT JOIN user_addresses sa ON sa.user_id = o.seller_id AND sa.is_default = TRUE
                WHERE o.id = %s AND (o.buyer_id = %s OR o.seller_id = %s)
                """,
                [order_id_str, user_id, user_id],
            )
            order = _dictfetchone(cursor)

        if order is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT oi.id, oi.food_id, oi.quantity, oi.unit_price, oi.line_total, oi.selected_addons_json,
                       f.name AS food_name
                FROM order_items oi
                JOIN foods f ON f.id = oi.food_id
                WHERE oi.order_id = %s
                """,
                [order_id_str],
            )
            items = _dictfetchall(cursor)

            cursor.execute(
                """
                SELECT event_type, actor_user_id, created_at
                FROM order_events
                WHERE order_id = %s
                ORDER BY created_at
                """,
                [order_id_str],
            )
            events = _dictfetchall(cursor)

        return Response(
            {
                "data": {
                    "id": str(order["id"]),
                    "orderId": str(order["id"]),
                    "status": order["status"],
                    "totalPrice": float(order["total_price"]),
                    "deliveryType": order["delivery_type"],
                    "note": order["seller_delivery_note"],
                    "sellerDeliveryNote": order["seller_delivery_note"],
                    "requestedDeliveryType": order["requested_delivery_type"],
                    "activeDeliveryType": order["active_delivery_type"],
                    "sellerDecisionState": order["seller_decision_state"],
                    "sellerEtaMinutes": order["seller_eta_minutes"],
                    "sellerPromisedAt": order["seller_promised_at"].isoformat() if order["seller_promised_at"] else None,
                    "approvedAt": order["approved_at"].isoformat() if order["approved_at"] else None,
                    "paymentCapturedAt": order["payment_captured_at"].isoformat() if order["payment_captured_at"] else None,
                    "createdAt": order["created_at"].isoformat() if order["created_at"] else None,
                    "updatedAt": order["updated_at"].isoformat() if order["updated_at"] else None,
                    "deliveryAddress": _gated_delivery_address(
                        order["delivery_address_json"],
                        caller_is_seller=user_id == str(order["seller_id"]),
                        active_delivery_type=str(order.get("active_delivery_type") or ""),
                    ),
                    "buyerId": str(order["buyer_id"]),
                    "sellerId": str(order["seller_id"]),
                    "buyerName": order["buyer_name"],
                    "sellerName": order["seller_name"],
                    # Buyer coordinates — returned only to the buyer, used as origin for pickup directions
                    "buyerCoordinates": (
                        {
                            "lat": float(order["buyer_lat"]),
                            "lng": float(order["buyer_lng"]),
                        }
                        if user_id == str(order["buyer_id"])
                        and order["buyer_lat"] is not None
                        and order["buyer_lng"] is not None
                        else None
                    ),
                    # Seller pickup address — shown to buyer once order is approved, never to seller
                    "sellerAddress": (
                        {
                            "title": order["seller_address_title"],
                            "addressLine": order["seller_address_line"],
                            "line": order["seller_address_line"],
                            "lat": float(order["seller_lat"]) if order["seller_lat"] is not None else None,
                            "lng": float(order["seller_lng"]) if order["seller_lng"] is not None else None,
                        }
                        if (
                            user_id == str(order["buyer_id"])
                            and str(order.get("active_delivery_type") or "") != "delivery"
                            and str(order.get("status") or "") != "pending_seller_approval"
                            and (order["seller_address_title"] or order["seller_address_line"])
                        )
                        else None
                    ),
                    "items": [
                        {
                            "id": str(i["id"]),
                            "foodId": str(i["food_id"]),
                            "foodName": i["food_name"],
                            "name": i["food_name"],
                            "quantity": i["quantity"],
                            "unitPrice": float(i["unit_price"]),
                            "subtotal": float(i["line_total"]),
                            "lineTotal": float(i["line_total"]),
                            "selectedAddons": i["selected_addons_json"],
                        }
                        for i in items
                    ],
                    "events": [
                        {
                            "eventType": e["event_type"],
                            "actorUserId": str(e["actor_user_id"]) if e["actor_user_id"] else None,
                            "createdAt": e["created_at"].isoformat() if e["created_at"] else None,
                        }
                        for e in events
                    ],
                }
            }
        )


class OrderStatusView(APIView):
    """POST /v1/orders/:order_id/status"""

    def post(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        new_status = request.data.get("status") or request.data.get("toStatus")
        if not new_status:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "status is required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_id = str(user.id)
        order_id_str = str(order_id)

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, status, buyer_id, seller_id, delivery_type, active_delivery_type FROM orders WHERE id = %s",
                [order_id_str],
            )
            order = _dictfetchone(cursor)

        if order is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        buyer_id = str(order["buyer_id"])
        seller_id = str(order["seller_id"])
        effective_delivery_type = str(order.get("active_delivery_type") or order.get("delivery_type") or "").strip().lower()

        if user_id not in (buyer_id, seller_id):
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "You are not a participant in this order"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        pickup_buyer_owned_statuses = {"preparing", "ready", "in_delivery", "approaching", "at_door", "delivered", "completed"}
        if effective_delivery_type == "pickup" and user_id == seller_id and str(new_status).strip().lower() in pickup_buyer_owned_statuses:
            return Response(
                {
                    "error": {
                        "code": "FORBIDDEN",
                        "message": "Gel al akışını alıcı ilerletir.",
                    }
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        current_status = str(order["status"])
        normalized_new_status = str(new_status).strip().lower()
        pickup_fast_start_allowed = (
            effective_delivery_type == "pickup"
            and user_id == buyer_id
            and normalized_new_status == "in_delivery"
            and current_status in {"paid", "preparing", "ready"}
        )
        if not pickup_fast_start_allowed and not can_transition(current_status, new_status):
            return Response(
                {
                    "error": {
                        "code": "INVALID_TRANSITION",
                        "message": f"Cannot transition from '{current_status}' to '{new_status}'",
                    }
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE orders
                    SET status = %s,
                        updated_at = now(),
                        seller_decision_state = CASE
                            WHEN %s = 'seller_approved' THEN 'approved'
                            ELSE seller_decision_state
                        END
                    WHERE id = %s
                    """,
                    [new_status, new_status, order_id_str],
                )
                cursor.execute(
                    """
                    INSERT INTO order_events (id, order_id, event_type, actor_user_id, from_status, to_status, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        str(uuid.uuid4()),
                        order_id_str,
                        f"status_changed_to_{new_status}",
                        user_id,
                        current_status,
                        new_status,
                        _json_dumps({"actorRole": "buyer" if user_id == buyer_id else "seller"}),
                    ],
                )

                # Generate one-time delivery PIN when order reaches at_door.
                if new_status == "at_door":
                    plain_pin = f"{secrets.randbelow(1_000_000):06d}"
                    hashed_pin = make_password(plain_pin)
                    # Plain PIN stored in metadata_json for buyer retrieval via /delivery-proof.
                    # It is cleared (set null) once verified.
                    cursor.execute(
                        """
                        INSERT INTO delivery_proof_records
                            (id, order_id, seller_id, buyer_id, proof_mode, pin_hash,
                             pin_sent_at, pin_sent_channel, verification_attempts, status,
                             metadata_json, created_at)
                        VALUES (%s, %s, %s, %s, 'pin', %s, now(), 'app', 0, 'pending', %s, now())
                        ON CONFLICT (order_id) DO UPDATE
                            SET pin_hash = EXCLUDED.pin_hash,
                                pin_sent_at = now(),
                                verification_attempts = 0,
                                status = 'pending',
                                metadata_json = EXCLUDED.metadata_json
                        """,
                        [
                            str(uuid.uuid4()), order_id_str, seller_id, buyer_id,
                            hashed_pin, _json_dumps({"pin": plain_pin}),
                        ],
                    )
                    _create_notification(
                        cursor,
                        buyer_id,
                        "delivery_pin_ready",
                        "Teslimat kodun hazır",
                        "Satıcı kapıda. Uygulamadan teslimat kodunu al ve satıcıya ver.",
                        {"orderId": order_id_str},
                    )

        return Response({"data": {"orderId": order_id_str, "status": new_status}})


class OrderCancelView(APIView):
    """POST /v1/orders/:order_id/cancel"""

    def post(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        user_id = str(user.id)
        order_id_str = str(order_id)
        cancel_reason = str(request.data.get("reason") or "").strip()
        if not cancel_reason:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "İptal sebebi zorunludur."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(cancel_reason) > 500:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "İptal sebebi en fazla 500 karakter olabilir."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, status, buyer_id, seller_id FROM orders WHERE id = %s",
                [order_id_str],
            )
            order = _dictfetchone(cursor)

        if order is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        buyer_id = str(order["buyer_id"])
        seller_id = str(order["seller_id"])

        if user_id not in (buyer_id, seller_id):
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "You are not a participant in this order"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO order_events (id, order_id, event_type, actor_user_id, payload_json, created_at)
                    VALUES (%s, %s, %s, %s, %s, now())
                    """,
                    [
                        str(uuid.uuid4()),
                        order_id_str,
                        "buyer_note" if user_id == buyer_id else "seller_note",
                        user_id,
                        _json_dumps({"message": cancel_reason}),
                    ],
                )
                cursor.execute(
                    """
                    UPDATE orders
                    SET status = 'cancelled', updated_at = now()
                    WHERE id = %s
                      AND status NOT IN ('completed', 'delivered', 'cancelled', 'paid', 'preparing', 'ready', 'in_delivery')
                    RETURNING id
                    """,
                    [order_id_str],
                )
                updated = cursor.fetchone()

                if updated is None:
                    return Response(
                        {
                            "error": {
                                "code": "INVALID_TRANSITION",
                                "message": "Order cannot be cancelled in its current state",
                            }
                        },
                        status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    )

                cursor.execute(
                    """
                    INSERT INTO order_events (id, order_id, event_type, actor_user_id, payload_json)
                    VALUES (%s, %s, 'order_cancelled', %s, %s)
                    """,
                    [
                        str(uuid.uuid4()),
                        order_id_str,
                        user_id,
                        _json_dumps({
                            "cancelledBy": "buyer" if user_id == buyer_id else "seller",
                            "reason": cancel_reason,
                        }),
                    ],
                )
                _create_notification(
                    cursor,
                    seller_id if user_id == buyer_id else buyer_id,
                    "order_cancelled",
                    "Siparis iptal edildi",
                    cancel_reason,
                    {
                        "orderId": order_id_str,
                        "cancelledBy": "buyer" if user_id == buyer_id else "seller",
                    },
                )

        return Response({"data": {"orderId": order_id_str, "status": "cancelled"}})


class BuyerDeliveryRequestView(APIView):
    """POST /v1/orders/:order_id/buyer-delivery-request"""

    def post(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        requested_delivery_type = request.data.get("requestedDeliveryType")
        if requested_delivery_type != "delivery":
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "requestedDeliveryType must be delivery"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_id = str(user.id)
        order_id_str = str(order_id)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, status, buyer_id, seller_id, requested_delivery_type, active_delivery_type
                FROM orders
                WHERE id = %s
                """,
                [order_id_str],
            )
            order = _dictfetchone(cursor)

        if order is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        if str(order["buyer_id"]) != user_id:
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "Only the buyer can request delivery"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        current_status = str(order["status"] or "")
        if current_status != "pending_seller_approval":
            return Response(
                {"error": {"code": "INVALID_STATE", "message": "Delivery can only be requested while seller approval is pending"}},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        if str(order.get("active_delivery_type") or "") == "delivery":
            return Response({"data": {"orderId": order_id_str, "requestedDeliveryType": "delivery", "activeDeliveryType": "delivery"}})

        with transaction.atomic():
            with connection.cursor() as cursor:
                # Capture buyer's default address
                cursor.execute(
                    """
                    SELECT title, address_line
                    FROM user_addresses
                    WHERE user_id = %s
                    ORDER BY is_default DESC, updated_at DESC, created_at DESC
                    LIMIT 1
                    """,
                    [user_id],
                )
                address_row = cursor.fetchone()
                delivery_address_snapshot = None
                if address_row and any(address_row):
                    delivery_address_snapshot = {
                        "title": address_row[0],
                        "addressLine": address_row[1],
                        "line": address_row[1],
                    }

                # Compute buyer-to-seller distance using stored coordinates
                cursor.execute(
                    """
                    SELECT
                        COALESCE(
                            b.latitude,
                            (
                                SELECT ull.latitude
                                FROM user_login_locations ull
                                WHERE ull.user_id = b.id
                                ORDER BY ull.created_at DESC
                                LIMIT 1
                            )
                        ) AS buyer_lat,
                        COALESCE(
                            b.longitude,
                            (
                                SELECT ull.longitude
                                FROM user_login_locations ull
                                WHERE ull.user_id = b.id
                                ORDER BY ull.created_at DESC
                                LIMIT 1
                            )
                        ) AS buyer_lng,
                        COALESCE(
                            s.latitude,
                            (
                                SELECT ull.latitude
                                FROM user_login_locations ull
                                WHERE ull.user_id = s.id
                                ORDER BY ull.created_at DESC
                                LIMIT 1
                            )
                        ) AS seller_lat,
                        COALESCE(
                            s.longitude,
                            (
                                SELECT ull.longitude
                                FROM user_login_locations ull
                                WHERE ull.user_id = s.id
                                ORDER BY ull.created_at DESC
                                LIMIT 1
                            )
                        ) AS seller_lng
                        ,
                        s.delivery_radius_km AS seller_delivery_radius_km
                    FROM users b, users s
                    WHERE b.id = %s AND s.id = %s
                    """,
                    [user_id, str(order["seller_id"])],
                )
                coord_row = cursor.fetchone()
                if coord_row and all(v is not None for v in coord_row[:4]):
                    try:
                        distance_km = _haversine_km(*coord_row[:4])
                        if delivery_address_snapshot is None:
                            delivery_address_snapshot = {}
                        delivery_address_snapshot["distanceKm"] = round(distance_km, 2)
                        delivery_address_snapshot["durationMinutes"] = max(5, round(distance_km / 30 * 60 + 5))
                    except (TypeError, ValueError):
                        pass
                elif coord_row:
                    distance_km, duration_minutes = _estimate_delivery_metrics_from_radius(coord_row[4])
                    if delivery_address_snapshot is None:
                        delivery_address_snapshot = {}
                    delivery_address_snapshot["distanceKm"] = distance_km
                    delivery_address_snapshot["durationMinutes"] = duration_minutes

                cursor.execute(
                    """
                    UPDATE orders
                    SET requested_delivery_type = 'delivery',
                        delivery_address_json = COALESCE(%s::jsonb, delivery_address_json),
                        updated_at = now()
                    WHERE id = %s
                    RETURNING requested_delivery_type, active_delivery_type
                    """,
                    [
                        _json_dumps(delivery_address_snapshot) if delivery_address_snapshot else None,
                        order_id_str,
                    ],
                )
                updated = cursor.fetchone()

                cursor.execute(
                    """
                    INSERT INTO order_events (id, order_id, event_type, actor_user_id, payload_json)
                    VALUES (%s, %s, 'buyer_delivery_requested', %s, %s)
                    """,
                    [
                        str(uuid.uuid4()),
                        order_id_str,
                        user_id,
                        _json_dumps({"requestedDeliveryType": "delivery"}),
                    ],
                )

                _create_notification(
                    cursor,
                    str(order["seller_id"]),
                    "buyer_delivery_requested",
                    "Alıcı teslimat istedi",
                    "Bu sipariş için alıcı gel al yerine teslimat talebi bıraktı.",
                    {
                        "orderId": order_id_str,
                        "buyerId": user_id,
                        "sellerId": str(order["seller_id"]),
                        "requestedDeliveryType": "delivery",
                    },
                )

        return Response(
            {
                "data": {
                    "orderId": order_id_str,
                    "requestedDeliveryType": str(updated[0] or "delivery"),
                    "activeDeliveryType": str(updated[1] or "pickup"),
                }
            }
        )


class SellerDeliveryRequestResolveView(APIView):
    """POST /v1/orders/:order_id/seller-delivery-request-response"""

    def post(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        order_id_str = str(order_id)
        user_id = str(user.id)
        delivery_type = str(request.data.get("deliveryType") or "").strip().lower()
        note = str(request.data.get("note") or "").strip()
        eta_minutes = request.data.get("etaMinutes")

        if delivery_type not in ("pickup", "delivery"):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "deliveryType must be pickup or delivery"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        seller_eta_minutes = None
        if eta_minutes not in (None, ""):
            try:
                seller_eta_minutes = int(eta_minutes)
            except (TypeError, ValueError):
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "etaMinutes must be an integer"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if seller_eta_minutes < 0:
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "etaMinutes must be >= 0"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, status, buyer_id, seller_id, requested_delivery_type, active_delivery_type, delivery_address_json
                FROM orders
                WHERE id = %s
                """,
                [order_id_str],
            )
            order = _dictfetchone(cursor)

        if order is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        if str(order["seller_id"]) != user_id:
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "Only the seller can resolve this request"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        current_status = str(order.get("status") or "")
        if current_status != "seller_approved":
            return Response(
                {"error": {"code": "INVALID_STATE", "message": "Delivery request can only be resolved after seller approval"}},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        if str(order.get("requested_delivery_type") or "") != "delivery" or str(order.get("active_delivery_type") or "") == "delivery":
            return Response(
                {"error": {"code": "INVALID_STATE", "message": "There is no pending delivery request to resolve"}},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        event_type = "seller_delivery_request_accepted" if delivery_type == "delivery" else "seller_delivery_request_declined"
        next_status = "pending_buyer_confirmation" if delivery_type == "delivery" else current_status
        buyer_body = (
            "Satici teslimat istegini kabul etti. Devam etmek icin teklifi onaylaman gerekiyor."
            if delivery_type == "delivery"
            else "Satici teslimat istegini kabul etmedi. Siparis gel al olarak devam ediyor."
        )

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT title, address_line
                    FROM user_addresses
                    WHERE user_id = %s
                    ORDER BY is_default DESC, updated_at DESC, created_at DESC
                    LIMIT 1
                    """,
                    [str(order["buyer_id"])],
                )
                address_row = cursor.fetchone()
                delivery_address_snapshot = None
                if address_row and any(address_row):
                    delivery_address_snapshot = {
                        "title": address_row[0],
                        "addressLine": address_row[1],
                        "line": address_row[1],
                    }

                existing_snapshot = _json_object(order.get("delivery_address_json"))
                existing_distance = _to_finite_number(existing_snapshot.get("distanceKm")) if existing_snapshot else None
                existing_duration = _to_finite_number(existing_snapshot.get("durationMinutes")) if existing_snapshot else None
                if (existing_distance is not None or existing_duration is not None) and delivery_address_snapshot is None:
                    delivery_address_snapshot = {}
                if existing_distance is not None:
                    delivery_address_snapshot["distanceKm"] = round(existing_distance, 2)
                if existing_duration is not None:
                    delivery_address_snapshot["durationMinutes"] = int(round(existing_duration))

                cursor.execute(
                    """
                    UPDATE orders
                    SET delivery_type = %s,
                        requested_delivery_type = %s,
                        active_delivery_type = %s,
                        status = %s,
                        seller_decision_state = CASE WHEN %s = 'pending_buyer_confirmation' THEN 'revised' ELSE seller_decision_state END,
                        delivery_address_json = COALESCE(%s, delivery_address_json),
                        seller_delivery_note = %s,
                        seller_eta_minutes = COALESCE(%s, seller_eta_minutes),
                        seller_promised_at = CASE
                            WHEN %s IS NOT NULL THEN now() + (%s * INTERVAL '1 minute')
                            ELSE seller_promised_at
                        END,
                        updated_at = now()
                    WHERE id = %s
                    RETURNING delivery_type, requested_delivery_type, active_delivery_type, seller_promised_at
                    """,
                    [
                        delivery_type,
                        delivery_type,
                        delivery_type,
                        next_status,
                        next_status,
                        _json_dumps(delivery_address_snapshot) if delivery_address_snapshot else None,
                        note or None,
                        seller_eta_minutes,
                        seller_eta_minutes,
                        seller_eta_minutes,
                        order_id_str,
                    ],
                )
                updated = cursor.fetchone()

                cursor.execute(
                    """
                    INSERT INTO order_events (id, order_id, event_type, actor_user_id, from_status, to_status, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        str(uuid.uuid4()),
                        order_id_str,
                        event_type,
                        user_id,
                        current_status,
                        next_status,
                        _json_dumps({
                            "deliveryType": delivery_type,
                            "note": note,
                            "etaMinutes": seller_eta_minutes,
                        }),
                    ],
                )
                if note:
                    cursor.execute(
                        """
                        INSERT INTO order_events (id, order_id, event_type, actor_user_id, payload_json, created_at)
                        VALUES (%s, %s, 'seller_note', %s, %s, now())
                        """,
                        [
                            str(uuid.uuid4()),
                            order_id_str,
                            user_id,
                            _json_dumps({"message": note}),
                        ],
                    )

                _create_notification(
                    cursor,
                    str(order["buyer_id"]),
                    "order_update",
                    "Teslimat istegin yanitlandi",
                    buyer_body,
                    {
                        "orderId": order_id_str,
                        "deliveryType": delivery_type,
                        "note": note,
                    },
                )

        return Response(
            {
                "data": {
                    "orderId": order_id_str,
                    "status": next_status,
                    "deliveryType": str(updated[0] or delivery_type),
                    "requestedDeliveryType": str(updated[1] or delivery_type),
                    "activeDeliveryType": str(updated[2] or delivery_type),
                    "sellerPromisedAt": updated[3].isoformat() if updated[3] else None,
                }
            }
        )


class OrderReviewView(APIView):
    """POST /v1/orders/:order_id/review"""

    def post(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        rating = request.data.get("rating")
        comment = request.data.get("comment", "")

        if rating is None:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "rating is required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            rating = int(rating)
        except (ValueError, TypeError):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "rating must be an integer"}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if rating < 1 or rating > 5:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "rating must be between 1 and 5"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_id = str(user.id)
        order_id_str = str(order_id)

        with transaction.atomic():
            with connection.cursor() as cursor:
                # Check for existing review
                cursor.execute(
                    "SELECT id FROM reviews WHERE order_id = %s AND buyer_id = %s",
                    [order_id_str, user_id],
                )
                if cursor.fetchone() is not None:
                    return Response(
                        {"error": {"code": "CONFLICT", "message": "You have already reviewed this order"}},
                        status=status.HTTP_409_CONFLICT,
                    )

                # Insert review; fails gracefully if order not found / not completed / not buyer
                cursor.execute(
                    """
                    INSERT INTO reviews (order_id, buyer_id, seller_id, food_id, rating, comment)
                    SELECT %s, o.buyer_id, o.seller_id, oi.food_id, %s, %s
                    FROM orders o
                    JOIN order_items oi ON oi.order_id = o.id
                    WHERE o.id = %s
                      AND o.buyer_id = %s
                      AND o.status = 'completed'
                    LIMIT 1
                    RETURNING id
                    """,
                    [order_id_str, rating, comment, order_id_str, user_id],
                )
                inserted = cursor.fetchone()

        if inserted is None:
            return Response(
                {
                    "error": {
                        "code": "FORBIDDEN",
                        "message": "Order not found, not completed, or you are not the buyer",
                    }
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        return Response(
            {"data": {"reviewId": str(inserted[0]), "orderId": order_id_str, "rating": rating}},
            status=status.HTTP_201_CREATED,
        )


class SellerDecisionView(APIView):
    """POST /v1/orders/:order_id/seller-decision"""

    DECISION_STATUS_MAP = {
        "approved": "seller_approved",
        "rejected": "rejected",
        "revised": "pending_buyer_confirmation",
    }

    def post(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        decision = _normalize_seller_decision(request.data.get("decision"))
        note = request.data.get("note", "")
        requested_delivery_type = request.data.get("deliveryType")
        eta_minutes = request.data.get("etaMinutes")

        if decision not in self.DECISION_STATUS_MAP:
            return Response(
                {
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": "decision must be one of: approved, rejected, revised",
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_id = str(user.id)
        order_id_str = str(order_id)

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, status, seller_id, buyer_id, requested_delivery_type FROM orders WHERE id = %s",
                [order_id_str],
            )
            order = _dictfetchone(cursor)

        if order is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        if str(order["seller_id"]) != user_id:
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "Only the seller can make this decision"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        current_status = order["status"]
        new_status = self.DECISION_STATUS_MAP[decision]

        # When seller approves with delivery and buyer already requested delivery →
        # route to pending_buyer_confirmation so buyer can confirm the delivery proposal.
        if (
            decision == "approved"
            and requested_delivery_type == "delivery"
            and str(order.get("requested_delivery_type") or "") == "delivery"
        ):
            new_status = "pending_buyer_confirmation"

        if decision == "revised" and current_status not in ("pending", "pending_seller_approval"):
            return Response(
                {
                    "error": {
                        "code": "INVALID_TRANSITION",
                        "message": "revised decision is only valid for pending seller approval orders",
                    }
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        if decision != "revised" and not can_transition(current_status, new_status):
            return Response(
                {
                    "error": {
                        "code": "INVALID_TRANSITION",
                        "message": f"Cannot apply decision '{decision}' when order is '{current_status}'",
                    }
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        if requested_delivery_type not in (None, "", "pickup", "delivery"):
            return Response(
                {
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": "deliveryType must be pickup or delivery",
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        seller_eta_minutes = None
        if eta_minutes not in (None, ""):
            try:
                seller_eta_minutes = int(eta_minutes)
            except (TypeError, ValueError):
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "etaMinutes must be an integer"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if seller_eta_minutes < 0:
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "etaMinutes must be >= 0"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        metadata = {
            "decision": decision,
            "note": note,
            "deliveryType": requested_delivery_type,
            "etaMinutes": seller_eta_minutes,
        }

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE orders
                    SET status = %s,
                        updated_at = now(),
                        seller_decision_state = %s,
                        seller_delivery_note = %s,
                        seller_eta_minutes = COALESCE(%s, seller_eta_minutes),
                        active_delivery_type = COALESCE(%s, active_delivery_type),
                        approved_at = CASE WHEN %s = 'approved' THEN now() ELSE approved_at END,
                        seller_promised_at = CASE
                            WHEN %s IS NOT NULL THEN now() + (%s * INTERVAL '1 minute')
                            ELSE seller_promised_at
                        END
                    WHERE id = %s
                    """,
                    [
                        new_status,
                        decision,
                        note or None,
                        seller_eta_minutes,
                        requested_delivery_type,
                        decision,
                        seller_eta_minutes,
                        seller_eta_minutes,
                        order_id_str,
                    ],
                )
                cursor.execute(
                    """
                    INSERT INTO order_events (id, order_id, event_type, actor_user_id, from_status, to_status, payload_json)
                    VALUES (%s, %s, 'seller_decision', %s, %s, %s, %s)
                    """,
                    [str(uuid.uuid4()), order_id_str, user_id, current_status, new_status, _json_dumps(metadata)],
                )
                if note:
                    cursor.execute(
                        """
                        INSERT INTO order_events (id, order_id, event_type, actor_user_id, payload_json, created_at)
                        VALUES (%s, %s, 'seller_note', %s, %s, now())
                        """,
                        [
                            str(uuid.uuid4()),
                            order_id_str,
                            user_id,
                            _json_dumps({"message": note}),
                        ],
                    )

                # Notify buyer when seller sends a delivery proposal (pending_buyer_confirmation)
                if new_status == "pending_buyer_confirmation":
                    _create_notification(
                        cursor,
                        str(order["buyer_id"]),
                        "seller_delivery_proposal",
                        "Satıcı teslimat teklifini gönderdi",
                        "Satıcı teslimat yapabileceğini bildirdi. Onayla veya iptal et.",
                        {"orderId": order_id_str, "sellerId": user_id},
                    )

        return Response(
            {
                "data": {
                    "orderId": order_id_str,
                    "decision": decision,
                    "status": new_status,
                }
            }
        )


class BuyerConfirmTermsView(APIView):
    """POST /v1/orders/:order_id/buyer-confirm-terms"""

    def post(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        confirm = request.data.get("confirm")
        if confirm is None:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "confirm field is required (true or false)"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_id = str(user.id)
        order_id_str = str(order_id)

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, status, buyer_id, seller_id, requested_delivery_type FROM orders WHERE id = %s",
                [order_id_str],
            )
            order = _dictfetchone(cursor)

        if order is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Sipariş bulunamadı."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        if str(order["buyer_id"]) != user_id:
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "Only the buyer can confirm terms"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        current_status = str(order.get("status") or "")
        requested_delivery_type = str(order.get("requested_delivery_type") or "")
        has_delivery_request_event = False
        if requested_delivery_type != "delivery":
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT EXISTS(
                        SELECT 1 FROM order_events
                        WHERE order_id = %s AND event_type = 'buyer_delivery_requested'
                    )
                    """,
                    [order_id_str],
                )
                row = cursor.fetchone()
                has_delivery_request_event = bool(row[0]) if row else False
        allow_delivery_confirmation = (
            (requested_delivery_type == "delivery" or has_delivery_request_event)
            and current_status not in ("completed", "cancelled", "rejected")
        )

        if current_status != "pending_buyer_confirmation" and not allow_delivery_confirmation:
            return Response(
                {"error": {"code": "INVALID_STATE", "message": "Bu sipariş onay beklemiyor."}},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        if confirm:
            # Buyer is the final approver in delivery-request flow.
            # Keep confirm idempotent if order already advanced.
            new_status = "seller_approved" if current_status in ("pending_seller_approval", "pending_buyer_confirmation", "seller_approved") else current_status
            event_type = "buyer_confirmed_terms"
        else:
            new_status = "cancelled"
            event_type = "buyer_declined_terms"

        # When buyer confirms a delivery proposal, activate delivery type so address becomes visible.
        is_delivery_confirm = bool(confirm) and requested_delivery_type == "delivery"

        with transaction.atomic():
            with connection.cursor() as cursor:
                if is_delivery_confirm:
                    cursor.execute(
                        """
                        UPDATE orders
                        SET status = %s,
                            seller_decision_state = 'approved',
                            active_delivery_type = 'delivery',
                            delivery_type = 'delivery',
                            updated_at = now()
                        WHERE id = %s
                        """,
                        [new_status, order_id_str],
                    )
                else:
                    cursor.execute(
                        """
                        UPDATE orders
                        SET status = %s,
                            seller_decision_state = CASE WHEN %s THEN 'approved' ELSE seller_decision_state END,
                            updated_at = now()
                        WHERE id = %s
                        """,
                        [new_status, bool(confirm), order_id_str],
                    )
                cursor.execute(
                    """
                    INSERT INTO order_events (id, order_id, event_type, actor_user_id, from_status, to_status, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        str(uuid.uuid4()),
                        order_id_str,
                        event_type,
                        user_id,
                        current_status,
                        new_status,
                        _json_dumps({"confirm": bool(confirm)}),
                    ],
                )
                if bool(confirm):
                    _create_notification(
                        cursor,
                        str(order["seller_id"]),
                        "buyer_confirmed_delivery",
                        "Ödeme onayı tamamlandı",
                        "Alıcı teklifi onayladı. Siparişi hazırlamaya başlayabilirsin.",
                        {"orderId": order_id_str, "buyerId": user_id, "status": "seller_approved"},
                    )

        return Response({"data": {"status": new_status}}, status=status.HTTP_200_OK)


class OrderNotesView(APIView):
    """GET /v1/orders/:order_id/notes  — list notes
       POST /v1/orders/:order_id/notes — add a note"""

    # Messaging is only open during negotiation phases; closes once agreement is reached.
    NON_MESSAGEABLE_STATUSES = {
        'seller_approved', 'awaiting_payment', 'paid',
        'preparing', 'ready', 'in_delivery', 'approaching',
        'at_door', 'delivered', 'completed', 'cancelled',
    }

    def _get_order_parties(self, order_id_str):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT buyer_id, seller_id, status FROM orders WHERE id = %s",
                [order_id_str],
            )
            return _dictfetchone(cursor)

    def get(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        user_id = str(user.id)
        order_id_str = str(order_id)
        order = self._get_order_parties(order_id_str)

        if order is None:
            return Response({"error": {"code": "NOT_FOUND", "message": "Sipariş bulunamadı."}}, status=status.HTTP_404_NOT_FOUND)

        if user_id not in (str(order['buyer_id']), str(order['seller_id'])):
            return Response({"error": {"code": "FORBIDDEN", "message": "Erişim reddedildi."}}, status=status.HTTP_403_FORBIDDEN)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT oe.id, oe.event_type, oe.actor_user_id, oe.payload_json, oe.created_at,
                       u.display_name AS sender_name
                FROM order_events oe
                LEFT JOIN users u ON u.id = oe.actor_user_id
                WHERE oe.order_id = %s AND oe.event_type IN ('buyer_note', 'seller_note')
                ORDER BY oe.created_at ASC
                """,
                [order_id_str],
            )
            rows = _dictfetchall(cursor)

        data = []
        for row in rows:
            payload = _json_object(row['payload_json'])
            data.append({
                'id': str(row['id']),
                'senderRole': 'buyer' if row['event_type'] == 'buyer_note' else 'seller',
                'senderName': row['sender_name'] or '',
                'message': payload.get('message', ''),
                'createdAt': row['created_at'].isoformat() if row['created_at'] else None,
            })

        return Response({'data': data})

    def post(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        user_id = str(user.id)
        order_id_str = str(order_id)
        message = (request.data.get('message') or '').strip()

        if not message:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "Mesaj boş olamaz."}}, status=status.HTTP_400_BAD_REQUEST)
        if len(message) > 500:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "Mesaj en fazla 500 karakter olabilir."}}, status=status.HTTP_400_BAD_REQUEST)

        order = self._get_order_parties(order_id_str)
        if order is None:
            return Response({"error": {"code": "NOT_FOUND", "message": "Sipariş bulunamadı."}}, status=status.HTTP_404_NOT_FOUND)

        buyer_id = str(order['buyer_id'])
        seller_id = str(order['seller_id'])

        if user_id == buyer_id:
            event_type = 'buyer_note'
            sender_role = 'buyer'
        elif user_id == seller_id:
            event_type = 'seller_note'
            sender_role = 'seller'
        else:
            return Response({"error": {"code": "FORBIDDEN", "message": "Erişim reddedildi."}}, status=status.HTTP_403_FORBIDDEN)

        if order['status'] in self.NON_MESSAGEABLE_STATUSES:
            return Response({"error": {"code": "INVALID_STATE", "message": "Bu sipariş için not gönderilemez."}}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        note_id = str(uuid.uuid4())
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO order_events
                        (id, order_id, event_type, actor_user_id, payload_json, created_at)
                    VALUES (%s, %s, %s, %s, %s, now())
                    """,
                    [note_id, order_id_str, event_type, user_id, _json_dumps({'message': message})],
                )
                # Bump updated_at so realtime subscribers see the change immediately.
                cursor.execute(
                    "UPDATE orders SET updated_at = now() WHERE id = %s",
                    [order_id_str],
                )
                cursor.execute("SELECT display_name FROM users WHERE id = %s", [user_id])
                user_row = _dictfetchone(cursor)

        sender_name = (user_row or {}).get('display_name', '')
        recipient_user_id = seller_id if user_id == buyer_id else buyer_id
        preview = (message[:117] + "...") if len(message) > 120 else message
        with connection.cursor() as cursor:
            _create_notification(
                cursor,
                recipient_user_id,
                "order_note_message",
                "Sipariş mesajı",
                message,
                {
                    "orderId": order_id_str,
                    "senderRole": sender_role,
                    "senderName": sender_name or "",
                    "messagePreview": preview,
                },
            )

        import datetime
        return Response({
            'data': {
                'id': note_id,
                'senderRole': sender_role,
                'senderName': sender_name or '',
                'message': message,
                'createdAt': datetime.datetime.utcnow().isoformat() + 'Z',
            }
        }, status=status.HTTP_201_CREATED)

        return Response({"data": {"orderId": order_id_str, "status": new_status}})


class DeliveryProofView(APIView):
    """GET /v1/orders/:order_id/delivery-proof — buyer retrieves their PIN"""

    def get(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        user_id = str(user.id)
        order_id_str = str(order_id)

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, status, buyer_id FROM orders WHERE id = %s",
                [order_id_str],
            )
            order = _dictfetchone(cursor)

        if order is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        if str(order["buyer_id"]) != user_id:
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "Only the buyer can view the delivery PIN"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, proof_mode, pin_sent_at, pin_verified_at,
                       verification_attempts, status, metadata_json
                FROM delivery_proof_records
                WHERE order_id = %s
                """,
                [order_id_str],
            )
            proof = _dictfetchone(cursor)

        if proof is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Delivery proof record not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Allow buyer screen to resolve gracefully after seller verification.
        # If order moved forward (delivered/completed) and proof is verified,
        # return verified payload so client can auto-close PIN screen.
        if order["status"] != "at_door":
            if str(proof.get("status") or "") == "verified" and str(order["status"] or "") in ("delivered", "completed"):
                return Response({
                    "data": {
                        "orderId": order_id_str,
                        "proofMode": proof["proof_mode"],
                        "pin": None,
                        "pinSentAt": proof["pin_sent_at"].isoformat() if proof["pin_sent_at"] else None,
                        "pinVerifiedAt": proof["pin_verified_at"].isoformat() if proof["pin_verified_at"] else None,
                        "verificationAttempts": proof["verification_attempts"],
                        "status": "verified",
                    }
                })
            return Response(
                {"error": {"code": "INVALID_STATE", "message": "Delivery PIN is only available when order is at_door"}},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        meta = _json_object(proof["metadata_json"])
        plain_pin = meta.get("pin") if proof["status"] == "pending" else None

        return Response({
            "data": {
                "orderId": order_id_str,
                "proofMode": proof["proof_mode"],
                "pin": plain_pin,
                "pinSentAt": proof["pin_sent_at"].isoformat() if proof["pin_sent_at"] else None,
                "pinVerifiedAt": proof["pin_verified_at"].isoformat() if proof["pin_verified_at"] else None,
                "verificationAttempts": proof["verification_attempts"],
                "status": proof["status"],
            }
        })


class VerifyDeliveryPinView(APIView):
    """POST /v1/orders/:order_id/verify-delivery-pin — seller submits PIN to confirm delivery"""

    MAX_ATTEMPTS = 5

    def post(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        user_id = str(user.id)
        order_id_str = str(order_id)
        submitted_pin = str(request.data.get("pin") or "").strip()

        if not submitted_pin:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "pin is required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, status, seller_id, buyer_id FROM orders WHERE id = %s",
                [order_id_str],
            )
            order = _dictfetchone(cursor)

        if order is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        if str(order["seller_id"]) != user_id:
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "Only the seller can verify the delivery PIN"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        if order["status"] != "at_door":
            return Response(
                {"error": {"code": "INVALID_STATE", "message": "PIN verification is only valid when order is at_door"}},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, pin_hash, verification_attempts, status FROM delivery_proof_records WHERE order_id = %s",
                [order_id_str],
            )
            proof = _dictfetchone(cursor)

        if proof is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Delivery proof record not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        if proof["status"] in ("verified", "failed"):
            return Response(
                {"error": {"code": "INVALID_STATE", "message": f"Delivery proof is already {proof['status']}"}},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        attempts = int(proof["verification_attempts"] or 0)

        if attempts >= self.MAX_ATTEMPTS:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE delivery_proof_records SET status = 'failed', metadata_json = NULL WHERE order_id = %s",
                    [order_id_str],
                )
            return Response(
                {"error": {"code": "TOO_MANY_ATTEMPTS", "message": "Maximum PIN attempts exceeded"}},
                status=status.HTTP_423_LOCKED,
            )

        pin_valid = check_password(submitted_pin, proof["pin_hash"])

        with transaction.atomic():
            with connection.cursor() as cursor:
                if pin_valid:
                    cursor.execute(
                        """
                        UPDATE delivery_proof_records
                        SET status = 'verified', pin_verified_at = now(), metadata_json = NULL
                        WHERE order_id = %s
                        """,
                        [order_id_str],
                    )
                    # Transition at_door → delivered → completed atomically so the
                    # mobile only needs to refresh; no extra status calls required.
                    cursor.execute(
                        "UPDATE orders SET status = 'completed', updated_at = now() WHERE id = %s",
                        [order_id_str],
                    )
                    cursor.execute(
                        """
                        INSERT INTO order_events (id, order_id, event_type, actor_user_id, from_status, to_status, payload_json)
                        VALUES (%s, %s, 'delivery_pin_verified', %s, 'at_door', 'delivered', %s),
                               (%s, %s, 'status_changed_to_completed', %s, 'delivered', 'completed', %s)
                        """,
                        [
                            str(uuid.uuid4()), order_id_str, user_id, _json_dumps({"sellerId": user_id}),
                            str(uuid.uuid4()), order_id_str, user_id, _json_dumps({"sellerId": user_id}),
                        ],
                    )
                    _create_notification(
                        cursor,
                        str(order["buyer_id"]),
                        "order_completed",
                        "Teslimat tamamlandı",
                        "Siparişin teslim edildi. Afiyet olsun!",
                        {"orderId": order_id_str},
                    )
                else:
                    cursor.execute(
                        "UPDATE delivery_proof_records SET verification_attempts = verification_attempts + 1 WHERE order_id = %s",
                        [order_id_str],
                    )

        if pin_valid:
            return Response({"data": {"orderId": order_id_str, "status": "completed", "verified": True}})

        remaining = self.MAX_ATTEMPTS - attempts - 1
        return Response(
            {
                "error": {
                    "code": "INVALID_PIN",
                    "message": "Yanlış kod.",
                    "remainingAttempts": max(0, remaining),
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
