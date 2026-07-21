-- =============================================================================
-- Sales Onboarding (Phase 1)
--
-- Adds everything the super-admin "Sales" tab / George's onboarding flow needs:
--   1. A `sales_agent` role on app_users (least-privilege: NOT a super admin,
--      tenant_id NULL) + is_sales_agent() helper + relaxed check_tenant_id.
--   2. sales_onboarding_submissions table (replaces the Google Sheet) + RLS.
--   3. company-logos / cms-media storage buckets + policies (were created by
--      hand in the dashboard and are untracked -> upload breaks on fresh envs).
--   4. site-settings CMS page added to the auto-seed trigger + backfill of
--      existing production tenants (fixes the "CMS logo upload not working").
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. sales_agent role
-- -----------------------------------------------------------------------------
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS is_sales_agent boolean NOT NULL DEFAULT false;

-- SECURITY DEFINER helper mirroring is_super_admin() / is_bonzah_partner()
CREATE OR REPLACE FUNCTION public.is_sales_agent()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_sales_agent FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_sales_agent() TO authenticated, anon, service_role;

-- Relax check_tenant_id: sales agents (like super admins & bonzah partners)
-- carry tenant_id NULL. Preserves the exact prior semantics for the other roles.
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS check_tenant_id;
ALTER TABLE public.app_users
  ADD CONSTRAINT check_tenant_id CHECK (
       (is_super_admin = true  AND tenant_id IS NULL)
    OR (is_bonzah_partner = true AND is_super_admin = false AND tenant_id IS NULL)
    OR (is_sales_agent = true AND is_super_admin = false AND is_bonzah_partner = false AND tenant_id IS NULL)
    OR (is_super_admin = false AND is_bonzah_partner = false AND is_sales_agent = false AND tenant_id IS NOT NULL)
  );

-- -----------------------------------------------------------------------------
-- 2. sales_onboarding_submissions — captures George's onboarding form per tenant
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_onboarding_submissions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  created_by            uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  -- Google-form fields
  first_name            text,
  business_name         text,
  slug                  text,
  vehicle_type          text,
  fleet_size            text,
  location              text,
  business_phone        text,
  business_email        text,
  operating_hours       text,
  business_colours      text,          -- raw free-text input ("Black and Gold")
  logo_url              text,
  wants_marketing       boolean,
  has_meta_ad_account   boolean,
  meta_daily_budget     text,
  other_info            text,
  -- provisioning outputs
  subscription_amount   integer,        -- cents; the paywall amount George entered
  subscription_currency text DEFAULT 'usd',
  extracted_colors      jsonb,          -- { primary, secondary, accent, palette, style }
  generated_email       text,           -- the admin login email handed to the client
  portal_url            text,
  booking_url           text,
  status                text NOT NULL DEFAULT 'created',  -- created | failed
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- NOTE: the plaintext first-login password is intentionally NOT stored — it is
-- deterministic from the slug and the client must change it on first login.

CREATE INDEX IF NOT EXISTS idx_sales_onboarding_tenant ON public.sales_onboarding_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_onboarding_created_at ON public.sales_onboarding_submissions(created_at DESC);

ALTER TABLE public.sales_onboarding_submissions ENABLE ROW LEVEL SECURITY;

-- Sales agents and super admins can read; nobody else.
DROP POLICY IF EXISTS "Sales & super admins read onboarding submissions" ON public.sales_onboarding_submissions;
CREATE POLICY "Sales & super admins read onboarding submissions"
  ON public.sales_onboarding_submissions FOR SELECT
  TO authenticated
  USING (is_sales_agent() OR is_super_admin());

-- Only service_role (the create-sales-onboarding edge fn) writes.
DROP POLICY IF EXISTS "Service role manages onboarding submissions" ON public.sales_onboarding_submissions;
CREATE POLICY "Service role manages onboarding submissions"
  ON public.sales_onboarding_submissions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_sales_onboarding_updated_at ON public.sales_onboarding_submissions;
CREATE TRIGGER trg_sales_onboarding_updated_at
  BEFORE UPDATE ON public.sales_onboarding_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Storage buckets: company-logos (logos/favicon/OG) + cms-media (CMS library)
--    These were created by hand in the dashboard and have NO tracked policies,
--    which is why logo upload silently breaks on some environments.
-- -----------------------------------------------------------------------------
-- NOTE: these buckets usually already exist (created by hand in the dashboard),
-- so the ON CONFLICT branch is the one that actually runs on an existing
-- project. It must therefore re-assert file_size_limit too — only setting
-- `public` left the live buckets with file_size_limit = NULL, i.e. no server
-- side cap at all, which is how prod ended up unbounded.
-- allowed_mime_types is deliberately NOT set: these buckets also carry favicons
-- (image/x-icon) and CMS media, and an over-tight allowlist would break those
-- existing upload paths.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('company-logos', 'company-logos', true, 10485760),
  ('cms-media',     'cms-media',     true, 10485760)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = COALESCE(storage.buckets.file_size_limit, EXCLUDED.file_size_limit);

-- Public read for both buckets (logos/CMS media are shown on public sites).
DROP POLICY IF EXISTS "Public read company-logos" ON storage.objects;
CREATE POLICY "Public read company-logos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "Public read cms-media" ON storage.objects;
CREATE POLICY "Public read cms-media"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'cms-media');

-- Authenticated portal users (any tenant admin) can upload/replace/delete.
DROP POLICY IF EXISTS "Authenticated write company-logos" ON storage.objects;
CREATE POLICY "Authenticated write company-logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "Authenticated update company-logos" ON storage.objects;
CREATE POLICY "Authenticated update company-logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'company-logos')
  WITH CHECK (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "Authenticated delete company-logos" ON storage.objects;
CREATE POLICY "Authenticated delete company-logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "Authenticated write cms-media" ON storage.objects;
CREATE POLICY "Authenticated write cms-media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'cms-media');

DROP POLICY IF EXISTS "Authenticated update cms-media" ON storage.objects;
CREATE POLICY "Authenticated update cms-media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'cms-media')
  WITH CHECK (bucket_id = 'cms-media');

DROP POLICY IF EXISTS "Authenticated delete cms-media" ON storage.objects;
CREATE POLICY "Authenticated delete cms-media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'cms-media');

-- Service role full access to both (edge functions / onboarding provisioning).
DROP POLICY IF EXISTS "Service role manages branding buckets" ON storage.objects;
CREATE POLICY "Service role manages branding buckets"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id IN ('company-logos', 'cms-media'))
  WITH CHECK (bucket_id IN ('company-logos', 'cms-media'));

-- -----------------------------------------------------------------------------
-- 4. Seed the `site-settings` CMS page for new tenants + backfill existing ones.
--    Without this row, /cms/site-settings shows "page not found" and the logo
--    uploader never mounts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_cms_pages_for_tenant()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO cms_pages (slug, name, description, status, tenant_id) VALUES
    ('home', 'Home', 'Homepage content and hero section', 'draft', NEW.id),
    ('about', 'About Us', 'About the company', 'draft', NEW.id),
    ('contact', 'Contact', 'Contact information and form', 'draft', NEW.id),
    ('fleet', 'Our Fleet', 'Vehicle fleet showcase', 'draft', NEW.id),
    ('reviews', 'Reviews', 'Customer testimonials', 'draft', NEW.id),
    ('promotions', 'Promotions', 'Special offers and promotions', 'draft', NEW.id),
    ('terms', 'Terms & Conditions', 'Terms of service', 'draft', NEW.id),
    ('privacy', 'Privacy Policy', 'Privacy policy page', 'draft', NEW.id),
    ('blog', 'Blog', 'Blog listing page settings', 'draft', NEW.id),
    ('site-settings', 'Site Settings', 'Global header, footer, logo and social links', 'draft', NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill: give every existing tenant a site-settings page if missing.
INSERT INTO cms_pages (slug, name, description, status, tenant_id)
SELECT 'site-settings', 'Site Settings', 'Global header, footer, logo and social links', 'draft', t.id
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM cms_pages p
  WHERE p.tenant_id = t.id AND p.slug = 'site-settings'
);
