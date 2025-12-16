-- 1) Safety: prevent double application
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ux_payment_app_unique') THEN
    ALTER TABLE payment_applications
      ADD CONSTRAINT ux_payment_app_unique UNIQUE (payment_id, charge_entry_id);
  END IF;
END$$;

-- 2) Charges: enforce one charge per rental per due date
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_rental_charge_unique
ON ledger_entries(rental_id, due_date)
WHERE type = 'Charge' AND category = 'Rental';

-- 3) Backfill rental charges through end_date (or today if end_date is null)
CREATE OR REPLACE FUNCTION backfill_rental_charges_full()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  d DATE;
  stop_date DATE;
BEGIN
  FOR r IN
    SELECT id, customer_id, vehicle_id, start_date, COALESCE(end_date, CURRENT_DATE) as end_at, monthly_amount
    FROM rentals
  LOOP
    d := r.start_date;
    stop_date := r.end_at;
    WHILE d <= stop_date LOOP
      INSERT INTO ledger_entries(
        customer_id, rental_id, vehicle_id, type, category,
        entry_date, due_date, amount, remaining_amount
      )
      VALUES (
        r.customer_id, r.id, r.vehicle_id, 'Charge', 'Rental',
        d, d, r.monthly_amount, r.monthly_amount
      )
      ON CONFLICT ON CONSTRAINT ux_ledger_rental_charge_unique DO NOTHING;
      d := (d + INTERVAL '1 month')::DATE;
    END LOOP;
  END LOOP;
END;
$$;

-- 4) Backfill rental_id on existing payments by matching (customer_id, vehicle_id, payment_date) to an active rental
CREATE OR REPLACE FUNCTION attach_payments_to_rentals()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE payments p
     SET rental_id = r.id
    FROM rentals r
   WHERE p.rental_id IS NULL
     AND p.customer_id = r.customer_id
     AND p.vehicle_id  = r.vehicle_id
     AND p.payment_date >= r.start_date
     AND p.payment_date <= COALESCE(r.end_date, p.payment_date);
END;
$$;

-- 5) FIFO that allocates across ALL charges (due and future) for the rental
CREATE OR REPLACE FUNCTION payment_apply_fifo(p_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_amt NUMERIC;
  v_left NUMERIC;
  v_rental UUID;
  v_customer UUID;
  v_vehicle UUID;
  v_pay_date DATE;
  c RECORD;
  to_apply NUMERIC;
BEGIN
  SELECT amount, rental_id, customer_id, vehicle_id, payment_date
    INTO v_amt, v_rental, v_customer, v_vehicle, v_pay_date
  FROM payments WHERE id = p_id;

  -- Skip if no rental_id
  IF v_rental IS NULL THEN
    RETURN;
  END IF;

  v_left := v_amt;

  -- Mirror payment in ledger (audit trail)
  INSERT INTO ledger_entries(
    customer_id, rental_id, vehicle_id, entry_date,
    type, category, amount, remaining_amount
  )
  VALUES(
    v_customer, v_rental, v_vehicle, v_pay_date,
    'Payment', 'Rental', v_amt, 0
  )
  ON CONFLICT DO NOTHING;

  -- Allocate to ALL charges (due and future) for this rental
  FOR c IN
    SELECT id, remaining_amount, due_date
      FROM ledger_entries
     WHERE rental_id = v_rental
       AND type='Charge' AND category='Rental'
       AND remaining_amount > 0
     ORDER BY due_date ASC, entry_date ASC
  LOOP
    EXIT WHEN v_left <= 0;

    to_apply := LEAST(c.remaining_amount, v_left);

    INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
    VALUES (p_id, c.id, to_apply)
    ON CONFLICT ON CONSTRAINT ux_payment_app_unique DO NOTHING;

    UPDATE ledger_entries
       SET remaining_amount = remaining_amount - to_apply
     WHERE id = c.id;

    -- Book revenue on the charge due date (even if future)
    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v_vehicle, c.due_date, 'Revenue', 'Rental', to_apply, p_id::text);

    v_left := v_left - to_apply;
  END LOOP;
END;
$$;

-- 6) Re-apply all payments chronologically (soft rebuild)
CREATE OR REPLACE FUNCTION reapply_all_payments()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  p RECORD;
BEGIN
  -- Reset only computed pieces safely
  DELETE FROM pnl_entries WHERE category='Rental' AND source_ref IS NOT NULL;
  UPDATE ledger_entries
    SET remaining_amount = amount
   WHERE type='Charge' AND category='Rental';

  DELETE FROM payment_applications;

  FOR p IN
    SELECT id FROM payments WHERE rental_id IS NOT NULL ORDER BY payment_date ASC, created_at ASC NULLS LAST
  LOOP
    PERFORM payment_apply_fifo(p.id);
  END LOOP;
END;
$$;

-- 7) Function to get customer net position
CREATE OR REPLACE FUNCTION get_customer_net_position(customer_id_param uuid)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  total_charges NUMERIC := 0;
  total_applied NUMERIC := 0;
  net_position NUMERIC;
BEGIN
  -- Get total charges for customer's rentals
  SELECT COALESCE(SUM(le.amount), 0) INTO total_charges
  FROM ledger_entries le
  JOIN rentals r ON r.id = le.rental_id
  WHERE r.customer_id = customer_id_param
    AND le.type = 'Charge'
    AND le.category = 'Rental';
  
  -- Get total applied payments to those charges
  SELECT COALESCE(SUM(pa.amount_applied), 0) INTO total_applied
  FROM payment_applications pa
  JOIN ledger_entries le ON le.id = pa.charge_entry_id
  JOIN rentals r ON r.id = le.rental_id
  WHERE r.customer_id = customer_id_param
    AND le.type = 'Charge'
    AND le.category = 'Rental';
  
  net_position := total_charges - total_applied;
  RETURN net_position;
END;
$$;

-- Run backfill functions
SELECT backfill_rental_charges_full();
SELECT attach_payments_to_rentals();
SELECT reapply_all_payments();