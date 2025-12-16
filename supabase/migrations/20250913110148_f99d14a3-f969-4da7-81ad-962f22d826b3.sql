-- Backfill functions for existing data
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
      );
      d := (d + INTERVAL '1 month')::DATE;
    END LOOP;
  END LOOP;
EXCEPTION
  WHEN unique_violation THEN
    -- Skip duplicate entries
    NULL;
END;
$$;

-- Backfill rental_id on existing payments by matching (customer_id, vehicle_id, payment_date) to an active rental
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

-- Re-apply all payments chronologically (soft rebuild)
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
    SELECT id FROM payments WHERE rental_id IS NOT NULL ORDER BY payment_date ASC
  LOOP
    PERFORM payment_apply_fifo(p.id);
  END LOOP;
END;
$$;

-- Run backfill functions
SELECT backfill_rental_charges_full();
SELECT attach_payments_to_rentals();
SELECT reapply_all_payments();