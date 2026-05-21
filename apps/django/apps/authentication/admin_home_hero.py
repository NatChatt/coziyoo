import base64
import json
import re
import uuid
from datetime import datetime

from django.conf import settings
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.views.decorators.csrf import csrf_exempt
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


def _content_type_to_ext(content_type: str) -> str:
    ct = str(content_type or "").lower().strip()
    if ct == "image/png":
        return "png"
    if ct == "image/webp":
        return "webp"
    if ct in ("image/jpg", "image/jpeg"):
        return "jpg"
    return "jpg"


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


def _with_hero_image_url(edit_json: str, image_url: str) -> str:
    if not edit_json:
        return ""
    try:
        parsed = json.loads(edit_json)
    except (TypeError, ValueError):
        return edit_json
    if not isinstance(parsed, dict):
        return edit_json
    parsed["imageUrl"] = image_url or parsed.get("imageUrl") or ""
    return json.dumps(parsed, ensure_ascii=False)


def _normalize_hero_text(value: str, max_length: int = 120) -> str:
    raw = re.sub(r"\s+", " ", str(value or "")).strip()
    if not raw:
        return ""
    return raw[:max_length]


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


def _decode_uploaded_file(uploaded_file):
    if not uploaded_file:
        return None, None, None
    content_type = str(getattr(uploaded_file, "content_type", "") or "").lower().strip()
    if not content_type.startswith("image/"):
        return None, None, None
    try:
        binary = uploaded_file.read()
    except Exception:
        return None, None, None
    if not binary or len(binary) > _MAX_IMAGE_BYTES:
        return None, None, None
    ext = _content_type_to_ext(content_type)
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


def _set_latest_optional_fields(
    latest_id,
    edit_json: str,
    asset_key: str,
    hero_question_text: str = "",
    hero_slogan_title: str = "",
    hero_slogan_subtitle: str = "",
) -> None:
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
        optional_text_fields = {
            "mobile_home_hero_question_text": hero_question_text,
            "mobile_home_hero_slogan_title": hero_slogan_title,
            "mobile_home_hero_slogan_subtitle": hero_slogan_subtitle,
        }
        for column_name, value in optional_text_fields.items():
            if _has_public_column("admin_sales_commission_settings", column_name):
                cursor.execute(
                    f"UPDATE admin_sales_commission_settings SET {column_name} = %s WHERE id = %s",
                    [value or None, latest_id],
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
def hero_image_proxy_view(request: HttpRequest) -> HttpResponse:
    """Serve the current hero image through Django (same-origin) so canvas can draw it."""
    latest = AdminSalesCommissionSettings.objects.order_by("-created_at").first()
    if not latest or not latest.mobile_home_header_image_url:
        from django.http import Http404
        raise Http404("No hero image")

    pointer = str(latest.mobile_home_header_image_url).strip()
    if not pointer.startswith("s3://"):
        from django.http import Http404
        raise Http404("Not an S3 pointer")

    parsed = s3_utils.parse_storage_pointer(pointer)
    if not parsed:
        from django.http import Http404
        raise Http404("Bad pointer")

    if not s3_utils.is_configured():
        from django.http import Http404
        raise Http404("S3 not configured")

    try:
        client = s3_utils.get_client()
        response = client.get_object(Bucket=parsed["bucket"], Key=parsed["key"])
        content_type = str(response.get("ContentType") or "image/jpeg").strip() or "image/jpeg"
        body = response["Body"].read()
        if not body:
            from django.http import Http404
            raise Http404("Empty body")
        http_response = HttpResponse(body, content_type=content_type)
        http_response["Cache-Control"] = "no-store"
        return http_response
    except Exception:
        from django.http import Http404
        raise Http404("S3 fetch failed")


@csrf_exempt
@staff_member_required
def home_hero_view(request: HttpRequest) -> HttpResponse:
    latest = AdminSalesCommissionSettings.objects.order_by("-created_at").first()

    if request.method == "POST":
        action = str(request.POST.get("action") or "").strip().lower()
        if action == "approve":
            uploaded_file = request.FILES.get("mobile_home_header_file")
            image_data = _normalize_hero_url(request.POST.get("mobile_home_header_image_data", ""))
            if not image_data:
                image_data = _normalize_hero_url(request.POST.get("mobile_home_header_image_url", ""))
            edit_json = _normalize_edit_json(request.POST.get("mobile_home_header_edit_json", ""))
            hero_question_text = _normalize_hero_text(request.POST.get("mobile_home_hero_question_text", ""), 90)
            hero_slogan_title = _normalize_hero_text(request.POST.get("mobile_home_hero_slogan_title", ""), 120)
            hero_slogan_subtitle = _normalize_hero_text(request.POST.get("mobile_home_hero_slogan_subtitle", ""), 120)

            if not uploaded_file and not image_data:
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

            # Priority: client-rendered data URL (includes drag/zoom placement) wins.
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
                    next_pointer = image_data
                    next_asset_key = None
            elif uploaded_file:
                decoded, content_type, ext = _decode_uploaded_file(uploaded_file)
                if not decoded:
                    messages.error(request, "Görsel dosyası geçersiz veya dosya boyutu çok büyük.")
                    return redirect(request.path)

                if s3_utils.is_configured() and getattr(settings, "S3_BUCKET_SELLER_DOCS", ""):
                    bucket = settings.S3_BUCKET_SELLER_DOCS
                    key = _build_hero_asset_key(ext)
                    next_pointer = s3_utils.put_bytes(bucket, key, decoded, content_type)
                    next_asset_key = key
                else:
                    encoded = base64.b64encode(decoded).decode("ascii")
                    next_pointer = f"data:{content_type};base64,{encoded}"
                    next_asset_key = None
            latest.mobile_home_header_image_url = next_pointer or None
            latest.save(update_fields=["mobile_home_header_image_url"])
            edit_json = _with_hero_image_url(edit_json, next_pointer or "")
            _set_latest_optional_fields(
                latest.id,
                edit_json,
                next_asset_key or "",
                hero_question_text,
                hero_slogan_title,
                hero_slogan_subtitle,
            )

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
    current_hero_question_text = ""
    current_hero_slogan_title = ""
    current_hero_slogan_subtitle = ""
    if latest:
        current_hero_question_text = _get_latest_optional_field(latest.id, "mobile_home_hero_question_text")
        current_hero_slogan_title = _get_latest_optional_field(latest.id, "mobile_home_hero_slogan_title")
        current_hero_slogan_subtitle = _get_latest_optional_field(latest.id, "mobile_home_hero_slogan_subtitle")

    # Use same-origin proxy URL so canvas can draw the image without CORS issues.
    has_image = bool(current_url_raw and current_url_raw.startswith("s3://"))
    proxy_image_url = "/admin/home-hero/image/" if has_image else ""

    context = {
        "title": "Home Hero",
        "current_url": proxy_image_url,
        "current_url_raw": current_url_raw,
        "current_edit_json": current_edit_json,
        "current_hero_question_text": current_hero_question_text or "Bugün ne yemek istersin?",
        "current_hero_slogan_title": current_hero_slogan_title or "Komşunun mutfağından, kapına.",
        "current_hero_slogan_subtitle": current_hero_slogan_subtitle or "Sıcacık ev yemekleri.",
        "saved": request.GET.get("saved") == "1",
        "opts": AdminSalesCommissionSettings._meta,
    }
    return TemplateResponse(request, "admin/authentication/home_hero.html", context)
