-- Merge "Promotions" into Promo Codes.
-- A promo code now carries its own marketing card (image, title, description) and a
-- flag controlling whether it appears on the public booking /promotions page. The
-- separate `promotions` table / CMS editor is retired in favour of this.
ALTER TABLE public.promocodes
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS show_on_promotions boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.promocodes.title IS 'Optional marketing title for the public promotions card; falls back to auto-generated copy when blank.';
COMMENT ON COLUMN public.promocodes.description IS 'Optional marketing description for the public promotions card; falls back to auto-generated copy when blank.';
COMMENT ON COLUMN public.promocodes.image_url IS 'Optional banner image (cms-media bucket) for the public promotions card.';
COMMENT ON COLUMN public.promocodes.show_on_promotions IS 'When true, the code is advertised as a card on the public booking /promotions page.';

-- Duration codes were already auto-advertised on the promotions page before the merge,
-- so keep them visible.
UPDATE public.promocodes
  SET show_on_promotions = true
  WHERE min_duration_days IS NOT NULL AND min_duration_days > 0;
