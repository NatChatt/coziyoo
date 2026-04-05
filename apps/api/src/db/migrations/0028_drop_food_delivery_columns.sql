ALTER TABLE public.foods
  DROP COLUMN IF EXISTS delivery_fee,
  DROP COLUMN IF EXISTS max_delivery_distance_km,
  DROP COLUMN IF EXISTS delivery_options_json;
