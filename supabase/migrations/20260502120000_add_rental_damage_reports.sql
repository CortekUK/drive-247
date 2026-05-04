-- ============================================
-- Rental Damage Reports
-- AI-generated damage analysis comparing handover vs return photos
-- ============================================

CREATE TABLE IF NOT EXISTS public.rental_damage_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id UUID NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  generated_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,

  -- Model output
  summary TEXT,
  findings JSONB DEFAULT '[]'::jsonb,
  overall_severity TEXT CHECK (overall_severity IN ('none', 'minor', 'moderate', 'severe')),
  has_new_damage BOOLEAN DEFAULT false,

  -- Snapshot of inputs at time of generation
  giving_photo_count INTEGER DEFAULT 0,
  receiving_photo_count INTEGER DEFAULT 0,
  model TEXT,

  -- Reviewer fields (operator can accept/dispute the AI output)
  reviewed_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,

  generated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- One report per rental (re-runs upsert)
  CONSTRAINT rental_damage_reports_rental_unique UNIQUE (rental_id)
);

ALTER TABLE public.rental_damage_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant users can view their own tenant damage reports" ON public.rental_damage_reports;
CREATE POLICY "Tenant users can view their own tenant damage reports"
  ON public.rental_damage_reports FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "Tenant users can update damage reports for their tenant" ON public.rental_damage_reports;
CREATE POLICY "Tenant users can update damage reports for their tenant"
  ON public.rental_damage_reports FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "Service role can manage damage reports" ON public.rental_damage_reports;
CREATE POLICY "Service role can manage damage reports"
  ON public.rental_damage_reports FOR ALL
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS set_rental_damage_reports_updated_at ON public.rental_damage_reports;
CREATE TRIGGER set_rental_damage_reports_updated_at
  BEFORE UPDATE ON public.rental_damage_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_rental_damage_reports_tenant_id
  ON public.rental_damage_reports(tenant_id);

CREATE INDEX IF NOT EXISTS idx_rental_damage_reports_rental_id
  ON public.rental_damage_reports(rental_id);
