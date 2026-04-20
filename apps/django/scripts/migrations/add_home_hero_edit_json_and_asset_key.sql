ALTER TABLE admin_sales_commission_settings
  ADD COLUMN IF NOT EXISTS mobile_home_header_edit_json TEXT;

ALTER TABLE admin_sales_commission_settings
  ADD COLUMN IF NOT EXISTS mobile_home_header_asset_key TEXT;
