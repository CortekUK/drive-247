-- Migration: Add lockbox feature for vehicle key delivery
-- Allows tenants to configure lockbox-based key handover for delivery rentals

-- ============================================
-- 1. Add lockbox settings to tenants table
-- ============================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS lockbox_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lockbox_code_length integer,
  ADD COLUMN IF NOT EXISTS lockbox_notification_methods jsonb DEFAULT '["email"]'::jsonb;

COMMENT ON COLUMN public.tenants.lockbox_enabled IS 'Master toggle for lockbox feature';
COMMENT ON COLUMN public.tenants.lockbox_code_length IS 'Fixed code length (4/6/8) or NULL for free-form entry';
COMMENT ON COLUMN public.tenants.lockbox_notification_methods IS 'Array of notification channels: email, sms, whatsapp';

-- Validate code length if set
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_lockbox_code_length_valid
  CHECK (lockbox_code_length IS NULL OR lockbox_code_length IN (4, 6, 8));

-- ============================================
-- 2. Add lockbox fields to vehicles table
-- ============================================
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS lockbox_code text,
  ADD COLUMN IF NOT EXISTS lockbox_instructions text;

COMMENT ON COLUMN public.vehicles.lockbox_code IS 'Lockbox combination code for key delivery';
COMMENT ON COLUMN public.vehicles.lockbox_instructions IS 'Instructions for finding/using the lockbox (e.g. "Attached to rear left wheel arch")';

-- ============================================
-- 3. Add delivery method to rentals table
-- ============================================
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS delivery_method text;

COMMENT ON COLUMN public.rentals.delivery_method IS 'How keys were handed over: lockbox, in_person, or NULL for non-delivery';

ALTER TABLE public.rentals
  ADD CONSTRAINT rentals_delivery_method_valid
  CHECK (delivery_method IS NULL OR delivery_method IN ('lockbox', 'in_person'));

-- ============================================
-- 4. Add lockbox notification templates table
-- ============================================
-- Stores customisable email/SMS templates for lockbox notifications per tenant
CREATE TABLE IF NOT EXISTS public.lockbox_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel text NOT NULL, -- 'email', 'sms', 'whatsapp'
  subject text, -- email subject only
  body text NOT NULL, -- template body with {{variable}} placeholders
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, channel)
);

COMMENT ON TABLE public.lockbox_templates IS 'Customisable notification templates for lockbox code delivery';

-- RLS policies
ALTER TABLE public.lockbox_templates ENABLE ROW LEVEL SECURITY;

-- Tenant users can read their own templates
CREATE POLICY "Tenant users can view their lockbox templates"
  ON public.lockbox_templates FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

-- Tenant admins can manage their own templates
CREATE POLICY "Tenant admins can manage their lockbox templates"
  ON public.lockbox_templates FOR ALL
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

-- Updated_at trigger
CREATE TRIGGER set_lockbox_templates_updated_at
  BEFORE UPDATE ON public.lockbox_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS idx_lockbox_templates_tenant_channel
  ON public.lockbox_templates(tenant_id, channel);
