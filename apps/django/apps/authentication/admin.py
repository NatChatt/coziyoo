import json
from django import forms
from django.conf import settings
from django.contrib import admin
from django.contrib import messages
from django.db import connection
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect
from django.template.response import TemplateResponse
from django.urls import path
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _
from unfold.admin import ModelAdmin
from unfold.decorators import display

from coziyoo import s3 as s3_utils

from django.contrib.auth.models import User, Group
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import (
    Users, BuyerUsers, SellerUsers, AllUsers,
    AdminUsers, AdminSalesCommissionSettings,
    AdminAuditLogs, SecurityLoginEvents, AdminApiTokens,
    RolePermissions,
)

STATUS_TR = {
    "pending": "Beklemede", "processing": "Hazırlanıyor", "accepted": "Kabul Edildi",
    "delivered": "Teslim Edildi", "completed": "Tamamlandı", "cancelled": "İptal Edildi",
    "rejected": "Reddedildi", "failed": "Başarısız",
    "open": "Açık", "in_review": "İnceleniyor", "resolved": "Çözüldü", "closed": "Kapatıldı",
    "approved": "Onaylandı", "uploaded": "Yüklendi",
}

TYPE_TR = {"buyer": "Alıcı", "seller": "Satıcı", "both": "Her İkisi"}


def _user_type_badge(obj):
    colors = {"buyer": "#2563eb", "seller": "#16a34a", "both": "#7c3aed"}
    color = colors.get(obj.user_type, "#6b7280")
    return format_html(
        '<span style="background:{};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">{}</span>',
        color, obj.user_type,
    )


def _seller_status_badge(obj):
    if obj.user_type not in ("seller", "both"):
        return "—"
    colors = {
        "approved": "#16a34a", "pending": "#d97706",
        "rejected": "#dc2626", "suspended": "#6b7280",
    }
    color = colors.get(obj.seller_profile_status, "#6b7280")
    return format_html(
        '<span style="color:{};font-weight:600">{}</span>',
        color, obj.seller_profile_status or "—",
    )


_COMMON_FIELDSETS = [
    ("Identity", {"fields": ["id", "email", "display_name", "full_name", "username", "phone"]}),
    ("Account", {"fields": ["user_type", "is_active", "legal_hold_state", "seller_profile_status", "profile_image_url"]}),
    ("Seller Info", {
        "fields": ["kitchen_title", "kitchen_description", "delivery_radius_km",
                   "delivery_enabled", "delivery_terms"],
        "classes": ["collapse"],
    }),
    ("Meta", {"fields": ["created_at", "updated_at"]}),
]

_COMMON_READONLY = [
    "id", "password_hash", "created_at", "updated_at",
    "username_normalized", "display_name_normalized",
]


def _fetch_buyer_row_data(user_ids):
    """Single SQL query to get risk/complaint/spend metrics per buyer."""
    uid_strs = [str(uid) for uid in user_ids]
    result = {}
    with connection.cursor() as cur:
        cur.execute("""
            WITH
            cur_orders AS (
                SELECT buyer_id::text, count(*) AS cnt,
                       COALESCE(sum(CASE WHEN payment_completed THEN total_price ELSE 0 END), 0) AS spent
                FROM orders
                WHERE created_at >= now() - interval '30 days'
                  AND buyer_id::text = ANY(%s)
                GROUP BY buyer_id
            ),
            prev_orders AS (
                SELECT buyer_id::text, count(*) AS cnt,
                       COALESCE(sum(CASE WHEN payment_completed THEN total_price ELSE 0 END), 0) AS spent
                FROM orders
                WHERE created_at >= now() - interval '60 days'
                  AND created_at < now() - interval '30 days'
                  AND buyer_id::text = ANY(%s)
                GROUP BY buyer_id
            ),
            complaint_stats AS (
                SELECT COALESCE(complainant_user_id, complainant_buyer_id)::text AS user_id,
                       count(*) AS total,
                       count(*) FILTER (WHERE status IN ('open', 'in_review')) AS open_count
                FROM complaints
                WHERE COALESCE(complainant_user_id, complainant_buyer_id)::text = ANY(%s)
                GROUP BY COALESCE(complainant_user_id, complainant_buyer_id)
            ),
            last_login AS (
                SELECT user_id::text, max(created_at) AS last_at
                FROM auth_sessions
                WHERE user_id::text = ANY(%s)
                GROUP BY user_id
            )
            SELECT
                u.id::text,
                COALESCE(co.cnt, 0)        AS orders_current,
                COALESCE(po.cnt, 0)        AS orders_previous,
                COALESCE(co.spent, 0)      AS spent_current,
                COALESCE(po.spent, 0)      AS spent_previous,
                COALESCE(cs.total, 0)      AS complaints_total,
                COALESCE(cs.open_count, 0) AS complaints_open,
                ll.last_at                 AS last_login
            FROM users u
            LEFT JOIN cur_orders  co ON co.buyer_id = u.id::text
            LEFT JOIN prev_orders po ON po.buyer_id = u.id::text
            LEFT JOIN complaint_stats cs ON cs.user_id = u.id::text
            LEFT JOIN last_login   ll ON ll.user_id  = u.id::text
            WHERE u.id::text = ANY(%s)
        """, [uid_strs, uid_strs, uid_strs, uid_strs, uid_strs])

        for row in cur.fetchall():
            uid, ord_cur, ord_prev, sp_cur, sp_prev, comp_total, comp_open, last_login = row

            def trend(cur_val, prev_val):
                if cur_val > prev_val:
                    return "up"
                if cur_val < prev_val:
                    return "down"
                return "flat"

            ord_cur, ord_prev = int(ord_cur), int(ord_prev)
            sp_cur, sp_prev = float(sp_cur), float(sp_prev)
            comp_total, comp_open = int(comp_total), int(comp_open)
            order_trend = trend(ord_cur, ord_prev)
            spend_trend = trend(sp_cur, sp_prev)

            score = min(comp_open, 2) * 30
            if comp_total >= 2:
                score += 15
            if order_trend == "down":
                score += 12
            if spend_trend == "down":
                score += 12

            risk_level = "high" if score >= 70 else "medium" if score >= 35 else "low"

            result[uid] = {
                "orders_current": ord_cur,
                "orders_previous": ord_prev,
                "spent_current": sp_cur,
                "spent_previous": sp_prev,
                "complaints_total": comp_total,
                "complaints_open": comp_open,
                "last_login": last_login,
                "order_trend": order_trend,
                "spend_trend": spend_trend,
                "risk_level": risk_level,
                "risk_score": score,
            }
    return result


@admin.register(BuyerUsers)
class BuyerUsersAdmin(ModelAdmin):
    list_display = [
        "display_name_link", "email", "user_type_badge", "is_active", "created_at",
    ]
    list_display_links = None
    list_filter = ["is_active"]
    search_fields = ["email", "display_name", "username", "phone"]
    readonly_fields = _COMMON_READONLY
    ordering = ["-created_at"]
    list_per_page = 50
    fieldsets = _COMMON_FIELDSETS

    def has_add_permission(self, request):
        return False

    def get_queryset(self, request):
        return super().get_queryset(request).filter(
            is_active=True, user_type__in=["buyer", "both"]
        )

    def changelist_view(self, request, extra_context=None):
        types = ("buyer", "both")
        extra_context = extra_context or {}

        with connection.cursor() as cur:
            ph = "%s,%s"
            cur.execute(f"SELECT count(*)::int FROM users WHERE user_type IN ({ph}) AND is_active = TRUE", list(types))
            total = cur.fetchone()[0]

            cur.execute(f"""
                SELECT count(DISTINCT o.buyer_id)::int FROM orders o
                JOIN users u ON u.id = o.buyer_id
                WHERE u.user_type IN ({ph}) AND u.is_active = TRUE
                  AND o.created_at >= now() - interval '30 days'
            """, list(types))
            active = cur.fetchone()[0]

            cur.execute(f"""
                SELECT count(*)::int FROM complaints c
                JOIN users u ON u.id = COALESCE(c.complainant_user_id, c.complainant_buyer_id)
                WHERE u.user_type IN ({ph}) AND u.is_active = TRUE
                  AND c.status IN ('open', 'in_review')
            """, list(types))
            open_complaints = cur.fetchone()[0]

            cur.execute(f"""
                SELECT count(*)::int FROM users
                WHERE user_type IN ({ph}) AND is_active = TRUE AND legal_hold_state = TRUE
            """, list(types))
            risky = cur.fetchone()[0]

        extra_context["buyer_stats"] = {
            "total": total,
            "active": active,
            "open_complaints": open_complaints,
            "risky": risky,
        }

        response = super().changelist_view(request, extra_context=extra_context)

        if hasattr(response, 'context_data') and response.context_data:
            cl = response.context_data.get('cl')
            if cl and hasattr(cl, 'result_list') and cl.result_list is not None:
                try:
                    users_page = list(cl.result_list)
                    if users_page:
                        user_ids = [u.id for u in users_page]
                        enriched_map = _fetch_buyer_row_data(user_ids)
                        buyer_rows = []
                        for u in users_page:
                            uid_str = str(u.id)
                            data = enriched_map.get(uid_str, {
                                "orders_current": 0, "orders_previous": 0,
                                "spent_current": 0.0, "spent_previous": 0.0,
                                "complaints_total": 0, "complaints_open": 0,
                                "last_login": None, "order_trend": "flat",
                                "spend_trend": "flat", "risk_level": "low", "risk_score": 0,
                            })
                            buyer_rows.append({
                                "id": uid_str,
                                "display_name": u.display_name or u.email,
                                "email": u.email,
                                "user_type": u.user_type,
                                "is_active": u.is_active,
                                **data,
                            })
                        response.context_data['buyer_rows'] = buyer_rows
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).error("Buyer row enrichment failed: %s", e)

        return response

    def delete_model(self, request, obj):
        obj.is_active = False
        obj.save(update_fields=["is_active"])

    def delete_queryset(self, request, queryset):
        queryset.update(is_active=False)

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path("<uuid:user_id>/buyer-detail/", self.admin_site.admin_view(self.buyer_detail_view), name="authentication_buyerusers_buyer_detail"),
        ]
        return custom + urls

    def buyer_detail_view(self, request, user_id):
        user = get_object_or_404(Users, pk=user_id)

        with connection.cursor() as cur:
            # Summary stats
            cur.execute("""
                SELECT
                    count(*)::int AS total_orders,
                    COALESCE(sum(CASE WHEN payment_completed THEN total_price ELSE 0 END), 0) AS total_spent,
                    COALESCE(sum(CASE WHEN payment_completed AND created_at >= now() - interval '30 days' THEN total_price ELSE 0 END), 0) AS monthly_spent,
                    max(created_at) AS last_order_at
                FROM orders WHERE buyer_id = %s
            """, [user_id])
            orow = cur.fetchone()

            cur.execute("""
                SELECT
                    count(*)::int AS total,
                    count(*) FILTER (WHERE status IN ('open','in_review'))::int AS unresolved,
                    max(created_at) AS last_at
                FROM complaints
                WHERE COALESCE(complainant_user_id, complainant_buyer_id) = %s
            """, [user_id])
            crow = cur.fetchone()

            cur.execute("SELECT count(*)::int FROM reviews WHERE buyer_id = %s", [user_id])
            review_count = cur.fetchone()[0]

            cur.execute("SELECT count(*)::int FROM payment_attempts WHERE buyer_id = %s", [user_id])
            payment_count = cur.fetchone()[0]

            cur.execute("SELECT count(*)::int FROM buyer_notes WHERE buyer_id = %s", [user_id])
            notes_count = cur.fetchone()[0]

            cur.execute("SELECT count(*)::int FROM buyer_tags WHERE buyer_id = %s", [user_id])
            tags_count = cur.fetchone()[0]

            # Recent orders
            cur.execute("""
                SELECT o.id, u.display_name AS seller_name, o.total_price, o.status, o.created_at
                FROM orders o LEFT JOIN users u ON u.id = o.seller_id
                WHERE o.buyer_id = %s ORDER BY o.created_at DESC LIMIT 20
            """, [user_id])
            orders = [{"id": str(r[0]), "seller_name": r[1], "total_price": r[2], "status": r[3], "status_tr": STATUS_TR.get(r[3], r[3]), "created_at": r[4]} for r in cur.fetchall()]

            # Recent complaints
            cur.execute("""
                SELECT id, description, status, created_at FROM complaints
                WHERE COALESCE(complainant_user_id, complainant_buyer_id) = %s
                ORDER BY created_at DESC LIMIT 20
            """, [user_id])
            complaints = [{"id": str(r[0]), "description": r[1], "status": r[2], "status_tr": STATUS_TR.get(r[2], r[2]), "created_at": r[3]} for r in cur.fetchall()]

            # Recent reviews
            cur.execute("""
                SELECT r.id, f.name AS food_name, r.rating, r.comment, r.created_at
                FROM reviews r LEFT JOIN foods f ON f.id = r.food_id
                WHERE r.buyer_id = %s ORDER BY r.created_at DESC LIMIT 20
            """, [user_id])
            reviews = [{"id": str(r[0]), "food_name": r[1], "stars": "★" * int(r[2]) + "☆" * (5 - int(r[2])), "comment": r[3], "created_at": r[4]} for r in cur.fetchall()]

            # Payment attempts
            cur.execute("""
                SELECT pa.id, pa.provider, pa.status, pa.created_at,
                       o.total_price, o.id AS order_id
                FROM payment_attempts pa
                JOIN orders o ON o.id = pa.order_id
                WHERE pa.buyer_id = %s ORDER BY pa.created_at DESC LIMIT 20
            """, [user_id])
            payments = [{"id": str(r[0]), "provider": r[1], "status": r[2], "status_tr": STATUS_TR.get(r[2], r[2]), "created_at": r[3],
                         "amount": r[4], "order_id": str(r[5])} for r in cur.fetchall()]

            # Activity: auth sessions + presence events merged by time
            cur.execute("""
                SELECT 'login' AS event_type, ip, device_info AS detail, created_at
                FROM auth_sessions WHERE user_id = %s
                ORDER BY created_at DESC LIMIT 30
            """, [user_id])
            sessions = [{"event_type": r[0], "event_tr": "Giriş", "ip": r[1], "detail": r[2], "happened_at": r[3]} for r in cur.fetchall()]

            cur.execute("""
                SELECT event_type, ip, user_agent AS detail, happened_at
                FROM user_presence_events
                WHERE subject_type = 'user' AND subject_id = %s
                ORDER BY happened_at DESC LIMIT 30
            """, [user_id])
            presence = [{"event_type": r[0], "event_tr": r[0], "ip": r[1], "detail": r[2], "happened_at": r[3]} for r in cur.fetchall()]

            activity = sorted(sessions + presence, key=lambda x: x["happened_at"] or "", reverse=True)[:30]

            # Notes & Tags
            cur.execute("""
                SELECT bn.id, bn.note, au.email AS admin_email, bn.created_at
                FROM buyer_notes bn
                LEFT JOIN admin_users au ON au.id = bn.admin_id
                WHERE bn.buyer_id = %s ORDER BY bn.created_at DESC
            """, [user_id])
            notes = [{"id": str(r[0]), "note": r[1], "admin_email": r[2], "created_at": r[3]} for r in cur.fetchall()]

            cur.execute("SELECT tag, created_at FROM buyer_tags WHERE buyer_id = %s ORDER BY created_at DESC", [user_id])
            tags = [{"tag": r[0], "created_at": r[1]} for r in cur.fetchall()]

        summary = {
            "total_orders": orow[0] or 0,
            "total_spent": orow[1] or 0,
            "monthly_spent": orow[2] or 0,
            "last_order_at": orow[3],
            "complaint_total": crow[0] or 0,
            "complaint_unresolved": crow[1] or 0,
            "last_complaint_at": crow[2],
            "review_count": review_count,
            "payment_count": payment_count,
            "notes_count": notes_count + tags_count,
        }

        tabs = [
            ("general", "Genel"), ("orders", "Siparişler"), ("payments", "Ödemeler"),
            ("complaints", "Şikayetler"), ("reviews", "Yorumlar & Puanlar"),
            ("activity", "Aktivite Logu"), ("notes", "Notlar & Etiketler"), ("raw", "Ham Veri"),
        ]

        raw_data = {
            "id": str(user.id), "email": user.email, "display_name": user.display_name,
            "username": user.username, "phone": user.phone, "user_type": user.user_type,
            "is_active": user.is_active, "created_at": str(user.created_at),
        }

        context = {
            **self.admin_site.each_context(request),
            "title": f"Alıcı Detayı — {user.display_name}",
            "user": user,
            "summary": summary,
            "tabs": tabs,
            "orders": orders,
            "complaints": complaints,
            "reviews": reviews,
            "payments": payments,
            "activity": activity,
            "notes": notes,
            "tags": tags,
            "raw_json": json.dumps(raw_data, indent=2, default=str),
            "opts": self.model._meta,
        }
        return TemplateResponse(request, "admin/authentication/buyer_detail.html", context)

    @display(description=_("Name"), ordering="display_name")
    def display_name_link(self, obj):
        from django.urls import reverse
        url = reverse("admin:authentication_buyerusers_buyer_detail", args=[obj.id])
        return format_html('<a href="{}" class="text-primary-600 hover:underline font-medium">{}</a>', url, obj.display_name)

    @display(description=_("Type"), ordering="user_type")
    def user_type_badge(self, obj):
        return _user_type_badge(obj)


@admin.register(SellerUsers)
class SellerUsersAdmin(ModelAdmin):
    list_display = [
        "display_name_link", "email", "seller_status_badge", "is_active", "created_at",
    ]
    list_display_links = None
    list_filter = ["is_active", "seller_profile_status"]
    search_fields = ["email", "display_name", "username", "phone"]
    readonly_fields = _COMMON_READONLY
    ordering = ["-created_at"]
    list_per_page = 50
    fieldsets = _COMMON_FIELDSETS

    def has_add_permission(self, request):
        return False

    def get_queryset(self, request):
        return super().get_queryset(request).filter(
            is_active=True, user_type__in=["seller", "both"]
        )

    def changelist_view(self, request, extra_context=None):
        types = ("seller", "both")
        extra_context = extra_context or {}

        with connection.cursor() as cur:
            ph = "%s,%s"
            cur.execute(f"SELECT count(*)::int FROM users WHERE user_type IN ({ph}) AND is_active = TRUE", list(types))
            total = cur.fetchone()[0]

            cur.execute("""
                SELECT count(DISTINCT scd.seller_id)::int
                FROM seller_compliance_documents scd
                JOIN users u ON u.id = scd.seller_id
                WHERE scd.status = 'uploaded'
                  AND u.user_type IN ('seller', 'both')
                  AND u.is_active = TRUE
            """)
            pending_approvals = cur.fetchone()[0]

            cur.execute(f"""
                SELECT count(*)::int FROM complaints c
                JOIN orders o ON o.id = c.order_id
                JOIN users u ON u.id = o.seller_id
                WHERE u.user_type IN ({ph}) AND u.is_active = TRUE
                  AND c.status IN ('open', 'in_review')
            """, list(types))
            open_complaints = cur.fetchone()[0]

            cur.execute(f"""
                SELECT count(*)::int FROM users
                WHERE user_type IN ({ph}) AND is_active = TRUE
                  AND created_at::date = CURRENT_DATE
            """, list(types))
            new_today = cur.fetchone()[0]

        extra_context["seller_stats"] = {
            "total": total,
            "pending_approvals": pending_approvals,
            "open_complaints": open_complaints,
            "new_today": new_today,
        }
        return super().changelist_view(request, extra_context=extra_context)

    def delete_model(self, request, obj):
        obj.is_active = False
        obj.save(update_fields=["is_active"])

    def delete_queryset(self, request, queryset):
        queryset.update(is_active=False)

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path("<uuid:user_id>/seller-detail/", self.admin_site.admin_view(self.seller_detail_view), name="authentication_sellerusers_seller_detail"),
            path("<uuid:seller_id>/compliance/presign/", self.admin_site.admin_view(self.compliance_presign_view), name="authentication_sellerusers_compliance_presign"),
            path("<uuid:seller_id>/compliance/confirm/", self.admin_site.admin_view(self.compliance_confirm_view), name="authentication_sellerusers_compliance_confirm"),
            path("<uuid:seller_id>/compliance/review/", self.admin_site.admin_view(self.compliance_review_view), name="authentication_sellerusers_compliance_review"),
        ]
        return custom + urls

    def seller_detail_view(self, request, user_id):
        user = get_object_or_404(Users, pk=user_id)

        with connection.cursor() as cur:
            # Order/earnings stats
            cur.execute("""
                SELECT
                    count(*)::int AS total_orders,
                    COALESCE(sum(CASE WHEN payment_completed THEN total_price ELSE 0 END), 0) AS total_earnings,
                    COALESCE(sum(CASE WHEN payment_completed AND created_at >= now() - interval '30 days' THEN total_price ELSE 0 END), 0) AS monthly_earnings,
                    max(created_at) AS last_order_at
                FROM orders WHERE seller_id = %s
            """, [user_id])
            orow = cur.fetchone()

            cur.execute("""
                SELECT count(*)::int, count(*) FILTER (WHERE c.status IN ('open','in_review'))::int
                FROM complaints c JOIN orders o ON o.id = c.order_id WHERE o.seller_id = %s
            """, [user_id])
            crow = cur.fetchone()

            cur.execute("SELECT count(*)::int FROM foods WHERE seller_id = %s", [user_id])
            foods_count = cur.fetchone()[0]

            cur.execute("""
                SELECT count(*)::int, COALESCE(avg(r.rating), 0)::numeric(3,2)
                FROM reviews r JOIN foods f ON f.id = r.food_id WHERE f.seller_id = %s
            """, [user_id])
            rrow = cur.fetchone()

            cur.execute("""
                SELECT cdl.id::text, cdl.code, cdl.name, cdl.is_required_default,
                       scd.id::text AS doc_id, scd.status, scd.uploaded_at, scd.file_url,
                       scd.rejection_reason
                FROM compliance_documents_list cdl
                LEFT JOIN seller_compliance_documents scd
                    ON scd.document_list_id = cdl.id AND scd.seller_id = %s
                WHERE cdl.is_active = TRUE
                ORDER BY cdl.is_required_default DESC, cdl.name
            """, [user_id])
            compliance_docs = []
            for r in cur.fetchall():
                compliance_docs.append({
                    "document_list_id": r[0],
                    "code": r[1],
                    "name": r[2],
                    "is_required": r[3],
                    "doc_id": r[4],
                    "status": r[5] or "not_uploaded",
                    "status_tr": STATUS_TR.get(r[5], r[5]) if r[5] else "Yüklenmedi",
                    "uploaded_at": r[6],
                    "file_url": s3_utils.hydrate_file_url(r[7]) if r[7] else None,
                    "rejection_reason": r[8] or "",
                })

            cur.execute("""
                SELECT o.id, u.display_name AS buyer_name, o.total_price, o.status, o.created_at
                FROM orders o LEFT JOIN users u ON u.id = o.buyer_id
                WHERE o.seller_id = %s ORDER BY o.created_at DESC LIMIT 10
            """, [user_id])
            orders = [{"id": str(r[0]), "buyer_name": r[1], "total_price": r[2], "status": r[3], "status_tr": STATUS_TR.get(r[3], r[3]), "created_at": r[4]} for r in cur.fetchall()]

            cur.execute("""
                SELECT r.id, f.name AS food_name, r.rating AS review_rating, r.comment, r.created_at,
                       u.display_name AS buyer_name
                FROM reviews r
                JOIN foods f ON f.id = r.food_id
                LEFT JOIN users u ON u.id = r.buyer_id
                WHERE f.seller_id = %s ORDER BY r.created_at DESC LIMIT 10
            """, [user_id])
            reviews = [{"id": str(r[0]), "food_name": r[1], "stars": "★" * int(r[2]) + "☆" * (5 - int(r[2])),
                        "comment": r[3], "created_at": r[4], "buyer_name": r[5]} for r in cur.fetchall()]

            cur.execute("""
                SELECT c.id, c.description, c.status, c.created_at
                FROM complaints c JOIN orders o ON o.id = c.order_id
                WHERE o.seller_id = %s ORDER BY c.created_at DESC LIMIT 10
            """, [user_id])
            complaints = [{"id": str(r[0]), "description": r[1], "status": r[2], "status_tr": STATUS_TR.get(r[2], r[2]), "created_at": r[3]} for r in cur.fetchall()]

            cur.execute("""
                SELECT f.id, f.name, f.price, f.is_active, c.name_tr AS category_name
                FROM foods f LEFT JOIN categories c ON c.id = f.category_id
                WHERE f.seller_id = %s ORDER BY f.name LIMIT 20
            """, [user_id])
            foods = [{"id": str(r[0]), "name": r[1], "price": r[2], "is_active": r[3], "category_name": r[4]} for r in cur.fetchall()]

            cur.execute("""
                SELECT title, address_line FROM user_addresses WHERE user_id = %s LIMIT 1
            """, [user_id])
            addr_row = cur.fetchone()
            address = {"title": addr_row[0], "line": addr_row[1]} if addr_row else None

        summary = {
            "total_orders": orow[0] or 0,
            "total_earnings": orow[1] or 0,
            "monthly_earnings": orow[2] or 0,
            "last_order_at": orow[3],
            "complaint_total": crow[0] or 0,
            "complaint_unresolved": crow[1] or 0,
            "foods_count": foods_count,
            "review_count": rrow[0] or 0,
            "avg_rating": float(rrow[1] or 0),
        }

        compliance_summary = {
            "total": sum(1 for d in compliance_docs if d["is_required"]),
            "approved": sum(1 for d in compliance_docs if d["is_required"] and d["status"] == "approved"),
        }

        tabs = [
            ("general", _("General")), ("foods", _("Foods")), ("orders", _("Orders")),
            ("compliance", _("Compliance")), ("reviews", _("Reviews")),
            ("complaints", _("Complaints")), ("raw", _("Raw Data")),
        ]

        raw_data = {
            "id": str(user.id), "email": user.email, "display_name": user.display_name,
            "full_name": user.full_name, "username": user.username, "phone": user.phone,
            "user_type": user.user_type, "is_active": user.is_active,
            "seller_profile_status": user.seller_profile_status,
            "kitchen_title": user.kitchen_title, "kitchen_description": user.kitchen_description,
            "dob": str(user.dob) if user.dob else None,
            "country_code": user.country_code, "national_id": user.national_id,
            "created_at": str(user.created_at),
        }

        context = {
            **self.admin_site.each_context(request),
            "title": f"Satıcı Detayı — {user.display_name}",
            "user_obj": user,
            "summary": summary,
            "tabs": tabs,
            "orders": orders,
            "reviews": reviews,
            "complaints": complaints,
            "foods": foods,
            "compliance_docs": compliance_docs,
            "compliance_summary": compliance_summary,
            "address": address,
            "raw_json": json.dumps(raw_data, indent=2, default=str),
            "s3_configured": s3_utils.is_configured(),
            "opts": self.model._meta,
        }
        return TemplateResponse(request, "admin/authentication/seller_detail.html", context)

    def compliance_presign_view(self, request, seller_id):
        if request.method != "POST":
            return JsonResponse({"error": "Method not allowed"}, status=405)
        try:
            data = json.loads(request.body)
        except (ValueError, KeyError):
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        doc_type = data.get("docType")
        file_name = data.get("fileName", "document.bin")
        content_type = data.get("contentType", "application/octet-stream")

        if not doc_type:
            return JsonResponse({"error": "docType required"}, status=400)

        if not s3_utils.is_configured():
            return JsonResponse({"error": "S3 storage not configured"}, status=503)

        with connection.cursor() as cur:
            cur.execute(
                "SELECT id FROM compliance_documents_list WHERE code = %s AND is_active = TRUE",
                [doc_type],
            )
            if cur.fetchone() is None:
                return JsonResponse({"error": "Document type not found"}, status=404)

        bucket = settings.S3_BUCKET_SELLER_DOCS
        key = s3_utils.build_seller_document_key(str(seller_id), doc_type, file_name)
        upload_url = s3_utils.presign_put(bucket, key, content_type)

        return JsonResponse({
            "upload_url": upload_url,
            "file_url": s3_utils.to_storage_pointer(bucket, key),
        })

    def compliance_confirm_view(self, request, seller_id):
        if request.method != "POST":
            return JsonResponse({"error": "Method not allowed"}, status=405)
        try:
            data = json.loads(request.body)
        except (ValueError, KeyError):
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        document_list_id = data.get("document_list_id")
        file_url = data.get("file_url")

        if not document_list_id or not file_url:
            return JsonResponse({"error": "document_list_id and file_url required"}, status=400)

        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO seller_compliance_documents
                    (seller_id, document_list_id, file_url, status, uploaded_at)
                VALUES (%s, %s, %s, 'uploaded', now())
                ON CONFLICT (seller_id, document_list_id)
                DO UPDATE SET file_url=%s, status='uploaded', uploaded_at=now(), updated_at=now()
                RETURNING id
                """,
                [str(seller_id), document_list_id, file_url, file_url],
            )
            row = cur.fetchone()

        preview_url = s3_utils.hydrate_file_url(file_url) if s3_utils.is_configured() else None

        return JsonResponse({"id": str(row[0]), "status": "uploaded", "preview_url": preview_url})

    def compliance_review_view(self, request, seller_id):
        if request.method != "POST":
            return JsonResponse({"error": "Method not allowed"}, status=405)
        try:
            data = json.loads(request.body)
        except (ValueError, KeyError):
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        doc_id = data.get("doc_id")
        action = data.get("action")
        rejection_reason = data.get("rejection_reason", "") or ""

        if not doc_id or action not in ("approved", "rejected"):
            return JsonResponse({"error": "doc_id and action (approved/rejected) required"}, status=400)

        if action == "rejected" and len(rejection_reason.strip()) < 3:
            return JsonResponse({"error": "Rejection reason must be at least 3 characters"}, status=400)

        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE seller_compliance_documents
                SET status = %s,
                    rejection_reason = %s,
                    reviewed_at = now(),
                    updated_at = now()
                WHERE id = %s AND seller_id = %s
                RETURNING id, status
                """,
                [action, rejection_reason.strip() if action == "rejected" else None, doc_id, str(seller_id)],
            )
            row = cur.fetchone()

        if not row:
            return JsonResponse({"error": "Document not found"}, status=404)

        return JsonResponse({"id": str(row[0]), "status": row[1]})

    @display(description=_("Name"), ordering="display_name")
    def display_name_link(self, obj):
        from django.urls import reverse
        url = reverse("admin:authentication_sellerusers_seller_detail", args=[obj.id])
        return format_html('<a href="{}" class="text-primary-600 hover:underline font-medium">{}</a>', url, obj.display_name)

    @display(description=_("Type"), ordering="user_type")
    def user_type_badge(self, obj):
        return _user_type_badge(obj)

    @display(description=_("Seller Status"), ordering="seller_profile_status")
    def seller_status_badge(self, obj):
        return _seller_status_badge(obj)


@admin.register(AllUsers)
class AllUsersAdmin(ModelAdmin):
    actions_on_top = True
    actions_on_bottom = False
    actions = ["make_active", "make_inactive"]
    list_display = [
        "display_name_link", "email", "user_type_badge", "is_active",
        "seller_status_badge", "created_at",
    ]
    list_display_links = None
    list_filter = ["is_active", "seller_profile_status", "user_type"]
    search_fields = ["email", "display_name", "username", "phone"]
    ordering = ["-created_at"]
    list_per_page = 50

    @display(description=_("Name"), ordering="display_name")
    def display_name_link(self, obj):
        from django.urls import reverse
        if obj.user_type == "seller":
            url = reverse("admin:authentication_sellerusers_seller_detail", args=[obj.id])
        elif obj.user_type in ("buyer", "both"):
            url = reverse("admin:authentication_buyerusers_buyer_detail", args=[obj.id])
        else:
            return obj.display_name
        return format_html('<a href="{}" class="text-primary-600 hover:underline font-medium">{}</a>', url, obj.display_name)

    @display(description=_("Type"), ordering="user_type")
    def user_type_badge(self, obj):
        return _user_type_badge(obj)

    @display(description=_("Seller Status"), ordering="seller_profile_status")
    def seller_status_badge(self, obj):
        return _seller_status_badge(obj)

    @admin.action(description="Make selected users active")
    def make_active(self, request, queryset):
        updated = queryset.update(is_active=True)
        self.message_user(request, f"{updated} user(s) marked as active.")

    @admin.action(description="Make selected users inactive (passive)")
    def make_inactive(self, request, queryset):
        updated = queryset.update(is_active=False)
        self.message_user(request, f"{updated} user(s) marked as inactive.")

    def has_add_permission(self, request):
        return False

    def delete_model(self, request, obj):
        _cascade_delete_users(connection, [obj.id])

    def delete_queryset(self, request, queryset):
        _cascade_delete_users(connection, list(queryset.values_list("id", flat=True)))


def _cascade_delete_users(conn, user_ids):
    """Hard-delete users and all dependent records in FK dependency order."""
    if not user_ids:
        return
    ids = [str(u) for u in user_ids]
    ph = ",".join(["%s"] * len(ids))  # e.g. %s,%s,%s

    with conn.cursor() as cur:
        # ── Level 1: deepest leaf tables ──────────────────────────────────────
        # Via foods
        cur.execute(f"DELETE FROM allergen_disclosure_records WHERE food_id IN (SELECT id FROM foods WHERE seller_id IN ({ph}))", ids)
        cur.execute(f"DELETE FROM favorites WHERE food_id IN (SELECT id FROM foods WHERE seller_id IN ({ph}))", ids)
        cur.execute(f"DELETE FROM reviews WHERE food_id IN (SELECT id FROM foods WHERE seller_id IN ({ph}))", ids)
        # Via orders (seller side)
        cur.execute(f"DELETE FROM allergen_disclosure_records WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM delivery_proof_records WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM order_item_lot_allocations WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM order_notification_milestones WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM order_delivery_tracking WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM order_finance WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM finance_adjustments WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM payment_dispute_cases WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM payment_attempts WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM reviews WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        # Via chats (→ messages)
        cur.execute(f"DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        # Via complaints (→ notes)
        cur.execute(f"DELETE FROM complaint_admin_notes WHERE complaint_id IN (SELECT id FROM complaints WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph})))", ids + ids)

        # ── Level 2: tables referencing orders / chats ─────────────────────────
        cur.execute(f"DELETE FROM complaints WHERE order_id IN (SELECT id FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph}))", ids + ids)
        cur.execute(f"DELETE FROM chats WHERE seller_id IN ({ph}) OR buyer_id IN ({ph})", ids + ids)
        cur.execute(f"DELETE FROM lot_events WHERE lot_id IN (SELECT id FROM production_lots WHERE seller_id IN ({ph}))", ids)

        # ── Level 3: orders, production_lots ──────────────────────────────────
        cur.execute(f"DELETE FROM order_item_lot_allocations WHERE lot_id IN (SELECT id FROM production_lots WHERE seller_id IN ({ph}))", ids)
        cur.execute(f"DELETE FROM production_lots WHERE seller_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM orders WHERE seller_id IN ({ph}) OR buyer_id IN ({ph})", ids + ids)

        # ── Level 4: foods and seller/buyer direct refs ────────────────────────
        cur.execute(f"DELETE FROM seller_compliance_documents WHERE seller_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM seller_optional_uploads WHERE seller_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM seller_notes WHERE seller_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM seller_tags WHERE seller_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM foods WHERE seller_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM buyer_notes WHERE buyer_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM buyer_tags WHERE buyer_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM favorites WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM reviews WHERE buyer_id IN ({ph}) OR seller_id IN ({ph})", ids + ids)
        cur.execute(f"DELETE FROM sms_logs WHERE buyer_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM finance_adjustments WHERE seller_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM delivery_proof_records WHERE buyer_id IN ({ph}) OR seller_id IN ({ph})", ids + ids)
        cur.execute(f"DELETE FROM allergen_disclosure_records WHERE buyer_id IN ({ph}) OR seller_id IN ({ph})", ids + ids)
        cur.execute(f"DELETE FROM media_assets WHERE owner_user_id IN ({ph})", ids)

        # ── Level 5: auth / identity / session / device ───────────────────────
        cur.execute(f"DELETE FROM auth_audit WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM auth_sessions WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM user_addresses WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM user_device_tokens WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM user_login_locations WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM identities WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM long_term_memory WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM session_memory WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM mfa_factors WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM notification_events WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM oauth_authorizations WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM oauth_consents WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM one_time_tokens WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM sessions WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM webauthn_challenges WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM webauthn_credentials WHERE user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM order_events WHERE actor_user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM lot_events WHERE created_by IN ({ph})", ids)
        cur.execute(f"DELETE FROM order_delivery_tracking WHERE seller_user_id IN ({ph})", ids)
        cur.execute(f"DELETE FROM messages WHERE sender_id IN ({ph})", ids)

        # ── Final: users ───────────────────────────────────────────────────────
        cur.execute(f"DELETE FROM users WHERE id IN ({ph})", ids)


# ── Helper: get user's role from groups ──────────────────────────────────────

ROLE_GROUPS = ["Super Admin", "Admin", "User"]

def _get_user_role(user):
    """Return the role name based on group membership."""
    group_names = set(user.groups.values_list("name", flat=True))
    if "Super Admin" in group_names:
        return "super_admin"
    if "Admin" in group_names:
        return "admin"
    if "User" in group_names:
        return "user"
    if user.is_superuser:
        return "super_admin"
    if user.is_staff:
        return "admin"
    return "user"


def _set_user_role(user, role_name):
    """Set user's role by updating group membership and flags."""
    super_admin_grp, _ = Group.objects.get_or_create(name="Super Admin")
    admin_grp, _ = Group.objects.get_or_create(name="Admin")
    user_grp, _ = Group.objects.get_or_create(name="User")

    user.groups.remove(super_admin_grp, admin_grp, user_grp)

    if role_name == "super_admin":
        user.groups.add(super_admin_grp)
        user.is_superuser = True
        user.is_staff = True
    elif role_name == "admin":
        user.groups.add(admin_grp)
        user.is_superuser = False
        user.is_staff = True
    else:
        user.groups.add(user_grp)
        user.is_superuser = False
        user.is_staff = True  # still needs admin panel access
    user.save(update_fields=["is_superuser", "is_staff"])


# ── Django User Admin (replaces AdminUsers) ──────────────────────────────────

# Unregister default User and Group admin
admin.site.unregister(User)
admin.site.unregister(Group)


@admin.register(User)
class CoziyooUserAdmin(ModelAdmin):
    list_display = ["username", "email", "first_name", "last_name", "display_role", "is_active", "last_login", "date_joined"]
    list_filter = ["is_active", "groups"]
    search_fields = ["username", "email", "first_name", "last_name"]
    ordering = ["-date_joined"]
    filter_horizontal = ["groups"]

    def get_fieldsets(self, request, obj=None):
        if obj is None:
            return [
                (None, {"fields": ["username", "email", "first_name", "last_name", "password"]}),
                (_("Role"), {"fields": ["groups"]}),
            ]
        return [
            (None, {"fields": ["username", "email", "first_name", "last_name"]}),
            (_("Role"), {"fields": ["groups"]}),
            (_("Status"), {"fields": ["is_active", "last_login", "date_joined"]}),
        ]

    def get_readonly_fields(self, request, obj=None):
        if obj is None:
            return []
        return ["last_login", "date_joined"]

    @display(description=_("Role"))
    def display_role(self, obj):
        role = _get_user_role(obj)
        labels = {"super_admin": "Super Admin", "admin": "Admin", "user": "User"}
        colors = {"super_admin": "#9333ea", "admin": "#d97706", "user": "#6b7280"}
        color = colors.get(role, "#6b7280")
        return format_html(
            '<span style="background:{}18;color:{};border:1px solid {}40;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600">{}</span>',
            color, color, color, labels.get(role, role),
        )

    def save_model(self, request, obj, form, change):
        if not change:
            password = form.cleaned_data.get("password")
            if password:
                obj.set_password(password)
            obj.is_staff = True
        super().save_model(request, obj, form, change)

    # Permission definitions: (section_label, [(permission_key, display_label), ...])
    PERMISSION_SECTIONS = [
        (_("Users & Orders"), [
            ("view_buyers", _("View buyers")),
            ("view_sellers", _("View sellers")),
            ("view_all_users", _("View all users")),
            ("view_orders", _("View orders")),
            ("delete_users", _("Delete users")),
        ]),
        (_("Content"), [
            ("manage_foods", _("Manage foods")),
            ("manage_categories", _("Manage categories")),
            ("manage_production_lots", _("Manage production lots")),
            ("view_reviews", _("View reviews")),
        ]),
        (_("Support"), [
            ("manage_complaints", _("Manage complaints")),
            ("manage_compliance_docs", _("Manage compliance docs")),
            ("view_doc_types", _("View doc types")),
        ]),
        (_("Finance & Security"), [
            ("view_audit_logs", _("View audit logs")),
            ("view_login_events", _("View login events")),
            ("change_commission_rate", _("Change commission rate")),
            ("manage_api_tokens", _("Manage API tokens")),
        ]),
        (_("Administration"), [
            ("view_admin_users", _("View admin users")),
            ("add_admin_users", _("Add admin users")),
            ("change_admin_roles", _("Change admin roles")),
            ("deactivate_admins", _("Deactivate admins")),
        ]),
    ]

    EDITABLE_ROLES = ["admin", "user"]

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path(
                "permissions/",
                self.admin_site.admin_view(self.permissions_view),
                name="authentication_permissions",
            ),
            path(
                "permissions/change-role/",
                self.admin_site.admin_view(self.change_role_view),
                name="authentication_permissions_change_role",
            ),
            path(
                "permissions/toggle/",
                self.admin_site.admin_view(self.toggle_permission_view),
                name="authentication_permissions_toggle",
            ),
        ]
        return custom + urls

    def _get_permissions_lookup(self):
        """Build {(role, key): is_allowed} lookup from DB."""
        rows = RolePermissions.objects.filter(role__in=self.EDITABLE_ROLES)
        return {(r.role, r.permission_key): r.is_allowed for r in rows}

    def permissions_view(self, request):
        all_staff = list(User.objects.filter(is_staff=True).order_by("username"))
        total_admins = len(all_staff)
        super_admin_count = sum(1 for u in all_staff if _get_user_role(u) == "super_admin")
        admin_count = sum(1 for u in all_staff if _get_user_role(u) == "admin")
        user_count = sum(1 for u in all_staff if _get_user_role(u) == "user")
        inactive_count = sum(1 for u in all_staff if not u.is_active)

        # Annotate users with role
        admin_users = []
        for u in all_staff:
            u.role = _get_user_role(u)
            admin_users.append(u)

        lookup = self._get_permissions_lookup()

        permissions_matrix = []
        for section_label, perms in self.PERMISSION_SECTIONS:
            section_perms = []
            for key, label in perms:
                role_values = {}
                for role in self.EDITABLE_ROLES:
                    role_values[role] = lookup.get((role, key), False)
                section_perms.append((label, key, role_values))
            permissions_matrix.append((section_label, section_perms))

        perms_json = json.dumps({
            f"{role}:{key}": lookup.get((role, key), False)
            for _, perms in self.PERMISSION_SECTIONS
            for key, _ in perms
            for role in self.EDITABLE_ROLES
        })

        context = {
            **self.admin_site.each_context(request),
            "title": _("Permissions"),
            "admin_users": admin_users,
            "total_admins": total_admins,
            "super_admin_count": super_admin_count,
            "admin_count": admin_count,
            "user_count": user_count,
            "inactive_count": inactive_count,
            "permissions_matrix": permissions_matrix,
            "editable_roles": self.EDITABLE_ROLES,
            "perms_json": perms_json,
        }
        return TemplateResponse(request, "admin/authentication/permissions.html", context)

    def toggle_permission_view(self, request):
        """AJAX endpoint to toggle a single permission."""
        if request.method != "POST":
            return JsonResponse({"error": "POST required"}, status=405)

        try:
            data = json.loads(request.body)
            role = data.get("role")
            permission_key = data.get("permission_key")
        except (json.JSONDecodeError, AttributeError):
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        if role not in self.EDITABLE_ROLES:
            return JsonResponse({"error": "Invalid role"}, status=400)

        all_keys = [k for _, perms in self.PERMISSION_SECTIONS for k, _ in perms]
        if permission_key not in all_keys:
            return JsonResponse({"error": "Invalid permission key"}, status=400)

        try:
            from django.utils import timezone
            perm = RolePermissions.objects.get(role=role, permission_key=permission_key)
            perm.is_allowed = not perm.is_allowed
            perm.updated_at = timezone.now()
            perm.save(update_fields=["is_allowed", "updated_at"])
            new_value = perm.is_allowed
        except RolePermissions.DoesNotExist:
            import uuid
            from django.utils import timezone
            RolePermissions.objects.create(
                id=uuid.uuid4(),
                role=role,
                permission_key=permission_key,
                is_allowed=True,
                created_at=timezone.now(),
                updated_at=timezone.now(),
            )
            new_value = True

        return JsonResponse({"ok": True, "is_allowed": new_value})

    def change_role_view(self, request):
        if request.method != "POST":
            return redirect("admin:authentication_permissions")

        user_id = request.POST.get("admin_id")
        new_role = request.POST.get("new_role")

        if new_role not in ("user", "admin", "super_admin"):
            messages.error(request, _("Invalid role."))
            return redirect("admin:authentication_permissions")

        try:
            target_user = User.objects.get(pk=user_id)
            old_role = _get_user_role(target_user)
            if old_role != new_role:
                _set_user_role(target_user, new_role)
                messages.success(
                    request,
                    _(f"Role for {target_user.username} changed from {old_role} to {new_role}."),
                )
            else:
                messages.info(request, _(f"{target_user.username} already has role: {new_role}."))
        except User.DoesNotExist:
            messages.error(request, _("User not found."))

        return redirect("admin:authentication_permissions")


@admin.register(AdminSalesCommissionSettings)
class AdminSalesCommissionSettingsAdmin(ModelAdmin):
    list_display = ["commission_rate_percent", "created_by_admin", "created_at"]
    readonly_fields = ["id", "created_at", "created_by_admin"]
    ordering = ["-created_at"]

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AdminAuditLogs)
class AdminAuditLogsAdmin(ModelAdmin):
    list_display = ["actor_email", "actor_role", "action", "entity_type", "entity_id", "created_at"]
    list_filter = ["action", "entity_type", "actor_role"]
    search_fields = ["actor_email", "entity_id", "action"]
    readonly_fields = [
        "id", "actor_admin", "actor_email", "actor_role", "action",
        "entity_type", "entity_id", "before_json", "after_json", "created_at",
    ]
    ordering = ["-created_at"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SecurityLoginEvents)
class SecurityLoginEventsAdmin(ModelAdmin):
    list_display = ["identifier", "realm", "success_badge", "failure_reason", "ip", "created_at"]
    list_filter = ["realm", "success"]
    search_fields = ["identifier", "ip"]
    readonly_fields = ["id", "created_at"]
    ordering = ["-created_at"]

    @display(description="Result", ordering="success")
    def success_badge(self, obj):
        if obj.success:
            return format_html('<span style="color:#16a34a;font-weight:600">&#10003; OK</span>')
        return format_html('<span style="color:#dc2626;font-weight:600">&#10007; Fail</span>')

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AdminApiTokens)
class AdminApiTokensAdmin(ModelAdmin):
    list_display = ["label", "role", "token_preview", "created_by_admin", "revoked_at", "created_at"]
    list_filter = ["role"]
    search_fields = ["label", "token_preview"]
    readonly_fields = ["id", "session_id", "token_hash", "token_preview", "created_by_admin", "created_at"]
    ordering = ["-created_at"]
