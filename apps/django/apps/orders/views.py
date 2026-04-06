from django.db import connection, transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

TRANSITIONS = {
    "pending":     ["preparing", "cancelled"],
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
            SELECT o.id, o.status, o.total_price, o.delivery_type, o.created_at,
                   o.buyer_id, o.seller_id,
                   ub.display_name AS buyer_name,
                   us.display_name AS seller_name
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
                "orderId": str(r["id"]),
                "status": r["status"],
                "totalPrice": float(r["total_price"]),
                "deliveryType": r["delivery_type"],
                "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
                "buyerId": str(r["buyer_id"]),
                "sellerId": str(r["seller_id"]),
                "buyerName": r["buyer_name"],
                "sellerName": r["seller_name"],
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

            # 2. Validate each food belongs to seller and is active
            food_ids = [item.get("foodId") for item in items]
            if any(f is None for f in food_ids):
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "Each item must have a foodId"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            placeholders = ", ".join(["%s"] * len(food_ids))
            cursor.execute(
                f"SELECT id FROM foods WHERE id IN ({placeholders}) AND seller_id = %s AND is_active = TRUE",
                food_ids + [seller_id],
            )
            valid_foods = {str(row[0]) for row in cursor.fetchall()}

            invalid = [fid for fid in food_ids if str(fid) not in valid_foods]
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

            # Fetch prices from DB
            cursor.execute(
                f"SELECT id, price FROM foods WHERE id IN ({placeholders}) AND seller_id = %s AND is_active = TRUE",
                food_ids + [seller_id],
            )
            food_prices = {str(row[0]): float(row[1]) for row in cursor.fetchall()}

        # 3. Validate quantities and inject prices from DB
        for item in items:
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
            item["unitPrice"] = food_prices.get(str(item.get("foodId")), 0.0)

        total_price = sum(i["quantity"] * i["unitPrice"] for i in items)

        with transaction.atomic():
            with connection.cursor() as cursor:
                # 4. Insert order
                cursor.execute(
                    """
                    INSERT INTO orders (buyer_id, seller_id, status, total_price,
                                       delivery_type, requested_delivery_type, active_delivery_type,
                                       seller_decision_state)
                    VALUES (%s, %s, 'pending', %s, %s, %s, %s, 'pending')
                    RETURNING id
                    """,
                    [buyer_id, seller_id, total_price, delivery_type, delivery_type, delivery_type],
                )
                order_id = str(cursor.fetchone()[0])

                # 5. Insert order items
                for item in items:
                    subtotal = item["quantity"] * item["unitPrice"]
                    cursor.execute(
                        """
                        INSERT INTO order_items (order_id, food_id, quantity, unit_price, line_total)
                        VALUES (%s, %s, %s, %s, %s)
                        """,
                        [order_id, item["foodId"], item["quantity"], item["unitPrice"], subtotal],
                    )

                # 6. Insert order event
                cursor.execute(
                    """
                    INSERT INTO order_events (order_id, event_type, actor_user_id, payload_json)
                    VALUES (%s, 'order_created', %s, '{}')
                    """,
                    [order_id, buyer_id],
                )

        return Response(
            {"data": {"orderId": order_id, "status": "pending", "totalPrice": total_price}},
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
                       o.created_at, o.updated_at,
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
                SELECT oi.id, oi.food_id, oi.quantity, oi.unit_price, oi.line_total,
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
                    "orderId": str(order["id"]),
                    "status": order["status"],
                    "totalPrice": float(order["total_price"]),
                    "deliveryType": order["delivery_type"],
                    "note": order["seller_delivery_note"],
                    "createdAt": order["created_at"].isoformat() if order["created_at"] else None,
                    "updatedAt": order["updated_at"].isoformat() if order["updated_at"] else None,
                    "buyerId": str(order["buyer_id"]),
                    "sellerId": str(order["seller_id"]),
                    "buyerName": order["buyer_name"],
                    "sellerName": order["seller_name"],
                    "items": [
                        {
                            "id": str(i["id"]),
                            "foodId": str(i["food_id"]),
                            "foodName": i["food_name"],
                            "quantity": i["quantity"],
                            "unitPrice": float(i["unit_price"]),
                            "subtotal": float(i["line_total"]),
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

        new_status = request.data.get("status")
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

        actor_type = "buyer" if user_id == buyer_id else "seller"

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE orders SET status = %s, updated_at = now() WHERE id = %s",
                    [new_status, order_id_str],
                )
                cursor.execute(
                    """
                    INSERT INTO order_events (order_id, event_type, actor_user_id, payload_json)
                    VALUES (%s, %s, %s, %s, '{}')
                    """,
                    [order_id_str, f"status_changed_to_{new_status}", actor_type, user_id],
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

        actor_type = "buyer" if user_id == buyer_id else "seller"

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
                    INSERT INTO order_events (order_id, event_type, actor_user_id, payload_json)
                    VALUES (%s, 'order_cancelled', %s, %s, '{}')
                    """,
                    [order_id_str, actor_type, user_id],
                )

        return Response({"data": {"orderId": order_id_str, "status": "cancelled"}})


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
        "approved": "preparing",
        "rejected": "cancelled",
        "revised": "pending",
    }

    def post(self, request, order_id):
        user, err = _check_app_auth(request)
        if err:
            return err

        decision = request.data.get("decision")
        note = request.data.get("note", "")

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

        # "revised" keeps the order in "pending" — only valid when currently pending
        if decision == "revised" and current_status != "pending":
            return Response(
                {
                    "error": {
                        "code": "INVALID_TRANSITION",
                        "message": "revised decision is only valid for pending orders",
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

        import json

        metadata = json.dumps({"decision": decision, "note": note})

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE orders SET status = %s, updated_at = now() WHERE id = %s",
                    [new_status, order_id_str],
                )
                cursor.execute(
                    """
                    INSERT INTO order_events (order_id, event_type, actor_user_id, payload_json)
                    VALUES (%s, 'seller_decision', 'seller', %s, %s)
                    """,
                    [order_id_str, user_id, metadata],
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
