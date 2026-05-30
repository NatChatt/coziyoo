ALTER TABLE production_lots
  ADD COLUMN IF NOT EXISTS food_name_snapshot VARCHAR(255),
  ADD COLUMN IF NOT EXISTS price_snapshot NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS menu_items_snapshot_json JSONB,
  ADD COLUMN IF NOT EXISTS paid_addons_snapshot_json JSONB;
