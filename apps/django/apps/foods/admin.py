import difflib
import json

from django.contrib import admin
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path
from django.utils.html import format_html
from unfold.admin import ModelAdmin
from unfold.decorators import display

from .models import AddonTemplates, Foods, Categories, IngredientTemplates, ProductionLots

_LOT_STATUS_STYLE = {
    "open":      "background:#dcfce7;color:#166534;border:1px solid #86efac",
    "active":    "background:#dcfce7;color:#166534;border:1px solid #86efac",
    "locked":    "background:#fef3c7;color:#92400e;border:1px solid #fcd34d",
    "depleted":  "background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0",
    "exhausted": "background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0",
    "discarded": "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5",
    "expired":   "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5",
    "recalled":  "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5",
}


def _fmt(dt):
    return dt.strftime("%d.%m.%Y %H:%M") if dt else None


def _normalize_text_list(value):
    if value in (None, ""):
        return []
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    return [str(x).strip() for x in parsed if str(x).strip()]
            except Exception:
                pass
        return [item.strip() for item in raw.split(",") if item.strip()]
    return [str(value).strip()] if str(value).strip() else []


def _ingredients_diff(original, snapshot):
    """Return list of {text, type} where type is 'same'|'added'|'removed'."""
    orig = _normalize_text_list(original)
    snap = _normalize_text_list(snapshot)
    orig_lower = {x.lower(): x for x in orig}
    snap_lower = {x.lower(): x for x in snap}
    seen = set()
    result = []
    for item in orig + snap:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        in_orig = key in orig_lower
        in_snap = key in snap_lower
        if in_orig and in_snap:
            result.append({"text": orig_lower[key], "type": "same"})
        elif in_snap:
            result.append({"text": snap_lower[key], "type": "added"})
        else:
            result.append({"text": orig_lower[key], "type": "removed"})
    return result


def _recipe_diff(original, snapshot):
    """Return list of {line, type} where type is 'same'|'added'|'removed'."""
    orig_lines = (original or "").splitlines()
    snap_lines = (snapshot or "").splitlines()
    if not orig_lines and not snap_lines:
        return []
    result = []
    for entry in difflib.ndiff(orig_lines, snap_lines):
        if entry.startswith("+ "):
            result.append({"line": entry[2:], "type": "added"})
        elif entry.startswith("- "):
            result.append({"line": entry[2:], "type": "removed"})
        elif entry.startswith("  "):
            result.append({"line": entry[2:], "type": "same"})
        # skip '? ' hint lines
    return result


@admin.register(IngredientTemplates)
class IngredientTemplatesAdmin(ModelAdmin):
    list_display = ["name", "name_en", "sort_order", "is_active"]
    list_filter = ["is_active"]
    search_fields = ["name", "name_en"]
    list_editable = ["name_en", "sort_order", "is_active"]
    ordering = ["sort_order", "name"]
    readonly_fields = ["id", "created_at", "updated_at"]
    fieldsets = [
        (None, {"fields": ["name", "name_en", "sort_order", "is_active"]}),
        ("Meta", {"fields": ["id", "created_at", "updated_at"]}),
    ]


@admin.register(AddonTemplates)
class AddonTemplatesAdmin(ModelAdmin):
    list_display = ["name", "kind", "pricing", "default_price", "sort_order", "is_active"]
    list_filter = ["kind", "pricing", "is_active"]
    search_fields = ["name"]
    list_editable = ["sort_order", "is_active"]
    ordering = ["sort_order", "name"]
    readonly_fields = ["id", "created_at", "updated_at"]
    fieldsets = [
        (None, {"fields": ["name", "kind", "pricing", "default_price", "sort_order", "is_active"]}),
        ("Meta", {"fields": ["id", "created_at", "updated_at"]}),
    ]


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
        "food_name_link", "seller", "category", "price", "is_active",
        "image_count", "menu_item_count", "rating", "review_count", "created_at",
    ]
    list_select_related = ["seller", "category"]
    list_filter = ["is_active", "category"]
    search_fields = ["name", "seller__display_name", "seller__email"]
    readonly_fields = [
        "id", "seller", "rating", "review_count", "favorite_count",
        "created_at", "updated_at", "image_count", "menu_item_count",
    ]
    ordering = ["-created_at"]
    list_per_page = 50

    def has_add_permission(self, request):
        return False

    def get_urls(self):
        urls = super().get_urls()
        extra = [
            path(
                "<uuid:food_id>/detail/",
                self.admin_site.admin_view(self.food_detail_view),
                name="menu_foods_food_detail",
            ),
        ]
        return extra + urls

    def food_detail_view(self, request, food_id):
        food = get_object_or_404(
            Foods.objects.select_related("seller", "category"), pk=food_id
        )
        lots = list(ProductionLots.objects.filter(food_id=food_id).order_by("-produced_at"))

        lots_json = json.dumps([
            {
                "id": str(lot.id),
                "lot_number": lot.lot_number,
                "food_name": food.name,
                "status": lot.status,
                "status_style": _LOT_STATUS_STYLE.get(lot.status, "background:#f1f5f9;color:#64748b"),
                "qty_produced": lot.quantity_produced,
                "qty_available": lot.quantity_available,
                "produced_at": _fmt(lot.produced_at),
                "sale_starts_at": _fmt(lot.sale_starts_at),
                "sale_ends_at": _fmt(lot.sale_ends_at),
                "use_by": _fmt(lot.use_by),
                "best_before": _fmt(lot.best_before),
                "recipe_snapshot": lot.recipe_snapshot or "",
                "ingredients": _normalize_text_list(lot.ingredients_snapshot_json) or _normalize_text_list(food.ingredients_json),
                "allergens": _normalize_text_list(lot.allergens_snapshot_json) or _normalize_text_list(food.allergens_json),
                "notes": lot.notes or "",
                "ingredients_diff": _ingredients_diff(
                    food.ingredients_json, lot.ingredients_snapshot_json
                ),
                "recipe_diff": _recipe_diff(
                    food.recipe, lot.recipe_snapshot
                ),
            }
            for lot in lots
        ], ensure_ascii=False)

        context = {
            **self.admin_site.each_context(request),
            "food": food,
            "lots": lots,
            "lots_json": lots_json,
            "page_title": food.name,
            "title": food.name,
        }
        return TemplateResponse(request, "admin/menu/foods/food_detail.html", context)

    fieldsets = [
        ("Food", {"fields": ["id", "name", "seller", "category", "price", "is_active"]}),
        ("Details", {"fields": ["card_summary", "description", "recipe", "serving_size",
                                "preparation_time_minutes", "image_url", "image_urls_json", "image_count"]}),
        ("Menu", {"fields": ["menu_items_json", "menu_item_count", "secondary_category_ids_json"], "classes": ["collapse"]}),
        ("Nutritional", {"fields": ["ingredients_json", "allergens_json"], "classes": ["collapse"]}),
        ("Stats", {"fields": ["rating", "review_count", "favorite_count"]}),
        ("Meta", {"fields": ["created_at", "updated_at"]}),
    ]

    @display(description="Ad")
    def food_name_link(self, obj):
        return format_html(
            '<a href="/admin/menu/foods/{}/detail/" class="font-medium text-primary-600 hover:underline">{}</a>',
            obj.id,
            obj.name,
        )

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
    list_select_related = ["seller"]
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
