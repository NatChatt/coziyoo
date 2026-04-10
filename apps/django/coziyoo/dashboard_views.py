"""
Admin dashboard data endpoint.
Returns system-wide KPIs, 7-day sparkline data, and recent activity.
"""
from django.db import connection
from django.http import JsonResponse


def dashboard_data(request):
    with connection.cursor() as cur:

        # ── KPIs ────────────────────────────────────────────────────────────
        cur.execute("""
            SELECT
                -- Buyers
                count(*) FILTER (WHERE user_type IN ('buyer','both'))           AS total_buyers,
                count(*) FILTER (WHERE user_type IN ('buyer','both')
                                   AND created_at >= now() - interval '30 days') AS new_buyers_month,

                -- Sellers
                count(*) FILTER (WHERE user_type IN ('seller','both')
                                   AND seller_profile_status = 'approved'
                                   AND is_active)                                AS active_sellers,
                count(*) FILTER (WHERE user_type IN ('seller','both')
                                   AND seller_profile_status = 'pending')        AS pending_sellers

            FROM users
        """)
        row = cur.fetchone()
        total_buyers, new_buyers_month, active_sellers, pending_sellers = row

        cur.execute("""
            SELECT
                count(*) FILTER (WHERE created_at::date = current_date)         AS orders_today,
                count(*) FILTER (WHERE created_at >= date_trunc('month', now())) AS orders_month,
                count(*) FILTER (WHERE status IN ('pending','processing','accepted')) AS orders_active,

                COALESCE(sum(total_price) FILTER (
                    WHERE created_at::date = current_date AND payment_completed), 0) AS revenue_today,
                COALESCE(sum(total_price) FILTER (
                    WHERE created_at >= date_trunc('month', now()) AND payment_completed), 0) AS revenue_month

            FROM orders
        """)
        row = cur.fetchone()
        orders_today, orders_month, orders_active, revenue_today, revenue_month = row

        cur.execute("""
            SELECT
                count(*) FILTER (WHERE status IN ('open','in_review')) AS open_complaints,
                count(*) FILTER (WHERE created_at::date = current_date) AS complaints_today
            FROM complaints
        """)
        row = cur.fetchone()
        open_complaints, complaints_today = row

        cur.execute("""
            SELECT count(*)
            FROM seller_compliance_documents
            WHERE status = 'pending'
        """)
        pending_compliance = cur.fetchone()[0]

        # ── Ops metrics (alerts + backlog) ──────────────────────────────────
        cur.execute("""
            SELECT count(*)
            FROM payment_attempts
            WHERE created_at >= now() - interval '24 hours'
              AND status IN ('failed', 'error', 'cancelled')
        """)
        failed_payments_24h = cur.fetchone()[0]

        cur.execute("""
            SELECT count(*)
            FROM payment_dispute_cases
            WHERE status NOT IN ('resolved', 'closed')
        """)
        open_disputes = cur.fetchone()[0]

        cur.execute("""
            SELECT count(*)
            FROM orders
            WHERE status IN ('pending', 'processing', 'accepted')
              AND created_at <= now() - interval '30 minutes'
        """)
        overdue_active_orders = cur.fetchone()[0]

        cur.execute("""
            SELECT count(*)
            FROM complaints
            WHERE status IN ('open', 'in_review')
              AND priority IN ('high', 'critical', 'urgent')
        """)
        high_priority_complaints = cur.fetchone()[0]

        cur.execute("""
            SELECT count(*)
            FROM seller_compliance_documents
            WHERE status = 'pending'
              AND created_at <= now() - interval '24 hours'
        """)
        stale_pending_docs = cur.fetchone()[0]

        cur.execute("""
            SELECT count(*)
            FROM reviews
            WHERE created_at >= now() - interval '7 days'
              AND rating <= 2
        """)
        low_rating_reviews_7d = cur.fetchone()[0]

        cur.execute("""
            SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        """)
        last_updated_at = cur.fetchone()[0]

        # ── 7-day sparkline (orders + revenue) ──────────────────────────────
        cur.execute("""
            SELECT
                date_series::date                                                       AS day,
                COALESCE(count(o.id), 0)                                                AS order_count,
                COALESCE(sum(o.total_price) FILTER (WHERE o.payment_completed), 0)      AS revenue
            FROM generate_series(
                now()::date - interval '6 days',
                now()::date,
                interval '1 day'
            ) AS date_series
            LEFT JOIN orders o ON o.created_at::date = date_series::date
            GROUP BY date_series
            ORDER BY date_series
        """)
        chart_rows = cur.fetchall()
        chart_data = [
            {
                "date": str(r[0]),
                "orders": int(r[1]),
                "revenue": float(r[2]),
            }
            for r in chart_rows
        ]

        # ── Recent orders (10) ───────────────────────────────────────────────
        cur.execute("""
            SELECT
                o.id::text,
                o.status,
                o.total_price,
                o.payment_completed,
                o.created_at,
                buyer.display_name  AS buyer_name,
                seller.display_name AS seller_name
            FROM orders o
            LEFT JOIN users buyer  ON buyer.id  = o.buyer_id
            LEFT JOIN users seller ON seller.id = o.seller_id
            ORDER BY o.created_at DESC
            LIMIT 10
        """)
        recent_orders = [
            {
                "id": r[0],
                "id_short": r[0][:8],
                "status": r[1],
                "total": float(r[2]) if r[2] is not None else 0,
                "paid": r[3],
                "created_at": r[4].strftime("%d.%m.%Y %H:%M") if r[4] else "",
                "buyer": r[5] or "—",
                "seller": r[6] or "—",
            }
            for r in cur.fetchall()
        ]

        # ── Recent complaints (5) ────────────────────────────────────────────
        cur.execute("""
            SELECT
                c.id::text,
                c.status,
                c.created_at,
                u.display_name AS complainant_name
            FROM complaints c
            LEFT JOIN users u ON u.id = COALESCE(c.complainant_user_id, c.complainant_buyer_id)
            ORDER BY c.created_at DESC
            LIMIT 5
        """)
        recent_complaints = [
            {
                "id": r[0],
                "id_short": r[0][:8],
                "status": r[1],
                "created_at": r[2].strftime("%d.%m.%Y %H:%M") if r[2] else "",
                "complainant": r[3] or "—",
            }
            for r in cur.fetchall()
        ]

    return JsonResponse({
        "kpis": {
            "total_buyers": int(total_buyers),
            "new_buyers_month": int(new_buyers_month),
            "active_sellers": int(active_sellers),
            "pending_sellers": int(pending_sellers),
            "orders_today": int(orders_today),
            "orders_month": int(orders_month),
            "orders_active": int(orders_active),
            "revenue_today": float(revenue_today),
            "revenue_month": float(revenue_month),
            "open_complaints": int(open_complaints),
            "complaints_today": int(complaints_today),
            "pending_compliance": int(pending_compliance),
        },
        "ops": {
            "failed_payments_24h": int(failed_payments_24h),
            "open_disputes": int(open_disputes),
            "overdue_active_orders": int(overdue_active_orders),
            "high_priority_complaints": int(high_priority_complaints),
            "stale_pending_docs": int(stale_pending_docs),
            "low_rating_reviews_7d": int(low_rating_reviews_7d),
            "last_updated_at": last_updated_at,
        },
        "chart": chart_data,
        "recent_orders": recent_orders,
        "recent_complaints": recent_complaints,
    })
