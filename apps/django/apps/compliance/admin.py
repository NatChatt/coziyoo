from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display

from .models import ComplianceDocumentsList, SellerComplianceDocuments


class SellerDocsInline(TabularInline):
    model = SellerComplianceDocuments
    extra = 0
    can_delete = False
    readonly_fields = [
        "seller", "is_required", "status", "file_url",
        "uploaded_at", "reviewed_by_admin", "reviewed_at",
        "rejection_reason", "version", "is_current",
    ]
    fields = ["seller", "status", "is_required", "file_url", "reviewed_at", "rejection_reason"]

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(ComplianceDocumentsList)
class ComplianceDocumentsListAdmin(ModelAdmin):
    list_display = ["name", "code", "is_required_default", "is_active", "validity_years", "created_at"]
    list_filter = ["is_active", "is_required_default"]
    search_fields = ["name", "code"]
    readonly_fields = ["id", "created_at", "updated_at"]
    ordering = ["name"]
    inlines = [SellerDocsInline]


@admin.register(SellerComplianceDocuments)
class SellerComplianceDocumentsAdmin(ModelAdmin):
    list_display = [
        "seller", "document_list", "status_badge", "is_required",
        "is_current", "uploaded_at", "reviewed_by_admin",
    ]
    list_select_related = ["seller", "document_list", "reviewed_by_admin"]
    list_filter = ["status", "is_required", "is_current"]
    search_fields = ["seller__email", "seller__display_name", "document_list__name"]
    readonly_fields = [
        "id", "seller", "document_list", "uploaded_at",
        "created_at", "updated_at", "version",
    ]
    ordering = ["-created_at"]
    list_per_page = 50

    fieldsets = [
        ("Document", {"fields": ["id", "seller", "document_list", "is_required", "version", "is_current"]}),
        ("Status", {"fields": ["status", "file_url", "uploaded_at"]}),
        ("Review", {"fields": ["reviewed_by_admin", "reviewed_at", "rejection_reason", "notes"]}),
        ("Meta", {"fields": ["created_at", "updated_at"]}),
    ]

    @display(description="Status", ordering="status")
    def status_badge(self, obj):
        colors = {
            "pending": "#d97706", "approved": "#16a34a",
            "rejected": "#dc2626", "expired": "#6b7280",
        }
        color = colors.get(obj.status, "#6b7280")
        return format_html(
            '<span style="color:{};font-weight:600">{}</span>',
            color, obj.status,
        )
