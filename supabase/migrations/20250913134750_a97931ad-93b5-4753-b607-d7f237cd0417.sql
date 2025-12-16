-- Update ledger_entries category check constraint to include 'Initial Fees'
ALTER TABLE public.ledger_entries 
DROP CONSTRAINT IF EXISTS ledger_entries_category_check;

ALTER TABLE public.ledger_entries 
ADD CONSTRAINT ledger_entries_category_check 
CHECK (category = ANY (ARRAY['Rental'::text, 'InitialFee'::text, 'Initial Fees'::text, 'Fine'::text, 'Adjustment'::text]));

-- Now apply the existing Initial Fee payment
SELECT apply_payment_fully('8da15782-4d55-40f2-889a-756b793f9a14');