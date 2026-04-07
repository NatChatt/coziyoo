import json
from django.contrib import admin
from django.db import connection
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path
from django.utils.html import format_html
from unfold.admin import ModelAdmin
from unfold.decorators import display

from .models import (
    Users, AdminUsers, AdminSalesCommissionSettings,
    AdminAuditLogs, SecurityLoginEvents, AdminApiTokens,
)


@admin.register(Users)
class UsersAdmin(ModelAdmin):
    list_display = [
        "display_name_link", "email", "user_type_badge", "is_active",
        "seller_status_badge", "created_at",
    ]
    list_display_links = None
    list_filter = ["user_type", "is_active", "seller_profile_status"]
    search_fields = ["email", "display_name", "username", "phone"]
    readonly_fields = [
        "id", "password_hash", "created_at", "updated_at",
        "username_normalized", "display_name_normalized",
    ]
    ordering = ["-created_at"]
    list_per_page = 50

    fieldsets = [
        ("Identity", {"fields": ["id", "email", "display_name", "full_name", "username", "phone"]}),
        ("Account", {"fields": ["user_type", "is_active", "legal_hold_state", "seller_profile_status", "profile_image_url"]}),
        ("Seller Info", {
            "fields": ["kitchen_title", "kitchen_description", "delivery_radius_km",
                       "delivery_enabled", "delivery_terms"],
            "classes": ["collapse"],
        }),
        ("Meta", {"fields": ["created_at", "updated_at"]}),
    ]

    def get_urls(self):
        urls = super().get_urls()
        custom = [
            path("<uuid:user_id>/buyer-detail/", self.admin_site.admin_view(self.buyer_detail_view), name="authentication_users_buyer_detail"),
            path("<uuid:user_id>/seller-detail/", self.admin_site.admin_view(self.seller_detail_view), name="authentication_users_seller_detail"),
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
            orders = [{"id": str(r[0]), "seller_name": r[1], "total_price": r[2], "status": r[3], "created_at": r[4]} for r in cur.fetchall()]

            # Recent complaints
            cur.execute("""
                SELECT id, description, status, created_at FROM complaints
                WHERE COALESCE(complainant_user_id, complainant_buyer_id) = %s
                ORDER BY created_at DESC LIMIT 20
            """, [user_id])
            complaints = [{"id": str(r[0]), "description": r[1], "status": r[2], "created_at": r[3]} for r in cur.fetchall()]

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
            payments = [{"id": str(r[0]), "provider": r[1], "status": r[2], "created_at": r[3],
                         "amount": r[4], "order_id": str(r[5])} for r in cur.fetchall()]

            # Activity: auth sessions + presence events merged by time
            cur.execute("""
                SELECT 'login' AS event_type, ip, device_info AS detail, created_at
                FROM auth_sessions WHERE user_id = %s
                ORDER BY created_at DESC LIMIT 30
            """, [user_id])
            sessions = [{"event_type": r[0], "ip": r[1], "detail": r[2], "happened_at": r[3]} for r in cur.fetchall()]

            cur.execute("""
                SELECT event_type, ip, user_agent AS detail, happened_at
                FROM user_presence_events
                WHERE subject_type = 'user' AND subject_id = %s
                ORDER BY happened_at DESC LIMIT 30
            """, [user_id])
            presence = [{"event_type": r[0], "ip": r[1], "detail": r[2], "happened_at": r[3]} for r in cur.fetchall()]

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

        overview_rows = [
            {"label": "Siparişler", "tab_id": "orders", "count": summary["total_orders"], "last_activity": summary["last_order_at"].strftime("%d.%m.%Y") if summary["last_order_at"] else None},
            {"label": "Ödemeler", "tab_id": "payments", "count": summary["payment_count"], "last_activity": None},
            {"label": "Şikayetler", "tab_id": "complaints", "count": summary["complaint_total"], "last_activity": summary["last_complaint_at"].strftime("%d.%m.%Y") if summary["last_complaint_at"] else None},
            {"label": "Yorumlar & Puanlar", "tab_id": "reviews", "count": summary["review_count"], "last_activity": None},
            {"label": "Aktivite Logu", "tab_id": "activity", "count": len(activity), "last_activity": None},
            {"label": "Notlar & Etiketler", "tab_id": "notes", "count": summary["notes_count"], "last_activity": None},
            {"label": "Ham Veri", "tab_id": "raw", "count": None, "last_activity": None},
        ]

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
            "overview_rows": overview_rows,
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

            # Complaint stats (via orders)
            cur.execute("""
                SELECT count(*)::int, count(*) FILTER (WHERE c.status IN ('open','in_review'))::int
                FROM complaints c JOIN orders o ON o.id = c.order_id WHERE o.seller_id = %s
            """, [user_id])
            crow = cur.fetchone()

            # Foods count
            cur.execute("SELECT count(*)::int FROM foods WHERE seller_id = %s", [user_id])
            foods_count = cur.fetchone()[0]

            # Review stats
            cur.execute("""
                SELECT count(*)::int, COALESCE(avg(r.rating), 0)::numeric(3,2)
                FROM reviews r JOIN foods f ON f.id = r.food_id WHERE f.seller_id = %s
            """, [user_id])
            rrow = cur.fetchone()

            # Compliance docs
            cur.execute("""
                SELECT cdl.name, scd.status, scd.uploaded_at
                FROM seller_compliance_documents scd
                JOIN compliance_documents_list cdl ON cdl.id = scd.document_list_id
                WHERE scd.seller_id = %s ORDER BY cdl.name
            """, [user_id])
            compliance_docs = [{"name": r[0], "status": r[1], "uploaded_at": r[2]} for r in cur.fetchall()]

            # Recent orders
            cur.execute("""
                SELECT o.id, u.display_name AS buyer_name, o.total_price, o.status, o.created_at
                FROM orders o LEFT JOIN users u ON u.id = o.buyer_id
                WHERE o.seller_id = %s ORDER BY o.created_at DESC LIMIT 10
            """, [user_id])
            orders = [{"id": str(r[0]), "buyer_name": r[1], "total_price": r[2], "status": r[3], "created_at": r[4]} for r in cur.fetchall()]

            # Recent reviews
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

            # Recent complaints (via orders)
            cur.execute("""
                SELECT c.id, c.description, c.status, c.created_at
                FROM complaints c JOIN orders o ON o.id = c.order_id
                WHERE o.seller_id = %s ORDER BY c.created_at DESC LIMIT 10
            """, [user_id])
            complaints = [{"id": str(r[0]), "description": r[1], "status": r[2], "created_at": r[3]} for r in cur.fetchall()]

            # Foods list
            cur.execute("""
                SELECT f.id, f.name, f.price, f.is_active, c.name_tr AS category_name
                FROM foods f LEFT JOIN categories c ON c.id = f.category_id
                WHERE f.seller_id = %s ORDER BY f.name LIMIT 20
            """, [user_id])
            foods = [{"id": str(r[0]), "name": r[1], "price": r[2], "is_active": r[3], "category_name": r[4]} for r in cur.fetchall()]

            # Address
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

        tabs = [
            ("general", "General"), ("foods", "Foods"), ("orders", "Orders & Earnings"),
            ("wallet", "Wallet & Transactions"), ("compliance", "Compliance"),
            ("location", "Location & Security"), ("reviews", "Reviews"),
            ("complaints", "Complaints"), ("notes", "Notes & Tags"), ("raw", "Raw Data"),
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
            "address": address,
            "raw_json": json.dumps(raw_data, indent=2, default=str),
            "opts": self.model._meta,
        }
        return TemplateResponse(request, "admin/authentication/seller_detail.html", context)

    @display(description="Name", ordering="display_name")
    def display_name_link(self, obj):
        from django.urls import reverse
        if obj.user_type == "seller":
            url = reverse("admin:authentication_users_seller_detail", args=[obj.id])
        elif obj.user_type in ("buyer", "both"):
            url = reverse("admin:authentication_users_buyer_detail", args=[obj.id])
        else:
            return obj.display_name
        return format_html('<a href="{}" class="text-primary-600 hover:underline font-medium">{}</a>', url, obj.display_name)

    @display(description="Type", ordering="user_type")
    def user_type_badge(self, obj):
        colors = {"buyer": "#2563eb", "seller": "#16a34a", "both": "#7c3aed"}
        color = colors.get(obj.user_type, "#6b7280")
        return format_html(
            '<span style="background:{};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">{}</span>',
            color, obj.user_type,
        )

    @display(description="Seller Status", ordering="seller_profile_status")
    def seller_status_badge(self, obj):
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


@admin.register(AdminUsers)
class AdminUsersAdmin(ModelAdmin):
    list_display = ["email", "role", "is_active", "last_login_at", "created_at"]
    list_filter = ["role", "is_active"]
    search_fields = ["email"]
    readonly_fields = ["id", "password_hash", "created_at", "updated_at"]
    ordering = ["-created_at"]


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
