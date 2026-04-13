import json
import uuid

from django.db import connection, transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

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
    "in_delivery": ["approaching", "delivered"],
    "approaching": ["at_door", "delivered"],
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


def _dictfetchone(cursor):
    """Return a single row as a dict, or None."""
    row = cursor.fetchone()
    if row is None:
        return None
    columns = [col[0] for col in cursor.description]
    return dict(zip(columns, row))


def _dictfetchall(cursor):
    """Return all rows as a list of dicts."""
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _json_dumps(value):
    return json.dumps(value, ensure_ascii=False)


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
                   ) AS items_json
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
                _create_notification(
                    cursor,
                    seller_id,
                    "order_created",
                    "Yeni liste geldi",
                    "Bir alıcı senden onay bekleyen yeni bir liste gönderdi.",
                    {
                        "orderId": order_id,
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
                       us.display_name AS seller_name
                FROM orders o
                JOIN users ub ON ub.id = o.buyer_id
                JOIN users us ON us.id = o.seller_id
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
                    "deliveryAddress": order["delivery_address_json"],
                    "buyerId": str(order["buyer_id"]),
                    "sellerId": str(order["seller_id"]),
                    "buyerName": order["buyer_name"],
                    "sellerName": order["seller_name"],
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

        current_status = order["status"]
        if not can_transition(current_status, new_status):
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
                    "UPDATE orders SET status = %s, updated_at = now() WHERE id = %s",
                    [new_status, order_id_str],
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
                    UPDATE orders
                    SET status = 'cancelled', updated_at = now()
                    WHERE id = %s
                      AND status NOT IN ('completed', 'delivered', 'cancelled')
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
                            "reason": cancel_reason or None,
                        }),
                    ],
                )
                if cancel_reason:
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
                cursor.execute(
                    """
                    UPDATE orders
                    SET requested_delivery_type = 'delivery',
                        updated_at = now()
                    WHERE id = %s
                    RETURNING requested_delivery_type, active_delivery_type
                    """,
                    [order_id_str],
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
        buyer_body = (
            "Satici teslimat istegini kabul etti."
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

                cursor.execute(
                    """
                    UPDATE orders
                    SET delivery_type = %s,
                        requested_delivery_type = %s,
                        active_delivery_type = %s,
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
                        current_status,
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
                    "status": current_status,
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
                "SELECT id, status, seller_id FROM orders WHERE id = %s",
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
                "SELECT id, status, buyer_id FROM orders WHERE id = %s",
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

        if order["status"] != "pending_buyer_confirmation":
            return Response(
                {"error": {"code": "INVALID_STATE", "message": "Bu sipariş onay beklemiyor."}},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        if confirm:
            new_status = "seller_approved"
            event_type = "buyer_confirmed_terms"
        else:
            new_status = "cancelled"
            event_type = "buyer_declined_terms"

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE orders
                    SET status = %s,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    [new_status, order_id_str],
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
                        "pending_buyer_confirmation",
                        new_status,
                        _json_dumps({"confirm": bool(confirm)}),
                    ],
                )


class OrderNotesView(APIView):
    """GET /v1/orders/:order_id/notes  — list notes
       POST /v1/orders/:order_id/notes — add a note"""

    NOTEABLE_STATUSES = {
        'pending_seller_approval', 'pending_buyer_confirmation',
        'seller_approved', 'awaiting_payment', 'paid', 'preparing', 'ready',
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
            payload = row['payload_json'] or {}
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

        if order['status'] not in self.NOTEABLE_STATUSES:
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
                cursor.execute("SELECT display_name FROM users WHERE id = %s", [user_id])
                user_row = _dictfetchone(cursor)

        sender_name = (user_row or {}).get('display_name', '')

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
