-- Add Reviews page to CMS
-- Adds the reviews page for managing feedback CTA content

-- Insert Reviews page
INSERT INTO cms_pages (slug, name, description, status)
VALUES (
  'reviews',
  'Reviews Page',
  'Customer reviews page hero, feedback CTA, and SEO settings',
  'draft'
) ON CONFLICT (slug) DO NOTHING;

-- Insert default sections for Reviews page
WITH reviews_page AS (
  SELECT id FROM cms_pages WHERE slug = 'reviews'
)
INSERT INTO cms_page_sections (page_id, section_key, content, display_order)
SELECT
  reviews_page.id,
  section.key,
  section.content::jsonb,
  section.display_order
FROM reviews_page, (VALUES
  ('hero', '{
    "title": "Customer Reviews",
    "subtitle": "What our customers say about their luxury vehicle rental experience."
  }', 1),
  ('feedback_cta', '{
    "title": "Would you like to share your experience?",
    "description": "We value your feedback and would love to hear about your rental experience with Drive917.",
    "button_text": "Submit Feedback",
    "empty_state_message": "Be the first to share your Drive917 experience."
  }', 2),
  ('seo', '{
    "title": "Drive917 — Customer Reviews",
    "description": "Read verified customer reviews of Drive917''s luxury car rentals. Real experiences from our distinguished clientele.",
    "keywords": "Drive917 reviews, luxury car rental reviews, customer testimonials, verified reviews"
  }', 3)
) AS section(key, content, display_order)
ON CONFLICT (page_id, section_key) DO NOTHING;
