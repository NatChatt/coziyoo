from .base import *
from decouple import config

DEBUG = False

_secret_key = config("DJANGO_SECRET_KEY", default="")
if not _secret_key or _secret_key.startswith("django-insecure-"):
    raise ValueError("DJANGO_SECRET_KEY must be set to a secure value in production")
SECRET_KEY = _secret_key

ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="api.coziyoo.com,admin.coziyoo.com,127.0.0.1,localhost", cast=lambda v: [s.strip() for s in v.split(",")])

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
SECURE_SSL_REDIRECT = False  # Nginx handles SSL termination
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {"format": "{levelname} {asctime} {module} {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "verbose"},
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
}
