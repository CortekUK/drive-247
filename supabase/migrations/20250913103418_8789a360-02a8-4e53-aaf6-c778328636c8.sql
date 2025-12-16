-- Drop all existing functions with the same names
DROP FUNCTION IF EXISTS get_customer_credit(uuid);
DROP FUNCTION IF EXISTS get_rental_credit(uuid);
DROP FUNCTION IF EXISTS get_payment_remaining(uuid);

-- Create function to get customer credit (unapplied payment amounts)
CREATE FUNCTION get_customer_credit(customer_id_param uuid)
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
  WHERE p.customer_id = customer_id_param;
  
  RETURN GREATEST(total_credit, 0);
END;
$$;

-- Create function to get rental credit (unapplied payment amounts for specific rental)
CREATE FUNCTION get_rental_credit(rental_id_param uuid)
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
  WHERE p.rental_id = rental_id_param;
  
  RETURN GREATEST(total_credit, 0);
END;
$$;

-- Create function to get payment remaining amount
CREATE FUNCTION get_payment_remaining(payment_id_param uuid)
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
  WHERE id = payment_id_param;
  
  -- Get total applied amount
  SELECT COALESCE(SUM(amount_applied), 0) INTO applied_amount
  FROM payment_applications
  WHERE payment_id = payment_id_param;
  
  RETURN GREATEST(payment_amount - applied_amount, 0);
END;
$$;