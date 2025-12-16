-- Fix security warnings by setting search_path for all functions
DROP FUNCTION IF EXISTS pnl_post_acquisition(uuid);
DROP FUNCTION IF EXISTS rental_create_charge(uuid, date, numeric);
DROP FUNCTION IF EXISTS payment_apply_fifo(uuid);
DROP FUNCTION IF EXISTS generate_rental_charges(uuid);
DROP FUNCTION IF EXISTS trigger_generate_rental_charges();
DROP FUNCTION IF EXISTS trigger_post_acquisition();

-- Post acquisition costs to P&L (with security)
CREATE OR REPLACE FUNCTION pnl_post_acquisition(v_id uuid)
RETURNS void 
LANGUAGE sql 
SECURITY DEFINER
SET search_path = 'public'
AS $$
  INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
  SELECT id, acquisition_date, 'Cost', 'Acquisition', purchase_price, id::text
  FROM vehicles v
  WHERE v.id = v_id AND v.purchase_price IS NOT NULL AND v.acquisition_date IS NOT NULL
  ON CONFLICT DO NOTHING;
$$;

-- Create rental charge (with security)
CREATE OR REPLACE FUNCTION rental_create_charge(r_id uuid, due date, amt numeric)
RETURNS uuid 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE 
  rc record; 
  cid uuid;
BEGIN
  SELECT * INTO rc FROM rentals WHERE id = r_id;
  INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount)
  VALUES(rc.customer_id, rc.id, rc.vehicle_id, due, 'Charge', 'Rental', amt, due, amt)
  RETURNING id INTO cid;
  RETURN cid;
END $$;

-- Apply payment FIFO with P&L posting (with security)
CREATE OR REPLACE FUNCTION payment_apply_fifo(p_id uuid)
RETURNS void 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_amt numeric; 
  v_left numeric; 
  v_rental uuid; 
  v_customer uuid; 
  v_vehicle uuid; 
  v_date date;
  c record; 
  applied_total numeric := 0;
BEGIN
  SELECT amount, rental_id, customer_id, vehicle_id, payment_date
  INTO v_amt, v_rental, v_customer, v_vehicle, v_date
  FROM payments WHERE id = p_id;

  v_left := v_amt;

  -- Mirror receipt in ledger
  INSERT INTO ledger_entries(customer_id, rental_id, vehicle_id, entry_date, type, category, amount, remaining_amount)
  VALUES(v_customer, v_rental, v_vehicle, v_date, 'Payment', 'Rental', v_amt, 0);

  -- Apply to charges FIFO
  FOR c IN
    SELECT id, remaining_amount
    FROM ledger_entries
    WHERE rental_id = v_rental AND type = 'Charge' AND remaining_amount > 0 AND due_date <= CURRENT_DATE
    ORDER BY due_date ASC, entry_date ASC
  LOOP
    EXIT WHEN v_left <= 0;
    
    IF c.remaining_amount <= v_left THEN
      INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
      VALUES(p_id, c.id, c.remaining_amount);
      UPDATE ledger_entries SET remaining_amount = 0 WHERE id = c.id;
      applied_total := applied_total + c.remaining_amount;
      v_left := v_left - c.remaining_amount;
    ELSE
      INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
      VALUES(p_id, c.id, v_left);
      UPDATE ledger_entries SET remaining_amount = remaining_amount - v_left WHERE id = c.id;
      applied_total := applied_total + v_left;
      v_left := 0;
    END IF;
  END LOOP;

  -- Post P&L revenue for applied amount
  IF applied_total > 0 THEN
    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v_vehicle, v_date, 'Revenue', 'Rental', applied_total, p_id::text);
  END IF;
END $$;

-- Generate monthly charges for rental (with security)
CREATE OR REPLACE FUNCTION generate_rental_charges(r_id uuid)
RETURNS void 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  rental_rec record;
  current_month integer := 0;
  charge_date date;
  duration_months integer;
BEGIN
  SELECT * INTO rental_rec FROM rentals WHERE id = r_id;
  
  -- Calculate duration in months
  duration_months := EXTRACT(YEAR FROM AGE(rental_rec.end_date, rental_rec.start_date)) * 12 + 
                     EXTRACT(MONTH FROM AGE(rental_rec.end_date, rental_rec.start_date));
  
  -- Generate monthly charges
  WHILE current_month < duration_months LOOP
    charge_date := rental_rec.start_date + INTERVAL '1 month' * current_month;
    
    PERFORM rental_create_charge(r_id, charge_date, rental_rec.monthly_amount);
    
    current_month := current_month + 1;
  END LOOP;
END $$;

-- Trigger to auto-generate charges on rental creation (with security)
CREATE OR REPLACE FUNCTION trigger_generate_rental_charges()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  PERFORM generate_rental_charges(NEW.id);
  RETURN NEW;
END $$;

-- Trigger to post acquisition costs (with security)
CREATE OR REPLACE FUNCTION trigger_post_acquisition()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.purchase_price IS NOT NULL AND NEW.acquisition_date IS NOT NULL AND 
     (OLD IS NULL OR OLD.purchase_price IS DISTINCT FROM NEW.purchase_price OR 
      OLD.acquisition_date IS DISTINCT FROM NEW.acquisition_date) THEN
    PERFORM pnl_post_acquisition(NEW.id);
  END IF;
  RETURN NEW;
END $$;

-- Recreate triggers
CREATE TRIGGER rental_charges_trigger
  AFTER INSERT ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION trigger_generate_rental_charges();

CREATE TRIGGER vehicle_acquisition_trigger
  AFTER INSERT OR UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_post_acquisition();