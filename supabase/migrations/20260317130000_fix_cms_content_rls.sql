-- Fix RLS on CMS content tables that currently have wide-open policies (USING (true))
-- Tables: faqs, testimonials, promotions, cms_media, cms_page_versions
-- Pattern follows cms_pages from 20260110110000_fix_cms_rls_super_admin.sql

-- ============================================================================
-- STEP 1: Enable RLS on all affected tables
-- ============================================================================

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_page_versions ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 2: FAQs
-- ============================================================================

-- Drop existing wide-open policies
DROP POLICY IF EXISTS "Allow authenticated users to manage FAQs" ON public.faqs;
DROP POLICY IF EXISTS "Allow public to read active FAQs" ON public.faqs;

-- Anon can only read active FAQs (booking site uses anon key)
CREATE POLICY "faqs_anon_read"
ON public.faqs
FOR SELECT TO anon
USING (is_active = true);

-- Authenticated: read own tenant + global + super admin
CREATE POLICY "faqs_tenant_read"
ON public.faqs
FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);

-- Authenticated: insert into own tenant only
CREATE POLICY "faqs_tenant_insert"
ON public.faqs
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- Authenticated: update own tenant only
CREATE POLICY "faqs_tenant_update"
ON public.faqs
FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
)
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- Authenticated: delete own tenant only
CREATE POLICY "faqs_tenant_delete"
ON public.faqs
FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- ============================================================================
-- STEP 3: Testimonials
-- ============================================================================

-- Drop existing wide-open policies
DROP POLICY IF EXISTS "Allow authenticated users to manage testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Allow public to view testimonials" ON public.testimonials;

-- Anon can read all testimonials (booking site)
CREATE POLICY "testimonials_anon_read"
ON public.testimonials
FOR SELECT TO anon
USING (true);

-- Authenticated: read own tenant + global + super admin
CREATE POLICY "testimonials_tenant_read"
ON public.testimonials
FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);

-- Authenticated: insert into own tenant only
CREATE POLICY "testimonials_tenant_insert"
ON public.testimonials
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- Authenticated: update own tenant only
CREATE POLICY "testimonials_tenant_update"
ON public.testimonials
FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
)
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- Authenticated: delete own tenant only
CREATE POLICY "testimonials_tenant_delete"
ON public.testimonials
FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- ============================================================================
-- STEP 4: Promotions
-- ============================================================================

-- Drop existing wide-open policies
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.promotions;
DROP POLICY IF EXISTS "Allow public read" ON public.promotions;

-- Anon can read all promotions (booking site)
CREATE POLICY "promotions_anon_read"
ON public.promotions
FOR SELECT TO anon
USING (true);

-- Authenticated: read own tenant + global + super admin
CREATE POLICY "promotions_tenant_read"
ON public.promotions
FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);

-- Authenticated: insert into own tenant only
CREATE POLICY "promotions_tenant_insert"
ON public.promotions
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- Authenticated: update own tenant only
CREATE POLICY "promotions_tenant_update"
ON public.promotions
FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
)
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- Authenticated: delete own tenant only
CREATE POLICY "promotions_tenant_delete"
ON public.promotions
FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- ============================================================================
-- STEP 5: CMS Media
-- ============================================================================

-- Drop existing wide-open policies
DROP POLICY IF EXISTS "Allow anon read cms_media" ON public.cms_media;
DROP POLICY IF EXISTS "Allow authenticated read cms_media" ON public.cms_media;
DROP POLICY IF EXISTS "Allow authenticated insert cms_media" ON public.cms_media;
DROP POLICY IF EXISTS "Allow authenticated delete cms_media" ON public.cms_media;

-- Anon can read all media (booking site renders images)
CREATE POLICY "cms_media_anon_read"
ON public.cms_media
FOR SELECT TO anon
USING (true);

-- Authenticated: read own tenant + global + super admin
CREATE POLICY "cms_media_tenant_read"
ON public.cms_media
FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);

-- Authenticated: insert into own tenant only
CREATE POLICY "cms_media_tenant_insert"
ON public.cms_media
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- Authenticated: update own tenant only
CREATE POLICY "cms_media_tenant_update"
ON public.cms_media
FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
)
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- Authenticated: delete own tenant only
CREATE POLICY "cms_media_tenant_delete"
ON public.cms_media
FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- ============================================================================
-- STEP 6: CMS Page Versions (verify RLS enabled, policies already fixed)
-- ============================================================================

-- RLS is enabled above in Step 1.
-- Secure policies were already created in 20260110110000_fix_cms_rls_super_admin.sql,
-- but the old wide-open policies were only dropped there (not here).
-- Drop any remaining old policies that might still exist, just in case.
DROP POLICY IF EXISTS "Allow authenticated read cms_page_versions" ON public.cms_page_versions;
DROP POLICY IF EXISTS "Allow authenticated insert cms_page_versions" ON public.cms_page_versions;
DROP POLICY IF EXISTS "Allow authenticated delete cms_page_versions" ON public.cms_page_versions;

-- The secure policies (cms_versions_tenant_read, cms_versions_tenant_insert,
-- cms_versions_tenant_delete) were created in 20260110110000_fix_cms_rls_super_admin.sql.
-- Re-create them idempotently in case that migration hasn't run.
DROP POLICY IF EXISTS "cms_versions_tenant_read" ON public.cms_page_versions;
DROP POLICY IF EXISTS "cms_versions_tenant_insert" ON public.cms_page_versions;
DROP POLICY IF EXISTS "cms_versions_tenant_delete" ON public.cms_page_versions;

CREATE POLICY "cms_versions_tenant_read"
ON public.cms_page_versions
FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);

CREATE POLICY "cms_versions_tenant_insert"
ON public.cms_page_versions
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

CREATE POLICY "cms_versions_tenant_delete"
ON public.cms_page_versions
FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);
