-- Automatically seed default CMS pages when a new tenant is created
-- Business Logic: Super admin configures CMS content for each rental company

-- Function to seed default CMS pages for a new tenant
CREATE OR REPLACE FUNCTION seed_cms_pages_for_tenant()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert default CMS pages for the new tenant
  INSERT INTO cms_pages (slug, name, description, status, tenant_id) VALUES
    ('home', 'Home', 'Homepage content and hero section', 'draft', NEW.id),
    ('about', 'About Us', 'About the company', 'draft', NEW.id),
    ('contact', 'Contact', 'Contact information and form', 'draft', NEW.id),
    ('fleet', 'Our Fleet', 'Vehicle fleet showcase', 'draft', NEW.id),
    ('reviews', 'Reviews', 'Customer testimonials', 'draft', NEW.id),
    ('promotions', 'Promotions', 'Special offers and promotions', 'draft', NEW.id),
    ('terms', 'Terms & Conditions', 'Terms of service', 'draft', NEW.id),
    ('privacy', 'Privacy Policy', 'Privacy policy page', 'draft', NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically seed CMS pages after tenant creation
DROP TRIGGER IF EXISTS trigger_seed_cms_pages ON tenants;
CREATE TRIGGER trigger_seed_cms_pages
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION seed_cms_pages_for_tenant();

-- Add comment for documentation
COMMENT ON FUNCTION seed_cms_pages_for_tenant() IS
  'Automatically creates default CMS pages (home, about, contact, fleet, reviews, promotions, terms, privacy) when a new tenant/rental company is created. Super admin then configures the content for each rental.';
