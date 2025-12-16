-- Protection Plans: Add Anonymous Access and Invoice Breakdown Support
-- Run this migration after the initial protection plans migration

-- 1. Add RLS policies for anonymous users (needed for client booking flow)
-- Drop existing policies if they exist first
DROP POLICY IF EXISTS "Anonymous users can insert protection selections" ON public.rental_protection_selections;
DROP POLICY IF EXISTS "Anonymous users can view protection selections" ON public.rental_protection_selections;

CREATE POLICY "Anonymous users can insert protection selections"
ON public.rental_protection_selections
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Anonymous users can view protection selections"
ON public.rental_protection_selections
FOR SELECT
TO anon
USING (true);

-- 2. Add rental_fee and protection_fee columns to invoices table
-- This allows proper breakdown of rental vs protection costs
ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS rental_fee DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS protection_fee DECIMAL(10, 2);

-- 3. Backfill existing invoices (set rental_fee = subtotal, protection_fee = 0)
UPDATE public.invoices
SET rental_fee = subtotal, protection_fee = 0
WHERE rental_fee IS NULL;

-- 4. Add helpful comments
COMMENT ON COLUMN public.invoices.rental_fee IS 'Vehicle rental cost only (excluding protection)';
COMMENT ON COLUMN public.invoices.protection_fee IS 'Protection plan cost (if selected)';

-- 5. Grant permissions to anon for protection tables
GRANT SELECT ON public.protection_plans TO anon;
GRANT INSERT, SELECT ON public.rental_protection_selections TO anon;
