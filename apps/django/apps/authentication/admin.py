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
        "display_name", "email", "user_type_badge", "is_active",
        "seller_status_badge", "created_at", "buyer_detail_link",
    ]
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

            # Recent orders
            cur.execute("""
                SELECT o.id, u.display_name AS seller_name, o.total_price, o.status, o.created_at
                FROM orders o LEFT JOIN users u ON u.id = o.seller_id
                WHERE o.buyer_id = %s ORDER BY o.created_at DESC LIMIT 10
            """, [user_id])
            orders = [{"id": str(r[0]), "seller_name": r[1], "total_price": r[2], "status": r[3], "created_at": r[4]} for r in cur.fetchall()]

            # Recent complaints
            cur.execute("""
                SELECT id, description, status, created_at FROM complaints
                WHERE COALESCE(complainant_user_id, complainant_buyer_id) = %s
                ORDER BY created_at DESC LIMIT 10
            """, [user_id])
            complaints = [{"id": str(r[0]), "subject": r[1], "status": r[2], "created_at": r[3]} for r in cur.fetchall()]

            # Recent reviews
            cur.execute("""
                SELECT r.id, f.name AS food_name, r.rating, r.comment, r.created_at
                FROM reviews r LEFT JOIN foods f ON f.id = r.food_id
                WHERE r.buyer_id = %s ORDER BY r.created_at DESC LIMIT 10
            """, [user_id])
            reviews = [{"id": str(r[0]), "food_name": r[1], "stars": "★" * r[2] + "☆" * (5 - r[2]), "comment": r[3], "created_at": r[4]} for r in cur.fetchall()]

        summary = {
            "total_orders": orow[0] or 0,
            "total_spent": orow[1] or 0,
            "monthly_spent": orow[2] or 0,
            "last_order_at": orow[3],
            "complaint_total": crow[0] or 0,
            "complaint_unresolved": crow[1] or 0,
            "last_complaint_at": crow[2],
            "review_count": review_count,
        }

        overview_rows = [
            {"label": "Siparişler", "tab_id": "orders", "count": summary["total_orders"], "last_activity": summary["last_order_at"].strftime("%d.%m.%Y") if summary["last_order_at"] else None},
            {"label": "Ödemeler", "tab_id": "payments", "count": summary["total_orders"], "last_activity": summary["last_order_at"].strftime("%d.%m.%Y") if summary["last_order_at"] else None},
            {"label": "Şikayetler", "tab_id": "complaints", "count": summary["complaint_total"], "last_activity": summary["last_complaint_at"].strftime("%d.%m.%Y") if summary["last_complaint_at"] else None},
            {"label": "Yorumlar & Puanlar", "tab_id": "reviews", "count": summary["review_count"], "last_activity": None},
            {"label": "Aktivite Logu", "tab_id": "activity", "count": 0, "last_activity": None},
            {"label": "Notlar & Etiketler", "tab_id": "notes", "count": 0, "last_activity": None},
            {"label": "Ham Veri", "tab_id": "raw", "count": 10, "last_activity": None},
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
            "raw_json": json.dumps(raw_data, indent=2, default=str),
            "opts": self.model._meta,
        }
        return TemplateResponse(request, "admin/authentication/buyer_detail.html", context)

    @display(description="Detail", label=True)
    def buyer_detail_link(self, obj):
        if obj.user_type in ("buyer", "both"):
            from django.urls import reverse
            url = reverse("admin:authentication_users_buyer_detail", args=[obj.id])
            return format_html('<a href="{}" class="text-primary-600 hover:underline text-sm">Detail →</a>', url)
        return "—"

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
