-- Add security deposit settings to tenants table
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS deposit_mode text DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS global_deposit_amount numeric(10,2) DEFAULT 0;

-- Add constraint for deposit mode values
ALTER TABLE public.tenants
  ADD CONSTRAINT deposit_mode_values CHECK (deposit_mode IN ('global', 'per_vehicle'));

-- Add security deposit to vehicles table
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS security_deposit numeric(10,2) DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.tenants.deposit_mode IS 'Deposit mode: global (single amount) or per_vehicle (individual amounts)';
COMMENT ON COLUMN public.tenants.global_deposit_amount IS 'Global security deposit amount (used when deposit_mode is global)';
COMMENT ON COLUMN public.vehicles.security_deposit IS 'Per-vehicle security deposit (used when deposit_mode is per_vehicle)';
