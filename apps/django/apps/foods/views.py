"""
Public food browsing views for the app realm.
All endpoints require a valid JWT with realm == 'app'.
"""
from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated


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


class FoodListView(APIView):
    """GET /v1/foods/ — List active foods with optional filters."""

    permission_classes = [IsAppRealm]

    def get(self, request):
        search = request.query_params.get("search", "").strip()
        category_id = request.query_params.get("categoryId")
        seller_id = request.query_params.get("sellerId")

        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except (ValueError, TypeError):
            page = 1

        try:
            page_size = max(1, min(100, int(request.query_params.get("pageSize", 20))))
        except (ValueError, TypeError):
            page_size = 20

        offset = (page - 1) * page_size

        where_clauses = ["f.is_active = TRUE"]
        params = []

        if category_id:
            where_clauses.append("f.category_id = %s")
            params.append(category_id)

        if seller_id:
            where_clauses.append("f.seller_id = %s")
            params.append(seller_id)

        if search:
            where_clauses.append("(f.name ILIKE %s OR f.card_summary ILIKE %s)")
            like = f"%{search}%"
            params.extend([like, like])

        where_sql = " AND ".join(where_clauses)

        count_sql = f"""
            SELECT COUNT(*) FROM foods f
            JOIN users u ON u.id = f.seller_id
            WHERE {where_sql}
        """

        data_sql = f"""
            SELECT f.id, f.name, f.card_summary, f.price, f.image_url, f.image_urls_json,
                   f.cuisine, f.allergens_json, f.is_active, f.rating, f.review_count,
                   f.seller_id, u.display_name AS seller_name
            FROM foods f
            JOIN users u ON u.id = f.seller_id
            WHERE {where_sql}
            ORDER BY f.created_at DESC
            LIMIT %s OFFSET %s
        """

        with connection.cursor() as cursor:
            cursor.execute(count_sql, params)
            total = cursor.fetchone()[0]

            cursor.execute(data_sql, params + [page_size, offset])
            items = _rows_as_dicts(cursor)

        uuid_fields = ["id", "seller_id"]
        for item in items:
            _stringify_uuids(item, uuid_fields)

        return Response({"data": {"items": items, "total": total, "page": page, "pageSize": page_size}})


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
        sql = """
            SELECT f.id, f.name, f.card_summary, f.price, f.image_url, f.image_urls_json,
                   f.cuisine, f.allergens_json, f.is_active, f.rating, f.review_count,
                   f.seller_id, u.display_name AS seller_name
            FROM foods f
            JOIN users u ON u.id = f.seller_id
            WHERE f.seller_id = %s AND f.is_active = TRUE
            ORDER BY f.created_at DESC
        """
        with connection.cursor() as cursor:
            cursor.execute(sql, [str(seller_id)])
            items = _rows_as_dicts(cursor)

        uuid_fields = ["id", "seller_id"]
        for item in items:
            _stringify_uuids(item, uuid_fields)

        return Response({"data": items})


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
