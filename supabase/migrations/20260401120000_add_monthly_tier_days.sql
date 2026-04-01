-- Add configurable monthly tier threshold per tenant
-- Controls when monthly pricing tier kicks in (>= 30 or >= 31 days)
-- Also used as the pro-rata divisor for monthly rate calculations

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS monthly_tier_days integer NOT NULL DEFAULT 30;

-- Add check constraint only if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monthly_tier_days_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT monthly_tier_days_check CHECK (monthly_tier_days IN (30, 31));
  END IF;
END $$;
