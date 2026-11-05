-- APPLIED to production 2026-11-03.
--
-- Secondary drivers: a renter names one extra driver on a Pending rental, that
-- person verifies their ID, and they are listed on the rental. That is all.
-- The agreement and the Bonzah policy stay primary-driver only.
--
-- They reuse rental_additional_drivers, marked listing_only, because everything
-- that verification and the operator screens need is already on that table.

-- Keeps these drivers out of agreements. Every agreement send reads this table,
-- so without the marker a Resend would write them into the contract.
ALTER TABLE public.rental_additional_drivers
  ADD COLUMN IF NOT EXISTS listing_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rental_additional_drivers.listing_only IS
  'Secondary driver added by the renter: verified and listed only. Never written into an agreement, never a BoldSign signer, never sent to Bonzah.';

-- One secondary driver per rental, held by the database so a double submit
-- cannot make two.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_additional_drivers_one_listing_only
  ON public.rental_additional_drivers(rental_id)
  WHERE listing_only;

-- Invites are limited per rental, not per driver: removing a driver and adding
-- another must not reset the count, or a renter could email anyone without limit.
ALTER TABLE public.identity_verifications
  ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES public.rentals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_identity_verifications_rental
  ON public.identity_verifications(rental_id, created_at)
  WHERE rental_id IS NOT NULL;

-- This policy returned whole rows, so a renter could read a driver's licence
-- number and their verification link, and complete the check on their behalf.
-- No customer screen ever read the table directly. Renters now get name and
-- status from the customer-secondary-driver edge function.
DROP POLICY IF EXISTS rental_additional_drivers_select_customer
  ON public.rental_additional_drivers;
