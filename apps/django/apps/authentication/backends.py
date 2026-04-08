"""
JWT authentication backend for the app realm (buyer/seller mobile).
Admin panel uses Django session auth — no JWT needed.
"""
import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed


class AuthUser:
    """Lightweight request.user for JWT-authenticated requests."""

    def __init__(self, payload: dict):
        self.id = payload["sub"]
        self.session_id = payload.get("sessionId", "")
        self.realm = payload.get("realm", "app")
        self.role = payload.get("role", "")
        self.is_authenticated = True
        self.is_anonymous = False
        self.is_active = True
        self.pk = self.id

    def has_perm(self, perm, obj=None):
        return False

    def has_module_perms(self, app_label):
        return False


class CoziyooJWTAuthentication(BaseAuthentication):

    def authenticate(self, request):
        header = request.META.get("HTTP_AUTHORIZATION", "")
        if not header.startswith("Bearer "):
            return None

        token = header[7:]
        try:
            payload = jwt.decode(token, settings.APP_JWT_SECRET, algorithms=["HS256"])
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed({"code": "TOKEN_EXPIRED", "message": "Token has expired"})
        except jwt.InvalidTokenError as e:
            raise AuthenticationFailed({"code": "INVALID_TOKEN", "message": str(e)})

        return (AuthUser(payload), token)

    def authenticate_header(self, request):
        return "Bearer"
