-- ============================================
-- TEST BRANDING ISOLATION BETWEEN TENANTS
-- ============================================
-- This verifies that FleetVana and Global Motion Transport
-- have separate branding configurations
-- ============================================

-- Step 1: Check current branding for both tenants
SELECT
  id,
  company_name,
  slug,
  app_name,
  primary_color,
  secondary_color,
  accent_color,
  light_primary_color,
  dark_primary_color,
  logo_url,
  favicon_url
FROM tenants
WHERE slug IN ('fleetvana', 'globalmotiontransport')
ORDER BY slug;

-- Step 2: Expected initial state (before any changes)
-- FleetVana:     primary_color = #3B82F6 (blue) OR default #C6A256 (gold)
-- Global Motion: primary_color = #C6A256 (gold - default)

-- ============================================
-- TEST PROCEDURE:
-- ============================================

-- 1. Login as Super Admin to FleetVana:
--    URL: http://localhost:3001/login
--    Credentials: admin@drive-247.com / password

-- 2. Change FleetVana branding:
--    - Go to Settings → Branding
--    - Change Primary Color to: #3B82F6 (blue)
--    - Change App Name to: FleetVana Rentals
--    - Click Save

-- 3. Verify FleetVana changes saved:
SELECT 'FleetVana after changes:' as test;
SELECT
  company_name,
  slug,
  app_name,
  primary_color,
  CASE
    WHEN primary_color = '#3B82F6' THEN '✅ Blue color applied'
    ELSE '❌ Still default color'
  END as color_status
FROM tenants
WHERE slug = 'fleetvana';

-- 4. Logout and login as Global Motion Transport admin:
--    URL: http://localhost:3001/login
--    Credentials: admin@globalmotiontransport.com / password
--    (If you haven't created this user yet, use super admin)

-- 5. Check Global Motion Transport branding is UNCHANGED:
SELECT 'Global Motion Transport (should be unchanged):' as test;
SELECT
  company_name,
  slug,
  app_name,
  primary_color,
  CASE
    WHEN primary_color = '#C6A256' OR primary_color IS NULL THEN '✅ Default gold color (unchanged)'
    WHEN primary_color = '#3B82F6' THEN '❌ ERROR: Blue color leaked from FleetVana!'
    ELSE '⚠️  Different custom color'
  END as color_status
FROM tenants
WHERE slug = 'globalmotiontransport';

-- Step 3: Compare both tenants side by side
SELECT
  slug,
  app_name,
  primary_color,
  secondary_color,
  CASE
    WHEN slug = 'fleetvana' AND primary_color = '#3B82F6' THEN '✅ FleetVana has blue'
    WHEN slug = 'globalmotiontransport' AND (primary_color = '#C6A256' OR primary_color IS NULL) THEN '✅ GMT has gold'
    ELSE '❌ Unexpected color'
  END as expected_state
FROM tenants
WHERE slug IN ('fleetvana', 'globalmotiontransport')
ORDER BY slug;

-- ============================================
-- EXPECTED RESULT AFTER TEST:
-- ============================================
-- FleetVana:
--   - app_name: FleetVana Rentals (or custom name)
--   - primary_color: #3B82F6 (blue)
--   - Status: ✅ Blue color applied
--
-- Global Motion Transport:
--   - app_name: Global Motion Transport (unchanged)
--   - primary_color: #C6A256 or NULL (gold/default)
--   - Status: ✅ Default gold color (unchanged)
--
-- Result: ✅ BRANDING IS ISOLATED - Each tenant has separate colors
-- ============================================

-- ============================================
-- HOW BRANDING ISOLATION WORKS:
-- ============================================
-- 1. Each tenant has its own row in the tenants table
-- 2. Branding columns (primary_color, logo_url, etc.) are per-tenant
-- 3. TenantContext loads the current tenant based on subdomain or user's tenant_id
-- 4. Settings page updates ONLY the current tenant's row
-- 5. No cross-contamination between tenants
-- ============================================
