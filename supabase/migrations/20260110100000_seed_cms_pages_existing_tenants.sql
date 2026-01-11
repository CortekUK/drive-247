-- Seed CMS pages for existing tenants that don't have them
-- This fixes tenants created before the auto-seed trigger was added

-- Insert default CMS pages for any tenant that doesn't have them yet
INSERT INTO cms_pages (slug, name, description, status, tenant_id)
SELECT page.slug, page.name, page.description, 'draft', t.id
FROM tenants t
CROSS JOIN (
  VALUES
    ('home', 'Home', 'Homepage content and hero section'),
    ('about', 'About Us', 'About the company'),
    ('contact', 'Contact', 'Contact information and form'),
    ('fleet', 'Our Fleet', 'Vehicle fleet showcase'),
    ('reviews', 'Reviews', 'Customer testimonials'),
    ('promotions', 'Promotions', 'Special offers and promotions'),
    ('terms', 'Terms & Conditions', 'Terms of service'),
    ('privacy', 'Privacy Policy', 'Privacy policy page')
) AS page(slug, name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM cms_pages cp
  WHERE cp.tenant_id = t.id AND cp.slug = page.slug
);

COMMENT ON TABLE cms_pages IS
  'CMS pages for each tenant. Pages are auto-seeded when tenants are created.';
