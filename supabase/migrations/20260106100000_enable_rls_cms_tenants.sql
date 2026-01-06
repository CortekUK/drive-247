-- Enable RLS on cms_pages, cms_page_sections, and tenants tables
-- This ensures the existing policies are enforced

-- Enable RLS on cms_pages
ALTER TABLE IF EXISTS "public"."cms_pages" ENABLE ROW LEVEL SECURITY;

-- Enable RLS on cms_page_sections
ALTER TABLE IF EXISTS "public"."cms_page_sections" ENABLE ROW LEVEL SECURITY;

-- Enable RLS on tenants
ALTER TABLE IF EXISTS "public"."tenants" ENABLE ROW LEVEL SECURITY;

-- Ensure anonymous users can read published CMS pages
-- Drop and recreate to ensure it exists with correct settings
DROP POLICY IF EXISTS "cms_pages_anon_read_published" ON "public"."cms_pages";
CREATE POLICY "cms_pages_anon_read_published"
  ON "public"."cms_pages"
  FOR SELECT
  TO anon
  USING (status = 'published');

-- Ensure anonymous users can read CMS sections of published pages
DROP POLICY IF EXISTS "cms_sections_anon_read" ON "public"."cms_page_sections";
CREATE POLICY "cms_sections_anon_read"
  ON "public"."cms_page_sections"
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM cms_pages
      WHERE cms_pages.id = cms_page_sections.page_id
      AND cms_pages.status = 'published'
    )
  );

-- Ensure anyone (anon + authenticated) can read active tenants
DROP POLICY IF EXISTS "tenants_public_read_active" ON "public"."tenants";
CREATE POLICY "tenants_public_read_active"
  ON "public"."tenants"
  FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

-- Grant necessary permissions
GRANT SELECT ON "public"."cms_pages" TO anon;
GRANT SELECT ON "public"."cms_page_sections" TO anon;
GRANT SELECT ON "public"."tenants" TO anon;

COMMENT ON POLICY "cms_pages_anon_read_published" ON "public"."cms_pages" IS
  'Allow anonymous users to read published CMS pages for the booking site';

COMMENT ON POLICY "cms_sections_anon_read" ON "public"."cms_page_sections" IS
  'Allow anonymous users to read CMS sections of published pages';

COMMENT ON POLICY "tenants_public_read_active" ON "public"."tenants" IS
  'Allow anyone to read active tenant information for multi-tenant routing';
