-- Add tax configuration columns to tenants table
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tax_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_percentage numeric(5,2) DEFAULT 0;

-- Add constraint to ensure tax percentage is between 0 and 100
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tax_percentage_range'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tax_percentage_range CHECK (tax_percentage >= 0 AND tax_percentage <= 100);
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.tax_enabled IS 'Whether tax is enabled for this tenant';
COMMENT ON COLUMN public.tenants.tax_percentage IS 'Tax percentage to apply to rentals (0-100)';
