import json
import uuid

from django.db import connection, ProgrammingError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.permissions import IsAppRealm
from apps.common.responses import error_response


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
                           cc.name AS category_name,
                           COALESCE(o.active_delivery_type, o.delivery_type, o.requested_delivery_type, 'pickup') AS delivery_type,
                           (
                               SELECT f.name
                               FROM order_items oi
                               LEFT JOIN foods f ON f.id = oi.food_id
                               WHERE oi.order_id = c.order_id
                               ORDER BY oi.created_at
                               LIMIT 1
                           ) AS primary_food_name
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
                           cc.name AS category_name,
                           COALESCE(o.active_delivery_type, o.delivery_type, o.requested_delivery_type, 'pickup') AS delivery_type,
                           (
                               SELECT f.name
                               FROM order_items oi
                               LEFT JOIN foods f ON f.id = oi.food_id
                               WHERE oi.order_id = c.order_id
                               ORDER BY oi.created_at
                               LIMIT 1
                           ) AS primary_food_name
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
            cols = [
                "id",
                "orderId",
                "status",
                "priority",
                "description",
                "createdAt",
                "ticketNo",
                "categoryName",
                "deliveryType",
                "primaryFoodName",
            ]
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
            return error_response("VALIDATION_ERROR", "category and description are required", 400)

        if not order_id:
            return error_response("VALIDATION_ERROR", "orderId is required", 400)

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
                return error_response("NOT_FOUND", "Order not found", 404)

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
                return error_response("DUPLICATE_COMPLAINT", "A complaint already exists for this order", 409)

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
            return error_response("NOT_FOUND", "Ticket not found", 404)

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
            return error_response("VALIDATION_ERROR", "body is required", 400)

        with connection.cursor() as cur:
            if actor_role == "seller":
                cur.execute(
                    """
                    SELECT c.id, c.status, c.assigned_admin_id, c.ticket_no
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
                    SELECT c.id, c.status, c.assigned_admin_id, c.ticket_no
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
                return error_response("NOT_FOUND", "Ticket not found", 404)
            complaint_status = str(complaint_row[1] or "").strip().lower()
            if complaint_status in {"resolved", "closed"}:
                return error_response("TICKET_CLOSED", "Ticket is closed for messaging", 409)
            assigned_admin_id = complaint_row[2]
            ticket_no = complaint_row[3]

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
                    return error_response("ADMIN_REPLY_REQUIRED", "Admin must send the first reply", 409)

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

                admin_ids = []
                if assigned_admin_id:
                    admin_ids.append(str(assigned_admin_id))
                else:
                    cur.execute(
                        """
                        SELECT DISTINCT tm.author_admin_id
                        FROM ticket_messages tm
                        WHERE tm.complaint_id = %s
                          AND tm.author_admin_id IS NOT NULL
                        ORDER BY tm.author_admin_id
                        """,
                        [complaint_id],
                    )
                    admin_ids = [str(row[0]) for row in cur.fetchall() if row[0]]

                if admin_ids:
                    placeholders = ", ".join(["%s"] * len(admin_ids))
                    cur.execute(
                        f"""
                        SELECT u.id
                        FROM admin_users au
                        JOIN users u
                          ON lower(trim(u.email)) = lower(trim(au.email))
                        WHERE au.id IN ({placeholders})
                        """,
                        admin_ids,
                    )
                    target_user_ids = [str(row[0]) for row in cur.fetchall() if row[0]]

                    for target_user_id in target_user_ids:
                        cur.execute(
                            """
                            INSERT INTO notification_events (
                                id,
                                user_id,
                                type,
                                title,
                                body,
                                data_json,
                                is_read,
                                created_at
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, FALSE, now())
                            """,
                            [
                                str(uuid.uuid4()),
                                target_user_id,
                                "complaint_message",
                                f"Şikayet #{ticket_no}",
                                body,
                                json.dumps(
                                    {
                                        "complaintId": str(complaint_id),
                                        "ticketNo": ticket_no,
                                        "recipientRole": "admin",
                                        "senderRole": actor_role,
                                    },
                                    ensure_ascii=False,
                                ),
                            ],
                        )
        except ProgrammingError as exc:
            if "ticket_messages" in str(exc) or "does not exist" in str(exc):
                return error_response("NOT_IMPLEMENTED", "Ticket messages are not yet available", 501)
            raise

        return Response({"data": {"id": message_id}}, status=201)
