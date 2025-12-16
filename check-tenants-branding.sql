-- Check if tenants table has branding columns

-- Check FleetVana and Global Motion Transport tenants
SELECT
  id,
  company_name,
  slug,
  app_name,
  primary_color,
  secondary_color,
  accent_color,
  logo_url,
  favicon_url,
  status
FROM tenants
WHERE slug IN ('fleetvana', 'globalmotiontransport')
ORDER BY slug;

-- Check all columns in tenants table
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'tenants'
  AND table_schema = 'public'
ORDER BY ordinal_position;
