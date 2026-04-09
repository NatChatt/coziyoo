# Food Detail Page — Design Spec

**Date:** 2026-04-09  
**Status:** Approved

---

## Overview

Replace the foods changelist inline lot expansion and food detail modal with a dedicated full-page food detail view. Follows the same pattern as `buyer_detail` and `seller_detail` pages.

---

## URL & Routing

- **New URL:** `/admin/menu/foods/<uuid:food_id>/detail/`
- Registered in `FoodsAdmin.get_urls()` alongside existing custom URLs
- Food name column in changelist becomes a clickable link to this URL
- Global search (`admin_search.py`) food URLs updated from `?open_food=<id>` to `/admin/menu/foods/<id>/detail/`

---

## Backend (`apps/django/apps/foods/admin.py`)

### New: `food_detail_view(request, food_id)`

- Fetches `Foods` with `select_related("seller", "category")`
- Fetches all `ProductionLots` for the food ordered by `-produced_at`
- Serializes lots to JSON using existing `_fmt`, `_LOT_STATUS_STYLE` helpers
- Returns `TemplateResponse` with context:
  - `food` — the Foods model instance
  - `lots_json` — JSON string of serialized lots (same shape as current `FOOD_LOTS` entries)
  - `page_title` — food name (for `<title>` block)

### Removed: `food_modal_detail(request, food_id)`

- JSON endpoint no longer needed; delete it and remove from `get_urls()`

### Updated: `FoodsAdmin.list_display`

- `name` replaced with a `@display(description="Ad")` method `food_name_link` that returns:
  ```html
  <a href="/admin/menu/foods/{id}/detail/" class="font-medium text-primary-600 hover:underline">{name}</a>
  ```
- Uses `format_html` for safety

### Removed: `changelist_view` override

- Entire `changelist_view` override deleted — all its logic served the now-removed lots pre-loading and `open_food_id` handling
- `open_food_id` is no longer needed because `admin_search.py` now links directly to `/admin/menu/foods/{id}/detail/`
- Django's default changelist behavior applies

---

## Template: `food_detail.html`

**Path:** `templates/admin/menu/foods/food_detail.html`  
**Extends:** `admin/base.html`

### Header Card

Matches buyer/seller detail header pattern (`flex-wrap` row):

- **Left:** Food image (`<img>` if `food.image_url`, else `restaurant` icon chip) + food name (h1) + seller name + category
- **Middle (KPI cards, grow):**
  - Blue: Toplam lot sayısı
  - Emerald: Rating (e.g. `4.8 ⭐`)
  - Amber: Yorum sayısı (`review_count`)
  - Active/passive badge inline next to name
- **Right:** "Düzenle" button → `/admin/menu/foods/<id>/change/`

### Body — 2-column grid

| Left column | Right column |
|-------------|--------------|
| Temel bilgiler subcard (fiyat, mutfak, hazırlama süresi, porsiyon, oluşturma tarihi) | Açıklama subcard (`description`) |
| Malzemeler subcard (`ingredients_json` — pill list) | Kısa açıklama subcard (`card_summary`) |
| Alerjenler subcard (`allergens_json` — pill list) | Tarif subcard (`recipe`) — rendered only if not empty |

### Lots Section (full width, below body grid)

- Section header: "Lotlar" + lot count badge
- Table columns: Lot No, Durum, Üretilen, Mevcut, Üretim Tarihi, Satış Başlangıç, Satış Bitiş, Son Kullanma
- Each row has a visibility icon button (`type="button"`) → opens lot detail modal
- Empty state if no lots

### Lot Detail Modal

- Exact same modal structure as currently in `change_list.html`
- Moved to `food_detail.html`
- Alpine state: `{ modal: null }` (no fetch — lot data pre-loaded in `LOTS_JSON`)

### Alpine.js Component

```js
function foodDetail() {
  return {
    modal: null,  // currently open lot data
    openLot(id) {
      this.modal = LOTS_JSON.find(l => l.id === id) || null;
    }
  };
}
```

`LOTS_JSON` is a `<script>` block injected from `lots_json` context variable.

---

## Changelist (`change_list.html`) Simplification

**Removed:**
- `const FOOD_LOTS = ...` JS block
- `foodsTable()` Alpine function entirely
- `x-data="foodsTable()"` wrapper div
- Food detail modal (backdrop + card + all inner content)
- Row expand toggle (chevron button, `expanded` state, expanded lot rows)
- Eye icon button (visibility trigger for food modal)

**Kept:**
- Search, filters, pagination — untouched (Django standard)
- Table structure with food rows — simplified, name cell is now just the `<a>` link from `food_name_link` display method

**Result:** `change_list.html` reduces from ~728 lines to ~200 lines or fewer.

---

## Global Search (`admin_search.py`)

Change food result URL:

```python
# Before
"url": f"/admin/menu/foods/?open_food={fid}",

# After
"url": f"/admin/menu/foods/{fid}/detail/",
```

---

## What is NOT changing

- `CategoriesAdmin` — untouched
- `ProductionLotsAdmin` — untouched
- Lot modal structure/content — same, just moved to detail page
- `_fmt`, `_LOT_STATUS_STYLE`, `_ingredients_diff`, `_recipe_diff` helpers — kept, reused
- Django unfold design system patterns (KPI cards, subcards, table hover, etc.) — followed exactly

---

## Files Touched

| File | Change |
|------|--------|
| `apps/foods/admin.py` | Add `food_detail_view`, add `food_name_link`, remove `changelist_view` override, update `get_urls`, remove `food_modal_detail` |
| `templates/admin/menu/foods/change_list.html` | Remove Alpine component, food modal, row expand; simplify to ~200 lines |
| `templates/admin/menu/foods/food_detail.html` | New file |
| `coziyoo/admin_search.py` | Update food URL |
