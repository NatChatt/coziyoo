"""
Seller management views — all endpoints require realm == 'app'.
The caller must also be a seller (user_type in ('seller', 'both')),
but role enforcement is left to the JWT payload (role == 'seller').
"""
import json
import logging
import math
import uuid
from datetime import datetime

from django.db import DatabaseError, connection, transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status

logger = logging.getLogger(__name__)

_LOT_ACTIVE_STATUS_CACHE = None


class IsAppRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "app"


def _rows_as_dicts(cursor):
    """Convert cursor results to list of dicts using cursor.description."""
    cols = [col.name for col in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _row_as_dict(cursor):
    """Return first row as dict, or None if no rows."""
    cols = [col.name for col in cursor.description]
    row = cursor.fetchone()
    return dict(zip(cols, row)) if row else None


def _stringify_uuids(obj, fields):
    """Convert UUID fields to strings in-place."""
    for f in fields:
        if obj.get(f) is not None:
            obj[f] = str(obj[f])
    return obj


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


def _to_finite_number(value):
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if math.isfinite(num) else None


def _haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km between two (lat, lon) pairs."""
    radius_km = 6371.0
    phi1 = math.radians(float(lat1))
    phi2 = math.radians(float(lat2))
    dphi = math.radians(float(lat2) - float(lat1))
    dlambda = math.radians(float(lon2) - float(lon1))
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius_km * math.asin(math.sqrt(a))


def _estimate_delivery_metrics_from_radius(radius_km):
    """Return (distance_km, duration_minutes) estimate when precise coordinates are unavailable."""
    radius = _to_finite_number(radius_km)
    if radius is None or radius <= 0:
        radius = 5.0
    distance_km = round(max(0.5, min(radius, radius * 0.6)), 2)
    duration_minutes = int(max(5, round(distance_km / 30 * 60 + 5)))
    return distance_km, duration_minutes


class SellerProfileView(APIView):
    """GET /v1/seller/profile — Fetch own seller profile.
    PUT /v1/seller/profile — Update seller profile fields."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        sql = """
            SELECT id, email, display_name, kitchen_title, kitchen_description,
                   kitchen_specialties, delivery_enabled, delivery_radius_km,
                   delivery_terms, working_hours_json,
                   profile_image_url
            FROM users
            WHERE id = %s
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [request.user.id])
            profile = _row_as_dict(cursor)

        if profile is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "User not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        _stringify_uuids(profile, ["id"])
        return Response({"data": profile})

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
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "User not found"}},
                status=status.HTTP_404_NOT_FOUND,
            )

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
        should_create_initial_lot = (
            initial_stock not in (None, "")
            or initial_sale_starts_at not in (None, "")
            or initial_sale_ends_at not in (None, "")
        )

        if not name or price is None:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "name and price are required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
                initial_stock = int(initial_stock)
            except (TypeError, ValueError):
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "initialStock must be an integer"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if initial_stock < 1:
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "initialStock must be greater than 0"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not initial_sale_starts_at or not initial_sale_ends_at:
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "initialSaleStartsAt and initialSaleEndsAt are required"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                sale_start_dt = _parse_iso(initial_sale_starts_at)
                sale_end_dt = _parse_iso(initial_sale_ends_at)
            except (TypeError, ValueError):
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "Invalid initial sale window"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if sale_start_dt > sale_end_dt:
                return Response(
                    {"error": {"code": "VALIDATION_ERROR", "message": "initialSaleStartsAt must be before initialSaleEndsAt"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not recipe or not ingredients or not allergens:
                return Response(
                    {
                        "error": {
                            "code": "LOT_SNAPSHOT_REQUIRED",
                            "message": "Recipe, ingredients, and allergens must be defined before creating the first lot",
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

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
            return Response(
                {"error": {"code": "DB_ERROR", "message": f"Veritabanı hatası: {exc}"}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

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
                        lot_id = str(uuid.uuid4())
                        lot_number = f"CZ-{food_id[:8].upper()}-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
                        cursor.execute(
                            """
                                INSERT INTO production_lots
                                    (
                                        id, seller_id, food_id, lot_number, produced_at, sale_starts_at, sale_ends_at,
                                        use_by, best_before, recipe_snapshot, ingredients_snapshot_json, allergens_snapshot_json,
                                        quantity_produced, quantity_available, status, notes, created_at, updated_at
                                    )
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), now())
                            """,
                            [
                                lot_id,
                                request.user.id,
                                food_id,
                                lot_number,
                                produced_at,
                                sale_start_dt.isoformat(),
                                sale_end_dt.isoformat(),
                                None,
                                None,
                                recipe,
                                json.dumps(ingredients),
                                json.dumps(allergens),
                                initial_stock,
                                initial_stock,
                                active_lot_status,
                                "mobile_initial_stock",
                            ],
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
            return Response(
                {"error": {"code": "DB_ERROR", "message": f"Veritabanı hatası: {exc}"}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

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
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "No updatable fields provided"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Food not found or does not belong to seller"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({"data": {"id": str(row[0]), "foodId": str(row[0])}})


class SellerFoodStatusView(APIView):
    """PATCH /v1/seller/foods/:food_id/status — Toggle food availability."""

    permission_classes = [IsAppRealm]

    def patch(self, request, food_id):
        is_active = request.data.get("isActive")
        if is_active is None:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "isActive is required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Food not found or does not belong to seller"}},
                status=status.HTTP_404_NOT_FOUND,
            )

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
        sql = """
            SELECT r.id, r.rating, r.comment, r.created_at, u.display_name AS buyer_name
            FROM reviews r
            JOIN users u ON u.id = r.buyer_id
            WHERE r.seller_id = %s
            ORDER BY r.created_at DESC
            LIMIT 50
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [request.user.id])
            reviews = _rows_as_dicts(cursor)

        for review in reviews:
            _stringify_uuids(review, ["id"])

        return Response({"data": reviews})


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
                   status AS lifecycle_status, produced_at, sale_starts_at, sale_ends_at,
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
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": f"Missing required fields: {', '.join(missing)}"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            quantity_produced = int(quantity_produced)
            quantity_available = int(quantity_available)
        except (TypeError, ValueError):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "quantityProduced and quantityAvailable must be integers"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if quantity_produced < 1 or quantity_available < 0 or quantity_available > quantity_produced:
            return Response(
                {"error": {"code": "LOT_INVALID_QUANTITY", "message": "Available cannot exceed produced"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        def _parse_iso(value):
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))

        try:
            produced_dt = _parse_iso(produced_at)
            sale_start_dt = _parse_iso(sale_starts_at)
            sale_end_dt = _parse_iso(sale_ends_at)
            use_by_dt = _parse_iso(use_by) if use_by else None
            best_before_dt = _parse_iso(best_before) if best_before else None
        except (TypeError, ValueError):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "Invalid ISO datetime payload"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if produced_dt > sale_start_dt or sale_start_dt > sale_end_dt:
            return Response(
                {"error": {"code": "LOT_INVALID_TIMELINE", "message": "producedAt must be before saleStartsAt and saleStartsAt before saleEndsAt"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with connection.cursor() as cursor:
            cursor.execute(
                """
                    SELECT id, recipe, ingredients_json, allergens_json
                    FROM foods
                    WHERE id = %s AND seller_id = %s
                """,
                [str(food_id), request.user.id],
            )
            food = _row_as_dict(cursor)

        if food is None:
            return Response(
                {"error": {"code": "FOOD_NOT_FOUND", "message": "Food not found in seller scope"}},
                status=status.HTTP_404_NOT_FOUND,
            )

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
        lot_id = str(uuid.uuid4())
        lot_number = f"CZ-{str(food_id)[:8].upper()}-{produced_dt.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
        with connection.cursor() as cursor:
            cursor.execute(
                """
                    INSERT INTO production_lots
                        (
                            id, seller_id, food_id, lot_number, produced_at, sale_starts_at, sale_ends_at,
                            use_by, best_before, recipe_snapshot, ingredients_snapshot_json, allergens_snapshot_json,
                            quantity_produced, quantity_available, status, notes, created_at, updated_at
                        )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), now())
                """,
                [
                    lot_id,
                    request.user.id,
                    str(food_id),
                    lot_number,
                    produced_at,
                    sale_starts_at,
                    sale_ends_at,
                    use_by_dt.isoformat() if use_by_dt else None,
                    best_before_dt.isoformat() if best_before_dt else None,
                    final_recipe,
                    json.dumps(final_ingredients),
                    json.dumps(final_allergens),
                    quantity_produced,
                    quantity_available,
                    active_lot_status,
                    notes,
                ],
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
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "saleStartsAt, saleEndsAt, or quantityAvailable is required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Lot not found or does not belong to seller"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            next_quantity_available = (
                int(quantity_available)
                if quantity_available not in (None, "")
                else int(current_lot["quantity_available"])
            )
            current_quantity_produced = int(current_lot["quantity_produced"])
        except (TypeError, ValueError):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "quantityAvailable must be an integer"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if next_quantity_available < 0:
            return Response(
                {"error": {"code": "LOT_INVALID_QUANTITY", "message": "quantityAvailable cannot be negative"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        next_quantity_produced = max(current_quantity_produced, next_quantity_available)

        try:
            produced_dt = _parse_iso(current_lot["produced_at"])
            sale_start_dt = _parse_iso(sale_starts_at) if sale_starts_at not in (None, "") else _parse_iso(current_lot["sale_starts_at"])
            sale_end_dt = _parse_iso(sale_ends_at) if sale_ends_at not in (None, "") else _parse_iso(current_lot["sale_ends_at"])
        except (TypeError, ValueError):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "Invalid ISO datetime payload"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if produced_dt > sale_start_dt or sale_start_dt > sale_end_dt:
            return Response(
                {"error": {"code": "LOT_INVALID_TIMELINE", "message": "producedAt must be before saleStartsAt and saleStartsAt before saleEndsAt"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "delta is required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            delta = int(delta)
        except (ValueError, TypeError):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "delta must be an integer"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Lot not found or does not belong to seller"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        next_quantity = int(current.get("quantity_available") or 0) + delta
        quantity_produced = int(current.get("quantity_produced") or 0)
        if next_quantity < 0 or next_quantity > quantity_produced:
            return Response(
                {"error": {"code": "LOT_INVALID_QUANTITY", "message": "Available cannot be negative or exceed produced"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
            return Response(
                {"error": {"code": "LOT_NOT_FOUND", "message": "Lot not found in seller scope"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        if lot.get("status") == "recalled":
            return Response(
                {"error": {"code": "LOT_ALREADY_RECALLED", "message": "Lot is already recalled"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
