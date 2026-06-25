-- Decouple Promotions (advertisement) from Promo Codes (codes only).
-- The Promotions page is operator-authored advertising managed in the CMS (the
-- `promotions` table); promo codes are not advertised there. Drop the short-lived
-- marketing columns that were added to promocodes during the merge experiment.
-- min_duration_days stays — duration auto-discounts are unaffected.
ALTER TABLE public.promocodes
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS image_url,
  DROP COLUMN IF EXISTS show_on_promotions;
