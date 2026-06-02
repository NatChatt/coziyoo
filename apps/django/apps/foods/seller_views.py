"""
Seller management views — all endpoints require realm == 'app'.
The caller must also be a seller (user_type in ('seller', 'both')),
but role enforcement is left to the JWT payload (role == 'seller').
"""
import json
import logging
import uuid
from datetime import datetime, timedelta

from django.db import DatabaseError, connection, transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from coziyoo import s3 as s3_utils

from apps.common.permissions import IsAppRealm
from apps.common.responses import error_response
from apps.common.db import (
    rows_as_dicts as _rows_as_dicts,
    row_as_dict as _row_as_dict,
    stringify_uuids as _stringify_uuids,
)
from apps.common.geo import (
    to_finite_number as _to_finite_number,
    haversine_km as _haversine_km,
    estimate_delivery_metrics_from_radius as _estimate_delivery_metrics_from_radius,
)

logger = logging.getLogger(__name__)

_LOT_ACTIVE_STATUS_CACHE = None
_PUBLIC_COLUMN_CACHE = {}


def _has_users_column(column_name):
    with connection.cursor() as cursor:
        cursor.execute(
            """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'users'
                      AND column_name = %s
                )
            """,
            [column_name],
        )
        return bool(cursor.fetchone()[0])


def _has_public_column(table_name, column_name):
    cache_key = (table_name, column_name)
    if cache_key in _PUBLIC_COLUMN_CACHE:
        return _PUBLIC_COLUMN_CACHE[cache_key]
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
    _PUBLIC_COLUMN_CACHE[cache_key] = exists
    return exists


def _coerce_json_array(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
    return []


_JSON_ARRAY_FIELDS = [
    "ingredients_json",
    "allergens_json",
    "menu_items_json",
    "paid_addons_json",
    "image_urls_json",
    "secondary_category_ids_json",
]


def _ensure_json_arrays(food: dict) -> dict:
    """Guarantee jsonb columns are Python lists, not raw strings.

    psycopg2 should auto-deserialise jsonb, but when columns were inserted
    via json.dumps() as a plain text param there are edge cases where the
    driver returns a str instead of a list.  Parsing defensively here keeps
    the API contract stable regardless of driver behaviour.
    """
    for field in _JSON_ARRAY_FIELDS:
        value = food.get(field)
        if value is None:
            food[field] = []
        elif isinstance(value, str):
            try:
                parsed = json.loads(value)
                food[field] = parsed if isinstance(parsed, list) else []
            except (json.JSONDecodeError, ValueError):
                food[field] = []
        elif not isinstance(value, list):
            food[field] = []
    return food


def _resolve_lot_active_status():
    global _LOT_ACTIVE_STATUS_CACHE
    if _LOT_ACTIVE_STATUS_CACHE is not None:
        return _LOT_ACTIVE_STATUS_CACHE

    with connection.cursor() as cursor:
        cursor.execute(
            """
                SELECT pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conrelid = 'production_lots'::regclass
                  AND conname = 'production_lots_status_check'
                LIMIT 1
            """
        )
        row = cursor.fetchone()

    definition = str(row[0] if row else "")
    _LOT_ACTIVE_STATUS_CACHE = "active" if "'active'" in definition else "open"
    return _LOT_ACTIVE_STATUS_CACHE


def _parse_iso(value):
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _make_lot_number(food_id, produced_dt):
    return f"CZ-{str(food_id)[:8].upper()}-{produced_dt.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"


def _insert_production_lot(
    cursor,
    *,
    seller_id,
    food_id,
    produced_at,
    sale_starts_at,
    sale_ends_at,
    quantity_produced,
    quantity_available,
    lifecycle_status,
    recipe_snapshot,
    ingredients_snapshot,
    allergens_snapshot,
    notes=None,
    use_by=None,
    best_before=None,
    food_name_snapshot=None,
    price_snapshot=None,
    menu_items_snapshot=None,
    paid_addons_snapshot=None,
):
    produced_dt = produced_at if isinstance(produced_at, datetime) else _parse_iso(produced_at)
    lot_id = str(uuid.uuid4())
    lot_number = _make_lot_number(food_id, produced_dt)

    columns = [
        "id", "seller_id", "food_id", "lot_number", "produced_at", "sale_starts_at", "sale_ends_at",
        "use_by", "best_before", "recipe_snapshot", "ingredients_snapshot_json", "allergens_snapshot_json",
        "quantity_produced", "quantity_available", "status", "notes", "created_at", "updated_at",
    ]
    values = [
        lot_id,
        seller_id,
        str(food_id),
        lot_number,
        produced_at.isoformat() if isinstance(produced_at, datetime) else produced_at,
        sale_starts_at.isoformat() if isinstance(sale_starts_at, datetime) else sale_starts_at,
        sale_ends_at.isoformat() if isinstance(sale_ends_at, datetime) else sale_ends_at,
        use_by.isoformat() if isinstance(use_by, datetime) else use_by,
        best_before.isoformat() if isinstance(best_before, datetime) else best_before,
        recipe_snapshot,
        json.dumps(_coerce_json_array(ingredients_snapshot)),
        json.dumps(_coerce_json_array(allergens_snapshot)),
        quantity_produced,
        quantity_available,
        lifecycle_status,
        notes,
    ]

    optional_columns = {
        "food_name_snapshot": food_name_snapshot,
        "price_snapshot": price_snapshot,
        "menu_items_snapshot_json": json.dumps(_coerce_json_array(menu_items_snapshot)),
        "paid_addons_snapshot_json": json.dumps(_coerce_json_array(paid_addons_snapshot)),
    }
    for column, value in optional_columns.items():
        if _has_public_column("production_lots", column):
            columns.insert(-2, column)
            values.append(value)

    placeholders = ["%s"] * (len(columns) - 2) + ["now()", "now()"]
    cursor.execute(
        f"""
            INSERT INTO production_lots ({", ".join(columns)})
            VALUES ({", ".join(placeholders)})
        """,
        values,
    )
    return lot_id, lot_number


class SellerProfileView(APIView):
    """GET /v1/seller/profile — Fetch own seller profile.
    PUT /v1/seller/profile — Update seller profile fields."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        home_card_image_sql = (
            "home_card_image_url"
            if _has_users_column("home_card_image_url")
            else "NULL::text AS home_card_image_url"
        )
        sql = """
            SELECT id, email, display_name, username, kitchen_title, kitchen_description,
                   kitchen_specialties, delivery_enabled, delivery_radius_km,
                   delivery_terms, working_hours_json,
                   profile_image_url,
                   seller_profile_status,
                   phone,
                   {home_card_image_sql}
            FROM users
            WHERE id = %s
        """.format(home_card_image_sql=home_card_image_sql)
        with connection.cursor() as cursor:
            cursor.execute(sql, [request.user.id])
            profile = _row_as_dict(cursor)

        if profile is None:
            return error_response("NOT_FOUND", "User not found", status.HTTP_404_NOT_FOUND)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT title, address_line
                    FROM user_addresses
                    WHERE user_id = %s AND is_default = TRUE
                    ORDER BY updated_at DESC
                    LIMIT 1
                """,
                [request.user.id],
            )
            default_address = _row_as_dict(cursor)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                  COUNT(*) FILTER (WHERE cdl.is_required_default = TRUE)::int AS required_count,
                  COUNT(*) FILTER (
                    WHERE cdl.is_required_default = TRUE
                      AND scd.status IN ('pending', 'uploaded', 'approved', 'rejected')
                  )::int AS uploaded_required_count
                FROM compliance_documents_list cdl
                LEFT JOIN seller_compliance_documents scd
                  ON scd.document_list_id = cdl.id
                 AND scd.seller_id = %s
                 AND scd.is_current = TRUE
                WHERE cdl.is_active = TRUE
                """,
                [request.user.id],
            )
            compliance_row = cursor.fetchone() or (0, 0)

        raw_status = str(profile.get("seller_profile_status") or "").strip()
        api_status = "active" if raw_status == "approved" else "pending_review" if raw_status == "pending" else "incomplete"
        specialties = profile.get("kitchen_specialties")
        if isinstance(specialties, str):
            try:
                specialties = json.loads(specialties)
            except (json.JSONDecodeError, ValueError):
                specialties = []
        working_hours = profile.get("working_hours_json")
        if isinstance(working_hours, str):
            try:
                working_hours = json.loads(working_hours)
            except (json.JSONDecodeError, ValueError):
                working_hours = []

        data = {
            "id": str(profile["id"]),
            "email": profile.get("email"),
            "displayName": profile.get("display_name"),
            "username": profile.get("username"),
            "profileImageUrl": s3_utils.hydrate_file_url(profile.get("profile_image_url")),
            "homeCardImageUrl": s3_utils.hydrate_file_url(profile.get("home_card_image_url")),
            "kitchenTitle": profile.get("kitchen_title"),
            "kitchenDescription": profile.get("kitchen_description"),
            "kitchenSpecialties": specialties if isinstance(specialties, list) else [],
            "deliveryEnabled": bool(profile.get("delivery_enabled")),
            "deliveryRadiusKm": profile.get("delivery_radius_km"),
            "deliveryTerms": profile.get("delivery_terms"),
            "workingHours": working_hours if isinstance(working_hours, list) else [],
            "status": api_status,
            "defaultAddress": {
                "title": default_address.get("title"),
                "addressLine": default_address.get("address_line"),
            } if default_address else None,
            "requirements": {
                "hasPhone": bool(str(profile.get("phone") or "").strip()),
                "hasDefaultAddress": bool(default_address),
                "hasKitchenTitle": bool(str(profile.get("kitchen_title") or "").strip()),
                "hasKitchenDescription": bool(str(profile.get("kitchen_description") or "").strip()),
                "hasDeliveryRadius": profile.get("delivery_radius_km") is not None,
                "hasWorkingHours": bool(working_hours),
                "complianceRequiredCount": int(compliance_row[0] or 0),
                "complianceUploadedRequiredCount": int(compliance_row[1] or 0),
            },
        }
        return Response({"data": data})

    def put(self, request):
        data = request.data
        kitchen_title = data.get("kitchenTitle")
        kitchen_description = data.get("kitchenDescription")
        kitchen_specialties = data.get("kitchenSpecialties")
        delivery_enabled = data.get("deliveryEnabled")
        delivery_radius_km = data.get("deliveryRadiusKm")
        delivery_terms = data.get("deliveryTerms")
        working_hours = data.get("workingHours")

        sql = """
            UPDATE users
            SET kitchen_title = %s,
                kitchen_description = %s,
                kitchen_specialties = %s,
                delivery_enabled = %s,
                delivery_radius_km = %s,
                delivery_terms = %s,
                working_hours_json = %s,
                updated_at = now()
            WHERE id = %s
            RETURNING id
        """
        with connection.cursor() as cursor:
            cursor.execute(
                sql,
                [
                    kitchen_title,
                    kitchen_description,
                    json.dumps(kitchen_specialties) if kitchen_specialties is not None else None,
                    delivery_enabled,
                    delivery_radius_km,
                    delivery_terms,
                    json.dumps(working_hours) if working_hours is not None else None,
                    request.user.id,
                ],
            )
            row = cursor.fetchone()

        if row is None:
            return error_response("NOT_FOUND", "User not found", status.HTTP_404_NOT_FOUND)

        return Response({"data": {"id": str(row[0])}})


class SellerFoodListView(APIView):
    """GET /v1/seller/foods — List seller's own foods.
    POST /v1/seller/foods — Create a new food listing."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        food_id = str(request.query_params.get("foodId") or "").strip()
        where_clauses = ["f.seller_id = %s"]
        params = [request.user.id]
        if food_id:
            where_clauses.append("f.id = %s")
            params.append(food_id)

        where_sql = " AND ".join(where_clauses)
        sql = """
            SELECT
                f.id,
                f.name,
                f.card_summary,
                f.description,
                f.recipe,
                f.price,
                f.is_active,
                f.image_url,
                f.image_urls_json,
                f.cuisine,
                f.ingredients_json,
                f.allergens_json,
                f.menu_items_json,
                f.paid_addons_json,
                f.secondary_category_ids_json,
                f.preparation_time_minutes,
                f.category_id,
                c.name_tr AS category_name,
                EXISTS (
                    SELECT 1
                    FROM production_lots pl_any
                    WHERE pl_any.food_id = f.id
                ) AS has_any_lot,
                COALESCE(
                    (
                        SELECT SUM(pl.quantity_available)
                        FROM production_lots pl
                        WHERE pl.food_id = f.id
                          AND pl.status IN ('open', 'active')
                          AND pl.quantity_available > 0
                          AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
                          AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
                    ),
                    0
                )::int AS stock,
                f.created_at,
                f.updated_at
            FROM foods f
            LEFT JOIN categories c ON c.id = f.category_id
            WHERE """ + where_sql + """
            ORDER BY created_at DESC
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            foods = _rows_as_dicts(cursor)

        uuid_fields = ["id", "category_id"]
        for food in foods:
            _stringify_uuids(food, uuid_fields)
            _ensure_json_arrays(food)

        return Response({"data": foods})

    def post(self, request):
        data = request.data
        name = data.get("name")
        price = data.get("price")
        initial_stock = data.get("initialStock")
        initial_sale_starts_at = data.get("initialSaleStartsAt")
        initial_sale_ends_at = data.get("initialSaleEndsAt")
        should_create_initial_lot = True

        if not name or price is None:
            return error_response("VALIDATION_ERROR", "name and price are required", status.HTTP_400_BAD_REQUEST)

        description = data.get("description")
        card_summary = data.get("cardSummary")
        recipe = data.get("recipe")
        cuisine = data.get("cuisine")
        is_active = data.get("isActive", True)
        category_id = data.get("categoryId") or None
        image_urls = data.get("imageUrls") if isinstance(data.get("imageUrls"), list) else []
        image_url = data.get("imageUrl") or (image_urls[0] if image_urls else None)
        ingredients = data.get("ingredients") if isinstance(data.get("ingredients"), list) else []
        allergens = data.get("allergens") if isinstance(data.get("allergens"), list) else []
        preparation_time_minutes = data.get("preparationTimeMinutes")
        all_menu_items = data.get("menuItems") if isinstance(data.get("menuItems"), list) else []
        free_menu_items = [item for item in all_menu_items if item.get("pricing") != "paid"]
        paid_menu_items = [item for item in all_menu_items if item.get("pricing") == "paid"]
        secondary_category_ids = data.get("secondaryCategoryIds") if isinstance(data.get("secondaryCategoryIds"), list) else []

        sale_start_dt = None
        sale_end_dt = None
        if should_create_initial_lot:
            try:
                initial_stock = int(initial_stock if initial_stock not in (None, "") else 1)
            except (TypeError, ValueError):
                return error_response("VALIDATION_ERROR", "initialStock must be an integer", status.HTTP_400_BAD_REQUEST)

            if initial_stock < 1:
                return error_response("VALIDATION_ERROR", "initialStock must be greater than 0", status.HTTP_400_BAD_REQUEST)

            try:
                now_for_defaults = datetime.utcnow()
                sale_start_dt = _parse_iso(initial_sale_starts_at) if initial_sale_starts_at else now_for_defaults
                sale_end_dt = _parse_iso(initial_sale_ends_at) if initial_sale_ends_at else now_for_defaults + timedelta(days=30)
            except (TypeError, ValueError):
                return error_response("VALIDATION_ERROR", "Invalid initial sale window", status.HTTP_400_BAD_REQUEST)

            if sale_start_dt > sale_end_dt:
                return error_response("VALIDATION_ERROR", "initialSaleStartsAt must be before initialSaleEndsAt", status.HTTP_400_BAD_REQUEST)

            if not recipe or not ingredients or not allergens:
                return error_response("LOT_SNAPSHOT_REQUIRED", "Recipe, ingredients, and allergens must be defined before creating the first lot", status.HTTP_400_BAD_REQUEST)

        sql = """
            INSERT INTO foods
                (
                    seller_id, category_id, name, card_summary, description, recipe, price,
                    image_url, ingredients_json, allergens_json, preparation_time_minutes,
                    is_active, cuisine, image_urls_json, menu_items_json, paid_addons_json, secondary_category_ids_json
                )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """
        try:
            active_lot_status = _resolve_lot_active_status()
        except DatabaseError as exc:
            logger.exception("Failed to resolve lot active status")
            return error_response("DB_ERROR", f"Veritabanı hatası: {exc}", status.HTTP_500_INTERNAL_SERVER_ERROR)

        now = datetime.utcnow()
        produced_at = now.isoformat() + "Z"
        # Clamp sale_starts_at to now if the user picked a time in the past (e.g. today's midnight in local timezone)
        if sale_start_dt is not None and sale_start_dt.replace(tzinfo=None) < now:
            sale_start_dt = now
        lot_id = None
        try:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(
                        sql,
                        [
                            request.user.id,
                            category_id,
                            name,
                            card_summary,
                            description,
                            recipe,
                            price,
                            image_url,
                            json.dumps(ingredients),
                            json.dumps(allergens),
                            preparation_time_minutes,
                            is_active,
                            cuisine,
                            json.dumps(image_urls),
                            json.dumps(free_menu_items),
                            json.dumps(paid_menu_items),
                            json.dumps(secondary_category_ids),
                        ],
                    )
                    row = cursor.fetchone()
                    food_id = str(row[0])
                    if should_create_initial_lot:
                        lot_id, lot_number = _insert_production_lot(
                            cursor,
                            seller_id=request.user.id,
                            food_id=food_id,
                            produced_at=produced_at,
                            sale_starts_at=sale_start_dt,
                            sale_ends_at=sale_end_dt,
                            quantity_produced=initial_stock,
                            quantity_available=initial_stock,
                            lifecycle_status=active_lot_status,
                            recipe_snapshot=recipe,
                            ingredients_snapshot=ingredients,
                            allergens_snapshot=allergens,
                            notes="mobile_initial_stock",
                            food_name_snapshot=name,
                            price_snapshot=price,
                            menu_items_snapshot=free_menu_items,
                            paid_addons_snapshot=paid_menu_items,
                        )
                        cursor.execute(
                            """
                                INSERT INTO lot_events (lot_id, event_type, event_payload_json, created_by, created_at)
                                VALUES (%s, 'created', %s, %s, now())
                            """,
                            [
                                lot_id,
                                json.dumps(
                                    {
                                        "quantityProduced": initial_stock,
                                        "quantityAvailable": initial_stock,
                                        "saleStartsAt": sale_start_dt.isoformat(),
                                        "saleEndsAt": sale_end_dt.isoformat(),
                                        "source": "seller_food_create",
                                    }
                                ),
                                request.user.id,
                            ],
                        )
        except DatabaseError as exc:
            logger.exception("Database error while creating food for seller %s", request.user.id)
            return error_response("DB_ERROR", f"Veritabanı hatası: {exc}", status.HTTP_500_INTERNAL_SERVER_ERROR)

        payload = {"id": food_id, "foodId": food_id}
        if lot_id:
            payload["lotId"] = lot_id
        return Response({"data": payload}, status=status.HTTP_201_CREATED)


class SellerFoodDetailView(APIView):
    """PATCH /v1/seller/foods/:food_id — Partial update of a food listing."""

    permission_classes = [IsAppRealm]

    def patch(self, request, food_id):
        data = request.data

        field_map = {
            "name": "name",
            "price": "price",
            "description": "description",
            "isActive": "is_active",
            "cardSummary": "card_summary",
            "cuisine": "cuisine",
            "recipe": "recipe",
            "categoryId": "category_id",
            "imageUrl": "image_url",
            "preparationTimeMinutes": "preparation_time_minutes",
        }

        set_clauses = []
        params = []

        for json_key, col_name in field_map.items():
            if json_key in data:
                set_clauses.append(f"{col_name} = %s")
                params.append(data[json_key])

        json_field_map = {
            "imageUrls": "image_urls_json",
            "ingredients": "ingredients_json",
            "allergens": "allergens_json",
            "secondaryCategoryIds": "secondary_category_ids_json",
        }

        for json_key, col_name in json_field_map.items():
            if json_key in data:
                set_clauses.append(f"{col_name} = %s")
                params.append(json.dumps(data[json_key]))

        if "menuItems" in data:
            all_items = data["menuItems"] if isinstance(data["menuItems"], list) else []
            free_items = [item for item in all_items if item.get("pricing") != "paid"]
            paid_items = [item for item in all_items if item.get("pricing") == "paid"]
            set_clauses.append("menu_items_json = %s")
            params.append(json.dumps(free_items))
            set_clauses.append("paid_addons_json = %s")
            params.append(json.dumps(paid_items))

        if "imageUrls" in data and "imageUrl" not in data:
            image_urls = data.get("imageUrls") if isinstance(data.get("imageUrls"), list) else []
            first_image_url = next((item for item in image_urls if isinstance(item, str) and item.strip()), None)
            set_clauses.append("image_url = %s")
            params.append(first_image_url)

        if not set_clauses:
            return error_response("VALIDATION_ERROR", "No updatable fields provided", status.HTTP_400_BAD_REQUEST)

        set_clauses.append("updated_at = now()")
        set_sql = ", ".join(set_clauses)
        params.extend([str(food_id), request.user.id])

        sql = f"""
            UPDATE foods
            SET {set_sql}
            WHERE id = %s AND seller_id = %s
            RETURNING id
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            row = cursor.fetchone()

        if row is None:
            return error_response("NOT_FOUND", "Food not found or does not belong to seller", status.HTTP_404_NOT_FOUND)

        return Response({"data": {"id": str(row[0]), "foodId": str(row[0])}})


class SellerFoodStatusView(APIView):
    """PATCH /v1/seller/foods/:food_id/status — Toggle food availability."""

    permission_classes = [IsAppRealm]

    def patch(self, request, food_id):
        is_active = request.data.get("isActive")
        if is_active is None:
            return error_response("VALIDATION_ERROR", "isActive is required", status.HTTP_400_BAD_REQUEST)

        sql = """
            UPDATE foods
            SET is_active = %s, updated_at = now()
            WHERE id = %s AND seller_id = %s
            RETURNING id
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [bool(is_active), str(food_id), request.user.id])
            row = cursor.fetchone()

        if row is None:
            return error_response("NOT_FOUND", "Food not found or does not belong to seller", status.HTTP_404_NOT_FOUND)

        return Response({"data": {"id": str(row[0]), "isActive": bool(is_active)}})


class SellerOrdersView(APIView):
    """GET /v1/seller/orders — Seller's incoming orders (most recent 100)."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        sql = """
            SELECT o.id, o.seller_id, o.status, o.total_price, o.created_at, o.updated_at, o.buyer_id,
                   u.display_name AS buyer_name, o.delivery_type,
                   o.requested_delivery_type, o.active_delivery_type, o.seller_decision_state,
                   o.delivery_address_json,
                   COALESCE(
                       ub.latitude,
                       (
                           SELECT ull.latitude
                           FROM user_login_locations ull
                           WHERE ull.user_id = o.buyer_id
                           ORDER BY ull.created_at DESC
                           LIMIT 1
                       )
                   ) AS buyer_lat,
                   COALESCE(
                       ub.longitude,
                       (
                           SELECT ull.longitude
                           FROM user_login_locations ull
                           WHERE ull.user_id = o.buyer_id
                           ORDER BY ull.created_at DESC
                           LIMIT 1
                       )
                   ) AS buyer_lng,
                   COALESCE(
                       us.latitude,
                       (
                           SELECT ull.latitude
                           FROM user_login_locations ull
                           WHERE ull.user_id = o.seller_id
                           ORDER BY ull.created_at DESC
                           LIMIT 1
                       )
                   ) AS seller_lat,
                   COALESCE(
                       us.longitude,
                       (
                           SELECT ull.longitude
                           FROM user_login_locations ull
                           WHERE ull.user_id = o.seller_id
                           ORDER BY ull.created_at DESC
                           LIMIT 1
                       )
                   ) AS seller_lng,
                   us.delivery_radius_km AS seller_delivery_radius_km,
                   (
                       SELECT f.name
                       FROM order_items oi
                       JOIN foods f ON f.id = oi.food_id
                       WHERE oi.order_id = o.id
                       ORDER BY oi.created_at
                       LIMIT 1
                   ) AS primary_food_name,
                   (
                       SELECT COUNT(*)
                       FROM order_items oi
                       WHERE oi.order_id = o.id
                   ) AS item_count
            FROM orders o
            JOIN users u ON u.id = o.buyer_id
            LEFT JOIN users ub ON ub.id = o.buyer_id
            LEFT JOIN users us ON us.id = o.seller_id
            WHERE o.seller_id = %s
            ORDER BY o.created_at DESC
            LIMIT 100
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [request.user.id])
            orders = _rows_as_dicts(cursor)

        result = []
        for order in orders:
            addr_json = order.get("delivery_address_json")
            addr = json.loads(addr_json) if isinstance(addr_json, str) else addr_json
            distance_km = _to_finite_number(addr.get("distanceKm")) if isinstance(addr, dict) else None
            duration_minutes = _to_finite_number(addr.get("durationMinutes")) if isinstance(addr, dict) else None

            if distance_km is None or duration_minutes is None:
                buyer_lat = _to_finite_number(order.get("buyer_lat"))
                buyer_lng = _to_finite_number(order.get("buyer_lng"))
                seller_lat = _to_finite_number(order.get("seller_lat"))
                seller_lng = _to_finite_number(order.get("seller_lng"))
                if None not in (buyer_lat, buyer_lng, seller_lat, seller_lng):
                    try:
                        distance_km = round(_haversine_km(buyer_lat, buyer_lng, seller_lat, seller_lng), 2)
                        duration_minutes = max(5, round(distance_km / 30 * 60 + 5))
                    except (TypeError, ValueError):
                        pass

            if distance_km is None or duration_minutes is None:
                distance_km, duration_minutes = _estimate_delivery_metrics_from_radius(order.get("seller_delivery_radius_km"))

            delivery_address = (
                {"distanceKm": distance_km, "durationMinutes": int(duration_minutes)}
                if distance_km is not None and duration_minutes is not None
                else None
            )
            result.append(
                {
                    "id": str(order["id"]),
                    "sellerId": str(order["seller_id"]) if order.get("seller_id") else None,
                    "buyerId": str(order["buyer_id"]) if order.get("buyer_id") else None,
                    "buyerName": order.get("buyer_name"),
                    "primaryFoodName": order.get("primary_food_name"),
                    "itemCount": int(order["item_count"]) if order.get("item_count") is not None else 0,
                    "status": order.get("status"),
                    "deliveryType": order.get("delivery_type"),
                    "requestedDeliveryType": order.get("requested_delivery_type"),
                    "activeDeliveryType": order.get("active_delivery_type"),
                    "sellerDecisionState": order.get("seller_decision_state"),
                    "totalPrice": float(order["total_price"]) if order.get("total_price") is not None else 0,
                    "createdAt": order["created_at"].isoformat() if order.get("created_at") else None,
                    "updatedAt": order["updated_at"].isoformat() if order.get("updated_at") else None,
                    "deliveryAddress": delivery_address,
                }
            )

        return Response({"data": result})


class SellerReviewsView(APIView):
    """GET /v1/seller/reviews — Reviews received by the seller."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        items_sql = """
            SELECT
                r.id,
                r.rating,
                r.comment,
                r.created_at,
                u.display_name AS buyer_name,
                f.name AS food_name
            FROM reviews r
            JOIN users u ON u.id = r.buyer_id
            LEFT JOIN foods f ON f.id = r.food_id
            WHERE r.seller_id = %s
            ORDER BY r.created_at DESC
            LIMIT 50
        """
        summary_sql = """
            SELECT
                COUNT(*)::int AS total_reviews,
                COALESCE(AVG(r.rating), 0)::numeric(4,2) AS average_rating
            FROM reviews r
            WHERE r.seller_id = %s
        """
        with connection.cursor() as cursor:
            cursor.execute(items_sql, [request.user.id])
            reviews = _rows_as_dicts(cursor)
            cursor.execute(summary_sql, [request.user.id])
            summary = _rows_as_dicts(cursor)[0]

        for review in reviews:
            _stringify_uuids(review, ["id"])
            review["buyerName"] = review.get("buyer_name")
            review["foodName"] = review.get("food_name")
            review["createdAt"] = review["created_at"].isoformat() if review.get("created_at") else None
            review.pop("buyer_name", None)
            review.pop("food_name", None)
            review.pop("created_at", None)

        return Response(
            {
                "data": {
                    "summary": {
                        "averageRating": float(summary.get("average_rating") or 0),
                        "totalReviews": int(summary.get("total_reviews") or 0),
                    },
                    "items": reviews,
                }
            }
        )


class SellerCategoriesView(APIView):
    """GET /v1/seller/categories — All available categories (for food creation forms)."""

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


class SellerLotListView(APIView):
    """GET /v1/seller/lots — Seller's production lots.
    POST /v1/seller/lots — Create a production lot."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        food_id = str(request.query_params.get("foodId") or "").strip()
        where_clauses = ["seller_id = %s"]
        params = [request.user.id]
        if food_id:
            where_clauses.append("food_id = %s")
            params.append(food_id)

        where_sql = " AND ".join(where_clauses)
        sql = """
            SELECT id, food_id, lot_number, quantity_produced, quantity_available,
                   status, status AS lifecycle_status, produced_at, sale_starts_at, sale_ends_at,
                   use_by, best_before, notes, created_at, updated_at
            FROM production_lots
            WHERE """ + where_sql + """
            ORDER BY created_at DESC
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            lots = _rows_as_dicts(cursor)

        uuid_fields = ["id", "food_id"]
        for lot in lots:
            _stringify_uuids(lot, uuid_fields)

        return Response({"data": lots})

    def post(self, request):
        data = request.data
        food_id = data.get("foodId")
        produced_at = data.get("producedAt")
        sale_starts_at = data.get("saleStartsAt")
        sale_ends_at = data.get("saleEndsAt")
        quantity_produced = data.get("quantityProduced")
        quantity_available = data.get("quantityAvailable", quantity_produced)
        use_by = data.get("useBy")
        best_before = data.get("bestBefore")
        notes = data.get("notes")
        recipe_snapshot_override = data.get("recipeSnapshot")
        ingredients_snapshot_override = data.get("ingredientsSnapshot")
        allergens_snapshot_override = data.get("allergensSnapshot")
        has_all_snapshot_overrides = (
            recipe_snapshot_override is not None
            and ingredients_snapshot_override is not None
            and allergens_snapshot_override is not None
        )

        missing = [
            field_name
            for field_name, value in (
                ("foodId", food_id),
                ("producedAt", produced_at),
                ("saleStartsAt", sale_starts_at),
                ("saleEndsAt", sale_ends_at),
                ("quantityProduced", quantity_produced),
            )
            if value in (None, "")
        ]
        if missing:
            return error_response("VALIDATION_ERROR", f"Missing required fields: {', '.join(missing)}", status.HTTP_400_BAD_REQUEST)

        try:
            quantity_produced = int(quantity_produced)
            quantity_available = int(quantity_available)
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "quantityProduced and quantityAvailable must be integers", status.HTTP_400_BAD_REQUEST)

        if quantity_produced < 1 or quantity_available < 0 or quantity_available > quantity_produced:
            return error_response("LOT_INVALID_QUANTITY", "Available cannot exceed produced", status.HTTP_400_BAD_REQUEST)

        def _parse_iso(value):
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))

        try:
            produced_dt = _parse_iso(produced_at)
            sale_start_dt = _parse_iso(sale_starts_at)
            sale_end_dt = _parse_iso(sale_ends_at)
            use_by_dt = _parse_iso(use_by) if use_by else None
            best_before_dt = _parse_iso(best_before) if best_before else None
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid ISO datetime payload", status.HTTP_400_BAD_REQUEST)

        if produced_dt > sale_start_dt or sale_start_dt > sale_end_dt:
            return error_response("LOT_INVALID_TIMELINE", "producedAt must be before saleStartsAt and saleStartsAt before saleEndsAt", status.HTTP_400_BAD_REQUEST)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, recipe, ingredients_json, allergens_json
                           , name, price, menu_items_json, paid_addons_json
                    FROM foods
                    WHERE id = %s AND seller_id = %s
                """,
                [str(food_id), request.user.id],
            )
            food = _row_as_dict(cursor)

        if food is None:
            return error_response("FOOD_NOT_FOUND", "Food not found in seller scope", status.HTTP_404_NOT_FOUND)

        if not has_all_snapshot_overrides:
            missing_fields = []
            if not food.get("recipe"):
                missing_fields.append("recipe")
            if food.get("ingredients_json") is None:
                missing_fields.append("ingredients_json")
            if food.get("allergens_json") is None:
                missing_fields.append("allergens_json")
            if missing_fields:
                return Response(
                    {
                        "error": {
                            "code": "LOT_SNAPSHOT_REQUIRED",
                            "message": "Recipe, ingredients, and allergens must be defined on food before creating a lot",
                            "details": {"missingFields": missing_fields},
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        final_recipe = recipe_snapshot_override if has_all_snapshot_overrides else food.get("recipe")
        final_ingredients = ingredients_snapshot_override if has_all_snapshot_overrides else food.get("ingredients_json")
        final_allergens = allergens_snapshot_override if has_all_snapshot_overrides else food.get("allergens_json")

        active_lot_status = _resolve_lot_active_status()
        with connection.cursor() as cursor:
            lot_id, lot_number = _insert_production_lot(
                cursor,
                seller_id=request.user.id,
                food_id=food_id,
                produced_at=produced_at,
                sale_starts_at=sale_starts_at,
                sale_ends_at=sale_ends_at,
                quantity_produced=quantity_produced,
                quantity_available=quantity_available,
                lifecycle_status=active_lot_status,
                recipe_snapshot=final_recipe,
                ingredients_snapshot=final_ingredients,
                allergens_snapshot=final_allergens,
                notes=notes,
                use_by=use_by_dt,
                best_before=best_before_dt,
                food_name_snapshot=food.get("name"),
                price_snapshot=food.get("price"),
                menu_items_snapshot=food.get("menu_items_json"),
                paid_addons_snapshot=food.get("paid_addons_json"),
            )
            cursor.execute(
                """
                    INSERT INTO lot_events (lot_id, event_type, event_payload_json, created_by, created_at)
                    VALUES (%s, 'created', %s, %s, now())
                """,
                [
                    lot_id,
                    json.dumps(
                        {
                            "quantityProduced": quantity_produced,
                            "quantityAvailable": quantity_available,
                            "producedAt": produced_at,
                            "saleStartsAt": sale_starts_at,
                            "saleEndsAt": sale_ends_at,
                        }
                    ),
                    request.user.id,
                ],
            )

        return Response({"data": {"lotId": lot_id, "lotNumber": lot_number}}, status=status.HTTP_201_CREATED)


class SellerLotDetailView(APIView):
    """PATCH /v1/seller/lots/:lot_id — Update an existing production lot."""

    permission_classes = [IsAppRealm]

    def patch(self, request, lot_id):
        data = request.data
        sale_starts_at = data.get("saleStartsAt")
        sale_ends_at = data.get("saleEndsAt")
        quantity_available = data.get("quantityAvailable")

        if sale_starts_at in (None, "") and sale_ends_at in (None, "") and quantity_available in (None, ""):
            return error_response("VALIDATION_ERROR", "saleStartsAt, saleEndsAt, or quantityAvailable is required", status.HTTP_400_BAD_REQUEST)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, food_id, produced_at, sale_starts_at, sale_ends_at,
                           quantity_produced, quantity_available
                    FROM production_lots
                    WHERE id = %s AND seller_id = %s
                """,
                [str(lot_id), request.user.id],
            )
            current_lot = _row_as_dict(cursor)

        if current_lot is None:
            return error_response("NOT_FOUND", "Lot not found or does not belong to seller", status.HTTP_404_NOT_FOUND)

        try:
            next_quantity_available = (
                int(quantity_available)
                if quantity_available not in (None, "")
                else int(current_lot["quantity_available"])
            )
            current_quantity_produced = int(current_lot["quantity_produced"])
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "quantityAvailable must be an integer", status.HTTP_400_BAD_REQUEST)

        if next_quantity_available < 0:
            return error_response("LOT_INVALID_QUANTITY", "quantityAvailable cannot be negative", status.HTTP_400_BAD_REQUEST)

        next_quantity_produced = max(current_quantity_produced, next_quantity_available)

        try:
            produced_dt = _parse_iso(current_lot["produced_at"])
            sale_start_dt = _parse_iso(sale_starts_at) if sale_starts_at not in (None, "") else _parse_iso(current_lot["sale_starts_at"])
            sale_end_dt = _parse_iso(sale_ends_at) if sale_ends_at not in (None, "") else _parse_iso(current_lot["sale_ends_at"])
        except (TypeError, ValueError):
            return error_response("VALIDATION_ERROR", "Invalid ISO datetime payload", status.HTTP_400_BAD_REQUEST)

        if produced_dt > sale_start_dt or sale_start_dt > sale_end_dt:
            return error_response("LOT_INVALID_TIMELINE", "producedAt must be before saleStartsAt and saleStartsAt before saleEndsAt", status.HTTP_400_BAD_REQUEST)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                    UPDATE production_lots
                    SET sale_starts_at = %s,
                        sale_ends_at = %s,
                        quantity_produced = %s,
                        quantity_available = %s,
                        updated_at = now()
                    WHERE id = %s AND seller_id = %s
                    RETURNING id, food_id, produced_at, sale_starts_at, sale_ends_at,
                              quantity_produced, quantity_available
                """,
                [
                    sale_start_dt.isoformat(),
                    sale_end_dt.isoformat(),
                    next_quantity_produced,
                    next_quantity_available,
                    str(lot_id),
                    request.user.id,
                ],
            )
            updated_lot = _row_as_dict(cursor)

        _stringify_uuids(updated_lot, ["id", "food_id"])
        return Response({"data": updated_lot})


class SellerLotAdjustView(APIView):
    """POST /v1/seller/lots/:lot_id/adjust — Adjust remaining quantity of a production lot."""

    permission_classes = [IsAppRealm]

    def post(self, request, lot_id):
        delta = request.data.get("delta")
        reason = request.data.get("reason", "")
        active_lot_status = _resolve_lot_active_status()

        if delta is None:
            return error_response("VALIDATION_ERROR", "delta is required", status.HTTP_400_BAD_REQUEST)

        try:
            delta = int(delta)
        except (ValueError, TypeError):
            return error_response("VALIDATION_ERROR", "delta must be an integer", status.HTTP_400_BAD_REQUEST)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, quantity_available, quantity_produced, status
                    FROM production_lots
                    WHERE id = %s AND seller_id = %s
                """,
                [str(lot_id), request.user.id],
            )
            current = _row_as_dict(cursor)

        if current is None:
            return error_response("NOT_FOUND", "Lot not found or does not belong to seller", status.HTTP_404_NOT_FOUND)

        next_quantity = int(current.get("quantity_available") or 0) + delta
        quantity_produced = int(current.get("quantity_produced") or 0)
        if next_quantity < 0 or next_quantity > quantity_produced:
            return error_response("LOT_INVALID_QUANTITY", "Available cannot be negative or exceed produced", status.HTTP_400_BAD_REQUEST)

        sql = """
            UPDATE production_lots
            SET quantity_available = %s,
                status = CASE
                    WHEN %s = 0 THEN 'depleted'
                    WHEN status IN ('depleted', 'expired', 'passive') AND %s > 0 THEN %s
                    ELSE status
                END,
                updated_at = now()
            WHERE id = %s AND seller_id = %s
            RETURNING id, quantity_available
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [next_quantity, next_quantity, next_quantity, active_lot_status, str(lot_id), request.user.id])
            row = cursor.fetchone()

        event_payload = {"delta": delta, "reason": reason, "quantityAvailable": row[1]}
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    INSERT INTO lot_events (lot_id, event_type, event_payload_json, created_by, created_at)
                    VALUES (%s, 'adjusted', %s, %s, now())
                """,
                [str(lot_id), json.dumps(event_payload), request.user.id],
            )

        return Response({"data": {"id": str(row[0]), "quantityRemaining": row[1]}})


class SellerLotRecallView(APIView):
    """POST /v1/seller/lots/:lot_id/recall — Recall a production lot."""

    permission_classes = [IsAppRealm]

    def post(self, request, lot_id):
        reason = request.data.get("reason", "")

        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, status
                    FROM production_lots
                    WHERE id = %s AND seller_id = %s
                """,
                [str(lot_id), request.user.id],
            )
            lot = _row_as_dict(cursor)

        if lot is None:
            return error_response("LOT_NOT_FOUND", "Lot not found in seller scope", status.HTTP_404_NOT_FOUND)

        if lot.get("status") == "recalled":
            return error_response("LOT_ALREADY_RECALLED", "Lot is already recalled", status.HTTP_400_BAD_REQUEST)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                    UPDATE production_lots
                    SET status = 'recalled', updated_at = now()
                    WHERE id = %s AND seller_id = %s
                """,
                [str(lot_id), request.user.id],
            )
            cursor.execute(
                """
                    INSERT INTO lot_events (lot_id, event_type, event_payload_json, created_by, created_at)
                    VALUES (%s, 'recalled', %s, %s, now())
                """,
                [str(lot_id), json.dumps({"reason": reason}), request.user.id],
            )

        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, food_id, lot_number, quantity_produced, quantity_available,
                           status AS lifecycle_status, produced_at, sale_starts_at, sale_ends_at,
                           use_by, best_before, notes, created_at, updated_at
                    FROM production_lots
                    WHERE id = %s
                """,
                [str(lot_id)],
            )
            updated_lot = _row_as_dict(cursor)

        _stringify_uuids(updated_lot, ["id", "food_id"])
        return Response({"data": updated_lot})


class SellerIngredientTemplatesView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, name_en
                FROM ingredient_templates
                WHERE is_active = true
                ORDER BY sort_order, name
                """
            )
            rows = _rows_as_dicts(cursor)

        data = [
            {"id": str(row["id"]), "name": row["name"], "nameEn": row["name_en"] or row["name"]}
            for row in rows
        ]
        return Response({"data": data})


class SellerAddonTemplatesView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, kind, pricing, default_price, sort_order
                FROM addon_templates
                WHERE is_active = true
                ORDER BY sort_order, name
                """
            )
            rows = _rows_as_dicts(cursor)

        data = []
        for row in rows:
            item = {
                "id": str(row["id"]),
                "name": row["name"],
                "kind": row["kind"],
                "pricing": row["pricing"],
            }
            if row["default_price"] is not None:
                item["defaultPrice"] = float(row["default_price"])
            data.append(item)

        return Response({"data": data})
