-- CMS Tables Migration
-- Creates tables for managing dynamic website content

-- ============================================
-- Table: cms_pages
-- Stores page-level metadata
-- ============================================
CREATE TABLE IF NOT EXISTS cms_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster slug lookups
CREATE INDEX IF NOT EXISTS idx_cms_pages_slug ON cms_pages(slug);
CREATE INDEX IF NOT EXISTS idx_cms_pages_status ON cms_pages(status);

-- ============================================
-- Table: cms_page_sections
-- Stores individual content sections for each page
-- ============================================
CREATE TABLE IF NOT EXISTS cms_page_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID REFERENCES cms_pages(id) ON DELETE CASCADE,
  section_key VARCHAR(100) NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  display_order INT DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(page_id, section_key)
);

-- Index for faster page lookups
CREATE INDEX IF NOT EXISTS idx_cms_page_sections_page_id ON cms_page_sections(page_id);

-- ============================================
-- Table: cms_page_versions
-- Stores version history for rollback capability
-- ============================================
CREATE TABLE IF NOT EXISTS cms_page_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID REFERENCES cms_pages(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  content JSONB NOT NULL,
  created_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- Index for version lookups
CREATE INDEX IF NOT EXISTS idx_cms_page_versions_page_id ON cms_page_versions(page_id);
CREATE INDEX IF NOT EXISTS idx_cms_page_versions_created_at ON cms_page_versions(created_at DESC);

-- ============================================
-- Table: cms_media
-- Media library for image management
-- ============================================
CREATE TABLE IF NOT EXISTS cms_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_size INT,
  mime_type VARCHAR(100),
  alt_text VARCHAR(255),
  folder VARCHAR(100) DEFAULT 'general',
  uploaded_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for folder-based queries
CREATE INDEX IF NOT EXISTS idx_cms_media_folder ON cms_media(folder);
CREATE INDEX IF NOT EXISTS idx_cms_media_created_at ON cms_media(created_at DESC);

-- ============================================
-- Trigger: Auto-update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_cms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cms_pages_updated_at
  BEFORE UPDATE ON cms_pages
  FOR EACH ROW
  EXECUTE FUNCTION update_cms_updated_at();

CREATE TRIGGER cms_page_sections_updated_at
  BEFORE UPDATE ON cms_page_sections
  FOR EACH ROW
  EXECUTE FUNCTION update_cms_updated_at();

-- ============================================
-- RLS Policies
-- ============================================

-- Enable RLS on all CMS tables
ALTER TABLE cms_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_page_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_page_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_media ENABLE ROW LEVEL SECURITY;

-- cms_pages policies
CREATE POLICY "Allow authenticated read cms_pages" ON cms_pages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert cms_pages" ON cms_pages
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update cms_pages" ON cms_pages
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated delete cms_pages" ON cms_pages
  FOR DELETE TO authenticated USING (true);

-- Public read for published pages (for Drive917-client)
CREATE POLICY "Allow anon read published cms_pages" ON cms_pages
  FOR SELECT TO anon USING (status = 'published');

-- cms_page_sections policies
CREATE POLICY "Allow authenticated read cms_page_sections" ON cms_page_sections
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert cms_page_sections" ON cms_page_sections
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update cms_page_sections" ON cms_page_sections
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated delete cms_page_sections" ON cms_page_sections
  FOR DELETE TO authenticated USING (true);

-- Public read for sections of published pages
CREATE POLICY "Allow anon read cms_page_sections" ON cms_page_sections
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM cms_pages
      WHERE cms_pages.id = cms_page_sections.page_id
      AND cms_pages.status = 'published'
    )
  );

-- cms_page_versions policies (authenticated only)
CREATE POLICY "Allow authenticated read cms_page_versions" ON cms_page_versions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert cms_page_versions" ON cms_page_versions
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated delete cms_page_versions" ON cms_page_versions
  FOR DELETE TO authenticated USING (true);

-- cms_media policies
CREATE POLICY "Allow authenticated read cms_media" ON cms_media
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert cms_media" ON cms_media
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated delete cms_media" ON cms_media
  FOR DELETE TO authenticated USING (true);

-- Public read for media (images need to be accessible)
CREATE POLICY "Allow anon read cms_media" ON cms_media
  FOR SELECT TO anon USING (true);

-- ============================================
-- Insert default Contact page
-- ============================================
INSERT INTO cms_pages (slug, name, description, status)
VALUES (
  'contact',
  'Contact Page',
  'Contact information, form settings, and trust badges',
  'draft'
) ON CONFLICT (slug) DO NOTHING;

-- Insert default sections for Contact page
WITH contact_page AS (
  SELECT id FROM cms_pages WHERE slug = 'contact'
)
INSERT INTO cms_page_sections (page_id, section_key, content, display_order)
SELECT
  contact_page.id,
  section.key,
  section.content::jsonb,
  section.display_order
FROM contact_page, (VALUES
  ('hero', '{
    "title": "Contact Drive917",
    "subtitle": "Get in touch for premium vehicle rentals, chauffeur services, and exclusive offers in Los Angeles."
  }', 1),
  ('contact_info', '{
    "phone": {
      "number": "+44 800 123 4567",
      "availability": "24 hours a day, 7 days a week, 365 days a year"
    },
    "email": {
      "address": "info@drive917.com",
      "response_time": "Response within 2 hours during business hours (PST)"
    },
    "office": {
      "address": "123 Luxury Lane, London, UK"
    },
    "whatsapp": {
      "number": "+447900123456",
      "description": "Quick response for urgent enquiries"
    }
  }', 2),
  ('contact_form', '{
    "title": "Send Us a Message",
    "subtitle": "We typically reply within 2 hours during business hours.",
    "success_message": "Thank you for contacting Drive917. Our concierge team will respond within 2 hours during business hours (PST).",
    "gdpr_text": "I consent to being contacted regarding my enquiry.",
    "submit_button_text": "Send Message",
    "subject_options": ["General Enquiry", "Corporate Rental", "Vehicle Availability", "Partnerships"]
  }', 3),
  ('trust_badges', '{
    "badges": [
      {
        "icon": "shield",
        "label": "Secure",
        "tooltip": "Your data and booking details are encrypted and secure"
      },
      {
        "icon": "lock",
        "label": "Confidential",
        "tooltip": "All information is kept strictly confidential"
      },
      {
        "icon": "clock",
        "label": "24/7 Support",
        "tooltip": "Our concierge team is available around the clock"
      }
    ]
  }', 4),
  ('seo', '{
    "title": "Contact Drive917 — Los Angeles Luxury Car Rentals",
    "description": "Get in touch with Drive917 for premium vehicle rentals, chauffeur services, and exclusive offers in Los Angeles.",
    "keywords": "contact Drive917, luxury car rental Los Angeles, premium vehicle rental contact, chauffeur service inquiry"
  }', 5)
) AS section(key, content, display_order)
ON CONFLICT (page_id, section_key) DO NOTHING;

-- ============================================
-- Storage bucket for CMS media
-- Note: This needs to be created via Supabase dashboard or CLI
-- Bucket name: cms-media
-- Public: true
-- File size limit: 5MB
-- Allowed MIME types: image/jpeg, image/png, image/webp, image/svg+xml
-- ============================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
