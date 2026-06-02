import json
import uuid

from django.db import connection, transaction
from rest_framework.exceptions import AuthenticationFailed
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.authentication.backends import CoziyooJWTAuthentication as BaseJWTAuthentication
from apps.authentication.security import verify_password
from apps.authentication.token_service import (
    generate_refresh_token,
    hash_refresh_token,
    refresh_expires_at,
    sign_access_token,
)
from apps.common.permissions import IsAdminRealm
from apps.common.responses import error_response
from coziyoo.dashboard_views import dashboard_data


class AdminJWTAuthentication(BaseJWTAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None

        user, token = result
        if getattr(user, "realm", None) != "admin":
            raise AuthenticationFailed({"code": "INVALID_TOKEN", "message": "Admin token required"})
        return user, token


class AdminAPIView(APIView):
    authentication_classes = [AdminJWTAuthentication]
    permission_classes = [IsAdminRealm]


from apps.common.db import (
    rows_as_dicts as _rows_as_dicts,
    row_as_dict as _row_as_dict,
    stringify_uuids as _stringify_uuids,
)


def _admin_payload(row):
    return {
        "id": str(row["id"]),
        "email": row["email"],
        "role": row["role"],
        "name": row.get("name"),
        "surname": row.get("surname"),
    }


def _log_security_login_event(*, realm: str, identifier: str, success: bool, failure_reason: str | None = None, actor_user_id: str | None = None, request=None):
    with connection.cursor() as cursor:
        cursor.execute(
            """
                INSERT INTO security_login_events
                    (id, realm, actor_user_id, identifier, success, failure_reason, device_id, device_name, ip, user_agent, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            """,
            [
                str(uuid.uuid4()),
                realm,
                actor_user_id,
                identifier,
                success,
                failure_reason,
                None,
                None,
                request.META.get("REMOTE_ADDR", "") if request else "",
                request.META.get("HTTP_USER_AGENT", "") if request else "",
            ],
        )


class AdminLoginView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        email = str(request.data.get("email", "")).strip().lower()
        password = str(request.data.get("password", ""))
        if not email or not password:
            return error_response("VALIDATION_ERROR", "email and password required", status.HTTP_400_BAD_REQUEST)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, email, password_hash, role, is_active, name, surname
                    FROM admin_users
                    WHERE email = %s
                """,
                [email],
            )
            admin_user = _row_as_dict(cursor)

        if not admin_user or not verify_password(admin_user["password_hash"], password):
            _log_security_login_event(
                realm="admin",
                identifier=email,
                success=False,
                failure_reason="invalid_credentials",
                request=request,
            )
            return error_response("INVALID_CREDENTIALS", "Email or password invalid", status.HTTP_401_UNAUTHORIZED)

        if not admin_user["is_active"]:
            _log_security_login_event(
                realm="admin",
                identifier=email,
                success=False,
                failure_reason="account_disabled",
                actor_user_id=str(admin_user["id"]),
                request=request,
            )
            return error_response("ACCOUNT_DISABLED", "Account is disabled", status.HTTP_403_FORBIDDEN)

        refresh_token = generate_refresh_token()
        session_id = str(uuid.uuid4())
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    INSERT INTO admin_auth_sessions
                        (id, admin_user_id, refresh_token_hash, expires_at, device_info, ip, created_at, last_used_at)
                    VALUES (%s, %s, %s, %s, %s, %s, now(), now())
                """,
                [
                    session_id,
                    str(admin_user["id"]),
                    hash_refresh_token(refresh_token),
                    refresh_expires_at(),
                    request.META.get("HTTP_USER_AGENT", ""),
                    request.META.get("REMOTE_ADDR", ""),
                ],
            )

        _log_security_login_event(
            realm="admin",
            identifier=email,
            success=True,
            actor_user_id=str(admin_user["id"]),
            request=request,
        )
        access_token = sign_access_token(str(admin_user["id"]), session_id, "admin", str(admin_user["role"]))
        return Response(
            {
                "data": {
                    "user": _admin_payload(admin_user),
                    "tokens": {
                        "accessToken": access_token,
                        "refreshToken": refresh_token,
                        "tokenType": "Bearer",
                    },
                }
            }
        )


class AdminRefreshView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        refresh_token = str(request.data.get("refreshToken", "")).strip()
        if not refresh_token:
            return error_response("VALIDATION_ERROR", "refreshToken required", status.HTTP_400_BAD_REQUEST)

        refresh_hash = hash_refresh_token(refresh_token)
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                        SELECT s.id, s.admin_user_id, a.role
                        FROM admin_auth_sessions s
                        JOIN admin_users a ON a.id = s.admin_user_id
                        WHERE s.refresh_token_hash = %s
                          AND s.revoked_at IS NULL
                          AND s.expires_at > now()
                          AND a.is_active = TRUE
                    """,
                    [refresh_hash],
                )
                row = cursor.fetchone()
                if not row:
                    return error_response("REFRESH_INVALID", "Invalid or expired refresh token", status.HTTP_401_UNAUTHORIZED)

                old_session_id, admin_user_id, role = row
                cursor.execute("UPDATE admin_auth_sessions SET revoked_at = now() WHERE id = %s", [old_session_id])

                new_refresh = generate_refresh_token()
                new_session_id = str(uuid.uuid4())
                cursor.execute(
                    """
                        INSERT INTO admin_auth_sessions
                            (id, admin_user_id, refresh_token_hash, expires_at, device_info, ip, created_at, last_used_at)
                        VALUES (%s, %s, %s, %s, %s, %s, now(), now())
                    """,
                    [
                        new_session_id,
                        admin_user_id,
                        hash_refresh_token(new_refresh),
                        refresh_expires_at(),
                        request.META.get("HTTP_USER_AGENT", ""),
                        request.META.get("REMOTE_ADDR", ""),
                    ],
                )

        access_token = sign_access_token(str(admin_user_id), new_session_id, "admin", str(role))
        return Response(
            {
                "data": {
                    "tokens": {
                        "accessToken": access_token,
                        "refreshToken": new_refresh,
                        "tokenType": "Bearer",
                    }
                }
            }
        )


class AdminMeView(AdminAPIView):
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, email, role, name, surname
                    FROM admin_users
                    WHERE id = %s AND is_active = TRUE
                """,
                [request.user.id],
            )
            row = _row_as_dict(cursor)

        if row is None:
            return error_response("NOT_FOUND", "Admin user not found", status.HTTP_404_NOT_FOUND)

        return Response({"data": _admin_payload(row)})


class AdminDashboardOverviewView(AdminAPIView):
    def get(self, request):
        response = dashboard_data(request)
        return Response(json.loads(response.content))


class AdminDashboardReviewQueueView(AdminAPIView):
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT count(*) FILTER (WHERE seller_profile_status = 'pending') AS pending_sellers,
                           (SELECT count(*) FROM seller_compliance_documents WHERE status = 'uploaded') AS pending_documents,
                           (SELECT count(*) FROM complaints WHERE status IN ('open', 'in_review')) AS open_complaints
                    FROM users
                    WHERE user_type IN ('seller', 'both')
                """
            )
            row = _row_as_dict(cursor) or {}

        return Response(
            {
                "data": {
                    "pendingSellers": int(row.get("pending_sellers") or 0),
                    "pendingDocuments": int(row.get("pending_documents") or 0),
                    "openComplaints": int(row.get("open_complaints") or 0),
                }
            }
        )


class AdminUsersListView(AdminAPIView):
    def get(self, request):
        search = str(request.query_params.get("search", "")).strip()
        user_type = str(request.query_params.get("userType", "")).strip().lower()
        where = ["1=1"]
        params = []
        if search:
            like = f"%{search}%"
            where.append("(email ILIKE %s OR display_name ILIKE %s OR username ILIKE %s)")
            params.extend([like, like, like])
        if user_type:
            if user_type == "buyer":
                where.append("user_type IN ('buyer', 'both')")
            elif user_type == "seller":
                where.append("user_type IN ('seller', 'both')")
            else:
                where.append("user_type = %s")
                params.append(user_type)

        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                    SELECT id, email, display_name, username, user_type, is_active, seller_profile_status, created_at
                    FROM users
                    WHERE {' AND '.join(where)}
                    ORDER BY created_at DESC
                    LIMIT 100
                """,
                params,
            )
            users = _rows_as_dicts(cursor)

        for item in users:
            _stringify_uuids(item, ["id"])
        return Response({"data": {"users": users}})


class AdminUserDetailView(AdminAPIView):
    def get(self, request, user_id):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, email, display_name, username, user_type, is_active, seller_profile_status,
                           created_at, updated_at, kitchen_title, kitchen_description, delivery_enabled, delivery_radius_km
                    FROM users
                    WHERE id = %s
                """,
                [str(user_id)],
            )
            user = _row_as_dict(cursor)

        if user is None:
            return error_response("NOT_FOUND", "User not found", status.HTTP_404_NOT_FOUND)

        _stringify_uuids(user, ["id"])
        return Response({"data": user})


class AdminComplaintsListView(AdminAPIView):
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT c.id, c.status, c.priority, c.description, c.created_at,
                           c.ticket_no, cc.name AS category_name, u.display_name AS complainant_name
                    FROM complaints c
                    LEFT JOIN complaint_categories cc ON cc.id = c.category_id
                    LEFT JOIN users u ON u.id = COALESCE(c.complainant_user_id, c.complainant_buyer_id)
                    ORDER BY c.created_at DESC
                    LIMIT 100
                """
            )
            complaints = _rows_as_dicts(cursor)

        for item in complaints:
            _stringify_uuids(item, ["id"])
        return Response({"data": {"complaints": complaints}})


class AdminComplaintDetailView(AdminAPIView):
    def get(self, request, complaint_id):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT c.id, c.status, c.priority, c.description, c.created_at, c.resolution_note,
                           c.ticket_no, cc.name AS category_name, u.display_name AS complainant_name,
                           a.email AS assigned_admin_email
                    FROM complaints c
                    LEFT JOIN complaint_categories cc ON cc.id = c.category_id
                    LEFT JOIN users u ON u.id = COALESCE(c.complainant_user_id, c.complainant_buyer_id)
                    LEFT JOIN admin_users a ON a.id = c.assigned_admin_id
                    WHERE c.id = %s
                """,
                [str(complaint_id)],
            )
            complaint = _row_as_dict(cursor)

        if complaint is None:
            return error_response("NOT_FOUND", "Complaint not found", status.HTTP_404_NOT_FOUND)

        _stringify_uuids(complaint, ["id"])
        return Response({"data": complaint})


class AdminComplaintCategoriesView(AdminAPIView):
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, code, name, is_active, created_at
                    FROM complaint_categories
                    ORDER BY created_at DESC, name ASC
                """
            )
            categories = _rows_as_dicts(cursor)

        for item in categories:
            _stringify_uuids(item, ["id"])
        return Response({"data": categories})


class AdminAuditEventsView(AdminAPIView):
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, actor_email, actor_role, action, entity_type, entity_id, created_at
                    FROM admin_audit_logs
                    ORDER BY created_at DESC
                    LIMIT 100
                """
            )
            events = _rows_as_dicts(cursor)

        for item in events:
            _stringify_uuids(item, ["id"])
        return Response({"data": {"events": events}})


class AdminSecurityLoginEventsView(AdminAPIView):
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, realm, actor_user_id, identifier, success, failure_reason, ip, user_agent, created_at
                    FROM security_login_events
                    ORDER BY created_at DESC
                    LIMIT 100
                """
            )
            events = _rows_as_dicts(cursor)

        for item in events:
            _stringify_uuids(item, ["id", "actor_user_id"])
        return Response({"data": {"events": events}})


class AdminSearchGlobalView(AdminAPIView):
    def get(self, request):
        q = str(request.query_params.get("q", "")).strip()
        if len(q) < 2:
            return Response({"data": {"groups": []}})

        like = f"%{q}%"
        groups = []
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id::text, display_name, email, user_type
                    FROM users
                    WHERE email ILIKE %s OR display_name ILIKE %s OR username ILIKE %s
                    LIMIT 5
                """,
                [like, like, like],
            )
            users = cursor.fetchall()
            if users:
                groups.append(
                    {
                        "key": "users",
                        "items": [
                            {"id": row[0], "label": row[1], "sublabel": row[2], "badge": row[3]}
                            for row in users
                        ],
                    }
                )

        return Response({"data": {"groups": groups}})


class AdminSalesCommissionLatestView(AdminAPIView):
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT s.id, s.commission_rate_percent, s.created_at, a.email AS created_by_email
                    FROM admin_sales_commission_settings s
                    LEFT JOIN admin_users a ON a.id = s.created_by_admin_id
                    ORDER BY s.created_at DESC
                    LIMIT 1
                """
            )
            row = _row_as_dict(cursor)

        if row is None:
            return error_response("NOT_FOUND", "No commission settings found", status.HTTP_404_NOT_FOUND)

        _stringify_uuids(row, ["id"])
        return Response({"data": row})


class AdminNotificationsTestView(AdminAPIView):
    def post(self, request):
        return Response({"data": {"success": True}})


class AdminComplianceQueueView(AdminAPIView):
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT d.id, d.status, d.uploaded_at, d.reviewed_at, d.expires_at, d.expired,
                           u.display_name AS seller_name, c.name AS document_name
                    FROM seller_compliance_documents d
                    JOIN users u ON u.id = d.seller_id
                    JOIN compliance_documents_list c ON c.id = d.document_list_id
                    ORDER BY d.created_at DESC
                    LIMIT 100
                """
            )
            rows = _rows_as_dicts(cursor)

        for item in rows:
            _stringify_uuids(item, ["id"])
        return Response({"data": {"items": rows}})


class AdminComplianceDocumentListView(AdminAPIView):
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, code, name, description, is_active, is_required_default, validity_years
                    FROM compliance_documents_list
                    ORDER BY name ASC
                """
            )
            rows = _rows_as_dicts(cursor)

        for item in rows:
            _stringify_uuids(item, ["id"])
        return Response({"data": {"items": rows}})
