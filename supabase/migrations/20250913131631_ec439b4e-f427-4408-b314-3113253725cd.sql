-- Fix duplicate Initial Fees P&L entries and make posting idempotent
-- Handle existing duplicates before creating unique constraint

-- 1. Add payment_id column to pnl_entries if it doesn't exist
ALTER TABLE public.pnl_entries 
ADD COLUMN IF NOT EXISTS payment_id uuid;

-- 2. Try to backfill payment_id for existing Initial Fees entries
-- Match by source_ref which should contain the payment_id as text
UPDATE public.pnl_entries 
SET payment_id = source_ref::uuid
WHERE category IN ('Initial Fees', 'InitialFees') 
  AND payment_id IS NULL 
  AND source_ref IS NOT NULL 
  AND source_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 3. Delete duplicate Initial Fees entries that have the same payment_id (keep earliest by id)
DELETE FROM public.pnl_entries p1
USING public.pnl_entries p2
WHERE p1.id > p2.id
  AND p1.category IN ('Initial Fees', 'InitialFees')
  AND p2.category IN ('Initial Fees', 'InitialFees')
  AND p1.payment_id IS NOT NULL
  AND p1.payment_id = p2.payment_id;

-- 4. Fallback deduplication for entries without payment_id
-- Delete duplicates by vehicle_id, category, amount, and entry_date (keep earliest by id)
DELETE FROM public.pnl_entries p1
USING public.pnl_entries p2
WHERE p1.id > p2.id
  AND p1.category IN ('Initial Fees', 'InitialFees')
  AND p2.category IN ('Initial Fees', 'InitialFees')
  AND p1.vehicle_id = p2.vehicle_id
  AND p1.amount = p2.amount
  AND DATE(p1.entry_date) = DATE(p2.entry_date);

-- 5. Standardize all remaining Initial Fees entries to use "InitialFees" category
UPDATE public.pnl_entries 
SET category = 'InitialFees'
WHERE category = 'Initial Fees';

-- 6. NOW create unique partial index to prevent duplicate Initial Fees per payment
CREATE UNIQUE INDEX IF NOT EXISTS ux_pnl_initial_fee_once
  ON public.pnl_entries (payment_id)
  WHERE category = 'InitialFees' AND payment_id IS NOT NULL;

-- 7. Verify the cleanup worked
DO $$
DECLARE
    duplicate_count integer;
    total_initial_fees integer;
BEGIN
    -- Check for remaining duplicates with payment_id
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT payment_id, COUNT(*) as cnt
        FROM public.pnl_entries 
        WHERE category = 'InitialFees' AND payment_id IS NOT NULL
        GROUP BY payment_id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    SELECT COUNT(*) INTO total_initial_fees
    FROM public.pnl_entries 
    WHERE category = 'InitialFees';
    
    RAISE NOTICE 'Initial Fees cleanup complete:';
    RAISE NOTICE '  - Total InitialFees entries: %', total_initial_fees;
    RAISE NOTICE '  - Remaining duplicates with payment_id: %', duplicate_count;
    
    IF duplicate_count > 0 THEN
        RAISE WARNING 'Still have % duplicate InitialFees entries with payment_id!', duplicate_count;
    END IF;
END $$;