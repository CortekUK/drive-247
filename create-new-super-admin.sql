-- ============================================
-- DELETE OLD SUPER ADMIN AND CREATE NEW ONE
-- ============================================
-- New Credentials:
--   Email: admin@drive-247.com
--   Password: password
-- ============================================

-- Step 1: Delete existing app_users record
DELETE FROM app_users
WHERE auth_user_id = '979d59ae-b597-4ae3-bacf-73715af538ab'
   OR email IN ('admin@cortek.io', 'admin@drive-247.com');

-- Step 2: Delete existing auth user (if exists)
-- NOTE: You need to do this in Supabase Dashboard → Authentication → Users
-- Find user with email 'admin@cortek.io' and delete it manually
-- OR use the Admin API (service role key required)

-- Step 3: Check that old records are deleted
SELECT 'Checking app_users...' as step;
SELECT * FROM app_users WHERE email IN ('admin@cortek.io', 'admin@drive-247.com');

SELECT 'Checking auth.users...' as step;
SELECT id, email FROM auth.users WHERE email IN ('admin@cortek.io', 'admin@drive-247.com');

-- ============================================
-- MANUAL STEPS REQUIRED:
-- ============================================
--
-- 1. Go to Supabase Dashboard → Authentication → Users
-- 2. Click "Add user" → "Create new user"
-- 3. Enter:
--    Email: admin@drive-247.com
--    Password: password
--    Auto Confirm User: YES (check this box)
-- 4. Click "Create user"
-- 5. COPY THE USER ID (UUID) that is generated
-- 6. Come back to SQL Editor and run Step 4 below
--
-- ============================================

-- Step 4: Insert new super admin record into app_users
-- IMPORTANT: Replace <NEW_AUTH_USER_ID> with the UUID from Step 5 above

INSERT INTO app_users (
  auth_user_id,
  tenant_id,
  email,
  name,
  role,
  is_active,
  is_super_admin,
  is_primary_super_admin,
  must_change_password
)
VALUES (
  '<NEW_AUTH_USER_ID>',          -- ⚠️ REPLACE THIS with the user ID from Supabase Dashboard
  NULL,
  'admin@drive-247.com',
  'Drive 247 Super Admin',
  'head_admin',
  true,
  true,
  true,
  false
);

-- Step 5: Verify the new super admin account
SELECT
  au.id,
  au.auth_user_id,
  au.email,
  au.name,
  au.role,
  au.is_active,
  au.is_super_admin,
  au.is_primary_super_admin,
  au.tenant_id,
  auth_users.email as auth_email,
  CASE
    WHEN au.is_super_admin = true AND au.is_primary_super_admin = true THEN '✅ READY TO USE'
    ELSE '❌ NEEDS SUPER ADMIN FLAGS'
  END as status
FROM app_users au
JOIN auth.users auth_users ON auth_users.id = au.auth_user_id
WHERE au.email = 'admin@drive-247.com';

-- ============================================
-- EXPECTED RESULT:
-- ============================================
-- ✅ email: admin@drive-247.com
-- ✅ auth_email: admin@drive-247.com
-- ✅ is_super_admin: true
-- ✅ is_primary_super_admin: true
-- ✅ is_active: true
-- ✅ tenant_id: NULL
-- ✅ role: head_admin
-- ✅ status: READY TO USE
-- ============================================

-- ============================================
-- AFTER SETUP, LOGIN WITH:
-- ============================================
-- Email: admin@drive-247.com
-- Password: password
--
-- Login URLs:
-- - http://localhost:3003/admin/login (super admin dashboard)
-- - http://localhost:3001/login (rental portals with full access)
-- - https://fleetvana.drive-247.com/dashboard (production)
-- - https://globalmotiontransport.drive-247.com/dashboard (production)
-- ============================================
