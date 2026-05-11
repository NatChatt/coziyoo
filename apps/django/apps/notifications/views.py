import uuid

from django.db import connection, transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from coziyoo.utils import _dictfetchone, _dictfetchall

from apps.common.permissions import IsAppRealm
from apps.common.responses import error_response
from apps.notifications.serializers import serialize_chat_message


def _resolve_chat_actor(request):
    actor_role = str(request.headers.get("x-actor-role") or request.META.get("HTTP_X_ACTOR_ROLE") or "").strip().lower()
    return "seller" if actor_role == "seller" else "buyer"


# ── List Notifications ────────────────────────────────────────────────────────

class NotificationListView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request):
        user_id = request.user.id
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, type, title, body, is_read, data_json, created_at
                FROM notification_events
                WHERE user_id = %s
                ORDER BY created_at DESC
                LIMIT 100
                """,
                [user_id],
            )
            cols = ["id", "type", "title", "body", "isRead", "data", "createdAt"]
            items = []
            for row in cur.fetchall():
                item = dict(zip(cols, row))
                item["id"] = str(item["id"])
                item["createdAt"] = item["createdAt"].isoformat() if item["createdAt"] else None
                items.append(item)

        return Response({"data": items})


# ── Mark Notification as Read ─────────────────────────────────────────────────

class MarkReadView(APIView):
    permission_classes = [IsAppRealm]

    def patch(self, request, notification_id):
        user_id = request.user.id
        with connection.cursor() as cur:
            cur.execute(
                "UPDATE notification_events SET is_read = TRUE WHERE id = %s AND user_id = %s RETURNING id",
                [notification_id, user_id],
            )
            row = cur.fetchone()

        if not row:
            return error_response("NOT_FOUND", "Notification not found", 404)

        return Response({"data": {"success": True}})


# ── Device Token ──────────────────────────────────────────────────────────────

class DeviceTokenView(APIView):
    permission_classes = [IsAppRealm]

    def put(self, request):
        user_id = request.user.id
        token = request.data.get("token")
        platform = request.data.get("platform")

        if not token or not platform:
            return error_response("VALIDATION_ERROR", "token and platform are required", 400)

        if platform not in ("ios", "android"):
            return error_response("VALIDATION_ERROR", "platform must be 'ios' or 'android'", 400)

        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_device_tokens (user_id, token, platform, is_active)
                VALUES (%s, %s, %s, TRUE)
                ON CONFLICT (token) DO UPDATE
                    SET user_id = %s, platform = %s, is_active = TRUE, updated_at = now()
                """,
                [user_id, token, platform, user_id, platform],
            )

        return Response({"data": {"success": True}})

    def delete(self, request):
        user_id = request.user.id
        token = request.data.get("token")

        with connection.cursor() as cur:
            if token:
                cur.execute(
                    "UPDATE user_device_tokens SET is_active = FALSE WHERE token = %s AND user_id = %s",
                    [token, user_id],
                )
            else:
                cur.execute(
                    "UPDATE user_device_tokens SET is_active = FALSE WHERE user_id = %s",
                    [user_id],
                )

        return Response({"data": {"success": True}})


class ChatListView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request):
        user_id = str(request.user.id)
        actor_role = _resolve_chat_actor(request)
        with connection.cursor() as cur:
            if actor_role == "seller":
                cur.execute(
                    """
                    SELECT
                        c.id,
                        c.buyer_id AS counterpart_id,
                        COALESCE(u.display_name, u.email, 'Müşteri') AS counterpart_name,
                        u.profile_image_url AS counterpart_image,
                        c.last_message,
                        c.last_message_time,
                        COALESCE(c.seller_unread_count, 0) AS unread_count
                    FROM chats c
                    JOIN users u ON u.id = c.buyer_id
                    WHERE c.seller_id = %s
                      AND COALESCE(c.is_active, TRUE) = TRUE
                    ORDER BY c.last_message_time DESC NULLS LAST, c.created_at DESC
                    """,
                    [user_id],
                )
            else:
                cur.execute(
                    """
                    SELECT
                        c.id,
                        c.seller_id AS counterpart_id,
                        COALESCE(u.display_name, u.email, 'Usta') AS counterpart_name,
                        u.profile_image_url AS counterpart_image,
                        c.last_message,
                        c.last_message_time,
                        COALESCE(c.buyer_unread_count, 0) AS unread_count
                    FROM chats c
                    JOIN users u ON u.id = c.seller_id
                    WHERE c.buyer_id = %s
                      AND COALESCE(c.is_active, TRUE) = TRUE
                    ORDER BY c.last_message_time DESC NULLS LAST, c.created_at DESC
                    """,
                    [user_id],
                )
            rows = _dictfetchall(cur)

        items = []
        for row in rows:
            items.append(
                {
                    "id": str(row["id"]),
                    "sellerId": str(row["counterpart_id"]),
                    "sellerName": str(row["counterpart_name"] or ("Müşteri" if actor_role == "seller" else "Usta")),
                    "sellerImage": row["counterpart_image"],
                    "lastMessage": row["last_message"],
                    "lastMessageTime": row["last_message_time"].isoformat() if row["last_message_time"] else None,
                    "buyerUnreadCount": int(row["unread_count"] or 0),
                }
            )

        return Response({"data": items})


class ChatBootstrapView(APIView):
    permission_classes = [IsAppRealm]

    def post(self, request):
        buyer_id = str(request.user.id)
        seller_id = str(request.data.get("sellerId") or "").strip()
        initial_message = str(request.data.get("initialMessage") or "").strip()

        if not seller_id:
            return error_response("VALIDATION_ERROR", "sellerId is required", status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, seller_id, COALESCE(is_active, TRUE) AS is_active
                    FROM chats
                    WHERE buyer_id = %s AND seller_id = %s
                    ORDER BY last_message_time DESC NULLS LAST, created_at DESC
                    LIMIT 1
                    """,
                    [buyer_id, seller_id],
                )
                chat = _dictfetchone(cur)

                if chat is None:
                    chat_id = str(uuid.uuid4())
                    cur.execute(
                        """
                        INSERT INTO chats (
                            id, buyer_id, seller_id, order_id, last_message, last_message_time,
                            last_message_sender, buyer_unread_count, seller_unread_count,
                            is_active, created_at, updated_at
                        )
                        VALUES (%s, %s, %s, NULL, NULL, NULL, NULL, 0, 0, TRUE, now(), now())
                        """,
                        [chat_id, buyer_id, seller_id],
                    )
                else:
                    chat_id = str(chat["id"])
                    if not bool(chat.get("is_active", True)):
                        cur.execute(
                            "UPDATE chats SET is_active = TRUE, updated_at = now() WHERE id = %s",
                            [chat_id],
                        )

                if initial_message:
                    message_id = str(uuid.uuid4())
                    cur.execute(
                        """
                        INSERT INTO messages (
                            id, chat_id, sender_id, sender_type, message, message_type,
                            order_data_json, is_read, created_at
                        )
                        VALUES (%s, %s, %s, 'buyer', %s, 'text', NULL, TRUE, now())
                        """,
                        [message_id, chat_id, buyer_id, initial_message],
                    )
                    cur.execute(
                        """
                        UPDATE chats
                        SET last_message = %s,
                            last_message_time = now(),
                            last_message_sender = 'buyer',
                            seller_unread_count = COALESCE(seller_unread_count, 0) + 1,
                            updated_at = now()
                        WHERE id = %s
                        """,
                        [initial_message, chat_id],
                    )

                cur.execute(
                    """
                    SELECT
                        c.id,
                        COALESCE(u.display_name, u.email, 'Usta') AS seller_name,
                        c.last_message_time
                    FROM chats c
                    JOIN users u ON u.id = c.seller_id
                    WHERE c.id = %s
                    LIMIT 1
                    """,
                    [chat_id],
                )
                payload = _dictfetchone(cur)

        return Response(
            {
                "data": {
                    "chatId": str(payload["id"]),
                    "sellerName": str(payload["seller_name"] or "Usta"),
                    "lastMessageTime": payload["last_message_time"].isoformat() if payload["last_message_time"] else None,
                }
            }
        )


class ChatMessagesView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request, chat_id):
        user_id = str(request.user.id)
        actor_role = _resolve_chat_actor(request)

        with transaction.atomic():
            with connection.cursor() as cur:
                if actor_role == "seller":
                    cur.execute(
                        """
                        SELECT id
                        FROM chats
                        WHERE id = %s AND seller_id = %s
                        LIMIT 1
                        """,
                        [str(chat_id), user_id],
                    )
                else:
                    cur.execute(
                        """
                        SELECT id
                        FROM chats
                        WHERE id = %s AND buyer_id = %s
                        LIMIT 1
                        """,
                        [str(chat_id), user_id],
                    )
                if cur.fetchone() is None:
                    return error_response("NOT_FOUND", "Chat not found", status.HTTP_404_NOT_FOUND)

                cur.execute(
                    """
                    UPDATE messages
                    SET is_read = TRUE
                    WHERE chat_id = %s AND sender_type = %s AND COALESCE(is_read, FALSE) = FALSE
                    """,
                    [str(chat_id), "buyer" if actor_role == "seller" else "seller"],
                )
                if actor_role == "seller":
                    cur.execute(
                        "UPDATE chats SET seller_unread_count = 0, updated_at = now() WHERE id = %s",
                        [str(chat_id)],
                    )
                else:
                    cur.execute(
                        "UPDATE chats SET buyer_unread_count = 0, updated_at = now() WHERE id = %s",
                        [str(chat_id)],
                    )
                cur.execute(
                    """
                    SELECT id, sender_id, sender_type, message, message_type, COALESCE(is_read, FALSE) AS is_read, created_at
                    FROM messages
                    WHERE chat_id = %s
                    ORDER BY created_at ASC
                    """,
                    [str(chat_id)],
                )
                rows = _dictfetchall(cur)

        items = [serialize_chat_message(row) for row in rows]

        return Response({"data": items})

    def post(self, request, chat_id):
        user_id = str(request.user.id)
        actor_role = _resolve_chat_actor(request)
        message = str(request.data.get("message") or "").strip()
        message_type = str(request.data.get("messageType") or "text").strip().lower()

        if not message:
            return error_response("VALIDATION_ERROR", "message is required", status.HTTP_400_BAD_REQUEST)
        if message_type != "text":
            return error_response("VALIDATION_ERROR", "messageType must be text", status.HTTP_400_BAD_REQUEST)

        message_id = str(uuid.uuid4())

        with transaction.atomic():
            with connection.cursor() as cur:
                if actor_role == "seller":
                    cur.execute(
                        """
                        SELECT id
                        FROM chats
                        WHERE id = %s AND seller_id = %s
                        LIMIT 1
                        """,
                        [str(chat_id), user_id],
                    )
                else:
                    cur.execute(
                        """
                        SELECT id
                        FROM chats
                        WHERE id = %s AND buyer_id = %s
                        LIMIT 1
                        """,
                        [str(chat_id), user_id],
                    )
                if cur.fetchone() is None:
                    return error_response("NOT_FOUND", "Chat not found", status.HTTP_404_NOT_FOUND)

                cur.execute(
                    """
                    INSERT INTO messages (
                        id, chat_id, sender_id, sender_type, message, message_type,
                        order_data_json, is_read, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, 'text', NULL, TRUE, now())
                    RETURNING id, sender_id, sender_type, message, message_type, is_read, created_at
                    """,
                    [message_id, str(chat_id), user_id, actor_role, message],
                )
                row = _dictfetchone(cur)
                if actor_role == "seller":
                    cur.execute(
                        """
                        UPDATE chats
                        SET last_message = %s,
                            last_message_time = now(),
                            last_message_sender = 'seller',
                            buyer_unread_count = COALESCE(buyer_unread_count, 0) + 1,
                            updated_at = now()
                        WHERE id = %s
                        """,
                        [message, str(chat_id)],
                    )
                else:
                    cur.execute(
                        """
                        UPDATE chats
                        SET last_message = %s,
                            last_message_time = now(),
                            last_message_sender = 'buyer',
                            seller_unread_count = COALESCE(seller_unread_count, 0) + 1,
                            updated_at = now()
                        WHERE id = %s
                        """,
                        [message, str(chat_id)],
                    )

        return Response({"data": serialize_chat_message(row)})
