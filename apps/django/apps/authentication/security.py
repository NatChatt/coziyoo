from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from django.contrib.auth.hashers import make_password as django_make_password

_ph = PasswordHasher()


def verify_password(stored_hash: str, password: str) -> bool:
    """Verify argon2 hash (from existing Node.js users) or Django hash."""
    if stored_hash.startswith("$argon2"):
        try:
            return _ph.verify(stored_hash, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
    # Fallback: Django's own hasher (PBKDF2)
    from django.contrib.auth.hashers import check_password
    return check_password(password, stored_hash)


def hash_password(password: str) -> str:
    """Hash new passwords with argon2."""
    return _ph.hash(password)
