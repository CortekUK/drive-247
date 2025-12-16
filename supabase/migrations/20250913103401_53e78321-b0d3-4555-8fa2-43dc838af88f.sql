-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_customer_credit(uuid);

-- Create function to get customer credit (unapplied payment amounts)
CREATE OR REPLACE FUNCTION get_customer_credit(p_customer_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_credit numeric := 0;
BEGIN
  -- Calculate total unapplied credit for customer
  SELECT COALESCE(
    SUM(p.amount) - COALESCE(SUM(pa.amount_applied), 0), 0
  ) INTO total_credit
  FROM payments p
  LEFT JOIN payment_applications pa ON pa.payment_id = p.id
  WHERE p.customer_id = p_customer_id;
  
  RETURN GREATEST(total_credit, 0);
END;
$$;

-- Create function to get rental credit (unapplied payment amounts for specific rental)
CREATE OR REPLACE FUNCTION get_rental_credit(p_rental_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_credit numeric := 0;
BEGIN
  -- Calculate total unapplied credit for rental
  SELECT COALESCE(
    SUM(p.amount) - COALESCE(SUM(pa.amount_applied), 0), 0
  ) INTO total_credit
  FROM payments p
  LEFT JOIN payment_applications pa ON pa.payment_id = p.id
  WHERE p.rental_id = p_rental_id;
  
  RETURN GREATEST(total_credit, 0);
END;
$$;

-- Create function to get payment remaining amount
CREATE OR REPLACE FUNCTION get_payment_remaining(p_payment_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  payment_amount numeric;
  applied_amount numeric := 0;
BEGIN
  -- Get payment amount
  SELECT amount INTO payment_amount
  FROM payments
  WHERE id = p_payment_id;
  
  -- Get total applied amount
  SELECT COALESCE(SUM(amount_applied), 0) INTO applied_amount
  FROM payment_applications
  WHERE payment_id = p_payment_id;
  
  RETURN GREATEST(payment_amount - applied_amount, 0);
END;
$$;