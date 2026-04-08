import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings


def sign_access_token(sub: str, session_id: str, realm: str, role: str) -> str:
    ttl: timedelta = settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"]
    payload = {
        "sub": sub,
        "sessionId": session_id,
        "realm": realm,
        "role": role,
        "exp": datetime.now(tz=timezone.utc) + ttl,
        "iat": datetime.now(tz=timezone.utc),
    }
    return jwt.encode(payload, settings.APP_JWT_SECRET, algorithm="HS256")


def generate_refresh_token() -> str:
    return secrets.token_hex(40)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def refresh_expires_at() -> datetime:
    ttl: timedelta = settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
    return datetime.now(tz=timezone.utc) + ttl
