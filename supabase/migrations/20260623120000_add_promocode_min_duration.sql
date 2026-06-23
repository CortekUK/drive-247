-- Duration-based promo codes.
-- When `min_duration_days` is set (> 0), the code auto-applies to FIXED rentals whose
-- duration in days >= this value. The highest qualifying tier wins (e.g. a 16-day rental
-- with codes at 7/14 days picks the 14-day one). NULL/0 = a normal manual code the
-- customer types at checkout (existing behaviour, unchanged).
--
-- Scope: the auto-apply only ever runs in the customer booking widget for pay-in-full
-- fixed rentals. It is intentionally NOT applied to installment plans, PAYG, or
-- auto-extend renewal cycles.
ALTER TABLE public.promocodes
  ADD COLUMN IF NOT EXISTS min_duration_days integer;

COMMENT ON COLUMN public.promocodes.min_duration_days IS
  'Optional. When > 0, this code auto-applies to fixed rentals lasting at least this many days (highest qualifying tier wins). NULL = manual code entered at checkout. Never applied to installment / PAYG / auto-extend bookings.';
