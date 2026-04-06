from django.contrib import admin
from django.utils.html import format_html
from unfold.admin import ModelAdmin
from unfold.decorators import display

from .models import Foods, Categories, ProductionLots


@admin.register(Categories)
class CategoriesAdmin(ModelAdmin):
    list_display = ["name_tr", "name_en", "sort_order", "is_active"]
    list_filter = ["is_active"]
    search_fields = ["name_tr", "name_en"]
    readonly_fields = ["id", "created_at", "updated_at"]
    ordering = ["sort_order", "name_tr"]


@admin.register(Foods)
class FoodsAdmin(ModelAdmin):
    list_display = [
        "name", "seller", "category", "price", "is_active",
        "rating", "review_count", "created_at",
    ]
    list_filter = ["is_active", "category"]
    search_fields = ["name", "seller__display_name", "seller__email"]
    readonly_fields = [
        "id", "seller", "rating", "review_count", "favorite_count",
        "created_at", "updated_at",
    ]
    ordering = ["-created_at"]
    list_per_page = 50

    fieldsets = [
        ("Food", {"fields": ["id", "name", "seller", "category", "price", "is_active"]}),
        ("Details", {"fields": ["card_summary", "description", "recipe", "serving_size",
                                "preparation_time_minutes", "image_url"]}),
        ("Nutritional", {"fields": ["ingredients_json", "allergens_json"], "classes": ["collapse"]}),
        ("Stats", {"fields": ["rating", "review_count", "favorite_count"]}),
        ("Meta", {"fields": ["created_at", "updated_at"]}),
    ]


@admin.register(ProductionLots)
class ProductionLotsAdmin(ModelAdmin):
    list_display = [
        "lot_number", "seller", "status_badge", "quantity_produced",
        "quantity_available", "produced_at", "use_by",
    ]
    list_filter = ["status"]
    search_fields = ["lot_number", "seller__display_name"]
    readonly_fields = ["id", "seller", "lot_number", "created_at"]
    ordering = ["-produced_at"]

    @display(description="Status", ordering="status")
    def status_badge(self, obj):
        colors = {
            "active": "#16a34a", "exhausted": "#6b7280",
            "expired": "#dc2626", "recalled": "#dc2626",
        }
        color = colors.get(obj.status, "#6b7280")
        return format_html(
            '<span style="color:{};font-weight:600">{}</span>',
            color, obj.status,
        )
