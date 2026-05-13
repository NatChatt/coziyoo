ALTER TABLE admin_sales_commission_settings
  ADD COLUMN IF NOT EXISTS mobile_home_hero_question_text TEXT;

ALTER TABLE admin_sales_commission_settings
  ADD COLUMN IF NOT EXISTS mobile_home_hero_slogan_title TEXT;

ALTER TABLE admin_sales_commission_settings
  ADD COLUMN IF NOT EXISTS mobile_home_hero_slogan_subtitle TEXT;
