from django.db import connection, ProgrammingError
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated


# ── Permissions ───────────────────────────────────────────────────────────────

class IsAppRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "app"


# ── Complaint List & Create ───────────────────────────────────────────────────

class ComplaintListCreateView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request):
        user_id = request.user.id
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT c.id, c.order_id, c.status, c.priority, c.description, c.created_at, c.ticket_no,
                       cc.name AS category_name
                FROM complaints c
                LEFT JOIN complaint_categories cc ON cc.id = c.category_id
                WHERE c.complainant_user_id = %s
                ORDER BY c.created_at DESC
                """,
                [user_id],
            )
            cols = ["id", "orderId", "status", "priority", "description", "createdAt", "ticketNo", "categoryName"]
            items = []
            for row in cur.fetchall():
                item = dict(zip(cols, row))
                item["id"] = str(item["id"])
                item["orderId"] = str(item["orderId"]) if item["orderId"] else None
                item["createdAt"] = item["createdAt"].isoformat() if item["createdAt"] else None
                item["lastActivityAt"] = item["createdAt"]
                items.append(item)

        return Response({"data": {"items": items}})

    def post(self, request):
        user_id = request.user.id
        category_code = request.data.get("category") or request.data.get("categoryId")
        description = request.data.get("description")
        order_id = request.data.get("orderId")

        if not category_code or not description:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "category and description are required"}},
                status=400,
            )

        if not order_id:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "orderId is required"}},
                status=400,
            )

        # Resolve category code to UUID
        with connection.cursor() as cur:
            cur.execute(
                "SELECT id FROM complaint_categories WHERE code = %s AND is_active = TRUE",
                [category_code],
            )
            row = cur.fetchone()
            if not row:
                # Fallback: treat category_code as a direct UUID (legacy support)
                category_id = category_code
            else:
                category_id = row[0]

        # Verify the order belongs to this user
        with connection.cursor() as cur:
            cur.execute(
                "SELECT id FROM orders WHERE id = %s AND buyer_id = %s",
                [order_id, user_id],
            )
            if not cur.fetchone():
                return Response(
                    {"error": {"code": "NOT_FOUND", "message": "Order not found"}},
                    status=404,
                )

        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO complaints (complainant_user_id, category_id, description, order_id,
                                        status, priority, complainant_type)
                VALUES (%s, %s, %s, %s, 'open', 'medium', 'buyer')
                RETURNING id, ticket_no
                """,
                [user_id, category_id, description, order_id],
            )
            row = cur.fetchone()

        complaint_id, ticket_no = row
        return Response({"data": {"id": str(complaint_id), "ticketNo": ticket_no}}, status=201)


# ── Complaint Detail ──────────────────────────────────────────────────────────

class ComplaintDetailView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request, complaint_id):
        user_id = request.user.id
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT c.id, c.order_id, c.status, c.priority, c.description, c.created_at,
                       c.ticket_no, cc.name AS category_name, c.resolution_note
                FROM complaints c
                LEFT JOIN complaint_categories cc ON cc.id = c.category_id
                WHERE c.id = %s AND c.complainant_user_id = %s
                """,
                [complaint_id, user_id],
            )
            row = cur.fetchone()

        if not row:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Ticket not found"}},
                status=404,
            )

        cols = ["id", "orderId", "status", "priority", "description", "createdAt",
                "ticketNo", "categoryName", "resolutionNotes"]
        item = dict(zip(cols, row))
        item["id"] = str(item["id"])
        item["orderId"] = str(item["orderId"]) if item["orderId"] else None
        item["createdAt"] = item["createdAt"].isoformat() if item["createdAt"] else None
        item["lastActivityAt"] = item["createdAt"]
        item["messages"] = []

        return Response({"data": item})


# ── Complaint Messages ────────────────────────────────────────────────────────

class ComplaintMessagesView(APIView):
    permission_classes = [IsAppRealm]

    def post(self, request, complaint_id):
        user_id = request.user.id
        body = request.data.get("body") or request.data.get("message")

        if not body:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "body is required"}},
                status=400,
            )

        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO ticket_messages (complaint_id, author_id, author_type, body)
                    VALUES (%s, %s, 'user', %s) RETURNING id
                    """,
                    [complaint_id, user_id, body],
                )
                message_id = str(cur.fetchone()[0])
        except ProgrammingError as exc:
            if "ticket_messages" in str(exc) or "does not exist" in str(exc):
                return Response(
                    {"error": {"code": "NOT_IMPLEMENTED", "message": "Ticket messages are not yet available"}},
                    status=501,
                )
            raise

        return Response({"data": {"id": message_id}}, status=201)
