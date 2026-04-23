-- Defense-in-depth: short-circuit the charge-generation trigger for PAYG rentals.
--
-- The existing `trigger_generate_rental_charges` trigger calls `generate_rental_charges(NEW.id)`
-- which loops over months between start_date and end_date inserting Rental ledger charges.
-- For PAYG rentals `end_date` is NULL so the loop is *currently* a no-op by accident
-- (AGE(NULL, start_date) is NULL and the WHILE condition never fires). If anyone ever
-- sets an end_date on a PAYG rental — for example on close, via finalize-payg-rental or
-- a manual admin edit — the trigger would happily generate upfront monthly charges that
-- collide with the daily accruals from `accrue-payg-charges`, causing double-billing.
--
-- Make the PAYG short-circuit explicit so the correctness doesn't depend on NULL arithmetic.

CREATE OR REPLACE FUNCTION public.trigger_generate_rental_charges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.is_pay_as_you_go, false) THEN
    -- PAYG rentals accrue daily via accrue-payg-charges cron; never pre-generate.
    RETURN NEW;
  END IF;

  PERFORM generate_rental_charges(NEW.id);
  RETURN NEW;
END $function$;
