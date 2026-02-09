ALTER TABLE "public"."ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_category_check";
ALTER TABLE "public"."ledger_entries" ADD CONSTRAINT "ledger_entries_category_check"
CHECK (("category" = ANY (ARRAY[
  'Rental'::text, 'InitialFee'::text, 'Initial Fees'::text, 'Fine'::text, 'Adjustment'::text,
  'Tax'::text, 'Service Fee'::text, 'Security Deposit'::text, 'Extension'::text
])));
