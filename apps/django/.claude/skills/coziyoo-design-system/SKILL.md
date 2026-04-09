# Coziyoo Admin Design System

Reference guide for all custom admin templates in the Coziyoo Django project.
Read this skill before creating or editing any template under `templates/admin/`.

---

## Foundation

- **CSS framework:** Tailwind via Unfold's compiled bundle — only pre-existing utility classes are available.
- **Interactivity:** Alpine.js (loaded by Unfold skeleton). Use `x-data`, `x-show`, `x-cloak`, `Alpine.store`.
- **Icons:** Material Symbols Outlined (`<span class="material-symbols-outlined">`).
- **Primary colour:** Purple (`primary-600 = #9333ea`).

---

## Detail-Page Card

Every info card on detail pages (food detail, buyer detail, seller detail) follows a two-part structure: a **header bar** and a **body area**.

### Header Bar

```html
<div class="px-5 py-3 flex items-center gap-2 bg-base-50 dark:bg-base-700/50 border-b border-base-200 dark:border-base-700">
  <span class="material-symbols-outlined text-base text-base-400 dark:text-base-500 leading-none">icon_name</span>
  <span class="text-xs font-semibold uppercase tracking-wide text-base-500 dark:text-base-400">SECTION TITLE</span>
</div>
```

Key values:
- Padding: `px-5 py-3`
- Icon size: `text-base` (16 px)
- Title font: `text-xs font-semibold uppercase tracking-wide`
- Title colour: `text-base-500 dark:text-base-400`

### Body Area

```html
<div class="px-5 py-4">
  <!-- content -->
</div>
```

Key values:
- Padding: `px-5 py-4`

### Card Wrapper

```html
<div class="rounded-xl border border-base-200 dark:border-base-700 overflow-hidden bg-white dark:bg-base-800">
  <!-- header bar -->
  <!-- body area -->
</div>
```

---

## Key-Value Rows (inside card body)

Used for label → value pairs like "Fiyat → ₺40,00".

```html
<div class="px-5 py-4 flex flex-col gap-3">
  <div class="flex items-center justify-between">
    <span class="text-xs text-base-500 dark:text-base-400">Label</span>
    <span class="text-sm text-base-700 dark:text-base-300">Value</span>
  </div>
</div>
```

- Label: `text-xs text-base-500 dark:text-base-400` (no uppercase, no tracking — that's reserved for card headers only)
- Value: `text-sm text-base-700 dark:text-base-300`
- Emphasized value (e.g. price): add `font-semibold text-base-900 dark:text-white`
- Gap between rows: `gap-3`

---

## Tags / Chips

Used for ingredients, allergens, categories, etc.

### Neutral Tag (ingredients, generic)

```html
<span class="px-2.5 py-1 rounded-full text-xs text-base-600 dark:text-base-300 bg-base-50 dark:bg-base-700 border border-base-200 dark:border-base-600">
  Tag text
</span>
```

### Warning Tag (allergens)

```html
<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">
  Allergen
</span>
```

### Tag Container

```html
<div class="flex flex-wrap gap-1.5">
  <!-- tags -->
</div>
```

---

## Status Badges

Inline status indicators used in tables and cards.

```html
<!-- Positive: active, open, approved -->
<span class="inline-flex px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">active</span>

<!-- Warning: locked, pending -->
<span class="inline-flex px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700">locked</span>

<!-- Danger: expired, discarded, recalled -->
<span class="inline-flex px-2.5 py-0.5 rounded text-xs font-semibold bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-700">expired</span>

<!-- Neutral: closed, draft -->
<span class="inline-flex px-2.5 py-0.5 rounded text-xs font-semibold bg-base-100 dark:bg-base-700 text-base-500 dark:text-base-400 border border-base-200 dark:border-base-600">draft</span>
```

---

## KPI Cards (Tonal)

Used on list page stats and detail page headers.

| Role | Background | Border | Icon/text colour |
|------|-----------|--------|-----------------|
| Total / Neutral | `bg-blue-50 dark:bg-blue-950/40` | `border-blue-200 dark:border-blue-800` | `text-blue-500 / -600 / -800` |
| Positive / Active | `bg-emerald-50 dark:bg-emerald-950/40` | `border-emerald-200 dark:border-emerald-800` | `text-emerald-500 / -600 / -800` |
| Warning / Spend | `bg-amber-50 dark:bg-amber-950/40` | `border-amber-200 dark:border-amber-800` | `text-amber-500 / -600 / -800` |
| Danger / Risk | `bg-rose-50 dark:bg-rose-950/40` | `border-rose-200 dark:border-rose-800` | `text-rose-500 / -600 / -800` |

```html
<div class="rounded-xl py-2 px-3 flex items-center gap-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">
  <span class="material-symbols-outlined text-base text-blue-500 dark:text-blue-400">icon</span>
  <div>
    <div class="text-xs font-medium text-blue-600 dark:text-blue-300 uppercase tracking-wide">Label</div>
    <div class="text-2xl font-bold text-blue-800 dark:text-blue-100">42</div>
  </div>
</div>
```

---

## Tables

### Table within a card (e.g. Lots table on food detail)

```html
<table class="w-full text-sm">
  <thead>
    <tr class="border-b border-base-200 dark:border-base-700 text-xs font-semibold uppercase tracking-wide text-base-500">
      <th class="px-5 py-3 text-left">Column</th>
    </tr>
  </thead>
  <tbody>
    <tr class="border-b border-base-100 dark:border-base-700/50 hover:bg-base-100/40 dark:hover:bg-base-700/30 transition-colors">
      <td class="px-5 py-3.5 text-sm text-base-700 dark:text-base-300">Cell</td>
    </tr>
  </tbody>
</table>
```

Key values:
- Header: `px-5 py-3`, no background (inherits from card)
- Cell: `px-5 py-3.5`
- Row hover: `hover:bg-base-100/40 dark:hover:bg-base-700/30 transition-colors`
- Cell text: `text-sm` (never `text-xs` for table cell content)

### Standalone list table (e.g. buyer/seller list)

Same as above but header may include `bg-base-50 dark:bg-base-900/50` when not inside a card.

---

## Custom Change List Pages

When overriding `{% block result_list %}` with a custom table:

1. **Include Unfold's action bar:** `{% include "unfold/helpers/change_list_actions.html" %}`
2. **Add required CSS classes for Unfold's `actions.js`:**
   - Table: `class="result-list ..."` (actions.js uses `.result-list` to find `.tBodies`)
   - Select-all checkbox: `class="action-toggle ..."` (actions.js queries `.action-toggle`)
   - Row checkboxes: `class="action-select ..."` (actions.js queries `input.action-select`)
3. **Do NOT override `{% block filters %}`** — let Unfold's default handle search + filter button alignment.
4. **Do NOT create a custom Alpine store for selection** — Unfold's `actions.js` handles all select/deselect/counter logic natively.

---

## Detail Page Tab Search

For client-side search within tabbed detail pages (buyer, seller):

```html
<div class="flex flex-col border-b border-base-200 dark:border-base-700 lg:flex-row lg:items-center">
  <!-- Tab buttons -->
  <div class="flex items-center overflow-x-auto flex-1">
    <button ...>Tab</button>
  </div>
  <!-- Search — full-width on mobile, right-aligned on desktop -->
  <div class="px-3 py-2 w-full lg:w-auto lg:shrink-0 lg:ml-auto lg:py-1.5" x-show="..." x-cloak>
    <div class="bg-white border border-base-200 flex flex-row items-center px-3 rounded-default relative shadow-xs w-full focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-primary-600 lg:w-96 dark:bg-base-900 dark:border-base-700">
      <button type="button" class="flex items-center focus:outline-hidden">
        <span class="material-symbols-outlined md-18 text-base-400 dark:text-base-500">search</span>
      </button>
      <input x-model="search" type="text" placeholder="{% trans 'Type to search' %}"
        class="grow font-medium min-w-0 overflow-hidden p-2 placeholder-font-subtle-light truncate focus:outline-hidden dark:bg-base-900 dark:placeholder-font-subtle-dark dark:text-font-default-dark">
    </div>
  </div>
</div>
```

This matches Unfold's native `search_form.html` styling (same border, shadow, focus ring, `lg:w-96`).

---

## Spacing Reference

| Context | Padding | Gap |
|---------|---------|-----|
| Card header | `px-5 py-3` | `gap-2` |
| Card body | `px-5 py-4` | — |
| Key-value list | (inherits card body) | `gap-3` |
| Tag container | (inherits card body) | `gap-1.5` |
| Table header cell | `px-5 py-3` | — |
| Table body cell | `px-5 py-3.5` | — |
| Page section gap | — | `gap-4` (on parent grid/flex) |

---

## Font Size Reference

| Element | Size class |
|---------|-----------|
| Card header title | `text-xs` |
| Key-value label | `text-xs` |
| Key-value value | `text-sm` |
| Tag text | `text-xs` |
| Status badge text | `text-xs` |
| Table cell content | `text-sm` |
| Table header | `text-xs` |
| Card body prose | `text-sm` |
| KPI label | `text-xs` |
| KPI value | `text-2xl` |

**Never use `text-[10px]` or `text-[11px]`** — the minimum readable size is `text-xs` (12px).

---

## Dark Mode

Every colour class must have a `dark:` counterpart. Follow the pattern:

- Backgrounds: `bg-{color}-50` → `dark:bg-{color}-950/40` or `dark:bg-{color}-900/30`
- Borders: `border-{color}-200` → `dark:border-{color}-700` or `dark:border-{color}-800`
- Text: `text-{color}-700` → `dark:text-{color}-300`

Always use Tailwind classes for colours, never inline `style=""` with hardcoded hex values. Inline styles don't respond to dark mode.
