-- Per-day vs per-trip billing for rental extras (Open Bay / Jim ask: a "per day"
-- extra like a $12/day stroller should bill price x rental days, not a flat $12).
--
-- billing_type is a NEW, ORTHOGONAL axis to pricing_type:
--   pricing_type  = where the price comes from  ('global' | 'per_vehicle')  [unchanged]
--   billing_type  = how often it's charged       ('per_trip' | 'per_day')   [new]
--
-- Default 'per_trip' means every existing extra keeps its current flat behaviour;
-- nothing changes until an operator sets an extra to per_day.
-- rental_extras_selections gets a snapshot so historical rentals stay correct even
-- if the catalog's billing_type is changed later.

ALTER TABLE public.rental_extras
  ADD COLUMN IF NOT EXISTS billing_type text NOT NULL DEFAULT 'per_trip';

DO $$ BEGIN
  ALTER TABLE public.rental_extras
    ADD CONSTRAINT rental_extras_billing_type_check
    CHECK (billing_type IN ('per_trip','per_day'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.rental_extras_selections
  ADD COLUMN IF NOT EXISTS billing_type_at_booking text NOT NULL DEFAULT 'per_trip';

COMMENT ON COLUMN public.rental_extras.billing_type IS
  'How the extra is billed: per_trip (flat, once) or per_day (unit price x rental days). Default per_trip. Orthogonal to pricing_type (global/per_vehicle).';
COMMENT ON COLUMN public.rental_extras_selections.billing_type_at_booking IS
  'Snapshot of the extra''s billing_type at booking time so historical totals stay correct.';
