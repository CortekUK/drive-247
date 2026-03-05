-- Add auth_logo_url column for tenant-specific login page logo
-- When set, the portal login page shows this image instead of text.
-- Other pages (sidebar, booking) continue using logo_url as before.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auth_logo_url TEXT;

-- Set RBVS auth logo from their existing CMS logo
UPDATE tenants
SET auth_logo_url = 'https://hviqoaokxvlancmftwuo.supabase.co/storage/v1/object/public/company-logos/logo-1772212439211.png'
WHERE slug = 'rbvs';
