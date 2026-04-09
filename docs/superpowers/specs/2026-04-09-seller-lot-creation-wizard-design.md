# Seller Lot Creation Wizard

**Date:** 2026-04-09
**Status:** Draft

## Problem

Sellers cannot create new lots for their foods because there is no navigation path to the SellerLotsScreen from anywhere in the app. The existing SellerLotsScreen has a basic create modal, but it's unreachable. Additionally, the lot creation flow needs to be a step-by-step wizard that lets sellers review and optionally customize food specs (recipe, ingredients, allergens) per-lot before setting production details.

## Solution Overview

1. **New `SellerLotCreateScreen`** — a full-screen, 4-step wizard for creating lots
2. **Navigation wiring** — two entry points: SellerHomeScreen and SellerFoodsManagerScreen
3. **Backend fixes** — fix missing fields in GET response and add recall endpoint

## Navigation & Entry Points

### Entry Point 1: SellerHomeScreen
- Add a "Lot Yonetimi" quick button alongside existing buttons (foods, finance)
- Navigates to `sellerLots` screen (the existing lot list)

### Entry Point 2: SellerFoodsManagerScreen
- Add a "Lot Olustur" button on each food card
- Navigates directly to `sellerLotCreate` screen with `preselectedFoodId`

### Entry Point 3: SellerLotsScreen "+" button
- Replace the current simple modal with navigation to `sellerLotCreate` screen
- Remove the inline modal from SellerLotsScreen

### New Screen Registration
- Register `sellerLotCreate` as a new screen type in `App.tsx`
- Props: `auth`, `onBack`, `onAuthRefresh`, `preselectedFoodId?: string`

## Wizard Steps

### Step 1: Select Food
- Fetch seller's food list via `GET /v1/seller/foods`
- Display foods as selectable cards (name, price, active/passive badge)
- Foods missing recipe/ingredients/allergens show a warning icon — they can be selected but will fail at lot creation (API validates this)
- If `preselectedFoodId` is provided, skip this step (show selected food at top with "Change" option)
- "Next" button advances to Step 2

### Step 2: Review & Edit Specs
- Fetch selected food's full details via `GET /v1/seller/foods/{foodId}`
- Display three sections:
  - **Recipe** — text display of food recipe
  - **Ingredients** — list from `ingredients_json`
  - **Allergens** — list from `allergens_json`
- Each section has an "Edit for this lot" toggle
- When toggled on, the section becomes editable (text input for recipe, editable list for ingredients/allergens)
- Edits are stored in local wizard state only — they become the lot's snapshot, NOT saved back to the food
- Default behavior: all sections stay read-only (use food's current specs as-is)
- "Next" button advances to Step 3

### Step 3: Production Details
- **Production date/time** — date-time picker, default: now
- **Sale start date/time** — date-time picker, default: now
- **Sale end date/time** — date-time picker, default: +24 hours from sale start
- **Use-by date** — date-time picker, optional
- **Best-before date** — date-time picker, optional
- **Quantity produced** — number input, required, min 1
- **Quantity available** — number input, defaults to quantity produced, max = produced
- **Notes** — optional text field
- Validation: producedAt < saleStartsAt < saleEndsAt, quantityAvailable <= quantityProduced
- "Next" button advances to Step 4

### Step 4: Review & Confirm
- Summary card showing:
  - Food name
  - Specs changes indicator (if any sections were edited)
  - Production timeline
  - Quantities
  - Notes
- "Create Lot" button
- On success: navigate back to `sellerLots` screen, show success toast
- On error: show error message, stay on Step 4

## API Integration

### Existing Endpoint (lot creation)
`POST /v1/seller/lots`

Request body (no changes needed):
```json
{
  "foodId": "uuid",
  "producedAt": "ISO-8601",
  "saleStartsAt": "ISO-8601",
  "saleEndsAt": "ISO-8601",
  "quantityProduced": 10,
  "quantityAvailable": 10,
  "useBy": "ISO-8601 (optional)",
  "bestBefore": "ISO-8601 (optional)",
  "notes": "string (optional)"
}
```

Note: The backend automatically snapshots the food's current recipe/ingredients/allergens at lot creation time. If the seller edits specs in Step 2, we need to either:
- **Option A:** Send the modified specs in the POST body and update the backend to accept them
- **Option B:** Temporarily update the food, create the lot (which snapshots), then revert the food

**Decision: Option A** — extend the POST endpoint to accept optional `recipeSnapshot`, `ingredientsSnapshot`, `allergensSnapshot` fields. If provided, use these instead of fetching from the food record.

### Backend Changes Required

#### 1. Fix `GET /v1/seller/lots` SQL
Add `lot_number` to the SELECT clause. Alias `status` as `lifecycle_status` for mobile compatibility.

**File:** `apps/django/apps/foods/seller_views.py` (SellerLotListView.get, ~line 466)

#### 2. Accept custom snapshots in `POST /v1/seller/lots`
Add optional fields to the create endpoint:
- `recipeSnapshot` (string, optional)
- `ingredientsSnapshot` (array, optional)
- `allergensSnapshot` (array, optional)

If provided, use these values for the lot's snapshot fields instead of fetching from the food record. Still require the food to exist and have base specs (validation unchanged).

**File:** `apps/django/apps/foods/seller_views.py` (SellerLotListView.post, ~line 484)

#### 3. Add `POST /v1/seller/lots/{id}/recall` endpoint
Create `SellerLotRecallView` that:
- Validates the lot belongs to the seller
- Changes lot status to 'recalled'
- Creates a LotEvent record
- Returns updated lot data

**Files:**
- `apps/django/apps/foods/seller_views.py` — new view class
- `apps/django/apps/foods/urls_seller.py` — new URL pattern

## Brand Copy (brandCopy.ts)

New keys to add:
```
headline.seller.lotCreate.title
headline.seller.lotCreate.step1
headline.seller.lotCreate.step2
headline.seller.lotCreate.step3
headline.seller.lotCreate.step4
cta.seller.lotCreate.next
cta.seller.lotCreate.back
cta.seller.lotCreate.create
cta.seller.lotCreate.editSpecs
cta.seller.lotCreate.changeFood
cta.seller.home.lots (for home screen button)
cta.seller.foodsManager.createLot (for food card button)
helper.seller.lotCreate.selectFood
helper.seller.lotCreate.reviewSpecs
helper.seller.lotCreate.specsUnchanged
helper.seller.lotCreate.specsModified
helper.seller.lotCreate.productionTime
helper.seller.lotCreate.saleStart
helper.seller.lotCreate.saleEnd
helper.seller.lotCreate.useBy
helper.seller.lotCreate.bestBefore
helper.seller.lotCreate.quantity
helper.seller.lotCreate.quantityAvailable
helper.seller.lotCreate.notes
helper.seller.lotCreate.foodMissingSpecs
status.seller.lotCreate.success
error.seller.lotCreate.failed
error.seller.lotCreate.validation
```

## Files Changed

### Mobile (apps/mobile)
| File | Change |
|------|--------|
| `src/screens/SellerLotCreateScreen.tsx` | **NEW** — 4-step wizard |
| `src/screens/SellerHomeScreen.tsx` | Add "Lot Yonetimi" quick button, add `onOpenLots` prop |
| `src/screens/SellerFoodsManagerScreen.tsx` | Add "Lot Olustur" button per food card, add `onOpenLotCreate` prop |
| `src/screens/SellerLotsScreen.tsx` | Replace modal with navigation to wizard, add `onOpenLotCreate` prop |
| `src/copy/brandCopy.ts` | Add new copy keys |
| `App.tsx` | Register `sellerLotCreate` screen, wire navigation callbacks |

### Backend (apps/django)
| File | Change |
|------|--------|
| `apps/foods/seller_views.py` | Fix GET lots SQL, accept snapshot overrides in POST, add recall view |
| `apps/foods/urls_seller.py` | Add recall URL pattern |

## Out of Scope
- Date-time picker component (use React Native's built-in or a simple text input with ISO format for now)
- Lot editing after creation
- Lot status transitions beyond recall
