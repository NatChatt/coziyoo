from django.contrib import admin
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
        "seller_status_badge", "created_at",
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
