-- APPLIED to production 2026-10-09
--
-- Auto-extend: keep billing until the car is back.
--
-- Until now an auto-extend rental billed one period, then waited for it to be
-- paid IN FULL before billing the next, and paused after the grace window. A
-- customer who fell behind kept the car while the weeks stopped appearing on
-- the ledger, so balances showed far less than was owed (RevTek R-4c677b:
-- unbilled from 25 Sep over $5.46 of unpaid tax).
--
--   tenants.auto_extend_keep_billing  on: every period is billed on schedule
--                                     while the rental is active, paid or not,
--                                     and the rental never auto-pauses. Off
--                                     (default): unchanged behaviour.
--   rentals.auto_extend_bill_until    the collection date: no period starting
--                                     on or after it is billed. Billing also
--                                     stops once a return handover is recorded.
--
-- auto-extend-rentals reads both on their own, fail-soft.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS auto_extend_keep_billing boolean NOT NULL DEFAULT false;

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS auto_extend_bill_until date;

COMMENT ON COLUMN public.tenants.auto_extend_keep_billing IS
  'Auto-extend keeps billing every period while the rental is active, paid or not; no grace pause.';
COMMENT ON COLUMN public.rentals.auto_extend_bill_until IS
  'Collection date: auto-extend bills no period starting on or after this date.';

-- RevTek asked for it (2026-10-09).
UPDATE public.tenants SET auto_extend_keep_billing = true WHERE slug = 'revtekrentals';
