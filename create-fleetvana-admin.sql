-- ============================================
-- CREATE FLEETVANA ADMIN USER
-- ============================================
-- Credentials:
--   Email: admin@fleetvana.com
--   Password: password
-- ============================================

-- Step 1: Check if FleetVana tenant exists
SELECT id, company_name, slug
FROM tenants
WHERE slug = 'fleetvana';

-- Step 2: Create auth user in Supabase Dashboard
-- Go to: Authentication → Users → Add user → Create new user
-- Email: admin@fleetvana.com
-- Password: password
-- Auto Confirm User: YES (check this)
-- Click "Create user" and COPY THE USER ID

-- Step 3: Insert app_users record (replace <AUTH_USER_ID> with copied ID)
INSERT INTO app_users (
  auth_user_id,
  tenant_id,
  email,
  name,
  role,
  is_active,
  is_super_admin,
  must_change_password
)
SELECT
  '<AUTH_USER_ID>',  -- ⚠️ REPLACE with auth user ID from step 2
  (SELECT id FROM tenants WHERE slug = 'fleetvana'),
  'admin@fleetvana.com',
  'FleetVana Admin',
  'head_admin',
  true,
  false,  -- ← NOT a super admin (won't see Website Content tab)
  false
WHERE NOT EXISTS (
  SELECT 1 FROM app_users WHERE email = 'admin@fleetvana.com'
);

-- Step 4: Verify the account
SELECT
  au.id,
  au.auth_user_id,
  au.email,
  au.name,
  au.role,
  au.is_active,
  au.is_super_admin,
  t.company_name as tenant,
  auth_users.email as auth_email,
  CASE
    WHEN au.is_super_admin = false THEN '✅ Regular Admin - No CMS Access'
    ELSE '⚠️ Super Admin - Has CMS Access'
  END as cms_access
FROM app_users au
JOIN auth.users auth_users ON auth_users.id = au.auth_user_id
LEFT JOIN tenants t ON t.id = au.tenant_id
WHERE au.email = 'admin@fleetvana.com';

-- ============================================
-- EXPECTED RESULT:
-- ============================================
-- ✅ email: admin@fleetvana.com
-- ✅ auth_email: admin@fleetvana.com
-- ✅ is_super_admin: false (regular admin)
-- ✅ is_active: true
-- ✅ role: head_admin
-- ✅ tenant: FleetVana
-- ✅ cms_access: Regular Admin - No CMS Access
-- ============================================

-- ============================================
-- LOGIN AND TEST:
-- ============================================
-- 1. Go to http://localhost:3001/login
-- 2. Login with:
--    Email: admin@fleetvana.com
--    Password: password
-- 3. Check sidebar - "Website Content" tab should be HIDDEN
-- 4. Try to go to /cms - should redirect to dashboard
--
-- Then login as super admin to compare:
-- 1. Logout and login with:
--    Email: admin@drive-247.com
--    Password: password
-- 2. Check sidebar - "Website Content" tab should be VISIBLE
-- 3. Can access /cms pages
-- ============================================
