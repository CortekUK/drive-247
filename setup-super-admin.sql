-- ============================================
-- SETUP UNIVERSAL SUPER ADMIN ACCOUNT
-- ============================================
-- This creates a super admin account that can access:
-- 1. Super admin dashboard (admin.drive-247.com)
-- 2. Any rental company dashboard with full head_admin privileges
--
-- Credentials:
--   Email: admin@cortek.io
--   Password: Admin@Cortek2024
-- ============================================

-- Step 1: Check if user already exists
SELECT
  id,
  email,
  created_at
FROM auth.users
WHERE email = 'admin@cortek.io';

-- Step 2: If user doesn't exist, you need to create it via Supabase Dashboard:
-- 1. Go to Authentication → Users
-- 2. Click "Add user" → "Create new user"
-- 3. Enter:
--    Email: admin@cortek.io
--    Password: Admin@Cortek2024
--    Confirm auto-email: No (uncheck)
-- 4. Copy the generated user ID

-- Step 3: After creating the auth user, insert into app_users table
-- Replace 'YOUR_AUTH_USER_ID' with the actual UUID from step 2

-- IMPORTANT: Run this AFTER creating the user in Supabase Auth Dashboard
-- Replace <AUTH_USER_ID> with the actual ID from auth.users

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
  '<AUTH_USER_ID>',              -- Replace with actual auth.users.id
  NULL,                          -- Super admins don't belong to a specific tenant
  'admin@cortek.io',
  'Cortek Super Admin',
  'head_admin',                  -- Role doesn't matter for super admins, but set to head_admin
  true,
  true,                          -- This is the key flag for super admin access
  true,                          -- Primary super admin (full permissions)
  false                          -- No password change required
)
ON CONFLICT (auth_user_id)
DO UPDATE SET
  is_super_admin = true,
  is_primary_super_admin = true,
  is_active = true,
  name = 'Cortek Super Admin',
  email = 'admin@cortek.io';

-- Step 4: Verify the account was created correctly
SELECT
  au.id,
  au.auth_user_id,
  au.email,
  au.name,
  au.role,
  au.is_active,
  au.is_super_admin,
  au.is_primary_super_admin,
  auth.email as auth_email
FROM app_users au
JOIN auth.users auth ON auth.id = au.auth_user_id
WHERE au.email = 'admin@cortek.io';

-- ============================================
-- HOW TO USE THIS ACCOUNT
-- ============================================
--
-- After setup, you can login with:
--   Email: admin@cortek.io
--   Password: Admin@Cortek2024
--
-- This account will work at:
-- 1. http://localhost:3003/admin/login (super admin dashboard)
-- 2. http://localhost:3001/login (any rental portal - gets head_admin access)
-- 3. https://fleetvana.drive-247.com/dashboard (production - any tenant)
-- 4. https://globalmotiontransport.drive-247.com/dashboard (production - any tenant)
--
-- The auth-store.ts already handles super admin access:
-- - Bypasses tenant_id requirement (can access any tenant)
-- - Bypasses is_active checks
-- - Gets head_admin role automatically
-- - Bypasses must_change_password requirement
-- ============================================
