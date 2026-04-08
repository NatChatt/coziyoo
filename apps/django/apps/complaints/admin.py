from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display

from .models import Complaints, ComplaintCategories, ComplaintAdminNotes


class ComplaintAdminNotesInline(TabularInline):
    model = ComplaintAdminNotes
    extra = 0
    readonly_fields = ["created_by_admin", "note", "created_at"]
    fields = ["note", "created_by_admin", "created_at"]
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(ComplaintCategories)
class ComplaintCategoriesAdmin(ModelAdmin):
    list_display = ["name", "code", "is_active", "created_at"]
    list_filter = ["is_active"]
    search_fields = ["name", "code"]
    readonly_fields = ["id", "created_at"]

    def has_add_permission(self, request):
        return False


@admin.register(Complaints)
class ComplaintsAdmin(ModelAdmin):
    list_display = [
        "ticket_no", "complainant_user", "category", "status_badge",
        "priority_badge", "assigned_admin", "created_at",
    ]
    list_select_related = ["complainant_user", "category", "assigned_admin"]
    list_filter = ["status", "priority", "category"]
    search_fields = ["complainant_user__email", "description"]
    readonly_fields = [
        "id", "order", "complainant_user", "complainant_buyer",
        "complainant_type", "ticket_no", "created_at", "resolved_at",
    ]
    ordering = ["-created_at"]
    inlines = [ComplaintAdminNotesInline]
    list_per_page = 50

    def has_add_permission(self, request):
        return False

    fieldsets = [
        ("Ticket", {"fields": ["id", "ticket_no", "status", "priority", "category"]}),
        ("Complainant", {"fields": ["complainant_user", "complainant_type", "order"]}),
        ("Content", {"fields": ["description", "resolution_note"]}),
        ("Assignment", {"fields": ["assigned_admin"]}),
        ("Meta", {"fields": ["created_at", "resolved_at"]}),
    ]

    @display(description="Status", ordering="status")
    def status_badge(self, obj):
        colors = {
            "open": "#2563eb", "in_review": "#d97706",
            "resolved": "#16a34a", "closed": "#6b7280",
        }
        color = colors.get(obj.status, "#6b7280")
        return format_html(
            '<span style="color:{};font-weight:600">{}</span>',
            color, obj.status,
        )

    @display(description="Priority", ordering="priority")
    def priority_badge(self, obj):
        colors = {
            "low": "#6b7280", "medium": "#d97706",
            "high": "#dc2626", "urgent": "#7c3aed",
        }
        color = colors.get(obj.priority, "#6b7280")
        return format_html(
            '<span style="color:{};font-weight:600">{}</span>',
            color, obj.priority,
        )
