-- Create unique constraint to prevent duplicate backfill entries
CREATE UNIQUE INDEX IF NOT EXISTS ux_initialfee_ledger_unique
ON public.ledger_entries (rental_id, customer_id, vehicle_id, entry_date, amount)
WHERE type = 'Payment' AND category = 'InitialFee';

-- Backfill missing ledger entries for existing InitialFee payments
INSERT INTO public.ledger_entries (
  rental_id, vehicle_id, customer_id,
  type, category, entry_date, amount, remaining_amount
)
SELECT
  p.rental_id, p.vehicle_id, p.customer_id,
  'Payment'::text, 'InitialFee'::text, p.payment_date, -p.amount, 0
FROM public.payments p
LEFT JOIN public.ledger_entries le
  ON le.rental_id = p.rental_id
 AND le.customer_id = p.customer_id
 AND le.vehicle_id = p.vehicle_id
 AND le.type = 'Payment'
 AND le.category = 'InitialFee'
 AND le.entry_date = p.payment_date
 AND le.amount = -p.amount
WHERE p.payment_type = 'InitialFee'
  AND le.id IS NULL;