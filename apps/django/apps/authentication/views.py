import re
import uuid
from django.db import connection, transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import AnonRateThrottle

from .token_service import sign_access_token, generate_refresh_token, hash_refresh_token, refresh_expires_at
from .security import verify_password, hash_password


# ── Permissions ──────────────────────────────────────────────────────────────

class IsAppRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "app"


# ── App Auth ──────────────────────────────────────────────────────────────────

class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        email = request.data.get("email", "").lower().strip()
        password = request.data.get("password", "")
        if not email or not password:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "email and password required"}}, status=400)

        with connection.cursor() as cur:
            cur.execute(
                "SELECT id, email, password_hash, user_type, is_active FROM users WHERE email = %s",
                [email],
            )
            row = cur.fetchone()

        if not row or not verify_password(row[2], password):
            return Response({"error": {"code": "INVALID_CREDENTIALS", "message": "Email or password invalid"}}, status=401)

        user_id, user_email, _, user_type, is_active = row
        if not is_active:
            return Response({"error": {"code": "ACCOUNT_DISABLED", "message": "Account is disabled"}}, status=403)

        refresh_token = generate_refresh_token()
        with connection.cursor() as cur:
            cur.execute(
                """INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, device_info, ip, last_used_at)
                   VALUES (%s, %s, %s, %s, %s, now()) RETURNING id""",
                [user_id, hash_refresh_token(refresh_token), refresh_expires_at(),
                 request.META.get("HTTP_USER_AGENT", ""), request.META.get("REMOTE_ADDR", "")],
            )
            session_id = cur.fetchone()[0]

        access_token = sign_access_token(str(user_id), str(session_id), "app", user_type)
        return Response({"data": {
            "user": {"id": str(user_id), "email": user_email, "userType": user_type},
            "tokens": {"accessToken": access_token, "refreshToken": refresh_token, "tokenType": "Bearer"},
        }})


class RefreshView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        refresh_token = request.data.get("refreshToken", "")
        if not refresh_token:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "refreshToken required"}}, status=400)

        refresh_hash = hash_refresh_token(refresh_token)

        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    """SELECT s.id, s.user_id, u.user_type
                       FROM auth_sessions s JOIN users u ON u.id = s.user_id
                       WHERE s.refresh_token_hash = %s AND s.revoked_at IS NULL
                         AND s.expires_at > now() AND u.is_active = TRUE""",
                    [refresh_hash],
                )
                row = cur.fetchone()
                if not row:
                    return Response({"error": {"code": "REFRESH_INVALID", "message": "Invalid or expired refresh token"}}, status=401)

                session_id, user_id, user_type = row
                cur.execute("UPDATE auth_sessions SET revoked_at = now() WHERE id = %s", [session_id])

                new_refresh = generate_refresh_token()
                cur.execute(
                    """INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, device_info, ip, last_used_at)
                       VALUES (%s, %s, %s, %s, %s, now()) RETURNING id""",
                    [user_id, hash_refresh_token(new_refresh), refresh_expires_at(),
                     request.META.get("HTTP_USER_AGENT", ""), request.META.get("REMOTE_ADDR", "")],
                )
                new_session_id = cur.fetchone()[0]

        access_token = sign_access_token(str(user_id), str(new_session_id), "app", user_type)
        return Response({"data": {
            "tokens": {"accessToken": access_token, "refreshToken": new_refresh, "tokenType": "Bearer"},
        }})


class LogoutView(APIView):
    permission_classes = [IsAppRealm]

    def post(self, request):
        refresh_token = request.data.get("refreshToken")
        with connection.cursor() as cur:
            if refresh_token:
                cur.execute(
                    "UPDATE auth_sessions SET revoked_at = now() WHERE refresh_token_hash = %s AND revoked_at IS NULL",
                    [hash_refresh_token(refresh_token)],
                )
            else:
                cur.execute(
                    "UPDATE auth_sessions SET revoked_at = now() WHERE id = %s AND revoked_at IS NULL",
                    [request.user.session_id],
                )
        return Response({"data": {"success": True}})


class MeView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request):
        with connection.cursor() as cur:
            cur.execute(
                """SELECT id, email, display_name, username, user_type, is_active, created_at,
                          full_name, phone, dob, country_code, national_id
                   FROM users WHERE id = %s""",
                [request.user.id],
            )
            row = cur.fetchone()

        if not row:
            return Response({"error": {"code": "NOT_FOUND", "message": "User not found"}}, status=404)

        return Response({"data": {
            "id": str(row[0]), "email": row[1], "displayName": row[2],
            "username": row[3], "userType": row[4],
            "fullName": row[7], "phone": row[8],
            "dob": row[9].isoformat() if row[9] else None,
            "countryCode": row[10], "nationalId": row[11],
            "createdAt": row[6].isoformat() if row[6] else None,
        }})

    def put(self, request):
        payload = request.data if isinstance(request.data, dict) else {}
        updates = []
        params = []

        field_map = {
            "email": "email",
            "displayName": "display_name",
            "fullName": "full_name",
            "phone": "phone",
            "countryCode": "country_code",
            "nationalId": "national_id",
            "dob": "dob",
        }

        for api_field, column in field_map.items():
            if api_field not in payload:
                continue
            value = payload.get(api_field)
            if isinstance(value, str):
                value = value.strip()
            if api_field == "countryCode" and isinstance(value, str):
                value = value.upper()
            updates.append(f"{column} = %s")
            params.append(value or None)

        if "displayName" in payload:
            display_name = str(payload.get("displayName") or "").strip()
            updates.append("display_name_normalized = %s")
            params.append(display_name.lower() if display_name else None)

        if not updates:
            return self.get(request)

        params.extend([request.user.id])
        with connection.cursor() as cur:
            cur.execute(
                f"""
                UPDATE users
                SET {", ".join(updates)},
                    updated_at = now()
                WHERE id = %s
                RETURNING id, email, display_name, username, user_type, is_active, created_at,
                          full_name, phone, dob, country_code, national_id
                """,
                params,
            )
            row = cur.fetchone()

        if not row:
            return Response({"error": {"code": "NOT_FOUND", "message": "User not found"}}, status=404)

        return Response({"data": {
            "id": str(row[0]), "email": row[1], "displayName": row[2],
            "username": row[3], "userType": row[4],
            "fullName": row[7], "phone": row[8],
            "dob": row[9].isoformat() if row[9] else None,
            "countryCode": row[10], "nationalId": row[11],
            "createdAt": row[6].isoformat() if row[6] else None,
        }})


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        email = request.data.get("email", "").lower().strip()
        password = request.data.get("password", "")
        display_name = request.data.get("displayName") or email.split("@")[0][:40]
        user_type = request.data.get("userType", "buyer")
        username_raw = request.data.get("username") or re.sub(r"[^a-z0-9_]", "_", email.split("@")[0].lower())[:30]

        if not email or not password or len(password) < 8:
            return Response({"error": {"code": "VALIDATION_ERROR", "message": "Valid email and password (min 8 chars) required"}}, status=400)

        password_hash = hash_password(password)

        with connection.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email = %s", [email])
            if cur.fetchone():
                return Response({"error": {"code": "EMAIL_TAKEN", "message": "Email already registered"}}, status=409)

            cur.execute("SELECT id FROM users WHERE username = %s", [username_raw])
            if cur.fetchone():
                username_raw = f"{username_raw}_{uuid.uuid4().hex[:4]}"

            cur.execute(
                """INSERT INTO users (email, password_hash, display_name, display_name_normalized, username, username_normalized, user_type)
                   VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id, email, display_name, user_type""",
                [email, password_hash, display_name, display_name.lower(), username_raw, username_raw.lower(), user_type],
            )
            user = cur.fetchone()

        user_id, user_email, user_display_name, user_type_val = user
        refresh_token = generate_refresh_token()

        with connection.cursor() as cur:
            cur.execute(
                """INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, device_info, ip, last_used_at)
                   VALUES (%s, %s, %s, %s, %s, now()) RETURNING id""",
                [user_id, hash_refresh_token(refresh_token), refresh_expires_at(),
                 request.META.get("HTTP_USER_AGENT", ""), request.META.get("REMOTE_ADDR", "")],
            )
            session_id = cur.fetchone()[0]

        access_token = sign_access_token(str(user_id), str(session_id), "app", user_type_val)
        return Response({"data": {
            "user": {"id": str(user_id), "email": user_email, "displayName": user_display_name, "userType": user_type_val},
            "tokens": {"accessToken": access_token, "refreshToken": refresh_token, "tokenType": "Bearer"},
        }}, status=201)


# Stubs for remaining endpoints (implemented incrementally)
class UsernameCheckView(APIView):
    permission_classes = [AllowAny]
    def get(self, request):
        value = request.query_params.get("value", "")
        with connection.cursor() as cur:
            cur.execute("SELECT EXISTS(SELECT 1 FROM users WHERE username = %s)", [value.lower()])
            exists = cur.fetchone()[0]
        return Response({"data": {"value": value, "available": not exists}})


class DisplayNameCheckView(APIView):
    permission_classes = [AllowAny]
    def get(self, request):
        value = request.query_params.get("value", "")
        return Response({"data": {"value": value, "available": True}})


class ForgotPasswordRequestView(APIView):
    permission_classes = [AllowAny]
    def post(self, request):
        return Response({"data": {"success": True}})


class ForgotPasswordConfirmView(APIView):
    permission_classes = [AllowAny]
    def post(self, request):
        return Response({"error": {"code": "NOT_IMPLEMENTED", "message": "Not yet implemented"}}, status=501)


class EnableSellerView(APIView):
    permission_classes = [IsAppRealm]
    def post(self, request):
        with connection.cursor() as cur:
            cur.execute(
                "UPDATE users SET user_type = 'both' WHERE id = %s AND user_type = 'buyer' RETURNING id",
                [request.user.id],
            )
            row = cur.fetchone()
        if not row:
            return Response({"error": {"code": "ALREADY_SELLER", "message": "Already a seller"}}, status=409)
        return Response({"data": {"success": True}})


class UserAddressListView(APIView):
    permission_classes = [IsAppRealm]
    def get(self, request):
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, title, address_line, is_default
                FROM user_addresses
                WHERE user_id = %s
                ORDER BY is_default DESC, updated_at DESC
                """,
                [request.user.id],
            )
            cols = ["id", "title", "addressLine", "isDefault"]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        return Response({"data": rows})

    def post(self, request):
        d = request.data
        title = d.get("title") or d.get("label")
        address_line = d.get("addressLine")
        is_default = bool(d.get("isDefault", False))
        with connection.cursor() as cur:
            if is_default:
                cur.execute("UPDATE user_addresses SET is_default = FALSE, updated_at = now() WHERE user_id = %s", [request.user.id])
            cur.execute(
                """INSERT INTO user_addresses (user_id, title, address_line, is_default)
                   VALUES (%s, %s, %s, %s) RETURNING id""",
                [request.user.id, title, address_line, is_default],
            )
            new_id = cur.fetchone()[0]
        return Response({"data": {"id": str(new_id)}}, status=201)


class UserAddressDetailView(APIView):
    permission_classes = [IsAppRealm]

    def patch(self, request, address_id):
        d = request.data if isinstance(request.data, dict) else {}
        title = d.get("title") or d.get("label")
        address_line = d.get("addressLine")
        is_default = d.get("isDefault")

        updates = []
        params = []
        if title is not None:
            updates.append("title = %s")
            params.append(str(title).strip() or None)
        if address_line is not None:
            updates.append("address_line = %s")
            params.append(str(address_line).strip() or None)
        if is_default is not None:
            updates.append("is_default = %s")
            params.append(bool(is_default))

        if not updates:
            return Response({"data": {"id": str(address_id)}})

        with transaction.atomic():
            with connection.cursor() as cur:
                if bool(is_default):
                    cur.execute(
                        "UPDATE user_addresses SET is_default = FALSE, updated_at = now() WHERE user_id = %s AND id <> %s",
                        [request.user.id, address_id],
                    )
                params.extend([request.user.id, address_id])
                cur.execute(
                    f"""
                    UPDATE user_addresses
                    SET {", ".join(updates)},
                        updated_at = now()
                    WHERE user_id = %s AND id = %s
                    RETURNING id
                    """,
                    params,
                )
                row = cur.fetchone()

        if not row:
            return Response({"error": {"code": "NOT_FOUND", "message": "Address not found"}}, status=404)

        return Response({"data": {"id": str(row[0])}})
