-- Fix: generate_first_charge_for_rental silently skips Rental + Tax charges.
--
-- BUG: the function opened with a COARSE whole-function guard —
--   IF EXISTS (Charge at due_date = start_date) THEN RETURN;
-- The portal New-Rental flow inserts the Bonzah Insurance charge (ref 'BONZAH-...')
-- BEFORE calling this function, so that guard always trips for insured rentals and
-- the function returns immediately, never creating Rental, Tax, Service Fee, etc.
-- The customer's payment link (built from the invoice total) then settles against the
-- only charge that exists (Insurance), leaving the rest unallocated. Real incident:
-- Paramount Solutions R-3bb30d — customer paid $131.33, only $50.13 (Insurance) bound.
--
-- FIX: replace the coarse guard with a PER-CATEGORY existence check on every insert.
-- Each category is created only if a Charge of that category doesn't already exist for
-- the rental at start_date (regardless of reference). So a pre-existing Bonzah Insurance
-- charge no longer suppresses Rental/Tax, and it is never duplicated. Idempotent and
-- reference-agnostic — the ON CONFLICT rows are kept as a second safety net.
CREATE OR REPLACE FUNCTION public.generate_first_charge_for_rental(rental_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_rental record;
  v_invoice record;
  v_charge_amount numeric;
BEGIN
  SELECT id, customer_id, vehicle_id, start_date, monthly_amount, status, tenant_id, collection_fee
  INTO v_rental
  FROM rentals
  WHERE id = rental_id_param;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental % not found', rental_id_param;
  END IF;

  SELECT rental_fee, tax_amount, service_fee, insurance_premium, delivery_fee, extras_total
  INTO v_invoice
  FROM invoices
  WHERE rental_id = v_rental.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_invoice.rental_fee IS NOT NULL THEN
    -- Rental
    v_charge_amount := COALESCE(v_invoice.rental_fee, 0);
    IF v_charge_amount > 0 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE rental_id=v_rental.id AND type='Charge' AND category='Rental' AND due_date=v_rental.start_date) THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Rental', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, ''), COALESCE(reference, '')) DO NOTHING;
    END IF;

    -- Tax
    v_charge_amount := COALESCE(v_invoice.tax_amount, 0);
    IF v_charge_amount > 0 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE rental_id=v_rental.id AND type='Charge' AND category='Tax' AND due_date=v_rental.start_date) THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Tax', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, ''), COALESCE(reference, '')) DO NOTHING;
    END IF;

    -- Service Fee
    v_charge_amount := COALESCE(v_invoice.service_fee, 0);
    IF v_charge_amount > 0 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE rental_id=v_rental.id AND type='Charge' AND category='Service Fee' AND due_date=v_rental.start_date) THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Service Fee', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, ''), COALESCE(reference, '')) DO NOTHING;
    END IF;

    -- Insurance (this is the one the Bonzah pre-insert used to suppress the whole function)
    v_charge_amount := COALESCE(v_invoice.insurance_premium, 0);
    IF v_charge_amount > 0 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE rental_id=v_rental.id AND type='Charge' AND category='Insurance' AND due_date=v_rental.start_date) THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Insurance', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, ''), COALESCE(reference, '')) DO NOTHING;
    END IF;

    -- Delivery Fee
    v_charge_amount := COALESCE(v_invoice.delivery_fee, 0);
    IF v_charge_amount > 0 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE rental_id=v_rental.id AND type='Charge' AND category='Delivery Fee' AND due_date=v_rental.start_date) THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Delivery Fee', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, ''), COALESCE(reference, '')) DO NOTHING;
    END IF;

    -- Collection Fee (from rental, not invoice)
    v_charge_amount := COALESCE(v_rental.collection_fee, 0);
    IF v_charge_amount > 0 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE rental_id=v_rental.id AND type='Charge' AND category='Collection Fee' AND due_date=v_rental.start_date) THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Collection Fee', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, ''), COALESCE(reference, '')) DO NOTHING;
    END IF;

    -- Extras
    v_charge_amount := COALESCE(v_invoice.extras_total, 0);
    IF v_charge_amount > 0 AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE rental_id=v_rental.id AND type='Charge' AND category='Extras' AND due_date=v_rental.start_date) THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Extras', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, ''), COALESCE(reference, '')) DO NOTHING;
    END IF;

    RAISE NOTICE 'Created category-split charges for rental % from invoice', v_rental.id;
  ELSE
    PERFORM rental_create_charge(v_rental.id, v_rental.start_date, v_rental.monthly_amount);
    RAISE NOTICE 'Created single rental charge for rental % (no invoice found)', v_rental.id;
  END IF;
END;
$function$;
