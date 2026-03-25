-- Upgrade generate_first_charge_for_rental to create separate ledger charges per category
-- instead of one lump "Rental" charge. This matches how the portal and apply-payment work.
-- Uses the invoice breakdown to split: Rental, Tax, Service Fee, Security Deposit, Insurance, Delivery Fee, Extras.

CREATE OR REPLACE FUNCTION "public"."generate_first_charge_for_rental"("rental_id_param" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rental record;
  v_invoice record;
  v_charge_amount numeric;
BEGIN
  -- Get rental details (include collection_fee for separate charge)
  SELECT id, customer_id, vehicle_id, start_date, monthly_amount, status, tenant_id, collection_fee
  INTO v_rental
  FROM rentals
  WHERE id = rental_id_param;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental % not found', rental_id_param;
  END IF;

  -- Check if this rental already has ANY charge (not just Rental category)
  IF EXISTS (
    SELECT 1 FROM ledger_entries
    WHERE rental_id = v_rental.id
      AND type = 'Charge'
      AND due_date = v_rental.start_date
  ) THEN
    -- Charges already exist, skip
    RETURN;
  END IF;

  -- Try to find the invoice for this rental to get category breakdown
  SELECT rental_fee, tax_amount, service_fee, security_deposit, insurance_premium, delivery_fee, extras_total, discount_amount
  INTO v_invoice
  FROM invoices
  WHERE rental_id = v_rental.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_invoice.rental_fee IS NOT NULL THEN
    -- Create separate charges per category from invoice breakdown

    -- Rental charge (use rental_fee which is the discounted amount)
    v_charge_amount := COALESCE(v_invoice.rental_fee, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Rental', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT ON CONSTRAINT ux_rental_charge_unique DO NOTHING;
    END IF;

    -- Tax charge
    v_charge_amount := COALESCE(v_invoice.tax_amount, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Tax', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT ON CONSTRAINT ux_rental_charge_unique DO NOTHING;
    END IF;

    -- Service Fee charge
    v_charge_amount := COALESCE(v_invoice.service_fee, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Service Fee', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT ON CONSTRAINT ux_rental_charge_unique DO NOTHING;
    END IF;

    -- Security Deposit charge
    v_charge_amount := COALESCE(v_invoice.security_deposit, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Security Deposit', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT ON CONSTRAINT ux_rental_charge_unique DO NOTHING;
    END IF;

    -- Insurance charge (Bonzah)
    v_charge_amount := COALESCE(v_invoice.insurance_premium, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Insurance', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT ON CONSTRAINT ux_rental_charge_unique DO NOTHING;
    END IF;

    -- Delivery Fee charge
    v_charge_amount := COALESCE(v_invoice.delivery_fee, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Delivery Fee', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT ON CONSTRAINT ux_rental_charge_unique DO NOTHING;
    END IF;

    -- Collection Fee charge (from rental record, not invoice)
    v_charge_amount := COALESCE(v_rental.collection_fee, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Collection Fee', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT ON CONSTRAINT ux_rental_charge_unique DO NOTHING;
    END IF;

    -- Extras charge
    v_charge_amount := COALESCE(v_invoice.extras_total, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Extras', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT ON CONSTRAINT ux_rental_charge_unique DO NOTHING;
    END IF;

    RAISE NOTICE 'Created category-split charges for rental % from invoice', v_rental.id;
  ELSE
    -- No invoice found — fall back to single Rental charge with monthly_amount
    PERFORM rental_create_charge(v_rental.id, v_rental.start_date, v_rental.monthly_amount);
    RAISE NOTICE 'Created single rental charge for rental % (no invoice found)', v_rental.id;
  END IF;
END;
$$;

COMMENT ON FUNCTION "public"."generate_first_charge_for_rental"("rental_id_param" "uuid") IS 'Generates charges for a rental split by category (Rental, Tax, Service Fee, Security Deposit, Insurance, Delivery, Extras) using invoice breakdown. Falls back to single Rental charge if no invoice exists.';
