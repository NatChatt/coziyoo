from django.db import connection
from rest_framework.views import APIView
from rest_framework.response import Response

from apps.common.permissions import IsAppRealm
from apps.common.responses import error_response


# ── Seller Finance Summary ────────────────────────────────────────────────────

class SellerFinanceBaseView(APIView):
    permission_classes = [IsAppRealm]

    def _check_seller_access(self, request, seller_id):
        user_id = str(request.user.id)
        if user_id != str(seller_id):
            return error_response("FORBIDDEN", "You can only view your own finance summary", 403)
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

        # Final fallback: keep mobile aligned with admin totals that are derived
        # from paid orders when finance snapshot tables are empty.
        if (total_earned or 0) == 0 and (current_balance or 0) == 0:
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        """
                        SELECT COALESCE(SUM(total_price), 0)
                        FROM orders
                        WHERE seller_id = %s AND payment_completed = TRUE
                        """,
                        [seller_id],
                    )
                    orders_total = (cur.fetchone() or (0,))[0] or 0
                total_earned = orders_total
                total_paid_out = total_paid_out or 0
                current_balance = orders_total
            except ProgrammingError:
                pass

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

        if (available_balance or 0) == 0:
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        """
                        SELECT COALESCE(SUM(total_price), 0)
                        FROM orders
                        WHERE seller_id = %s AND payment_completed = TRUE
                        """,
                        [seller_id],
                    )
                    available_balance = (cur.fetchone() or (0,))[0] or 0
            except ProgrammingError:
                available_balance = 0

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

        if not rows:
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        """
                        SELECT
                            id::text,
                            total_price,
                            COALESCE(payment_captured_at, updated_at, created_at)
                        FROM orders
                        WHERE seller_id = %s AND payment_completed = TRUE
                        ORDER BY COALESCE(payment_captured_at, updated_at, created_at) DESC
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
