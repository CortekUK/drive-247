-- Allow 'processing' and 'failed' on rentals.deposit_hold_status.
-- 'processing' = an atomic claim sentinel that place-deposit-hold flips NULL->processing
-- before calling Stripe, so two concurrent invocations can't both create real
-- PaymentIntents on the same card. 'failed' = the Stripe webhook marks the
-- rental when an off-session hold attempt errors out, so ops can see it on the
-- rental detail page and retry manually via the existing "Place Pre-Auth Hold"
-- button. Without this, the constraint violation surfaces as a 500 from
-- place-deposit-hold and the hold silently never lands (R-68d116 reproducer).

ALTER TABLE public.rentals
  DROP CONSTRAINT IF EXISTS rentals_deposit_hold_status_check;

ALTER TABLE public.rentals
  ADD CONSTRAINT rentals_deposit_hold_status_check
  CHECK (deposit_hold_status = ANY (ARRAY[
    'processing'::text,
    'held'::text,
    'captured'::text,
    'released'::text,
    'expired'::text,
    'refreshing'::text,
    'failed'::text
  ]));
