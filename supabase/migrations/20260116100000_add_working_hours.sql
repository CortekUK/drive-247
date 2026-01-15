-- Add working hours settings to tenants table
-- Allows tenants to configure business hours that restrict booking access

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS working_hours_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS working_hours_open time DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS working_hours_close time DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS working_hours_always_open boolean DEFAULT false;

COMMENT ON COLUMN public.tenants.working_hours_enabled IS 'Whether to enforce working hours restrictions on booking';
COMMENT ON COLUMN public.tenants.working_hours_open IS 'Business opening time (HH:MM format in tenant timezone)';
COMMENT ON COLUMN public.tenants.working_hours_close IS 'Business closing time (HH:MM format in tenant timezone)';
COMMENT ON COLUMN public.tenants.working_hours_always_open IS 'If true, business is 24/7 and working hours are not enforced';
