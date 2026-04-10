import uuid
from django.db import connection, transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated


# ── Permissions ───────────────────────────────────────────────────────────────

class IsAppRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "app"


# ── Payment Status ────────────────────────────────────────────────────────────

class PaymentStatusView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request, order_id):
        user_id = request.user.id
        with connection.cursor() as cur:
            # Fetch order status (verify access at the same time)
            cur.execute(
                "SELECT status FROM orders WHERE id = %s AND (buyer_id = %s OR seller_id = %s)",
                [order_id, user_id, user_id],
            )
            order_row = cur.fetchone()

        if not order_row:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                status=404,
            )

        order_status = order_row[0]

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT pa.id, pa.status, pa.provider, pa.created_at, pa.updated_at
                FROM payment_attempts pa
                WHERE pa.order_id = %s
                ORDER BY pa.created_at DESC
                """,
                [order_id],
            )
            cols = ["id", "status", "provider", "createdAt", "updatedAt"]
            attempts = []
            for row in cur.fetchall():
                attempt = dict(zip(cols, row))
                attempt["id"] = str(attempt["id"])
                attempt["createdAt"] = attempt["createdAt"].isoformat() if attempt["createdAt"] else None
                attempt["updatedAt"] = attempt["updatedAt"].isoformat() if attempt["updatedAt"] else None
                attempts.append(attempt)

        latest_attempt = attempts[0] if attempts else None
        payment_completed = bool(order_status == "paid" or (latest_attempt and latest_attempt.get("status") == "paid"))

        return Response(
            {
                "data": {
                    "orderId": str(order_id),
                    "orderStatus": order_status,
                    "attempts": attempts,
                    "latestAttempt": latest_attempt,
                    "paymentCompleted": payment_completed,
                }
            }
        )


# ── Initiate Payment ──────────────────────────────────────────────────────────

class PaymentInitView(APIView):
    permission_classes = [IsAppRealm]

    def post(self, request):
        order_id = request.data.get("orderId")
        if not order_id:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "orderId is required"}},
                status=400,
            )

        user_id = request.user.id

        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, total_price, buyer_id, seller_decision_state
                    FROM orders
                    WHERE id = %s AND buyer_id = %s
                    """,
                    [order_id, user_id],
                )
                order = cur.fetchone()

            if not order:
                return Response(
                    {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                    status=404,
                )

            db_order_id, status, _, buyer_id, seller_decision_state = order

            if status not in (
                "pending",
                "pending_seller_approval",
                "seller_approved",
                "awaiting_payment",
                "paid",
                "preparing",
            ):
                return Response(
                    {"error": {"code": "INVALID_ORDER_STATUS", "message": f"Order status '{status}' does not allow payment"}},
                    status=409,
                )

            if status in ("seller_approved", "awaiting_payment", "paid", "preparing") and seller_decision_state not in ("approved", None):
                return Response(
                    {"error": {"code": "SELLER_NOT_APPROVED", "message": "Satıcı onayı bekleniyor"}},
                    status=409,
                )

            attempt_id = str(uuid.uuid4())
            provider_session_id = str(uuid.uuid4())

            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO payment_attempts (order_id, buyer_id, status, provider, provider_session_id)
                    VALUES (%s, %s, 'pending', 'mockpay', %s) RETURNING id
                    """,
                    [db_order_id, buyer_id, provider_session_id],
                )
                attempt_id = str(cur.fetchone()[0])
                cur.execute(
                    """
                    UPDATE orders
                    SET status = CASE
                        WHEN status IN ('pending', 'pending_seller_approval', 'seller_approved') THEN 'awaiting_payment'
                        ELSE status
                    END,
                        updated_at = now()
                    WHERE id = %s
                    """,
                    [db_order_id],
                )

        checkout_url = f"/v1/payments/mock-checkout?sessionId={attempt_id}&orderId={db_order_id}"

        return Response(
            {
                "data": {
                    "paymentUrl": checkout_url,
                    "checkoutUrl": checkout_url,
                    "attemptId": attempt_id,
                    "sessionId": attempt_id,
                    "provider": "mockpay",
                }
            },
            status=201,
        )


# ── Mock Process (dev only) ───────────────────────────────────────────────────

class MockProcessView(APIView):
    permission_classes = []

    def post(self, request):
        order_id = request.data.get("orderId")
        session_id = request.data.get("sessionId")
        result = request.data.get("result", "success")

        if not order_id and not session_id:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "orderId or sessionId is required"}},
                status=400,
            )

        if result not in ("success", "failed"):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "result must be 'success' or 'failed'"}},
                status=400,
            )

        with transaction.atomic():
            with connection.cursor() as cur:
                if session_id:
                    cur.execute(
                        """
                        SELECT id, order_id FROM payment_attempts
                        WHERE id = %s AND status = 'pending'
                        ORDER BY created_at DESC LIMIT 1
                        """,
                        [session_id],
                    )
                else:
                    cur.execute(
                        """
                        SELECT id, order_id FROM payment_attempts
                        WHERE order_id = %s AND status = 'pending'
                        ORDER BY created_at DESC LIMIT 1
                        """,
                        [order_id],
                    )
                row = cur.fetchone()

            if not row:
                return Response(
                    {"error": {"code": "NOT_FOUND", "message": "No pending payment attempt found for this order"}},
                    status=404,
                )

            attempt_id, resolved_order_id = row
            order_id = resolved_order_id

            with connection.cursor() as cur:
                if result == "success":
                    cur.execute(
                        "UPDATE payment_attempts SET status = 'paid' WHERE id = %s",
                        [attempt_id],
                    )
                    cur.execute(
                        """
                        UPDATE orders
                        SET status = 'paid',
                            payment_completed = TRUE,
                            payment_captured_at = now(),
                            updated_at = now()
                        WHERE id = %s AND status IN ('pending', 'pending_seller_approval', 'seller_approved', 'awaiting_payment', 'paid', 'preparing')
                        """,
                        [order_id],
                    )
                else:
                    cur.execute(
                        "UPDATE payment_attempts SET status = 'failed' WHERE id = %s",
                        [attempt_id],
                    )

        return Response({"data": {"result": result}})
