"""
Public food browsing views for the app realm.
All endpoints require a valid JWT with realm == 'app'.
"""
import json

from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

_COLUMN_EXISTS_CACHE = {}


class IsAppRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "app"


def _rows_as_dicts(cursor):
    """Convert cursor results to list of dicts using cursor.description."""
    cols = [col.name for col in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _stringify_uuids(row: dict, fields: list) -> dict:
    """Convert UUID fields to strings in-place."""
    for f in fields:
        if row.get(f) is not None:
            row[f] = str(row[f])
    return row


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
        if str(item).strip().startswith(("http://", "https://"))
    ][:5]


def _resolve_primary_food_image(image_urls_value, image_url_fallback):
    image_urls = _parse_image_urls(image_urls_value)
    if image_urls:
        return image_urls[0]
    fallback = str(image_url_fallback or "").strip()
    return fallback if fallback.startswith(("http://", "https://")) else None


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


def _serialize_food_row(row, category_map):
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
        "imageUrl": _resolve_primary_food_image(row.get("image_urls_json"), row.get("image_url")),
        "imageUrls": image_urls,
        "rating": f"{float(row['rating']):.1f}" if row.get("rating") is not None else None,
        "reviewCount": int(row.get("review_count") or 0),
        "prepTime": row.get("preparation_time_minutes"),
        "maxDistance": float(row["seller_delivery_radius_km"]) if row.get("seller_delivery_radius_km") is not None else None,
        "allergens": allergens,
        "ingredients": ingredients,
        "cuisine": row.get("cuisine"),
        "menuItems": _parse_menu_items(row.get("menu_items_json"), category_map),
        "secondaryCategories": _parse_secondary_categories(row.get("secondary_category_ids_json"), category_map),
        "lotId": str(row["lot_id"]) if row.get("lot_id") is not None else None,
        "category": row.get("category"),
        "stock": int(row.get("stock") or 0),
        "seller": {
            "id": str(row["seller_id"]),
            "name": row.get("seller_name"),
            "username": row.get("seller_username"),
            "image": row.get("seller_image"),
            "homeCardImage": row.get("seller_home_card_image"),
        },
    }


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
                f.rating,
                f.review_count,
                f.preparation_time_minutes,
                f.allergens_json,
                f.ingredients_json,
                f.cuisine,
                f.menu_items_json,
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
        return Response({"data": [_serialize_food_row(item, category_map) for item in items]})


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
        sql = f"""
            SELECT
                f.id,
                f.name,
                f.card_summary,
                f.description,
                f.price,
                f.image_url,
                f.image_urls_json,
                f.rating,
                f.review_count,
                f.preparation_time_minutes,
                f.allergens_json,
                f.ingredients_json,
                f.cuisine,
                f.menu_items_json,
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
        return Response({"data": [_serialize_food_row(item, category_map) for item in items]})


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
