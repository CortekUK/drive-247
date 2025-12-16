-- Fix Initial Fee and Rental Charge Logic
-- 1. Clean up existing incorrect data first
DELETE FROM ledger_entries WHERE payment_id IN (
  SELECT id FROM payments WHERE payment_type = 'InitialFee'
);

-- 2. Remove all future rental charges (keep only current month charges)
DELETE FROM ledger_entries 
WHERE type = 'Charge' 
  AND category = 'Rental' 
  AND due_date > CURRENT_DATE;

-- 3. Create corrected backfill function that only creates first month charge
CREATE OR REPLACE FUNCTION public.backfill_rental_charges_first_month_only()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, customer_id, vehicle_id, start_date, monthly_amount
    FROM rentals
    WHERE status = 'Active'
  LOOP
    -- Only create the first month's charge (due on start date)
    INSERT INTO ledger_entries(
      customer_id, rental_id, vehicle_id, type, category,
      entry_date, due_date, amount, remaining_amount
    )
    VALUES (
      r.customer_id, r.id, r.vehicle_id, 'Charge', 'Rental',
      r.start_date, r.start_date, r.monthly_amount, r.monthly_amount
    )
    ON CONFLICT ON CONSTRAINT ux_rental_charge_unique DO NOTHING;
  END LOOP;
END;
$$;

-- 4. Update process_payment_transaction to handle InitialFee correctly
CREATE OR REPLACE FUNCTION public.process_payment_transaction(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
declare
  p record;
  cat text;
  d date;
  err text;
begin
  -- Load payment
  select * into p from public.payments where id = p_payment_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Payment not found', 'payment_id', p_payment_id);
  end if;

  d := coalesce(p.payment_date::date, now()::date);

  -- Handle InitialFee payments - ONLY create P&L revenue, NO customer ledger entry
  if lower(coalesce(p.payment_type, '')) in ('initial fee','initial fees','initialfee') then
    -- P&L: Company revenue only (no customer debt)
    INSERT INTO public.pnl_entries(
      vehicle_id, entry_date, side, category, amount, reference, customer_id
    )
    VALUES (
      p.vehicle_id, d, 'Revenue', 'Initial Fees', p.amount, p.id::text, p.customer_id
    )
    ON CONFLICT (reference) DO NOTHING;
    
    -- Mark payment as applied (it's just company profit)
    UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p.id;
    
    return jsonb_build_object('ok', true, 'payment_id', p.id, 'category', 'Initial Fees', 'type', 'company_revenue_only');
  end if;

  -- Handle regular payments (Rental, Fine, etc.)
  if lower(coalesce(p.payment_type, '')) = 'rental' then
    cat := 'Rental';
  elsif lower(coalesce(p.payment_type, '')) = 'fine' then
    cat := 'Fines';
  else
    cat := 'Other';
  end if;

  -- Create ledger payment entry (negative amount)
  insert into public.ledger_entries
    (customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, payment_id)
  values
    (p.customer_id, p.rental_id, p.vehicle_id, d, 'Payment', cat, -p.amount, d, 0, p.id)
  on conflict (payment_id) where (payment_id is not null) do nothing;

  -- P&L revenue entry
  insert into public.pnl_entries
    (vehicle_id, entry_date, side, category, amount, reference, customer_id)
  values
    (p.vehicle_id, d, 'Revenue', cat, p.amount, p.id::text, p.customer_id)
  on conflict (reference) do nothing;

  -- Try FIFO allocation
  begin
    perform public.payment_apply_fifo_v2(p.id);
  exception when others then
    -- ignore allocation errors
  end;

  return jsonb_build_object('ok', true, 'payment_id', p.id, 'category', cat, 'date', d);
exception
  when others then
    err := sqlerrm;
    return jsonb_build_object('ok', false, 'error', err, 'payment_id', p_payment_id);
end;
$$;

-- 5. Replace the backfill function to only create first month charges
SELECT public.backfill_rental_charges_first_month_only();

-- 6. Reapply all payments with the new logic
SELECT public.reapply_all_payments_v2();