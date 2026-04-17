from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated


# ── Permissions ───────────────────────────────────────────────────────────────

class IsAppRealm(IsAuthenticated):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and getattr(request.user, "realm", None) == "app"


# ── Seller Finance Summary ────────────────────────────────────────────────────

class SellerFinanceBaseView(APIView):
    permission_classes = [IsAppRealm]

    def _check_seller_access(self, request, seller_id):
        user_id = str(request.user.id)
        if user_id != str(seller_id):
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "You can only view your own finance summary"}},
                status=403,
            )
        return None


class SellerFinanceSummaryView(SellerFinanceBaseView):
    def get(self, request, seller_id):
        forbidden = self._check_seller_access(request, seller_id)
        if forbidden is not None:
            return forbidden

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

        if row:
            total_earned, total_paid_out, current_balance = row
        else:
            total_earned = total_paid_out = current_balance = 0

        # Fallback for environments where ledger rows are not yet written.
        # Mobile wallet should still reflect finalized seller earnings in order_finance.
        if (total_earned or 0) == 0 and (total_paid_out or 0) == 0 and (current_balance or 0) == 0:
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        """
                        SELECT
                            COALESCE(SUM(gross_amount), 0) AS total_selling_amount,
                            COALESCE(SUM(commission_amount), 0) AS total_commission,
                            COALESCE(SUM(seller_net_amount), 0) AS total_net_earnings
                        FROM order_finance
                        WHERE seller_id = %s
                        """,
                        [seller_id],
                    )
                    finance_row = cur.fetchone() or (0, 0, 0)

                    cur.execute(
                        """
                        SELECT COALESCE(SUM(amount), 0)
                        FROM finance_adjustments
                        WHERE seller_id = %s
                        """,
                        [seller_id],
                    )
                    adjustment_total = (cur.fetchone() or (0,))[0] or 0

                total_selling_amount, total_commission, total_net_earnings = finance_row
                total_earned = total_selling_amount
                total_paid_out = total_commission
                current_balance = total_net_earnings + adjustment_total
            except ProgrammingError:
                total_earned = total_earned or 0
                total_paid_out = total_paid_out or 0
                current_balance = current_balance or 0

        return Response({"data": {
            "totalEarned": str(total_earned),
            "totalPaidOut": str(total_paid_out),
            "currentBalance": str(current_balance),
            "totalSellingAmount": str(total_earned),
            "totalCommission": str(total_paid_out),
            "totalNetEarnings": str(current_balance),
        }})


class SellerFinanceBalanceView(SellerFinanceBaseView):
    def get(self, request, seller_id):
        forbidden = self._check_seller_access(request, seller_id)
        if forbidden is not None:
            return forbidden

        from django.db import ProgrammingError
        available_balance = 0
        pending_payout_amount = 0

        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        COALESCE(SUM(seller_net_amount), 0) AS net_total
                    FROM order_finance
                    WHERE seller_id = %s
                    """,
                    [seller_id],
                )
                net_total = (cur.fetchone() or (0,))[0] or 0

                cur.execute(
                    """
                    SELECT COALESCE(SUM(amount), 0)
                    FROM finance_adjustments
                    WHERE seller_id = %s
                    """,
                    [seller_id],
                )
                adjustment_total = (cur.fetchone() or (0,))[0] or 0

                available_balance = net_total + adjustment_total
        except ProgrammingError:
            available_balance = 0
            pending_payout_amount = 0

        return Response({"data": {
            "availableBalance": str(available_balance),
            "pendingPayoutAmount": str(pending_payout_amount),
            "currency": "TRY",
        }})


class SellerFinancePayoutsView(SellerFinanceBaseView):
    def get(self, request, seller_id):
        forbidden = self._check_seller_access(request, seller_id)
        if forbidden is not None:
            return forbidden

        try:
            page = max(int(request.GET.get("page", 1) or 1), 1)
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.GET.get("pageSize", 20) or 20)
        except (TypeError, ValueError):
            page_size = 20
        page_size = min(max(page_size, 1), 100)
        offset = (page - 1) * page_size

        from django.db import ProgrammingError
        rows = []
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        order_id::text,
                        seller_net_amount,
                        finalized_at
                    FROM order_finance
                    WHERE seller_id = %s
                    ORDER BY finalized_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    [seller_id, page_size, offset],
                )
                rows = cur.fetchall() or []
        except ProgrammingError:
            rows = []

        data = [
            {
                "batchId": row[0],
                "status": "completed",
                "totalAmount": str(row[1] or 0),
                "payoutDate": row[2].isoformat() if row[2] else None,
            }
            for row in rows
        ]
        return Response({"data": data})
