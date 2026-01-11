-- Fix CMS pages RLS to allow super admin access
-- The cms_pages and cms_page_sections policies were missing is_super_admin() check

-- ============================================================================
-- STEP 1: Update RLS policies on cms_pages table
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "cms_pages_tenant_read" ON "public"."cms_pages";
DROP POLICY IF EXISTS "cms_pages_tenant_insert" ON "public"."cms_pages";
DROP POLICY IF EXISTS "cms_pages_tenant_update" ON "public"."cms_pages";
DROP POLICY IF EXISTS "cms_pages_tenant_delete" ON "public"."cms_pages";

-- Create new policies that allow super admin access
CREATE POLICY "cms_pages_tenant_read"
ON "public"."cms_pages"
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);

CREATE POLICY "cms_pages_tenant_insert"
ON "public"."cms_pages"
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

CREATE POLICY "cms_pages_tenant_update"
ON "public"."cms_pages"
FOR UPDATE
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
)
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);

CREATE POLICY "cms_pages_tenant_delete"
ON "public"."cms_pages"
FOR DELETE
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

-- ============================================================================
-- STEP 2: Update RLS policies on cms_page_sections table
-- ============================================================================

DROP POLICY IF EXISTS "cms_sections_tenant_read" ON "public"."cms_page_sections";
DROP POLICY IF EXISTS "cms_sections_tenant_insert" ON "public"."cms_page_sections";
DROP POLICY IF EXISTS "cms_sections_tenant_update" ON "public"."cms_page_sections";
DROP POLICY IF EXISTS "cms_sections_tenant_delete" ON "public"."cms_page_sections";

-- Create new policies that allow super admin access
CREATE POLICY "cms_sections_tenant_read"
ON "public"."cms_page_sections"
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM cms_pages
    WHERE cms_pages.id = cms_page_sections.page_id
    AND (
      cms_pages.tenant_id = public.get_user_tenant_id()
      OR cms_pages.tenant_id IS NULL
      OR public.is_super_admin()
    )
  )
);

CREATE POLICY "cms_sections_tenant_insert"
ON "public"."cms_page_sections"
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM cms_pages
    WHERE cms_pages.id = cms_page_sections.page_id
    AND (
      cms_pages.tenant_id = public.get_user_tenant_id()
      OR public.is_super_admin()
    )
  )
);

CREATE POLICY "cms_sections_tenant_update"
ON "public"."cms_page_sections"
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM cms_pages
    WHERE cms_pages.id = cms_page_sections.page_id
    AND (
      cms_pages.tenant_id = public.get_user_tenant_id()
      OR cms_pages.tenant_id IS NULL
      OR public.is_super_admin()
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM cms_pages
    WHERE cms_pages.id = cms_page_sections.page_id
    AND (
      cms_pages.tenant_id = public.get_user_tenant_id()
      OR cms_pages.tenant_id IS NULL
      OR public.is_super_admin()
    )
  )
);

CREATE POLICY "cms_sections_tenant_delete"
ON "public"."cms_page_sections"
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM cms_pages
    WHERE cms_pages.id = cms_page_sections.page_id
    AND (
      cms_pages.tenant_id = public.get_user_tenant_id()
      OR public.is_super_admin()
    )
  )
);

-- ============================================================================
-- STEP 3: Update RLS policies on cms_page_versions table
-- ============================================================================

DROP POLICY IF EXISTS "Allow authenticated read cms_page_versions" ON "public"."cms_page_versions";
DROP POLICY IF EXISTS "Allow authenticated insert cms_page_versions" ON "public"."cms_page_versions";
DROP POLICY IF EXISTS "Allow authenticated delete cms_page_versions" ON "public"."cms_page_versions";

CREATE POLICY "cms_versions_tenant_read"
ON "public"."cms_page_versions"
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR tenant_id IS NULL
  OR public.is_super_admin()
);

CREATE POLICY "cms_versions_tenant_insert"
ON "public"."cms_page_versions"
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

CREATE POLICY "cms_versions_tenant_delete"
ON "public"."cms_page_versions"
FOR DELETE
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  OR public.is_super_admin()
);

COMMENT ON POLICY "cms_pages_tenant_read" ON "public"."cms_pages" IS
  'Allow users to read CMS pages for their tenant, global pages, or if they are super admin';
