from pathlib import Path
from datetime import timedelta
from decouple import config, Csv
import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent.parent

SECRET_KEY = config("DJANGO_SECRET_KEY", default="django-insecure-change-me-in-production")

INSTALLED_APPS = [
    "unfold",
    "unfold.contrib.filters",
    "unfold.contrib.forms",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "apps.authentication",
    "apps.orders",
    "apps.foods",
    "apps.payments",
    "apps.compliance",
    "apps.notifications",
    "apps.finance",
    "apps.complaints",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "coziyoo.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "django.template.context_processors.i18n",
            ],
        },
    },
]

WSGI_APPLICATION = "coziyoo.wsgi.application"

# --- Database (Supabase PostgreSQL) ---
DATABASES = {
    "default": dj_database_url.parse(
        config("DATABASE_URL"),
        conn_max_age=600,
        ssl_require=False,
    )
}

# --- Password hashing: Argon2 first (compatible with existing hashes) ---
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

# --- REST Framework ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.authentication.backends.CoziyooJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "120/min",
        "user": "300/min",
        "login": "10/min",
    },
    "EXCEPTION_HANDLER": "coziyoo.exceptions.custom_exception_handler",
}

# --- JWT ---
APP_JWT_SECRET = config("APP_JWT_SECRET")
ADMIN_JWT_SECRET = config("ADMIN_JWT_SECRET", default=APP_JWT_SECRET)

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(
        minutes=config("ACCESS_TOKEN_TTL_MINUTES", default=15, cast=int)
    ),
    "REFRESH_TOKEN_LIFETIME": timedelta(
        days=config("REFRESH_TOKEN_TTL_DAYS", default=30, cast=int)
    ),
    "ALGORITHM": "HS256",
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# --- CORS ---
CORS_ALLOWED_ORIGINS = config("CORS_ALLOWED_ORIGINS", default="", cast=Csv())
CORS_ALLOW_ALL_ORIGINS = config("CORS_ALLOW_ALL_ORIGINS", default=False, cast=bool)

# --- S3 ---
S3_ENDPOINT = config("S3_ENDPOINT", default="")
S3_REGION = config("S3_REGION", default="us-east-1")
S3_BUCKET_SELLER_DOCS = config("S3_BUCKET_SELLER_DOCS", default="seller-documents")
S3_ACCESS_KEY_ID = config("S3_ACCESS_KEY_ID", default="")
S3_SECRET_ACCESS_KEY = config("S3_SECRET_ACCESS_KEY", default="")
S3_FORCE_PATH_STYLE = config("S3_FORCE_PATH_STYLE", default=True, cast=bool)
S3_SIGNED_URL_TTL_SECONDS = config("S3_SIGNED_URL_TTL_SECONDS", default=900, cast=int)

# --- Supabase (for Realtime in admin templates) ---
SUPABASE_URL = config("SUPABASE_HOST_URL", default="")
SUPABASE_ANON_KEY = config("VITE_SUPABASE_ANON_KEY", default="")

# --- Static & Media ---
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LANGUAGE_CODE = "tr"
TIME_ZONE = config("TIME_ZONE", default="Europe/London")
USE_I18N = True
USE_TZ = True

LANGUAGES = [
    ("tr", "Türkçe"),
    ("en", "English"),
]

LOCALE_PATHS = [
    BASE_DIR / "locale",
]

# --- django-unfold ---
UNFOLD = {
    "SITE_TITLE": "Coziyoo Admin",
    "SITE_HEADER": "Coziyoo",
    "SITE_SYMBOL": "restaurant",
    "SHOW_HISTORY": True,
    "SHOW_VIEW_ON_SITE": False,
    "COLORS": {
        "primary": {
            "50": "250 245 255",
            "100": "243 232 255",
            "200": "233 213 255",
            "300": "216 180 254",
            "400": "192 132 252",
            "500": "168 85 247",
            "600": "147 51 234",
            "700": "126 34 206",
            "800": "107 33 168",
            "900": "88 28 135",
            "950": "59 7 100",
        },
    },
    "SIDEBAR": {
        "show_search": True,
        "show_all_applications": False,
        "navigation": [
            {
                "title": "Platform",
                "separator": True,
                "items": [
                    {
                        "title": "Buyers",
                        "icon": "person",
                        "link": "/admin/authentication/buyerusers/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Sellers",
                        "icon": "store",
                        "link": "/admin/authentication/sellerusers/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Orders",
                        "icon": "shopping_bag",
                        "link": "/admin/orders/orders/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Foods",
                        "icon": "restaurant_menu",
                        "link": "/admin/menu/foods/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Categories",
                        "icon": "category",
                        "link": "/admin/menu/categories/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Reviews",
                        "icon": "star",
                        "link": "/admin/orders/reviews/",
                        "permission": lambda request: request.user.is_staff,
                    },
                ],
            },
            {
                "title": "Compliance & Support",
                "separator": True,
                "items": [
                    {
                        "title": "Compliance Docs",
                        "icon": "verified",
                        "link": "/admin/compliance/sellercompliancedocuments/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Doc Types",
                        "icon": "description",
                        "link": "/admin/compliance/compliancedocumentslist/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Complaints",
                        "icon": "report",
                        "link": "/admin/complaints/complaints/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Complaint Categories",
                        "icon": "label",
                        "link": "/admin/complaints/complaintcategories/",
                        "permission": lambda request: request.user.is_staff,
                    },
                ],
            },
            {
                "title": "Settings & Security",
                "separator": True,
                "items": [
                    {
                        "title": "Admin Users",
                        "icon": "admin_panel_settings",
                        "link": "/admin/auth/user/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Commission Settings",
                        "icon": "percent",
                        "link": "/admin/authentication/adminsalescommissionsettings/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "API Tokens",
                        "icon": "key",
                        "link": "/admin/authentication/adminapitokens/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Audit Log",
                        "icon": "history",
                        "link": "/admin/authentication/adminauditlogs/",
                        "permission": lambda request: request.user.is_staff,
                    },
                    {
                        "title": "Login Events",
                        "icon": "lock",
                        "link": "/admin/authentication/securityloginevents/",
                        "permission": lambda request: request.user.is_staff,
                    },
                ],
            },
        ],
    },
}
