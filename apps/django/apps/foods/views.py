"""
Public food browsing views for the app realm.
All endpoints require a valid JWT with realm == 'app'.
"""
import base64
import binascii
import hashlib
import json
import re

from django.db import connection
from django.db import transaction
from django.http import Http404, HttpRequest, HttpResponse, HttpResponseRedirect
from django.urls import reverse
from rest_framework.views import APIView
from rest_framework.response import Response
from coziyoo import s3 as s3_utils

from apps.common.permissions import IsAppRealm
from apps.common.responses import error_response
from apps.common.db import rows_as_dicts as _rows_as_dicts, stringify_uuids as _stringify_uuids

_COLUMN_EXISTS_CACHE = {}


def _coerce_json(value):
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return value
    return value


def _has_public_column(table_name, column_name):
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


def _load_latest_mobile_home_header_raw():
    if not _has_public_column("admin_sales_commission_settings", "mobile_home_header_image_url"):
        return None, None

    with connection.cursor() as cursor:
        cursor.execute(
            """
                SELECT mobile_home_header_image_url
                FROM admin_sales_commission_settings
                WHERE mobile_home_header_image_url IS NOT NULL
                  AND TRIM(mobile_home_header_image_url) <> ''
                ORDER BY created_at DESC
                LIMIT 1
            """
        )
        row = cursor.fetchone()

    if not row or not row[0]:
        return None, None
    return str(row[0]).strip(), row[0]


def _resolve_mobile_home_header_image_url(request: HttpRequest | None = None):
    value, _raw = _load_latest_mobile_home_header_raw()
    if not value:
        return None
    if value.startswith(("s3://", "data:image/")):
        # Always serve stored/admin-uploaded images through our API so mobile
        # receives a stable HTTP image URL instead of expiring S3 URLs or inline data.
        path = reverse('foods-home-hero-image')
        if request is not None:
            return request.build_absolute_uri(path)
        return path
    if value.startswith(("http://", "https://")):
        return value
    return None


def _resolve_mobile_home_header_image_cache_key():
    value, _raw = _load_latest_mobile_home_header_raw()
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _resolve_mobile_home_surface_color() -> str | None:
    if not _has_public_column("admin_sales_commission_settings", "mobile_home_header_edit_json"):
        return None

    with connection.cursor() as cursor:
        cursor.execute(
            """
                SELECT mobile_home_header_edit_json
                FROM admin_sales_commission_settings
                WHERE mobile_home_header_edit_json IS NOT NULL
                  AND TRIM(mobile_home_header_edit_json) <> ''
                ORDER BY created_at DESC
                LIMIT 1
            """
        )
        row = cursor.fetchone()

    if not row or not row[0]:
        return None
    try:
        payload = json.loads(str(row[0]))
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    raw_color = str(payload.get("surfaceColor") or "").strip()
    if _HEX_COLOR_RE.match(raw_color):
        return raw_color.lower()
    return None


def _resolve_mobile_home_hero_render_config() -> dict | None:
    if not _has_public_column("admin_sales_commission_settings", "mobile_home_header_edit_json"):
        return None

    with connection.cursor() as cursor:
        cursor.execute(
            """
                SELECT mobile_home_header_edit_json
                FROM admin_sales_commission_settings
                WHERE mobile_home_header_edit_json IS NOT NULL
                  AND TRIM(mobile_home_header_edit_json) <> ''
                ORDER BY created_at DESC
                LIMIT 1
            """
        )
        row = cursor.fetchone()

    if not row or not row[0]:
        return None
    try:
        payload = json.loads(str(row[0]))
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _load_latest_mobile_home_hero_texts() -> dict[str, str]:
    columns = [
        "mobile_home_hero_question_text",
        "mobile_home_hero_slogan_title",
        "mobile_home_hero_slogan_subtitle",
    ]
    available_columns = [
        column for column in columns
        if _has_public_column("admin_sales_commission_settings", column)
    ]
    if not available_columns:
        return {}

    select_sql = ", ".join(available_columns)
    where_sql = " OR ".join(
        f"({column} IS NOT NULL AND TRIM({column}) <> '')"
        for column in available_columns
    )
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
                SELECT {select_sql}
                FROM admin_sales_commission_settings
                WHERE {where_sql}
                ORDER BY created_at DESC
                LIMIT 1
            """
        )
        row = cursor.fetchone()

    if not row:
        return {}
    result = {}
    for index, column in enumerate(available_columns):
        value = row[index]
        if value is None:
            continue
        normalized = str(value).strip()
        if normalized:
            result[column] = normalized
    return result


def mobile_home_hero_image_view(request: HttpRequest):
    value, _raw = _load_latest_mobile_home_header_raw()
    if not value:
        raise Http404("No hero image")

    if value.startswith("data:image/"):
        try:
            header, payload = value.split(",", 1)
            content_type = header.split(";")[0].replace("data:", "").strip() or "image/png"
            binary = base64.b64decode(payload)
            response = HttpResponse(binary, content_type=content_type)
            response["Cache-Control"] = "no-store"
            return response
        except (ValueError, binascii.Error):
            raise Http404("Bad data url")

    if value.startswith("s3://"):
        parsed = s3_utils.parse_storage_pointer(value)
        if not parsed or not s3_utils.is_configured():
            raise Http404("S3 unavailable")
        try:
            client = s3_utils.get_client()
            result = client.get_object(Bucket=parsed["bucket"], Key=parsed["key"])
            content_type = str(result.get("ContentType") or "image/jpeg").strip() or "image/jpeg"
            body = result["Body"].read()
            if not body:
                raise Http404("Empty image")
            response = HttpResponse(body, content_type=content_type)
            response["Cache-Control"] = "no-store"
            return response
        except Exception:
            raise Http404("S3 fetch failed")

    # For plain external URLs, redirect as a last resort.
    if value.startswith(("http://", "https://")):
        return HttpResponseRedirect(value)

    raise Http404("Unsupported image source")


def _parse_text_list(value):
    value = _coerce_json(value)
    if not value:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, dict):
        return [str(item).strip() for item in value.values() if str(item).strip()]
    return []


def _parse_image_urls(value):
    value = _coerce_json(value)
    if not isinstance(value, list):
        return []
    return [
        str(item).strip()
        for item in value
        if _is_supported_image_source(item)
    ][:5]


def _is_supported_image_source(value):
    raw = str(value or "").strip()
    if not raw:
        return False
    return raw.startswith(("http://", "https://", "data:image/"))


def _resolve_primary_food_image(image_urls_value, image_url_fallback):
    image_urls = _parse_image_urls(image_urls_value)
    if image_urls:
        return image_urls[0]
    fallback = str(image_url_fallback or "").strip()
    return fallback if _is_supported_image_source(fallback) else None


def _public_food_image_url(request, food_id, updated_at=None):
    if request is None or food_id is None:
        return None
    base_url = request.build_absolute_uri(reverse("food-public-image", args=[food_id]))
    if updated_at is None:
        return base_url
    version = str(updated_at)
    return f"{base_url}?v={version}"


def _resolve_food_image_for_client(request, food_id, image_urls_value, image_url_fallback, updated_at=None):
    primary = _resolve_primary_food_image(image_urls_value, image_url_fallback)
    if not primary:
        return None
    if primary.startswith("data:image/"):
        return _public_food_image_url(request, food_id, updated_at)
    return primary


def _decode_inline_image(data_uri):
    raw = str(data_uri or "").strip()
    if not raw.startswith("data:image/") or ";base64," not in raw:
        return None, None
    header, base64_payload = raw.split(",", 1)
    content_type = header.split(";", 1)[0][5:] or "image/jpeg"
    try:
        return base64.b64decode(base64_payload), content_type
    except (binascii.Error, ValueError):
        return None, None


def _parse_menu_items(value, category_map):
    value = _coerce_json(value)
    if not isinstance(value, list):
        return []
    items = []
    seen = set()
    for raw in value:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name", "")).strip()
        if not name:
            continue
        kind = str(raw.get("kind", "extra")).strip().lower()
        if kind not in {"sauce", "extra", "appetizer"}:
            kind = "extra"
        pricing = str(raw.get("pricing", "free")).strip().lower()
        pricing = "paid" if pricing == "paid" else "free"
        category_id = str(raw.get("categoryId", "")).strip() or None
        key = (name.lower(), kind, pricing, category_id or "")
        if key in seen:
            continue
        seen.add(key)
        item = {
            "name": name,
            "kind": kind,
            "pricing": pricing,
            "categoryId": category_id,
            "categoryName": category_map.get(category_id) if category_id else None,
        }
        try:
            price = float(raw.get("price"))
        except (TypeError, ValueError):
            price = None
        if pricing == "paid" and price and price > 0:
            item["price"] = round(price, 2)
        items.append(item)
    return items[:20]


def _parse_secondary_categories(value, category_map):
    value = _coerce_json(value)
    if not isinstance(value, list):
        return []
    seen = set()
    items = []
    for raw in value:
        category_id = str(raw or "").strip()
        if not category_id or category_id in seen:
            continue
        seen.add(category_id)
        category_name = category_map.get(category_id)
        if category_name:
            items.append({"id": category_id, "name": category_name})
    return items[:20]


def _seller_delivery_options(delivery_enabled_value):
    return {
        "pickup": True,
        "delivery": bool(delivery_enabled_value),
    }


def _visible_lot_exists_sql(food_alias="f", lot_alias="plx"):
    return f"""EXISTS (
        SELECT 1
        FROM production_lots {lot_alias}
        WHERE {lot_alias}.food_id = {food_alias}.id
          AND {lot_alias}.status IN ('open', 'active')
          AND {lot_alias}.quantity_available > 0
          AND ({lot_alias}.sale_starts_at IS NULL OR {lot_alias}.sale_starts_at <= NOW())
          AND ({lot_alias}.sale_ends_at IS NULL OR {lot_alias}.sale_ends_at > NOW())
    )"""


def _has_any_lot_sql(food_alias="f", lot_alias="pl_any"):
    return f"""EXISTS (
        SELECT 1
        FROM production_lots {lot_alias}
        WHERE {lot_alias}.food_id = {food_alias}.id
    )"""


def _visibility_gate_sql(food_alias="f"):
    return f"({_visible_lot_exists_sql(food_alias)} OR NOT {_has_any_lot_sql(food_alias)})"


def _preferred_lot_id_sql(food_alias="f"):
    return f"""(
        SELECT pl.id
        FROM production_lots pl
        WHERE pl.food_id = {food_alias}.id
          AND pl.status IN ('open', 'active')
          AND pl.quantity_available > 0
          AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
          AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
        ORDER BY pl.quantity_available DESC, pl.created_at DESC
        LIMIT 1
    )"""


def _stock_sql(food_alias="f"):
    return f"""(
        CASE
            WHEN {_has_any_lot_sql(food_alias, "pl_any_stock")}
                THEN COALESCE(
                    (
                        SELECT SUM(pl.quantity_available)
                        FROM production_lots pl
                        WHERE pl.food_id = {food_alias}.id
                          AND pl.status IN ('open', 'active')
                          AND pl.quantity_available > 0
                          AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
                          AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
                    ),
                    0
                )::int
            ELSE 1
        END
    )"""


def _load_category_map(category_ids):
    ids = [str(item).strip() for item in category_ids if str(item).strip()]
    if not ids:
        return {}
    with connection.cursor() as cursor:
        cursor.execute(
            """
                SELECT id, name_tr, name_en
                FROM categories
                WHERE id::text = ANY(%s)
            """,
            [ids],
        )
        rows = _rows_as_dicts(cursor)
    return {
        str(row["id"]): (row.get("name_tr") or row.get("name_en") or str(row["id"]))
        for row in rows
    }


def _collect_food_category_ids(items):
    category_ids = []
    for item in items:
        if item.get("category_id"):
            category_ids.append(item["category_id"])
        for menu_item in _coerce_json(item.get("menu_items_json")) or []:
            if isinstance(menu_item, dict) and menu_item.get("categoryId"):
                category_ids.append(menu_item["categoryId"])
        for secondary_id in _coerce_json(item.get("secondary_category_ids_json")) or []:
            category_ids.append(secondary_id)
    return category_ids


def _serialize_food_row(row, category_map, request=None):
    image_urls = _parse_image_urls(row.get("image_urls_json"))
    ingredients = _parse_text_list(row.get("ingredients_json"))
    allergens = _parse_text_list(row.get("allergens_json"))
    return {
        "id": str(row["id"]),
        "foodId": str(row["id"]),
        "name": row.get("name"),
        "cardSummary": row.get("card_summary"),
        "description": row.get("description"),
        "price": float(row.get("price") or 0),
        "deliveryFee": 0,
        "deliveryOptions": _seller_delivery_options(row.get("seller_delivery_enabled")),
        "imageUrl": _resolve_food_image_for_client(
            request,
            row.get("id"),
            row.get("image_urls_json"),
            row.get("image_url"),
            row.get("updated_at"),
        ),
        "imageUrls": image_urls,
        "rating": f"{float(row['rating']):.1f}" if row.get("rating") is not None else None,
        "reviewCount": int(row.get("review_count") or 0),
        "prepTime": row.get("preparation_time_minutes"),
        "maxDistance": float(row["seller_delivery_radius_km"]) if row.get("seller_delivery_radius_km") is not None else None,
        "allergens": allergens,
        "ingredients": ingredients,
        "cuisine": row.get("cuisine"),
        "menuItems": _parse_menu_items(
            (_coerce_json(row.get("menu_items_json")) or []) + (_coerce_json(row.get("paid_addons_json")) or []),
            category_map,
        ),
        "secondaryCategories": _parse_secondary_categories(row.get("secondary_category_ids_json"), category_map),
        "lotId": str(row["lot_id"]) if row.get("lot_id") is not None else None,
        "category": row.get("category"),
        "stock": int(row.get("stock") or 0),
        "seller": {
            "id": str(row["seller_id"]),
            "name": row.get("seller_name"),
            "username": row.get("seller_username"),
            "image": row.get("seller_image"),
            "tagline": row.get("seller_tagline"),
            "homeCardImage": row.get("seller_home_card_image"),
        },
    }


def _favorite_list_sql():
    return """
        SELECT
            f.id,
            f.name,
            f.price,
            f.image_url,
            f.image_urls_json,
            f.updated_at,
            f.rating,
            COALESCE(u.display_name, u.username, 'Satıcı') AS seller_name
        FROM favorites fav
        JOIN foods f ON f.id = fav.food_id
        JOIN users u ON u.id = f.seller_id
        WHERE fav.user_id = %s
        ORDER BY fav.created_at DESC
    """


def _serialize_favorite_row(row, request=None):
    return {
        "id": str(row["id"]),
        "name": row.get("name") or "",
        "price": float(row.get("price") or 0),
        "imageUrl": _resolve_food_image_for_client(
            request,
            row.get("id"),
            row.get("image_urls_json"),
            row.get("image_url"),
            row.get("updated_at"),
        ),
        "rating": f"{float(row['rating']):.1f}" if row.get("rating") is not None else None,
        "sellerName": row.get("seller_name") or "Satıcı",
    }


def _food_exists(food_id):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT EXISTS(SELECT 1 FROM foods WHERE id = %s)",
            [food_id],
        )
        return bool(cursor.fetchone()[0])


def _sync_food_favorite_count(food_id):
    with connection.cursor() as cursor:
        cursor.execute(
            """
                UPDATE foods f
                SET favorite_count = sub.total_count
                FROM (
                    SELECT COUNT(*)::int AS total_count
                    FROM favorites
                    WHERE food_id = %s
                ) sub
                WHERE f.id = %s
            """,
            [food_id, food_id],
        )


class FavoriteListView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(_favorite_list_sql(), [request.user.id])
            rows = _rows_as_dicts(cursor)
        return Response({"data": [_serialize_favorite_row(row, request) for row in rows]})


class FavoriteToggleView(APIView):
    permission_classes = [IsAppRealm]

    def post(self, request, food_id):
        if not _food_exists(food_id):
            return error_response("FOOD_NOT_FOUND", "Yemek bulunamadı.", 404)

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                        INSERT INTO favorites (user_id, food_id, created_at)
                        VALUES (%s, %s, NOW())
                        ON CONFLICT (user_id, food_id) DO NOTHING
                    """,
                    [request.user.id, food_id],
                )
            _sync_food_favorite_count(food_id)

        return Response({"data": {"ok": True}})

    def delete(self, request, food_id):
        if not _food_exists(food_id):
            return error_response("FOOD_NOT_FOUND", "Yemek bulunamadı.", 404)

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM favorites WHERE user_id = %s AND food_id = %s",
                    [request.user.id, food_id],
                )
            _sync_food_favorite_count(food_id)

        return Response({"data": {"ok": True}})


class FoodListView(APIView):
    """GET /v1/foods/ — List active foods with optional filters."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        search = request.query_params.get("search", "").strip()
        category_id = request.query_params.get("categoryId")
        seller_id = request.query_params.get("sellerId")

        category_name = request.query_params.get("category")
        seller_home_card_image_sql = (
            "u.home_card_image_url AS seller_home_card_image"
            if _has_public_column("users", "home_card_image_url")
            else "NULL::text AS seller_home_card_image"
        )
        paid_addons_sql = (
            "f.paid_addons_json"
            if _has_public_column("foods", "paid_addons_json")
            else "'[]'::jsonb AS paid_addons_json"
        )

        where_clauses = [
            "f.is_active = TRUE",
            _visibility_gate_sql("f"),
        ]
        params = []

        if category_id:
            where_clauses.append("f.category_id = %s")
            params.append(category_id)

        if category_name and category_name != "Tumu":
            where_clauses.append("c.name_tr = %s")
            params.append(category_name)

        if seller_id:
            where_clauses.append("f.seller_id = %s")
            params.append(seller_id)

        if search:
            where_clauses.append("(f.name ILIKE %s OR f.card_summary ILIKE %s)")
            like = f"%{search}%"
            params.extend([like, like])

        where_sql = " AND ".join(where_clauses)

        data_sql = f"""
            SELECT
                f.id,
                f.name,
                f.card_summary,
                f.description,
                f.price,
                f.image_url,
                f.image_urls_json,
                f.updated_at,
                f.rating,
                f.review_count,
                f.preparation_time_minutes,
                f.allergens_json,
                f.ingredients_json,
                f.cuisine,
                f.menu_items_json,
                {paid_addons_sql},
                f.secondary_category_ids_json,
                COALESCE(u.delivery_enabled, FALSE) AS seller_delivery_enabled,
                u.delivery_radius_km AS seller_delivery_radius_km,
                f.category_id,
                {_preferred_lot_id_sql("f")} AS lot_id,
                c.name_tr AS category,
                f.seller_id,
                u.display_name AS seller_name,
                u.username AS seller_username,
                u.profile_image_url AS seller_image,
                u.kitchen_description AS seller_tagline,
                {seller_home_card_image_sql},
                {_stock_sql("f")} AS stock
            FROM foods f
            JOIN users u ON u.id = f.seller_id
            LEFT JOIN categories c ON c.id = f.category_id
            WHERE {where_sql}
            ORDER BY f.created_at DESC
        """

        with connection.cursor() as cursor:
            cursor.execute(data_sql, params)
            items = _rows_as_dicts(cursor)

        category_map = _load_category_map(_collect_food_category_ids(items))
        hero_texts = _load_latest_mobile_home_hero_texts()
        return Response({
            "data": [_serialize_food_row(item, category_map, request) for item in items],
            "mobileHomeHeaderImageUrl": _resolve_mobile_home_header_image_url(request),
            "mobileHomeHeaderImageCacheKey": _resolve_mobile_home_header_image_cache_key(),
            "mobileHomeHeroSurfaceColor": _resolve_mobile_home_surface_color(),
            "mobileHomeHeroRenderConfig": _resolve_mobile_home_hero_render_config(),
            "mobileHomeHeroQuestionText": hero_texts.get("mobile_home_hero_question_text"),
            "mobileHomeHeroSloganTitle": hero_texts.get("mobile_home_hero_slogan_title"),
            "mobileHomeHeroSloganSubtitle": hero_texts.get("mobile_home_hero_slogan_subtitle"),
        })


RECOMMENDATION_DEFAULT_LIMIT = 8
RECOMMENDATION_MAX_LIMIT = 20
RECOMMENDATION_MAX_ITEMS_PER_SELLER = 2


def _parse_recommendation_limit(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return RECOMMENDATION_DEFAULT_LIMIT
    return max(1, min(parsed, RECOMMENDATION_MAX_LIMIT))


def _recommendation_reason(row):
    if row.get("has_favorite"):
        return "Favorilerinden tanıdık bir lezzet"
    if float(row.get("favorite_category_score") or 0) > 0:
        return "Favorilerindeki tatlara yakın"
    if float(row.get("order_category_score") or 0) > 0:
        return "Daha önce sevdiğin kategoriden"
    if float(row.get("order_cuisine_score") or 0) > 0:
        return "Damak tadına yakın bir mutfak"
    if float(row.get("seller_order_score") or 0) > 0:
        return "Daha önce tercih ettiğin satıcıdan"
    if int(row.get("seller_order_count") or 0) == 0 and bool(row.get("has_profile_signal")):
        return "Yeni bir satıcı keşfi"
    return "Popüler ve yüksek puanlı"


def _select_fair_recommendations(items, limit):
    selected = []
    selected_ids = set()
    seller_counts = {}
    min_distinct_sellers = max(1, min(limit, (limit + 1) // 2))

    def add_item(item, enforce_cap=True):
        if item["id"] in selected_ids:
            return False
        seller_id = str(item.get("seller_id") or "")
        if enforce_cap and seller_counts.get(seller_id, 0) >= RECOMMENDATION_MAX_ITEMS_PER_SELLER:
            return False
        selected.append(item)
        selected_ids.add(item["id"])
        seller_counts[seller_id] = seller_counts.get(seller_id, 0) + 1
        return True

    for item in items:
        if len(selected) >= limit or len(seller_counts) >= min_distinct_sellers:
            break
        seller_id = str(item.get("seller_id") or "")
        if seller_counts.get(seller_id, 0) == 0:
            add_item(item)

    for item in items:
        if len(selected) >= limit:
            break
        add_item(item)

    for item in items:
        if len(selected) >= limit:
            break
        add_item(item, enforce_cap=False)

    return selected[:limit]


class FoodRecommendationsView(APIView):
    """GET /v1/foods/recommendations - Personalized buyer recommendations."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        limit = _parse_recommendation_limit(request.query_params.get("limit"))
        candidate_limit = min(max(limit * 8, 40), 140)
        seller_home_card_image_sql = (
            "u.home_card_image_url AS seller_home_card_image"
            if _has_public_column("users", "home_card_image_url")
            else "NULL::text AS seller_home_card_image"
        )
        paid_addons_sql = (
            "f.paid_addons_json"
            if _has_public_column("foods", "paid_addons_json")
            else "'[]'::jsonb AS paid_addons_json"
        )
        favorite_count_sql = (
            "COALESCE(f.favorite_count, 0)"
            if _has_public_column("foods", "favorite_count")
            else "0"
        )

        sql = f"""
            WITH buyer_orders AS (
                SELECT
                    oi.food_id,
                    f.category_id,
                    NULLIF(LOWER(TRIM(f.cuisine)), '') AS cuisine_key,
                    f.seller_id,
                    SUM(GREATEST(oi.quantity, 1))::float AS order_weight,
                    MAX(o.created_at) AS last_ordered_at
                FROM orders o
                JOIN order_items oi ON oi.order_id = o.id
                JOIN foods f ON f.id = oi.food_id
                WHERE o.buyer_id = %s
                  AND o.status = 'completed'
                GROUP BY oi.food_id, f.category_id, cuisine_key, f.seller_id
            ),
            order_categories AS (
                SELECT category_id, SUM(order_weight)::float AS score
                FROM buyer_orders
                WHERE category_id IS NOT NULL
                GROUP BY category_id
            ),
            order_cuisines AS (
                SELECT cuisine_key, SUM(order_weight)::float AS score
                FROM buyer_orders
                WHERE cuisine_key IS NOT NULL
                GROUP BY cuisine_key
            ),
            order_sellers AS (
                SELECT seller_id, SUM(order_weight)::float AS score
                FROM buyer_orders
                GROUP BY seller_id
            ),
            favorite_foods AS (
                SELECT
                    fav.food_id,
                    f.category_id,
                    NULLIF(LOWER(TRIM(f.cuisine)), '') AS cuisine_key
                FROM favorites fav
                JOIN foods f ON f.id = fav.food_id
                WHERE fav.user_id = %s
            ),
            favorite_categories AS (
                SELECT category_id, COUNT(*)::float AS score
                FROM favorite_foods
                WHERE category_id IS NOT NULL
                GROUP BY category_id
            ),
            favorite_cuisines AS (
                SELECT cuisine_key, COUNT(*)::float AS score
                FROM favorite_foods
                WHERE cuisine_key IS NOT NULL
                GROUP BY cuisine_key
            ),
            food_sales AS (
                SELECT oi.food_id, SUM(GREATEST(oi.quantity, 1))::float AS total_sold
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id AND o.status = 'completed'
                GROUP BY oi.food_id
            ),
            candidate_scores AS (
                SELECT
                    f.id,
                    f.name,
                    f.card_summary,
                    f.description,
                    f.price,
                    f.image_url,
                    f.image_urls_json,
                    f.updated_at,
                    f.rating,
                    f.review_count,
                    f.preparation_time_minutes,
                    f.allergens_json,
                    f.ingredients_json,
                    f.cuisine,
                    f.menu_items_json,
                    {paid_addons_sql},
                    f.secondary_category_ids_json,
                    COALESCE(u.delivery_enabled, FALSE) AS seller_delivery_enabled,
                    u.delivery_radius_km AS seller_delivery_radius_km,
                    f.category_id,
                    {_preferred_lot_id_sql("f")} AS lot_id,
                    c.name_tr AS category,
                    f.seller_id,
                    u.display_name AS seller_name,
                    u.username AS seller_username,
                    u.profile_image_url AS seller_image,
                    u.kitchen_description AS seller_tagline,
                    {seller_home_card_image_sql},
                    {_stock_sql("f")} AS stock,
                    COALESCE(bo.order_weight, 0)::float AS exact_order_score,
                    COALESCE(oc.score, 0)::float AS order_category_score,
                    COALESCE(ocu.score, 0)::float AS order_cuisine_score,
                    COALESCE(os.score, 0)::float AS seller_order_score,
                    COALESCE(fc.score, 0)::float AS favorite_category_score,
                    COALESCE(fcu.score, 0)::float AS favorite_cuisine_score,
                    COALESCE(fs.total_sold, 0)::float AS total_sold,
                    (ff.food_id IS NOT NULL) AS has_favorite,
                    EXISTS (SELECT 1 FROM buyer_orders) OR EXISTS (SELECT 1 FROM favorite_foods) AS has_profile_signal,
                    (
                        COALESCE(bo.order_weight, 0) * 2.2
                        + COALESCE(oc.score, 0) * 1.45
                        + COALESCE(ocu.score, 0) * 1.05
                        + COALESCE(os.score, 0) * 0.28
                        + COALESCE(fc.score, 0) * 2.4
                        + COALESCE(fcu.score, 0) * 1.7
                        + CASE WHEN ff.food_id IS NOT NULL THEN 4.0 ELSE 0 END
                        + LEAST(COALESCE(f.rating, 0)::float, 5.0) * 0.18
                        + LN(1 + GREATEST(COALESCE(f.review_count, 0), 0)) * 0.16
                        + LN(1 + GREATEST({favorite_count_sql}, 0)) * 0.12
                        + LN(1 + COALESCE(fs.total_sold, 0)) * 0.24
                        + CASE WHEN os.seller_id IS NULL THEN 0.35 ELSE 0 END
                    ) AS recommendation_score,
                    COUNT(bo.food_id) OVER (PARTITION BY f.seller_id) AS seller_order_count
                FROM foods f
                JOIN users u ON u.id = f.seller_id
                LEFT JOIN categories c ON c.id = f.category_id
                LEFT JOIN buyer_orders bo ON bo.food_id = f.id
                LEFT JOIN order_categories oc ON oc.category_id = f.category_id
                LEFT JOIN order_cuisines ocu ON ocu.cuisine_key = NULLIF(LOWER(TRIM(f.cuisine)), '')
                LEFT JOIN order_sellers os ON os.seller_id = f.seller_id
                LEFT JOIN favorite_foods ff ON ff.food_id = f.id
                LEFT JOIN favorite_categories fc ON fc.category_id = f.category_id
                LEFT JOIN favorite_cuisines fcu ON fcu.cuisine_key = NULLIF(LOWER(TRIM(f.cuisine)), '')
                LEFT JOIN food_sales fs ON fs.food_id = f.id
                WHERE f.is_active = TRUE
                  AND {_visibility_gate_sql("f")}
                  AND {_stock_sql("f")} > 0
            )
            SELECT *
            FROM candidate_scores
            ORDER BY recommendation_score DESC, total_sold DESC, rating DESC NULLS LAST, review_count DESC, name ASC
            LIMIT %s
        """

        with connection.cursor() as cursor:
            cursor.execute(sql, [request.user.id, request.user.id, candidate_limit])
            candidates = _rows_as_dicts(cursor)

        selected = _select_fair_recommendations(candidates, limit)
        category_map = _load_category_map(_collect_food_category_ids(selected))
        data = []
        for item in selected:
            serialized = _serialize_food_row(item, category_map, request)
            serialized["reason"] = _recommendation_reason(item)
            serialized["totalSold"] = int(float(item.get("total_sold") or 0))
            data.append(serialized)
        return Response({"data": data})


class TopSoldFoodsView(APIView):
    """GET /v1/foods/top-sold — Top 20 foods by completed order count."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        sql = """
            SELECT f.id, f.name, f.price, f.image_url, f.image_urls_json,
                   COUNT(oi.id) AS sales_count, f.seller_id, u.display_name AS seller_name
            FROM foods f
            JOIN order_items oi ON oi.food_id = f.id
            JOIN orders o ON o.id = oi.order_id AND o.status = 'completed'
            JOIN users u ON u.id = f.seller_id
            WHERE f.is_active = TRUE
            GROUP BY f.id, u.display_name
            ORDER BY sales_count DESC
            LIMIT 20
        """
        with connection.cursor() as cursor:
            cursor.execute(sql)
            items = _rows_as_dicts(cursor)

        uuid_fields = ["id", "seller_id"]
        for item in items:
            _stringify_uuids(item, uuid_fields)

        return Response({"data": items})


class SellerListView(APIView):
    """GET /v1/foods/sellers — List seller profiles ordered by rating."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        sql = """
            SELECT u.id, u.display_name, u.kitchen_title, u.kitchen_description,
                   u.kitchen_specialties, u.delivery_enabled, u.delivery_radius_km,
                   u.profile_image_url
            FROM users u
            WHERE u.user_type IN ('seller', 'both') AND u.is_active = TRUE
            ORDER BY u.created_at DESC
            LIMIT 50
        """
        with connection.cursor() as cursor:
            cursor.execute(sql)
            sellers = _rows_as_dicts(cursor)

        for seller in sellers:
            _stringify_uuids(seller, ["id"])

        return Response({"data": sellers})


class SellerFoodsView(APIView):
    """GET /v1/foods/sellers/:sellerId/foods — Active foods for a specific seller."""

    permission_classes = [IsAppRealm]

    def get(self, request, seller_id):
        seller_home_card_image_sql = (
            "u.home_card_image_url AS seller_home_card_image"
            if _has_public_column("users", "home_card_image_url")
            else "NULL::text AS seller_home_card_image"
        )
        paid_addons_sql = (
            "f.paid_addons_json"
            if _has_public_column("foods", "paid_addons_json")
            else "'[]'::jsonb AS paid_addons_json"
        )
        sql = f"""
            SELECT
                f.id,
                f.name,
                f.card_summary,
                f.description,
                f.price,
                f.image_url,
                f.image_urls_json,
                f.updated_at,
                f.rating,
                f.review_count,
                f.preparation_time_minutes,
                f.allergens_json,
                f.ingredients_json,
                f.cuisine,
                f.menu_items_json,
                {paid_addons_sql},
                f.secondary_category_ids_json,
                COALESCE(u.delivery_enabled, FALSE) AS seller_delivery_enabled,
                u.delivery_radius_km AS seller_delivery_radius_km,
                f.category_id,
                {_preferred_lot_id_sql("f")} AS lot_id,
                c.name_tr AS category,
                f.seller_id,
                u.display_name AS seller_name,
                u.username AS seller_username,
                u.profile_image_url AS seller_image,
                u.kitchen_description AS seller_tagline,
                {seller_home_card_image_sql},
                {_stock_sql("f")} AS stock
            FROM foods f
            JOIN users u ON u.id = f.seller_id
            LEFT JOIN categories c ON c.id = f.category_id
            WHERE f.seller_id = %s
              AND f.is_active = TRUE
              AND {_visibility_gate_sql("f")}
            ORDER BY f.created_at DESC
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [str(seller_id)])
            items = _rows_as_dicts(cursor)

        category_ids = []
        for item in items:
            if item.get("category_id"):
                category_ids.append(item["category_id"])
            for menu_item in _coerce_json(item.get("menu_items_json")) or []:
                if isinstance(menu_item, dict) and menu_item.get("categoryId"):
                    category_ids.append(menu_item["categoryId"])
            for secondary_id in _coerce_json(item.get("secondary_category_ids_json")) or []:
                category_ids.append(secondary_id)
        category_map = _load_category_map(category_ids)
        return Response({"data": [_serialize_food_row(item, category_map, request) for item in items]})


class FoodImageView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, food_id):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT image_url, image_urls_json
                    FROM foods
                    WHERE id = %s
                    LIMIT 1
                """,
                [food_id],
            )
            row = cursor.fetchone()

        if not row:
            return HttpResponse(status=404)

        image_url, image_urls_json = row
        primary = _resolve_primary_food_image(image_urls_json, image_url)
        if not primary:
            return HttpResponse(status=404)

        if primary.startswith(("http://", "https://")):
            return HttpResponseRedirect(primary)

        image_bytes, content_type = _decode_inline_image(primary)
        if not image_bytes or not content_type:
            return HttpResponse(status=404)

        response = HttpResponse(image_bytes, content_type=content_type)
        response["Cache-Control"] = "public, max-age=86400"
        return response


class SellerAddressView(APIView):
    """GET /v1/foods/sellers/:sellerId/address — seller default pickup address."""

    permission_classes = [IsAppRealm]

    def get(self, request, seller_id):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT ua.title, ua.address_line
                FROM user_addresses ua
                JOIN users u ON u.id = ua.user_id
                WHERE ua.user_id = %s
                  AND u.user_type IN ('seller', 'both')
                  AND u.is_active = TRUE
                ORDER BY ua.is_default DESC, ua.updated_at DESC, ua.created_at DESC
                LIMIT 1
                """,
                [str(seller_id)],
            )
            row = cursor.fetchone()

        if row is None:
            return Response({"data": None})

        return Response({"data": {"title": row[0], "addressLine": row[1]}})


class SellerReviewsView(APIView):
    """GET /v1/foods/sellers/:sellerId/reviews — Reviews for a seller."""

    permission_classes = [IsAppRealm]

    def get(self, request, seller_id):
        sql = """
            SELECT r.id, r.rating, r.comment, r.created_at, u.display_name AS buyer_name
            FROM reviews r
            JOIN users u ON u.id = r.buyer_id
            WHERE r.seller_id = %s
            ORDER BY r.created_at DESC
            LIMIT 50
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [str(seller_id)])
            reviews = _rows_as_dicts(cursor)

        for review in reviews:
            _stringify_uuids(review, ["id"])

        return Response({"data": reviews})


class CategoryListView(APIView):
    """GET /v1/foods/categories — All food categories."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        sql = """
            SELECT id, name_tr, name_en, sort_order
            FROM categories
            WHERE is_active = TRUE
            ORDER BY sort_order, name_tr
        """
        with connection.cursor() as cursor:
            cursor.execute(sql)
            categories = _rows_as_dicts(cursor)

        for cat in categories:
            _stringify_uuids(cat, ["id"])

        return Response({"data": categories})
