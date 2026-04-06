"""
Seller management views — all endpoints require realm == 'app'.
The caller must also be a seller (user_type in ('seller', 'both')),
but role enforcement is left to the JWT payload (role == 'seller').
"""
from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status


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
        delivery_enabled = data.get("deliveryEnabled")
        delivery_radius_km = data.get("deliveryRadiusKm")

        sql = """
            UPDATE users
            SET kitchen_title = %s,
                kitchen_description = %s,
                delivery_enabled = %s,
                delivery_radius_km = %s,
                updated_at = now()
            WHERE id = %s
            RETURNING id
        """
        with connection.cursor() as cursor:
            cursor.execute(
                sql,
                [kitchen_title, kitchen_description, delivery_enabled, delivery_radius_km, request.user.id],
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
        sql = """
            SELECT id, name, card_summary, description, price, is_active, image_url,
                   image_urls_json, cuisine, allergens_json, category_id, created_at, updated_at
            FROM foods
            WHERE seller_id = %s
            ORDER BY created_at DESC
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [request.user.id])
            foods = _rows_as_dicts(cursor)

        uuid_fields = ["id", "category_id"]
        for food in foods:
            _stringify_uuids(food, uuid_fields)

        return Response({"data": foods})

    def post(self, request):
        data = request.data
        name = data.get("name")
        price = data.get("price")

        if not name or price is None:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "name and price are required"}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        description = data.get("description")
        card_summary = data.get("cardSummary")
        cuisine = data.get("cuisine")
        is_active = data.get("isActive", True)
        category_id = data.get("categoryId") or None

        sql = """
            INSERT INTO foods
                (seller_id, name, price, description, card_summary, cuisine, is_active, category_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """
        with connection.cursor() as cursor:
            cursor.execute(
                sql,
                [request.user.id, name, price, description, card_summary, cuisine, is_active, category_id],
            )
            row = cursor.fetchone()

        return Response({"data": {"id": str(row[0])}}, status=status.HTTP_201_CREATED)


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
        }

        set_clauses = []
        params = []

        for json_key, col_name in field_map.items():
            if json_key in data:
                set_clauses.append(f"{col_name} = %s")
                params.append(data[json_key])

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

        return Response({"data": {"id": str(row[0])}})


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
            SELECT o.id, o.status, o.total_price, o.created_at, o.buyer_id,
                   u.display_name AS buyer_name, o.delivery_type
            FROM orders o
            JOIN users u ON u.id = o.buyer_id
            WHERE o.seller_id = %s
            ORDER BY o.created_at DESC
            LIMIT 100
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [request.user.id])
            orders = _rows_as_dicts(cursor)

        uuid_fields = ["id", "buyer_id"]
        for order in orders:
            _stringify_uuids(order, uuid_fields)

        return Response({"data": orders})


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
    """GET /v1/seller/lots — Seller's production lots."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        sql = """
            SELECT id, food_id, quantity_produced, quantity_available,
                   status, produced_at, use_by, created_at
            FROM production_lots
            WHERE seller_id = %s
            ORDER BY created_at DESC
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [request.user.id])
            lots = _rows_as_dicts(cursor)

        uuid_fields = ["id", "food_id"]
        for lot in lots:
            _stringify_uuids(lot, uuid_fields)

        return Response({"data": lots})


class SellerLotAdjustView(APIView):
    """POST /v1/seller/lots/:lot_id/adjust — Adjust remaining quantity of a production lot."""

    permission_classes = [IsAppRealm]

    def post(self, request, lot_id):
        delta = request.data.get("delta")
        reason = request.data.get("reason", "")

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

        sql = """
            UPDATE production_lots
            SET quantity_available = quantity_available + %s,
                updated_at = now()
            WHERE id = %s AND seller_id = %s
            RETURNING id, quantity_remaining
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [delta, str(lot_id), request.user.id])
            row = cursor.fetchone()

        if row is None:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Lot not found or does not belong to seller"}},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response({"data": {"id": str(row[0]), "quantityRemaining": row[1]}})
