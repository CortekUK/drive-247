-- Deposits are now held on the card via the existing place-deposit-hold edge
-- function (rentals.deposit_hold_* columns), not charged upfront.
-- generate_first_charge_for_rental must stop creating a Security Deposit ledger
-- charge — otherwise the Payment Breakdown would show it as an unpaid balance
-- even though the deposit is being held separately via Stripe preauth.

CREATE OR REPLACE FUNCTION public.generate_first_charge_for_rental(rental_id_param uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
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

  IF EXISTS (
    SELECT 1 FROM ledger_entries
    WHERE rental_id = v_rental.id
      AND type = 'Charge'
      AND due_date = v_rental.start_date
  ) THEN
    RETURN;
  END IF;

  SELECT rental_fee, tax_amount, service_fee, insurance_premium, delivery_fee, extras_total
  INTO v_invoice
  FROM invoices
  WHERE rental_id = v_rental.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_invoice.rental_fee IS NOT NULL THEN
    v_charge_amount := COALESCE(v_invoice.rental_fee, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Rental', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, '')) DO NOTHING;
    END IF;

    v_charge_amount := COALESCE(v_invoice.tax_amount, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Tax', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, '')) DO NOTHING;
    END IF;

    v_charge_amount := COALESCE(v_invoice.service_fee, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Service Fee', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, '')) DO NOTHING;
    END IF;

    -- Security Deposit intentionally skipped — it lives on rentals.deposit_hold_*
    -- and is held as a Stripe preauth, not written as a Charge row.

    v_charge_amount := COALESCE(v_invoice.insurance_premium, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Insurance', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, '')) DO NOTHING;
    END IF;

    v_charge_amount := COALESCE(v_invoice.delivery_fee, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Delivery Fee', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, '')) DO NOTHING;
    END IF;

    v_charge_amount := COALESCE(v_rental.collection_fee, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Collection Fee', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, '')) DO NOTHING;
    END IF;

    v_charge_amount := COALESCE(v_invoice.extras_total, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Extras', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, '')) DO NOTHING;
    END IF;

    RAISE NOTICE 'Created category-split charges for rental % from invoice', v_rental.id;
  ELSE
    PERFORM rental_create_charge(v_rental.id, v_rental.start_date, v_rental.monthly_amount);
    RAISE NOTICE 'Created single rental charge for rental % (no invoice found)', v_rental.id;
  END IF;
END;
$$;
