-- =============================================================================
-- BASELINE MIGRATION — Bonzah onboarding objects that were applied DIRECTLY to
-- prod and never tracked in migrations. This file reflects the LIVE prod schema
-- (captured 2026-07-10 via information_schema + pg_policies) so fresh/staging
-- databases match production. Fully idempotent; a no-op against prod.
--
-- Covers:
--   * tenants Bonzah credential columns (bonzah_username/password/mode/brochure_url)
--   * bonzah_onboarding_submissions table + indexes + RLS
--   * bonzah-onboarding-files storage bucket + RLS
-- (integration_bonzah and bonzah_onboarding_drafts already live in tracked
--  migrations and are intentionally NOT duplicated here.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. tenants Bonzah credential columns (plaintext today; Vault-hardened later)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS bonzah_username   text,
  ADD COLUMN IF NOT EXISTS bonzah_password   text,
  ADD COLUMN IF NOT EXISTS bonzah_mode       text NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS bonzah_brochure_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenants'::regclass
      AND conname = 'tenants_bonzah_mode_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_bonzah_mode_check
      CHECK (bonzah_mode IN ('test', 'live'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. bonzah_onboarding_submissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bonzah_onboarding_submissions (
  id                         uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                  uuid        NOT NULL,
  submitted_by               uuid,
  business_trade_name        text        NOT NULL,
  business_legal_name        text        NOT NULL,
  primary_contact_first_name text,
  primary_contact_last_name  text,
  primary_contact_email      text        NOT NULL,
  primary_contact_phone      text,
  ein                        text,
  status                     text        NOT NULL DEFAULT 'pending',
  admin_note                 text,
  reviewed_by                uuid,
  reviewed_at                timestamptz,
  data                       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  file_urls                  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  submitted_at               timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bonzah_onboarding_submissions_pkey PRIMARY KEY (id),
  CONSTRAINT bonzah_onboarding_submissions_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT bonzah_onboarding_submissions_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT bonzah_onboarding_submissions_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES public.app_users(id) ON DELETE SET NULL,
  CONSTRAINT bonzah_onboarding_submissions_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES public.app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bonzah_onb_tenant_id    ON public.bonzah_onboarding_submissions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bonzah_onb_status       ON public.bonzah_onboarding_submissions (status);
CREATE INDEX IF NOT EXISTS idx_bonzah_onb_submitted_at ON public.bonzah_onboarding_submissions (submitted_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_bonzah_onboarding_submissions ON public.bonzah_onboarding_submissions;
CREATE TRIGGER set_updated_at_bonzah_onboarding_submissions
  BEFORE UPDATE ON public.bonzah_onboarding_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.bonzah_onboarding_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_select_own_bonzah_onboarding ON public.bonzah_onboarding_submissions;
CREATE POLICY tenants_select_own_bonzah_onboarding
  ON public.bonzah_onboarding_submissions FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS tenants_insert_own_bonzah_onboarding ON public.bonzah_onboarding_submissions;
CREATE POLICY tenants_insert_own_bonzah_onboarding
  ON public.bonzah_onboarding_submissions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS super_admin_update_bonzah_onboarding ON public.bonzah_onboarding_submissions;
CREATE POLICY super_admin_update_bonzah_onboarding
  ON public.bonzah_onboarding_submissions FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS super_admin_delete_bonzah_onboarding ON public.bonzah_onboarding_submissions;
CREATE POLICY super_admin_delete_bonzah_onboarding
  ON public.bonzah_onboarding_submissions FOR DELETE TO authenticated
  USING (is_super_admin());

-- ---------------------------------------------------------------------------
-- 3. bonzah-onboarding-files storage bucket + RLS (private; {tenant_id}/... paths)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('bonzah-onboarding-files', 'bonzah-onboarding-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS tenants_read_own_bonzah_onboarding_files ON storage.objects;
CREATE POLICY tenants_read_own_bonzah_onboarding_files
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bonzah-onboarding-files'
    AND ((storage.foldername(name))[1] = get_user_tenant_id()::text OR is_super_admin())
  );

DROP POLICY IF EXISTS tenants_upload_bonzah_onboarding_files ON storage.objects;
CREATE POLICY tenants_upload_bonzah_onboarding_files
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bonzah-onboarding-files'
    AND (storage.foldername(name))[1] = get_user_tenant_id()::text
  );

DROP POLICY IF EXISTS tenants_delete_own_bonzah_onboarding_files ON storage.objects;
CREATE POLICY tenants_delete_own_bonzah_onboarding_files
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'bonzah-onboarding-files'
    AND ((storage.foldername(name))[1] = get_user_tenant_id()::text OR is_super_admin())
  );
