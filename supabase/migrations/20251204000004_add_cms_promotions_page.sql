-- Add Promotions page to CMS
-- Adds the promotions page for managing hero, how it works, empty state, terms, and SEO content
-- Note: Uses existing cms-media storage bucket for hero images

-- Insert Promotions page
INSERT INTO cms_pages (slug, name, description, status)
VALUES (
  'promotions',
  'Promotions Page',
  'Promotions page hero, how it works section, empty state, terms & conditions, and SEO settings',
  'draft'
) ON CONFLICT (slug) DO NOTHING;

-- Insert default sections for Promotions page
WITH promotions_page AS (
  SELECT id FROM cms_pages WHERE slug = 'promotions'
)
INSERT INTO cms_page_sections (page_id, section_key, content, display_order)
SELECT
  promotions_page.id,
  section.key,
  section.content::jsonb,
  section.display_order
FROM promotions_page, (VALUES
  ('promotions_hero', '{
    "headline": "Promotions & Offers",
    "subheading": "Exclusive rental offers with transparent savings.",
    "primary_cta_text": "View Fleet & Pricing",
    "primary_cta_href": "/fleet",
    "secondary_cta_text": "Book Now",
    "background_image": ""
  }', 1),
  ('how_it_works', '{
    "title": "How Promotions Work",
    "subtitle": "Simple steps to save on your luxury car rental",
    "steps": [
      {
        "number": "1",
        "title": "Select Offer",
        "description": "Browse active promotions and choose your preferred deal"
      },
      {
        "number": "2",
        "title": "Choose Vehicle",
        "description": "Select from eligible vehicles in our premium fleet"
      },
      {
        "number": "3",
        "title": "Apply at Checkout",
        "description": "Discount automatically applied with promo code"
      }
    ]
  }', 2),
  ('empty_state', '{
    "title_active": "No active promotions right now",
    "title_default": "No promotions found",
    "description": "Check back soon or browse our Fleet & Pricing.",
    "button_text": "Browse Fleet & Pricing"
  }', 3),
  ('terms', '{
    "title": "Terms & Conditions",
    "terms": [
      "Promotions are subject to availability and vehicle eligibility",
      "Discounts cannot be combined with other offers",
      "Valid for new bookings only during the promotional period",
      "Promo codes must be applied at the time of booking",
      "Drive 917 reserves the right to modify or cancel promotions at any time",
      "Standard rental terms and conditions apply"
    ]
  }', 4),
  ('seo', '{
    "title": "Promotions & Offers | Drive 917 - Exclusive Luxury Car Rental Deals",
    "description": "Exclusive deals on luxury car rentals with daily, weekly, and monthly rates. Limited-time Drive 917 offers with transparent savings.",
    "keywords": "luxury car rental deals, car rental promotions, exclusive offers, discount car hire, Drive 917 deals"
  }', 5)
) AS section(key, content, display_order)
ON CONFLICT (page_id, section_key) DO NOTHING;
