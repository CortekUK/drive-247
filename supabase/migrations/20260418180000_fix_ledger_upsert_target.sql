-- The `ux_rental_charge_unique` constraint was replaced with an equivalent
-- expression index (adds COALESCE(extension_id, '') so each extension gets
-- its own row). Expression indexes can't back a table-level constraint, so
-- `ON CONFLICT ON CONSTRAINT ux_rental_charge_unique` no longer resolves.
-- Switch these functions to the index-inference form so upserts target the
-- same unique key by column list instead of by constraint name.

CREATE OR REPLACE FUNCTION public.rental_create_charge(r_id uuid, due date, amt numeric)
RETURNS uuid
LANGUAGE plpgsql
AS $$
declare
  rc record;
  cid uuid;
begin
  select * into rc from rentals where id = r_id;

  insert into ledger_entries(
    customer_id, rental_id, vehicle_id, entry_date,
    type, category, amount, due_date, remaining_amount, tenant_id
  )
  values(
    rc.customer_id, rc.id, rc.vehicle_id, due,
    'Charge', 'Rental', amt, due, amt, rc.tenant_id
  )
  on conflict (rental_id, due_date, type, category, COALESCE(extension_id::text, ''))
  do update set
    amount = excluded.amount,
    remaining_amount = excluded.amount,
    tenant_id = excluded.tenant_id;

  select id into cid
  from ledger_entries
  where rental_id = rc.id
    and type = 'Charge'
    and category = 'Rental'
    and due_date = due;

  return cid;
end;
$$;

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

  SELECT rental_fee, tax_amount, service_fee, security_deposit, insurance_premium, delivery_fee, extras_total, discount_amount
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

    v_charge_amount := COALESCE(v_invoice.security_deposit, 0);
    IF v_charge_amount > 0 THEN
      INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, tenant_id)
      VALUES(v_rental.customer_id, v_rental.id, v_rental.vehicle_id, v_rental.start_date, 'Charge', 'Security Deposit', v_charge_amount, v_rental.start_date, v_charge_amount, v_rental.tenant_id)
      ON CONFLICT (rental_id, due_date, type, category, COALESCE(extension_id::text, '')) DO NOTHING;
    END IF;

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
