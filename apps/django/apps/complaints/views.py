from django.db import connection, ProgrammingError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView


class IsAppRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "app"


def _actor_role(request):
    role = str(request.headers.get("x-actor-role") or request.META.get("HTTP_X_ACTOR_ROLE") or "").strip().lower()
    return "seller" if role == "seller" else "buyer"


class ComplaintListCreateView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request):
        user_id = request.user.id
        actor_role = _actor_role(request)
        with connection.cursor() as cur:
            if actor_role == "seller":
                cur.execute(
                    """
                    SELECT c.id, c.order_id, c.status, c.priority, c.description, c.created_at, c.ticket_no,
                           cc.name AS category_name
                    FROM complaints c
                    LEFT JOIN complaint_categories cc ON cc.id = c.category_id
                    LEFT JOIN orders o ON o.id = c.order_id
                    WHERE o.seller_id = %s
                      AND EXISTS (
                          SELECT 1
                          FROM ticket_messages tm
                          WHERE tm.complaint_id = c.id
                            AND tm.author_type = 'admin'
                            AND tm.recipient_user_id = %s
                      )
                    ORDER BY c.created_at DESC
                    """,
                    [user_id, user_id],
                )
            else:
                cur.execute(
                    """
                    SELECT c.id, c.order_id, c.status, c.priority, c.description, c.created_at, c.ticket_no,
                           cc.name AS category_name
                    FROM complaints c
                    LEFT JOIN complaint_categories cc ON cc.id = c.category_id
                    LEFT JOIN orders o ON o.id = c.order_id
                    WHERE (
                        COALESCE(c.complainant_user_id, c.complainant_buyer_id) = %s
                        OR o.buyer_id = %s
                    )
                    ORDER BY c.created_at DESC
                    """,
                    [user_id, user_id],
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

        with connection.cursor() as cur:
            cur.execute(
                "SELECT id FROM complaint_categories WHERE code = %s AND is_active = TRUE",
                [category_code],
            )
            row = cur.fetchone()
            category_id = row[0] if row else category_code

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
                SELECT id, ticket_no
                FROM complaints
                WHERE order_id = %s
                  AND COALESCE(complainant_user_id, complainant_buyer_id) = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [order_id, user_id],
            )
            existing = cur.fetchone()
            if existing:
                return Response(
                    {
                        "error": {
                            "code": "DUPLICATE_COMPLAINT",
                            "message": "A complaint already exists for this order",
                        }
                    },
                    status=409,
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


class ComplaintDetailView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request, complaint_id):
        user_id = request.user.id
        user_id_str = str(user_id)
        actor_role = _actor_role(request)
        with connection.cursor() as cur:
            if actor_role == "seller":
                cur.execute(
                    """
                    SELECT c.id, c.order_id, c.status, c.priority, c.description, c.created_at,
                           c.ticket_no, cc.name AS category_name, c.resolution_note,
                           COALESCE(c.complainant_user_id, c.complainant_buyer_id) AS complainant_id
                    FROM complaints c
                    LEFT JOIN complaint_categories cc ON cc.id = c.category_id
                    LEFT JOIN orders o ON o.id = c.order_id
                    WHERE c.id = %s
                      AND o.seller_id = %s
                      AND EXISTS (
                          SELECT 1
                          FROM ticket_messages tm
                          WHERE tm.complaint_id = c.id
                            AND tm.author_type = 'admin'
                            AND tm.recipient_user_id = %s
                      )
                    """,
                    [complaint_id, user_id, user_id],
                )
            else:
                cur.execute(
                    """
                    SELECT c.id, c.order_id, c.status, c.priority, c.description, c.created_at,
                           c.ticket_no, cc.name AS category_name, c.resolution_note,
                           COALESCE(c.complainant_user_id, c.complainant_buyer_id) AS complainant_id
                    FROM complaints c
                    LEFT JOIN complaint_categories cc ON cc.id = c.category_id
                    LEFT JOIN orders o ON o.id = c.order_id
                    WHERE c.id = %s
                      AND (
                          COALESCE(c.complainant_user_id, c.complainant_buyer_id) = %s
                          OR o.buyer_id = %s
                      )
                    """,
                    [complaint_id, user_id, user_id],
                )
            row = cur.fetchone()

        if not row:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Ticket not found"}},
                status=404,
            )

        cols = ["id", "orderId", "status", "priority", "description", "createdAt",
                "ticketNo", "categoryName", "resolutionNote", "complainantId"]
        item = dict(zip(cols, row))
        item["id"] = str(item["id"])
        item["orderId"] = str(item["orderId"]) if item["orderId"] else None
        item["createdAt"] = item["createdAt"].isoformat() if item["createdAt"] else None
        item["complainantId"] = str(item["complainantId"]) if item["complainantId"] else None

        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        tm.id,
                        tm.author_type,
                        tm.author_user_id,
                        tm.author_admin_id,
                        tm.recipient_user_id,
                        tm.recipient_role,
                        tm.body,
                        tm.created_at,
                        COALESCE(au.display_name, au.email, 'Kullanıcı') AS author_user_name,
                        COALESCE(NULLIF(trim(concat_ws(' ', aa.name, aa.surname)), ''), aa.email, 'Admin') AS author_admin_name,
                        COALESCE(ru.display_name, ru.email, 'Kullanıcı') AS recipient_user_name
                    FROM ticket_messages tm
                    LEFT JOIN users au ON au.id = tm.author_user_id
                    LEFT JOIN admin_users aa ON aa.id = tm.author_admin_id
                    LEFT JOIN users ru ON ru.id = tm.recipient_user_id
                    WHERE tm.complaint_id = %s
                      AND (
                          tm.author_user_id = %s
                          OR tm.recipient_user_id = %s
                      )
                    ORDER BY tm.created_at ASC
                    """,
                    [complaint_id, user_id, user_id],
                )
                messages = []
                for msg in cur.fetchall():
                    messages.append({
                        "id": str(msg[0]),
                        "authorType": msg[1],
                        "authorUserId": str(msg[2]) if msg[2] else None,
                        "authorAdminId": str(msg[3]) if msg[3] else None,
                        "recipientUserId": str(msg[4]) if msg[4] else None,
                        "recipientRole": msg[5],
                        "senderName": msg[9] if msg[1] == "admin" else msg[8],
                        "recipientName": msg[10],
                        "body": msg[6],
                        "createdAt": msg[7].isoformat() if msg[7] else None,
                    })
            initial_body = (item.get("description") or "").strip()
            can_show_initial_as_message = item.get("complainantId") == user_id_str
            has_initial_message = any(
                m.get("authorType") == "user"
                and m.get("authorUserId") == user_id_str
                and (m.get("body") or "").strip() == initial_body
                for m in messages
            )
            if can_show_initial_as_message and initial_body and not has_initial_message:
                messages.insert(0, {
                    "id": f"initial-{item['id']}",
                    "authorType": "user",
                    "authorUserId": user_id_str,
                    "authorAdminId": None,
                    "recipientUserId": None,
                    "recipientRole": "admin",
                    "senderName": "Sen",
                    "recipientName": "Admin",
                    "body": initial_body,
                    "createdAt": item.get("createdAt"),
                })

            item["messages"] = messages
        except ProgrammingError:
            initial_body = (item.get("description") or "").strip()
            can_show_initial_as_message = item.get("complainantId") == user_id_str
            if can_show_initial_as_message and initial_body:
                item["messages"] = [{
                    "id": f"initial-{item['id']}",
                    "authorType": "user",
                    "authorUserId": user_id_str,
                    "authorAdminId": None,
                    "recipientUserId": None,
                    "recipientRole": "admin",
                    "senderName": "Sen",
                    "recipientName": "Admin",
                    "body": initial_body,
                    "createdAt": item.get("createdAt"),
                }]
            else:
                item["messages"] = []

        return Response({"data": item})


class ComplaintMessagesView(APIView):
    permission_classes = [IsAppRealm]

    def post(self, request, complaint_id):
        user_id = request.user.id
        actor_role = _actor_role(request)
        body = (request.data.get("body") or request.data.get("message") or "").strip()

        if not body:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "body is required"}},
                status=400,
            )

        with connection.cursor() as cur:
            if actor_role == "seller":
                cur.execute(
                    """
                    SELECT c.id, c.status
                    FROM complaints c
                    LEFT JOIN orders o ON o.id = c.order_id
                    WHERE c.id = %s
                      AND o.seller_id = %s
                      AND EXISTS (
                          SELECT 1
                          FROM ticket_messages tm
                          WHERE tm.complaint_id = c.id
                            AND tm.author_type = 'admin'
                            AND tm.recipient_user_id = %s
                      )
                    """,
                    [complaint_id, user_id, user_id],
                )
            else:
                cur.execute(
                    """
                    SELECT c.id, c.status
                    FROM complaints c
                    LEFT JOIN orders o ON o.id = c.order_id
                    WHERE c.id = %s
                      AND (
                          COALESCE(c.complainant_user_id, c.complainant_buyer_id) = %s
                          OR o.buyer_id = %s
                      )
                    """,
                    [complaint_id, user_id, user_id],
                )
            complaint_row = cur.fetchone()
            if not complaint_row:
                return Response(
                    {"error": {"code": "NOT_FOUND", "message": "Ticket not found"}},
                    status=404,
                )
            complaint_status = str(complaint_row[1] or "").strip().lower()
            if complaint_status in {"resolved", "closed"}:
                return Response(
                    {"error": {"code": "TICKET_CLOSED", "message": "Ticket is closed for messaging"}},
                    status=409,
                )

        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT 1
                    FROM ticket_messages tm
                    WHERE tm.complaint_id = %s
                      AND tm.author_type = 'admin'
                      AND (
                        tm.recipient_user_id = %s
                        OR (%s = 'buyer' AND tm.recipient_role IN ('complainant', 'buyer'))
                        OR (%s = 'seller' AND tm.recipient_role = 'seller')
                      )
                    LIMIT 1
                    """,
                    [complaint_id, user_id, actor_role, actor_role],
                )
                admin_started = cur.fetchone() is not None
                if not admin_started:
                    return Response(
                        {"error": {"code": "ADMIN_REPLY_REQUIRED", "message": "Admin must send the first reply"}},
                        status=409,
                    )

                cur.execute(
                    """
                    INSERT INTO ticket_messages (
                        id,
                        complaint_id,
                        author_type,
                        author_user_id,
                        author_admin_id,
                        recipient_user_id,
                        recipient_role,
                        body,
                        created_at
                    )
                    VALUES (gen_random_uuid(), %s, 'user', %s, NULL, NULL, 'admin', %s, now())
                    RETURNING id
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
