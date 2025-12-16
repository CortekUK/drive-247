-- Fix process_payment_transaction function to use proper ON CONFLICT syntax
CREATE OR REPLACE FUNCTION public.process_payment_transaction(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
declare
  p record;
  has_side boolean;
  cat text;
  d date;
  err text;
  sql text;
begin
  -- 1) Load payment
  select *
    into p
  from public.payments
  where id = p_payment_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Payment not found', 'payment_id', p_payment_id);
  end if;

  -- 2) Map category
  if lower(coalesce(p.payment_type, '')) in ('initial fee','initial fees','initialfee') then
    cat := 'Initial Fees';
  elsif lower(coalesce(p.payment_type, '')) = 'rental' then
    cat := 'Rental';
  elsif lower(coalesce(p.payment_type, '')) = 'fine' then
    cat := 'Fines';
  else
    cat := 'Other';
  end if;

  d := coalesce(p.payment_date::date, now()::date);

  -- 3) Ledger: one Payment row per payment (negative amount)
  -- Use ON CONFLICT on the payment_id column directly
  insert into public.ledger_entries
    (customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, payment_id)
  values
    (p.customer_id, p.rental_id, p.vehicle_id, d, 'Payment', cat, -p.amount, d, 0, p.id)
  on conflict (payment_id) do nothing;

  -- 4) P&L: one Revenue row per payment.
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pnl_entries' and column_name = 'side'
  ) into has_side;

  if has_side then
    sql := $q$
      insert into public.pnl_entries
        (vehicle_id, entry_date, side, category, amount, reference, customer_id)
      values
        ($1, $2, 'Revenue', $3, $4, $5, $6)
      on conflict (reference) do nothing;
    $q$;
    execute sql using p.vehicle_id, d, cat, p.amount, p.id::text, p.customer_id;
  else
    sql := $q$
      insert into public.pnl_entries
        (vehicle_id, entry_date, category, amount, reference, customer_id)
      values
        ($1, $2, $3, $4, $5, $6)
      on conflict (reference) do nothing;
    $q$;
    execute sql using p.vehicle_id, d, cat, p.amount, p.id::text, p.customer_id;
  end if;

  -- 5) Try to allocate FIFO if function exists (ignore if not)
  begin
    perform public.payment_apply_fifo(p.id);
  exception when undefined_function then
    -- ignore
  end;

  return jsonb_build_object('ok', true, 'payment_id', p.id, 'category', cat, 'date', d);
exception
  when others then
    err := sqlerrm;
    return jsonb_build_object('ok', false, 'error', err, 'payment_id', p_payment_id);
end;
$$;