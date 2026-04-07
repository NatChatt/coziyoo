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
        "image_count", "menu_item_count", "rating", "review_count", "created_at",
    ]
    list_filter = ["is_active", "category"]
    search_fields = ["name", "seller__display_name", "seller__email"]
    readonly_fields = [
        "id", "seller", "rating", "review_count", "favorite_count",
        "created_at", "updated_at", "image_count", "menu_item_count",
    ]
    ordering = ["-created_at"]
    list_per_page = 50

    fieldsets = [
        ("Food", {"fields": ["id", "name", "seller", "category", "price", "is_active"]}),
        ("Details", {"fields": ["card_summary", "description", "recipe", "serving_size",
                                "preparation_time_minutes", "image_url", "image_urls_json", "image_count"]}),
        ("Menu", {"fields": ["menu_items_json", "menu_item_count", "secondary_category_ids_json"], "classes": ["collapse"]}),
        ("Nutritional", {"fields": ["ingredients_json", "allergens_json"], "classes": ["collapse"]}),
        ("Stats", {"fields": ["rating", "review_count", "favorite_count"]}),
        ("Meta", {"fields": ["created_at", "updated_at"]}),
    ]

    @display(description="Images")
    def image_count(self, obj):
        image_urls = obj.image_urls_json if isinstance(obj.image_urls_json, list) else []
        count = len([item for item in image_urls if str(item).strip()])
        if obj.image_url:
            count = max(count, 1)
        return count

    @display(description="Menu")
    def menu_item_count(self, obj):
        items = obj.menu_items_json if isinstance(obj.menu_items_json, list) else []
        return len(items)


@admin.register(ProductionLots)
class ProductionLotsAdmin(ModelAdmin):
    list_display = [
        "lot_number", "seller", "food_id", "status_badge", "quantity_produced",
        "quantity_available", "produced_at", "sale_window", "use_by",
    ]
    list_filter = ["status"]
    search_fields = ["lot_number", "seller__display_name"]
    readonly_fields = [
        "id", "seller", "food_id", "lot_number", "created_at", "updated_at",
        "sale_starts_at", "sale_ends_at", "recipe_snapshot",
        "ingredients_snapshot_json", "allergens_snapshot_json", "sale_window",
    ]
    ordering = ["-produced_at"]
    fieldsets = [
        ("Lot", {"fields": ["id", "seller", "food_id", "lot_number", "status"]}),
        ("Quantities", {"fields": ["quantity_produced", "quantity_available"]}),
        ("Timeline", {"fields": ["produced_at", "sale_starts_at", "sale_ends_at", "use_by", "best_before", "sale_window"]}),
        ("Snapshot", {"fields": ["recipe_snapshot", "ingredients_snapshot_json", "allergens_snapshot_json"], "classes": ["collapse"]}),
        ("Meta", {"fields": ["notes", "created_at", "updated_at"]}),
    ]

    @display(description="Status", ordering="status")
    def status_badge(self, obj):
        colors = {
            "open": "#16a34a",
            "active": "#16a34a", "exhausted": "#6b7280",
            "locked": "#d97706",
            "depleted": "#6b7280",
            "discarded": "#991b1b",
            "expired": "#dc2626", "recalled": "#dc2626",
        }
        color = colors.get(obj.status, "#6b7280")
        return format_html(
            '<span style="color:{};font-weight:600">{}</span>',
            color, obj.status,
        )

    @display(description="Sale Window")
    def sale_window(self, obj):
        start = obj.sale_starts_at.strftime("%d.%m.%Y %H:%M") if obj.sale_starts_at else "—"
        end = obj.sale_ends_at.strftime("%d.%m.%Y %H:%M") if obj.sale_ends_at else "—"
        return f"{start} → {end}"
