import base64
import json
import re
import uuid
from datetime import datetime

from django.conf import settings
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.db import connection
from django.http import HttpRequest, HttpResponse
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.utils import timezone

from apps.authentication.models import AdminSalesCommissionSettings, AdminUsers
from coziyoo import s3 as s3_utils

_DATA_URL_RE = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$")
_MAX_IMAGE_BYTES = 12 * 1024 * 1024
_COLUMN_EXISTS_CACHE = {}


def _normalize_hero_url(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if (
        raw.startswith("http://")
        or raw.startswith("https://")
        or raw.startswith("data:image/")
        or raw.startswith("s3://")
    ):
        return raw
    return ""


def _normalize_edit_json(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return ""
    if not isinstance(parsed, dict):
        return ""
    return json.dumps(parsed, ensure_ascii=False)


def _decode_data_url(data_url: str):
    raw = str(data_url or "").strip()
    match = _DATA_URL_RE.match(raw)
    if not match:
        return None, None, None

    content_type = match.group(1).lower()
    payload = match.group(2)
    try:
        binary = base64.b64decode(payload, validate=True)
    except (ValueError, TypeError):
        return None, None, None

    if not binary or len(binary) > _MAX_IMAGE_BYTES:
        return None, None, None

    ext = "jpg"
    if content_type == "image/png":
        ext = "png"
    elif content_type == "image/webp":
        ext = "webp"

    return binary, content_type, ext


def _build_hero_asset_key(ext: str) -> str:
    ts = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    uid = str(uuid.uuid4())[:8]
    return f"hero/mobile/{ts}-{uid}.{ext or 'jpg'}"


def _resolve_admin_user(request: HttpRequest):
    admin_user = AdminUsers.objects.filter(email__iexact=getattr(request.user, "email", "")).first()
    if admin_user is None:
        admin_user = AdminUsers.objects.order_by("created_at").first()
    return admin_user


def _has_public_column(table_name: str, column_name: str) -> bool:
    cache_key = (table_name, column_name)
    if cache_key in _COLUMN_EXISTS_CACHE:
        return _COLUMN_EXISTS_CACHE[cache_key]

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = %s
                  AND column_name = %s
            )
            """,
            [table_name, column_name],
        )
        exists = bool(cursor.fetchone()[0])

    _COLUMN_EXISTS_CACHE[cache_key] = exists
    return exists


def _get_latest_optional_field(latest_id, column_name: str) -> str:
    if not latest_id:
        return ""
    if not _has_public_column("admin_sales_commission_settings", column_name):
        return ""
    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT {column_name} FROM admin_sales_commission_settings WHERE id = %s LIMIT 1",
            [latest_id],
        )
        row = cursor.fetchone()
    if not row or row[0] is None:
        return ""
    return str(row[0]).strip()


def _set_latest_optional_fields(latest_id, edit_json: str, asset_key: str) -> None:
    if not latest_id:
        return
    with connection.cursor() as cursor:
        if _has_public_column("admin_sales_commission_settings", "mobile_home_header_edit_json"):
            cursor.execute(
                "UPDATE admin_sales_commission_settings SET mobile_home_header_edit_json = %s WHERE id = %s",
                [edit_json or None, latest_id],
            )
        if _has_public_column("admin_sales_commission_settings", "mobile_home_header_asset_key"):
            cursor.execute(
                "UPDATE admin_sales_commission_settings SET mobile_home_header_asset_key = %s WHERE id = %s",
                [asset_key or None, latest_id],
            )


def _hydrate_for_admin(value: str) -> str:
    if not value:
        return ""
    return s3_utils.hydrate_file_url(value) or value


def _storage_pointer_to_data_url(pointer: str) -> str:
    if not pointer or not pointer.startswith("s3://"):
        return ""
    parsed = s3_utils.parse_storage_pointer(pointer)
    if not parsed:
        return ""
    if not s3_utils.is_configured():
        return ""
    try:
        client = s3_utils.get_client()
        response = client.get_object(Bucket=parsed["bucket"], Key=parsed["key"])
        content_type = str(response.get("ContentType") or "image/jpeg").strip() or "image/jpeg"
        body = response["Body"].read()
        if not body:
            return ""
        encoded = base64.b64encode(body).decode("ascii")
        return f"data:{content_type};base64,{encoded}"
    except Exception:
        return ""


@staff_member_required
def home_hero_view(request: HttpRequest) -> HttpResponse:
    latest = AdminSalesCommissionSettings.objects.order_by("-created_at").first()

    if request.method == "POST":
        action = str(request.POST.get("action") or "").strip().lower()
        if action == "approve":
            image_data = _normalize_hero_url(request.POST.get("mobile_home_header_image_data", ""))
            if not image_data:
                image_data = _normalize_hero_url(request.POST.get("mobile_home_header_image_url", ""))
            edit_json = _normalize_edit_json(request.POST.get("mobile_home_header_edit_json", ""))

            if not image_data:
                messages.error(request, "Yayınlamak için geçerli bir görsel seç.")
                return redirect(request.path)

            admin_user = _resolve_admin_user(request)
            if admin_user is None:
                messages.error(request, "Admin kullanıcı kaydı bulunamadı.")
                return redirect(request.path)

            if latest is None:
                latest = AdminSalesCommissionSettings.objects.create(
                    id=uuid.uuid4(),
                    commission_rate_percent=0,
                    created_by_admin=admin_user,
                    created_at=timezone.now(),
                )

            old_pointer = str(getattr(latest, "mobile_home_header_image_url", "") or "").strip()
            old_asset_key = _get_latest_optional_field(latest.id, "mobile_home_header_asset_key")
            next_pointer = image_data
            next_asset_key = old_asset_key or None

            if image_data.startswith("data:image/"):
                decoded, content_type, ext = _decode_data_url(image_data)
                if not decoded:
                    messages.error(request, "Görsel verisi geçersiz veya dosya boyutu çok büyük.")
                    return redirect(request.path)

                if s3_utils.is_configured() and getattr(settings, "S3_BUCKET_SELLER_DOCS", ""):
                    bucket = settings.S3_BUCKET_SELLER_DOCS
                    key = _build_hero_asset_key(ext)
                    next_pointer = s3_utils.put_bytes(bucket, key, decoded, content_type)
                    next_asset_key = key
                else:
                    # Fallback: keep data URL if storage is not configured.
                    next_pointer = image_data
                    next_asset_key = None

            latest.mobile_home_header_image_url = next_pointer or None
            latest.save(update_fields=["mobile_home_header_image_url"])
            _set_latest_optional_fields(latest.id, edit_json, next_asset_key or "")

            if (
                old_pointer
                and old_pointer != next_pointer
                and old_pointer.startswith("s3://")
                and old_asset_key
            ):
                s3_utils.delete_object(old_pointer)

            messages.success(request, "Home Hero güncellendi.")
            return redirect(f"{request.path}?saved=1")

        if action == "edit":
            return redirect(request.path)

    current_url_raw = ""
    current_edit_json = ""
    if latest and latest.mobile_home_header_image_url:
        current_url_raw = str(latest.mobile_home_header_image_url).strip()
    if latest:
        current_edit_json = _get_latest_optional_field(latest.id, "mobile_home_header_edit_json")

    context = {
        "title": "Home Hero",
        "current_url": _hydrate_for_admin(current_url_raw),
        "current_url_raw": current_url_raw,
        "current_image_data_url": _storage_pointer_to_data_url(current_url_raw),
        "current_edit_json": current_edit_json,
        "saved": request.GET.get("saved") == "1",
        "opts": AdminSalesCommissionSettings._meta,
    }
    return TemplateResponse(request, "admin/authentication/home_hero.html", context)
