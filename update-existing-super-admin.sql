-- ============================================
-- UPDATE EXISTING SUPER ADMIN ACCOUNT
-- ============================================
-- The account already exists with auth_user_id: 979d59ae-b597-4ae3-bacf-73715af538ab
-- This script will update it to ensure super admin privileges
-- ============================================

-- Step 1: Check current status
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
  auth_users.email as auth_email
FROM app_users au
JOIN auth.users auth_users ON auth_users.id = au.auth_user_id
WHERE au.auth_user_id = '979d59ae-b597-4ae3-bacf-73715af538ab';

-- Step 2: Update to grant super admin privileges
UPDATE app_users
SET
  is_super_admin = true,
  is_primary_super_admin = true,
  is_active = true,
  tenant_id = NULL,
  role = 'head_admin',
  name = 'Cortek Super Admin',
  email = 'admin@cortek.io',
  must_change_password = false
WHERE auth_user_id = '979d59ae-b597-4ae3-bacf-73715af538ab';

-- Step 3: Verify the update
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
WHERE au.auth_user_id = '979d59ae-b597-4ae3-bacf-73715af538ab';

-- ============================================
-- EXPECTED RESULT AFTER UPDATE:
-- ============================================
-- ✅ email: admin@cortek.io
-- ✅ is_super_admin: true
-- ✅ is_primary_super_admin: true
-- ✅ is_active: true
-- ✅ tenant_id: NULL
-- ✅ role: head_admin
-- ✅ must_change_password: false
-- ✅ status: READY TO USE
-- ============================================
