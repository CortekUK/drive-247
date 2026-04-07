-- ============================================
-- Blog Feature: Categories, Posts, Versions
-- Tenant-isolated blog system with full SEO support
-- ============================================

-- ===================
-- 0. Tenant toggle
-- ===================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS blog_enabled BOOLEAN DEFAULT false;

-- ===================
-- 1. blog_categories
-- ===================
CREATE TABLE IF NOT EXISTS public.blog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT blog_categories_tenant_slug_unique UNIQUE (tenant_id, slug)
);

ALTER TABLE public.blog_categories ENABLE ROW LEVEL SECURITY;

-- Authenticated: full access (tenant isolation enforced at app layer, matching cms_pages pattern)
DROP POLICY IF EXISTS "Authenticated full access blog categories" ON public.blog_categories;
CREATE POLICY "Authenticated full access blog categories"
  ON public.blog_categories FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Anon: read all categories (needed for booking-side category filter)
DROP POLICY IF EXISTS "Anon can read blog categories" ON public.blog_categories;
CREATE POLICY "Anon can read blog categories"
  ON public.blog_categories FOR SELECT
  TO anon
  USING (true);

GRANT SELECT ON public.blog_categories TO anon;

-- Triggers & indexes
DROP TRIGGER IF EXISTS set_blog_categories_updated_at ON public.blog_categories;
CREATE TRIGGER set_blog_categories_updated_at
  BEFORE UPDATE ON public.blog_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_blog_categories_tenant_id
  ON public.blog_categories(tenant_id);

CREATE INDEX IF NOT EXISTS idx_blog_categories_tenant_slug
  ON public.blog_categories(tenant_id, slug);

-- ===================
-- 2. blog_posts
-- ===================
CREATE TABLE IF NOT EXISTS public.blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  excerpt TEXT,
  content TEXT,
  featured_image_url TEXT,
  category_id UUID REFERENCES public.blog_categories(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'draft' NOT NULL,
  is_featured BOOLEAN DEFAULT false,
  author_name TEXT,
  author_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  -- SEO fields
  meta_title TEXT,
  meta_description TEXT,
  meta_keywords TEXT,
  canonical_url TEXT,
  noindex BOOLEAN DEFAULT false,
  -- Computed fields
  reading_time_minutes SMALLINT DEFAULT 1,
  -- Publishing
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT blog_posts_tenant_slug_unique UNIQUE (tenant_id, slug),
  CONSTRAINT blog_posts_status_check CHECK (status IN ('draft', 'published'))
);

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

-- Authenticated: full access (tenant isolation enforced at app layer, matching cms_pages pattern)
DROP POLICY IF EXISTS "Authenticated full access blog posts" ON public.blog_posts;
CREATE POLICY "Authenticated full access blog posts"
  ON public.blog_posts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Anon: read only published posts (for booking site)
DROP POLICY IF EXISTS "Anon can read published blog posts" ON public.blog_posts;
CREATE POLICY "Anon can read published blog posts"
  ON public.blog_posts FOR SELECT
  TO anon
  USING (status = 'published');

GRANT SELECT ON public.blog_posts TO anon;

-- Triggers & indexes
DROP TRIGGER IF EXISTS set_blog_posts_updated_at ON public.blog_posts;
CREATE TRIGGER set_blog_posts_updated_at
  BEFORE UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_blog_posts_tenant_id
  ON public.blog_posts(tenant_id);

CREATE INDEX IF NOT EXISTS idx_blog_posts_tenant_slug
  ON public.blog_posts(tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_blog_posts_tenant_status_published
  ON public.blog_posts(tenant_id, status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_posts_tenant_category
  ON public.blog_posts(tenant_id, category_id);

CREATE INDEX IF NOT EXISTS idx_blog_posts_tenant_featured
  ON public.blog_posts(tenant_id, is_featured) WHERE is_featured = true;

-- ===================
-- 3. blog_post_versions
-- ===================
CREATE TABLE IF NOT EXISTS public.blog_post_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.blog_post_versions ENABLE ROW LEVEL SECURITY;

-- Authenticated: full access (tenant isolation enforced at app layer, matching cms_pages pattern)
DROP POLICY IF EXISTS "Authenticated full access blog versions" ON public.blog_post_versions;
CREATE POLICY "Authenticated full access blog versions"
  ON public.blog_post_versions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_blog_post_versions_post_id
  ON public.blog_post_versions(post_id);

CREATE INDEX IF NOT EXISTS idx_blog_post_versions_tenant_id
  ON public.blog_post_versions(tenant_id);

-- ===================
-- 4. Update seed function to include blog CMS page
-- ===================
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
    ('blog', 'Blog', 'Blog listing page settings', 'draft', NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Seed blog CMS page for existing tenants that don't have one
INSERT INTO cms_pages (slug, name, description, status, tenant_id)
SELECT 'blog', 'Blog', 'Blog listing page settings', 'draft', t.id
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM cms_pages cp
  WHERE cp.tenant_id = t.id AND cp.slug = 'blog'
);

-- ===================
-- 5. Grants for authenticated role
-- ===================
GRANT ALL ON public.blog_categories TO authenticated;
GRANT ALL ON public.blog_posts TO authenticated;
GRANT ALL ON public.blog_post_versions TO authenticated;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

-- ===================
-- 6. Comments
-- ===================
COMMENT ON TABLE public.blog_categories IS
  'Blog categories per tenant. Each category has a unique slug within the tenant.';

COMMENT ON TABLE public.blog_posts IS
  'Blog posts per tenant with full SEO support, draft/published workflow, and rich HTML content.';

COMMENT ON TABLE public.blog_post_versions IS
  'Version history for blog posts. A snapshot is created each time a post is published.';

COMMENT ON COLUMN public.tenants.blog_enabled IS
  'Whether the blog feature is enabled for this tenant. Controls visibility on booking site.';
