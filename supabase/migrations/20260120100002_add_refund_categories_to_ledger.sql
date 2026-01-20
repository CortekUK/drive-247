-- Add refund-related categories to ledger_entries category check constraint
-- Current categories: Rental, InitialFee, Initial Fees, Fine, Adjustment
-- Adding: Tax, Service Fee, Security Deposit

-- Drop the existing constraint
ALTER TABLE "public"."ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_category_check";

-- Add updated constraint with new categories
ALTER TABLE "public"."ledger_entries" ADD CONSTRAINT "ledger_entries_category_check"
CHECK (("category" = ANY (ARRAY[
  'Rental'::"text",
  'InitialFee'::"text",
  'Initial Fees'::"text",
  'Fine'::"text",
  'Adjustment'::"text",
  'Tax'::"text",
  'Service Fee'::"text",
  'Security Deposit'::"text"
])));
