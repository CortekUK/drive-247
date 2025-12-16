-- Add About page to CMS
-- Adds the about page for managing hero, story, why choose us, CTAs, and SEO content

-- Insert About page
INSERT INTO cms_pages (slug, name, description, status)
VALUES (
  'about',
  'About Page',
  'About page hero, story, why choose us, FAQ CTA, final CTA, and SEO settings',
  'draft'
) ON CONFLICT (slug) DO NOTHING;

-- Insert default sections for About page
WITH about_page AS (
  SELECT id FROM cms_pages WHERE slug = 'about'
)
INSERT INTO cms_page_sections (page_id, section_key, content, display_order)
SELECT
  about_page.id,
  section.key,
  section.content::jsonb,
  section.display_order
FROM about_page, (VALUES
  ('hero', '{
    "title": "About Drive917",
    "subtitle": "Setting the standard for premium luxury vehicle rentals across the United Kingdom."
  }', 1),
  ('about_story', '{
    "title": "Excellence in Every Rental",
    "founded_year": "2010",
    "content": "<p>Drive917 was founded with a simple vision: to provide the highest standard of premium vehicle rentals with unmatched flexibility and service.</p><p>What began as a boutique rental service has grown into the trusted choice for executives, professionals, and discerning clients who demand the finest vehicles with exceptional service.</p><p>Our founders recognized the need for a rental service that truly understood the unique requirements of premium vehicle hire—offering flexible daily, weekly, and monthly rates without compromising on quality.</p><p>Discretion, reliability, and uncompromising quality became the pillars upon which Drive917 was built.</p><p>Drive917 operates a fleet of the finest vehicles, each maintained to the highest standards and equipped with premium amenities. From Rolls-Royce to Range Rover, every vehicle represents automotive excellence.</p><p>We offer flexible rental periods tailored to your needs—whether it''s a day, a week, or a month, we provide premium vehicles with transparent pricing and exceptional service.</p><p>Our commitment extends beyond just providing vehicles. We ensure every rental includes comprehensive insurance, 24/7 support, and meticulous vehicle preparation.</p><p>We will never claim to be the biggest company — but what we are, is the pinnacle of excellence in luxury vehicle rentals.</p><p>This commitment creates a service that is second to none:</p><ul><li>Flexible daily, weekly, and monthly rental options</li><li>The finest luxury vehicles in the UK</li><li>Transparent pricing with no hidden fees</li><li>24/7 customer support and roadside assistance</li><li>Immaculate vehicles delivered to your door</li></ul><p>This is more than a rental service — it''s a new standard in luxury vehicle hire.</p>"
  }', 2),
  ('stats', '{
    "items": [
      {
        "icon": "clock",
        "label": "YEARS EXPERIENCE",
        "value": "",
        "suffix": "+",
        "use_dynamic": true,
        "dynamic_source": "years_experience"
      },
      {
        "icon": "car",
        "label": "RENTALS COMPLETED",
        "value": "",
        "suffix": "+",
        "use_dynamic": true,
        "dynamic_source": "total_rentals"
      },
      {
        "icon": "crown",
        "label": "PREMIUM VEHICLES",
        "value": "",
        "suffix": "+",
        "use_dynamic": true,
        "dynamic_source": "active_vehicles"
      },
      {
        "icon": "star",
        "label": "CLIENT RATING",
        "value": "",
        "suffix": "",
        "use_dynamic": true,
        "dynamic_source": "avg_rating"
      }
    ]
  }', 3),
  ('why_choose_us', '{
    "title": "Why Choose Us",
    "items": [
      {
        "icon": "lock",
        "title": "Privacy & Discretion",
        "description": "Your rental details remain completely private. We maintain strict confidentiality for all our distinguished clients."
      },
      {
        "icon": "crown",
        "title": "Premium Fleet",
        "description": "From the Rolls-Royce Phantom to the Range Rover Autobiography, every vehicle represents British excellence and comfort."
      },
      {
        "icon": "shield",
        "title": "Flexible Terms",
        "description": "Choose from daily, weekly, or monthly rental periods. Competitive rates with no hidden fees or surprises."
      },
      {
        "icon": "clock",
        "title": "24/7 Availability",
        "description": "Whether weekday or weekend, we''re ready to respond at a moment''s notice — anywhere across the UK."
      }
    ]
  }', 4),
  ('faq_cta', '{
    "title": "Still have questions?",
    "description": "Our team is here to help. Contact us for personalised assistance.",
    "button_text": "Call Us Now"
  }', 5),
  ('final_cta', '{
    "title": "Ready to Experience Premium Luxury?",
    "description": "Join our distinguished clients and enjoy world-class vehicle rental service.",
    "tagline": "Professional • Discreet • 24/7 Availability"
  }', 6),
  ('seo', '{
    "title": "About Drive917 — Premium Luxury Car Rentals",
    "description": "Discover Drive917 — the UK''s trusted name in premium car rentals, offering unmatched quality, flexibility, and discretion.",
    "keywords": "about Drive917, luxury car rental UK, premium vehicle hire, executive car rental, luxury fleet"
  }', 7)
) AS section(key, content, display_order)
ON CONFLICT (page_id, section_key) DO NOTHING;
