-- ============================================
-- Enquiries Feature
-- Lead capture from booking site for vehicles/dates that aren't immediately bookable.
-- Public submissions go through the submit-enquiry edge function (service_role).
-- Portal staff manage enquiries from /enquiries.
-- ============================================

-- 1. Tenant feature flag
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS enquiries_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.enquiries_enabled IS
  'When true, the booking site shows an enquiry CTA and submit-enquiry accepts submissions.';

-- 2. enquiries table
CREATE TABLE IF NOT EXISTS public.enquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Submitter (anonymous-friendly; optional link to existing customer)
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,

  -- Vehicle of interest (nullable -> "any vehicle")
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,

  -- Requested period
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,

  description TEXT NOT NULL,

  -- Workflow
  status TEXT NOT NULL DEFAULT 'new',
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  read_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,

  -- Audit
  source TEXT NOT NULL DEFAULT 'booking_site',
  ip_address INET,
  user_agent TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT enquiries_status_chk CHECK (status IN ('new', 'contacted', 'resolved', 'archived')),
  CONSTRAINT enquiries_dates_chk  CHECK (end_date >= start_date),
  CONSTRAINT enquiries_description_len_chk CHECK (char_length(description) BETWEEN 1 AND 2000),
  CONSTRAINT enquiries_source_chk CHECK (source IN ('booking_site', 'customer_portal', 'admin_manual'))
);

CREATE INDEX IF NOT EXISTS idx_enquiries_tenant_status_created
  ON public.enquiries(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enquiries_tenant_unread
  ON public.enquiries(tenant_id) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_enquiries_customer_id
  ON public.enquiries(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enquiries_vehicle_id
  ON public.enquiries(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enquiries_ip_recent
  ON public.enquiries(ip_address, created_at DESC) WHERE ip_address IS NOT NULL;

-- updated_at trigger (uses existing helper)
DROP TRIGGER IF EXISTS set_enquiries_updated_at ON public.enquiries;
CREATE TRIGGER set_enquiries_updated_at
  BEFORE UPDATE ON public.enquiries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. RLS — mirrors rental_reviews pattern
ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant users can view their own tenant enquiries" ON public.enquiries;
CREATE POLICY "Tenant users can view their own tenant enquiries"
  ON public.enquiries FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "Tenant users can update their own tenant enquiries" ON public.enquiries;
CREATE POLICY "Tenant users can update their own tenant enquiries"
  ON public.enquiries FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "Tenant users can delete their own tenant enquiries" ON public.enquiries;
CREATE POLICY "Tenant users can delete their own tenant enquiries"
  ON public.enquiries FOR DELETE
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

-- INSERT only via service_role (submit-enquiry edge function) — no public policy.

-- 4. Realtime: include enquiries in publication so portal can subscribe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'enquiries'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.enquiries';
  END IF;
END $$;

COMMENT ON TABLE public.enquiries IS
  'Customer enquiries submitted from the booking site (lead capture). Public inserts via submit-enquiry edge function only.';
