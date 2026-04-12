from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display

from .models import Orders, OrderItems, OrderEvents, Reviews


class OrderItemsInline(TabularInline):
    model = OrderItems
    extra = 0
    can_delete = False
    readonly_fields = ["id", "food_id", "quantity", "unit_price", "line_total", "created_at"]
    fields = ["food_id", "quantity", "unit_price", "line_total"]

    def has_add_permission(self, request, obj=None):
        return False


class OrderEventsInline(TabularInline):
    model = OrderEvents
    extra = 0
    can_delete = False
    readonly_fields = ["event_type", "actor_user", "from_status", "to_status", "payload_json", "created_at"]
    fields = ["event_type", "from_status", "to_status", "actor_user", "created_at"]

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Orders)
class OrdersAdmin(ModelAdmin):
    list_display = [
        "full_order_id", "status_badge", "buyer", "seller",
        "total_price", "delivery_type", "payment_completed", "created_at",
    ]
    list_select_related = ["buyer", "seller"]
    list_filter = ["status", "delivery_type", "payment_completed", "seller_decision_state"]
    search_fields = ["buyer__email", "buyer__display_name", "seller__display_name"]
    readonly_fields = [
        "id", "buyer", "seller", "status", "total_price", "delivery_type",
        "payment_completed", "requested_delivery_type", "active_delivery_type",
        "seller_decision_state", "seller_eta_minutes", "seller_promised_at",
        "seller_delivery_note", "approved_at", "payment_captured_at",
        "created_at", "updated_at",
    ]
    ordering = ["-created_at"]
    inlines = [OrderItemsInline, OrderEventsInline]
    list_per_page = 50

    fieldsets = [
        ("Order", {"fields": ["id", "status", "buyer", "seller", "total_price"]}),
        ("Delivery", {"fields": ["delivery_type", "requested_delivery_type", "active_delivery_type",
                                 "seller_delivery_note", "seller_eta_minutes", "seller_promised_at"]}),
        ("Payment", {"fields": ["payment_completed", "payment_captured_at", "approved_at"]}),
        ("State", {"fields": ["seller_decision_state"]}),
        ("Meta", {"fields": ["created_at", "updated_at"]}),
    ]

    def has_add_permission(self, request):
        return False

    @display(description="Sipariş No", ordering="id")
    def full_order_id(self, obj):
        return str(obj.id)

    @display(description="Status", ordering="status")
    def status_badge(self, obj):
        colors = {
            "pending": "#d97706", "preparing": "#2563eb", "ready": "#7c3aed",
            "in_delivery": "#0891b2", "delivered": "#16a34a",
            "completed": "#16a34a", "cancelled": "#dc2626",
        }
        color = colors.get(obj.status, "#6b7280")
        return format_html(
            '<span style="color:{};font-weight:600">{}</span>',
            color, obj.status,
        )


@admin.register(Reviews)
class ReviewsAdmin(ModelAdmin):
    list_display = ["buyer", "seller", "food", "rating_stars", "created_at"]
    list_select_related = ["buyer", "seller", "food"]
    list_filter = ["rating"]
    search_fields = ["buyer__email", "seller__display_name", "food__name"]
    readonly_fields = ["id", "buyer", "seller", "food", "order", "rating",
                       "comment", "helpful_count", "report_count", "created_at"]
    ordering = ["-created_at"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @display(description="Rating")
    def rating_stars(self, obj):
        stars = "★" * obj.rating + "☆" * (5 - obj.rating)
        return format_html('<span style="color:#d97706">{}</span>', stars)
