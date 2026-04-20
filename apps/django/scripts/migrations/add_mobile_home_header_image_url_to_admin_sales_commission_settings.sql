-- Migration: add mobile home hero image URL field for buyer home hero control
-- Safe to run multiple times.

ALTER TABLE admin_sales_commission_settings
    ADD COLUMN IF NOT EXISTS mobile_home_header_image_url TEXT;
