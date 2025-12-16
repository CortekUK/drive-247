-- Drop the existing function first
DROP FUNCTION IF EXISTS public.get_pending_charges_for_reminders();

-- Recreate the function with the new return type that includes charge_type
CREATE OR REPLACE FUNCTION public.get_pending_charges_for_reminders()
RETURNS TABLE(
  charge_id uuid, 
  customer_id uuid, 
  customer_name text, 
  customer_email text, 
  customer_phone text, 
  whatsapp_opt_in boolean, 
  rental_id uuid, 
  vehicle_id uuid, 
  vehicle_reg text, 
  due_date date, 
  amount numeric, 
  remaining_amount numeric, 
  customer_balance numeric, 
  days_until_due integer, 
  days_overdue integer,
  charge_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    le.id as charge_id,
    le.customer_id,
    c.name as customer_name,
    c.email as customer_email,
    c.phone as customer_phone,
    c.whatsapp_opt_in,
    le.rental_id,
    le.vehicle_id,
    v.reg as vehicle_reg,
    le.due_date,
    le.amount,
    le.remaining_amount,
    -- Calculate customer balance (total credits - total charges)
    COALESCE((
      SELECT SUM(CASE WHEN type = 'Payment' THEN amount ELSE -amount END)
      FROM ledger_entries le2
      WHERE le2.customer_id = le.customer_id
    ), 0) as customer_balance,
    (le.due_date - CURRENT_DATE)::integer as days_until_due,
    (CURRENT_DATE - le.due_date)::integer as days_overdue,
    le.category as charge_type
  FROM ledger_entries le
  JOIN customers c ON c.id = le.customer_id
  JOIN vehicles v ON v.id = le.vehicle_id
  WHERE le.type = 'Charge' 
    AND le.remaining_amount > 0
    AND le.due_date IS NOT NULL
    AND le.category IN ('Rental', 'Fine', 'InitialFee');
$$;