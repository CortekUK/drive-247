-- Fix duplicate Initial Fees P&L entries
-- 1. Add missing columns to pnl_entries if needed (most should exist)
ALTER TABLE public.pnl_entries 
ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
ADD COLUMN IF NOT EXISTS vehicle_id uuid,
ADD COLUMN IF NOT EXISTS rental_id uuid,
ADD COLUMN IF NOT EXISTS customer_id uuid,
ADD COLUMN IF NOT EXISTS entry_date date DEFAULT current_date NOT NULL,
ADD COLUMN IF NOT EXISTS side text NOT NULL,
ADD COLUMN IF NOT EXISTS category text NOT NULL,
ADD COLUMN IF NOT EXISTS amount numeric NOT NULL,
ADD COLUMN IF NOT EXISTS payment_id uuid;

-- 2. Normalize category variants to canonical "Initial Fees" (with space)
UPDATE public.pnl_entries
SET category = 'Initial Fees'
WHERE lower(replace(category, ' ', '')) IN ('initialfees', 'initialfee', 'initial_fees');

-- 3. Dedupe existing data: keep the earliest row per payment for Initial Fees
DELETE FROM public.pnl_entries p1
USING public.pnl_entries p2
WHERE p1.id > p2.id
  AND p1.payment_id IS NOT NULL
  AND p1.payment_id = p2.payment_id
  AND p1.category = 'Initial Fees'
  AND p2.category = 'Initial Fees';

-- 4. Add check constraint to validate P&L categories
ALTER TABLE public.pnl_entries
ADD CONSTRAINT chk_pnl_category_valid
CHECK (category IN (
  'Initial Fees', 'Rental', 'Acquisition', 'Finance', 'Service', 'Fines', 'Other'
));

-- 5. Create unique index for Initial Fees to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS ux_pnl_initial_fee_once
ON public.pnl_entries (payment_id)
WHERE category = 'Initial Fees';