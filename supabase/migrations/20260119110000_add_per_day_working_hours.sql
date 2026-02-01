-- Migration: Add per-day working hours to tenants table
-- This allows setting different opening/closing times for each day of the week

-- Monday
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS monday_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS monday_open time DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS monday_close time DEFAULT '17:00';

-- Tuesday
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tuesday_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS tuesday_open time DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS tuesday_close time DEFAULT '17:00';

-- Wednesday
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS wednesday_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS wednesday_open time DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS wednesday_close time DEFAULT '17:00';

-- Thursday
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS thursday_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS thursday_open time DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS thursday_close time DEFAULT '17:00';

-- Friday
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS friday_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS friday_open time DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS friday_close time DEFAULT '17:00';

-- Saturday
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS saturday_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS saturday_open time DEFAULT '10:00',
  ADD COLUMN IF NOT EXISTS saturday_close time DEFAULT '14:00';

-- Sunday
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS sunday_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sunday_open time DEFAULT '10:00',
  ADD COLUMN IF NOT EXISTS sunday_close time DEFAULT '14:00';

-- Add comments for documentation
COMMENT ON COLUMN public.tenants.monday_enabled IS 'Whether business is open on Monday';
COMMENT ON COLUMN public.tenants.monday_open IS 'Opening time on Monday (HH:MM format)';
COMMENT ON COLUMN public.tenants.monday_close IS 'Closing time on Monday (HH:MM format)';
