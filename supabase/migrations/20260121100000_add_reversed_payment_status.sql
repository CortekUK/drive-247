-- Add 'Reversed' to payment status constraint
-- This allows manual payments to be reversed/voided

-- Drop the existing constraint
ALTER TABLE "public"."payments" DROP CONSTRAINT IF EXISTS "payments_status_check";

-- Add updated constraint with 'Reversed' status
ALTER TABLE "public"."payments" ADD CONSTRAINT "payments_status_check"
CHECK ("status" = ANY (ARRAY['Applied', 'Credit', 'Partial', 'Reversed', 'Pending', 'Completed', 'Refunded', 'Partial Refund']));

-- Add comment explaining the status values
COMMENT ON COLUMN "public"."payments"."status" IS 'Payment status: Applied (fully allocated), Credit (unallocated balance), Partial (partially allocated), Reversed (manually voided), Pending, Completed, Refunded, Partial Refund';
