from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated


# ── Permissions ───────────────────────────────────────────────────────────────

class IsAppRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "app"


class IsAdminRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "admin"


# ── Seller Finance Summary ────────────────────────────────────────────────────

class SellerFinanceSummaryView(APIView):
    permission_classes = [IsAppRealm]

    def get(self, request, seller_id):
        user_id = str(request.user.id)

        if user_id != str(seller_id):
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "You can only view your own finance summary"}},
                status=403,
            )

        from django.db import ProgrammingError
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END), 0) AS total_earned,
                        COALESCE(SUM(CASE WHEN entry_type = 'debit'  THEN amount ELSE 0 END), 0) AS total_paid_out,
                        COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END), 0) AS current_balance
                    FROM seller_ledger_entries
                    WHERE seller_id = %s
                    """,
                    [seller_id],
                )
                row = cur.fetchone()
        except ProgrammingError:
            row = None

        total_earned, total_paid_out, current_balance = row if row else (0, 0, 0)

        return Response({"data": {
            "totalEarned": str(total_earned),
            "totalPaidOut": str(total_paid_out),
            "currentBalance": str(current_balance),
        }})


# ── Admin: Commission Settings ────────────────────────────────────────────────

class CommissionSettingsLatestView(APIView):
    permission_classes = [IsAdminRealm]

    def get(self, request):
        with connection.cursor() as cur:
            cur.execute(
                "SELECT id, commission_rate_percent, created_at FROM admin_sales_commission_settings ORDER BY created_at DESC LIMIT 1",
            )
            row = cur.fetchone()

        if not row:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "No commission settings found"}},
                status=404,
            )

        setting_id, rate_percent, created_at = row
        return Response({"data": {
            "id": str(setting_id),
            "ratePercent": str(rate_percent),
            "createdAt": created_at.isoformat() if created_at else None,
        }})


class CommissionSettingsCreateView(APIView):
    permission_classes = [IsAdminRealm]

    def post(self, request):
        rate_percent = request.data.get("ratePercent")
        if rate_percent is None:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "ratePercent is required"}},
                status=400,
            )

        admin_id = request.user.id

        with connection.cursor() as cur:
            cur.execute(
                "INSERT INTO admin_sales_commission_settings (commission_rate_percent, created_by_admin_id) VALUES (%s, %s) RETURNING id",
                [rate_percent, admin_id],
            )
            new_id = str(cur.fetchone()[0])

        return Response({"data": {"id": new_id}}, status=201)
