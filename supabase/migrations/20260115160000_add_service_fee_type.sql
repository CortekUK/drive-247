-- Add service fee type column to tenants table (percentage or fixed_amount)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS service_fee_type text DEFAULT 'fixed_amount';

-- Add constraint to ensure valid service fee type
ALTER TABLE public.tenants
  ADD CONSTRAINT service_fee_type_valid CHECK (service_fee_type IN ('percentage', 'fixed_amount'));

-- Rename service_fee_amount to service_fee_value for clarity (supports both percentage and fixed amount)
-- Note: keeping service_fee_amount for backward compatibility, service_fee_value will be the canonical name
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS service_fee_value numeric(10,2) DEFAULT 0;

-- Copy existing values from service_fee_amount to service_fee_value if not already set
UPDATE public.tenants
SET service_fee_value = COALESCE(service_fee_amount, 0)
WHERE service_fee_value IS NULL OR service_fee_value = 0;

-- Add constraint to ensure service fee value is non-negative
ALTER TABLE public.tenants
  ADD CONSTRAINT service_fee_value_positive CHECK (service_fee_value >= 0);

-- For percentage type, ensure value is <= 100
-- Note: This is handled in application logic for flexibility

COMMENT ON COLUMN public.tenants.service_fee_type IS 'Type of service fee: percentage or fixed_amount';
COMMENT ON COLUMN public.tenants.service_fee_value IS 'Service fee value (percentage 0-100 or fixed amount in dollars)';
