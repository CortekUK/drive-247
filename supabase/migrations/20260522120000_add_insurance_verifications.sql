-- insurance_verifications: AI-verified uploaded insurance documents, optionally attached to a rental
CREATE TABLE public.insurance_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rental_id UUID REFERENCES public.rentals(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,

  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','verified','flagged','rejected','failed')),
  ai_score INT CHECK (ai_score IS NULL OR (ai_score >= 0 AND ai_score <= 100)),
  ai_findings JSONB,
  extracted_fields JSONB,
  ai_error TEXT,

  uploaded_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  attached_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  attached_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_insurance_verifications_tenant ON public.insurance_verifications(tenant_id);
CREATE INDEX idx_insurance_verifications_rental ON public.insurance_verifications(rental_id) WHERE rental_id IS NOT NULL;
CREATE INDEX idx_insurance_verifications_customer ON public.insurance_verifications(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_insurance_verifications_status ON public.insurance_verifications(status);

CREATE TRIGGER trg_insurance_verifications_updated_at
  BEFORE UPDATE ON public.insurance_verifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.insurance_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY insurance_verifications_select
  ON public.insurance_verifications FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY insurance_verifications_insert
  ON public.insurance_verifications FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY insurance_verifications_update
  ON public.insurance_verifications FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY insurance_verifications_delete
  ON public.insurance_verifications FOR DELETE
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Storage bucket for uploaded insurance documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'insurance-verifications',
  'insurance-verifications',
  true,
  20971520,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "insurance_verifications_storage_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'insurance-verifications'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.get_user_tenant_id()::text
      OR public.is_super_admin()
    )
  );

CREATE POLICY "insurance_verifications_storage_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'insurance-verifications'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.get_user_tenant_id()::text
      OR public.is_super_admin()
    )
  );

CREATE POLICY "insurance_verifications_storage_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'insurance-verifications'
    AND (
      auth.role() = 'service_role'
      OR (storage.foldername(name))[1] = public.get_user_tenant_id()::text
      OR public.is_super_admin()
    )
  );
