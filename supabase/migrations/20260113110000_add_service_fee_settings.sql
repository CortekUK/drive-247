-- Add service fee configuration columns to tenants table
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS service_fee_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_fee_amount numeric(10,2) DEFAULT 0;

-- Add constraint to ensure service fee amount is non-negative
ALTER TABLE public.tenants
  ADD CONSTRAINT service_fee_amount_positive CHECK (service_fee_amount >= 0);

COMMENT ON COLUMN public.tenants.service_fee_enabled IS 'Whether service fee is enabled for this tenant';
COMMENT ON COLUMN public.tenants.service_fee_amount IS 'Fixed service fee amount to apply to rentals';
