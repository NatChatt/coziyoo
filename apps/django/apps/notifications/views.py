from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated


# ── Permissions ───────────────────────────────────────────────────────────────

class IsAppRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "app"


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

        return Response({"data": {"items": items}})


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
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Notification not found"}},
                status=404,
            )

        return Response({"data": {"success": True}})


# ── Device Token ──────────────────────────────────────────────────────────────

class DeviceTokenView(APIView):
    permission_classes = [IsAppRealm]

    def put(self, request):
        user_id = request.user.id
        token = request.data.get("token")
        platform = request.data.get("platform")

        if not token or not platform:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "token and platform are required"}},
                status=400,
            )

        if platform not in ("ios", "android"):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "platform must be 'ios' or 'android'"}},
                status=400,
            )

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
