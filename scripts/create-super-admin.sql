-- =====================================================
-- Script to Create a Super Admin User
-- =====================================================
-- This creates a super admin who can:
-- 1. Access admin.drive-247.com (super admin dashboard)
-- 2. Login to ANY rental company dashboard with their credentials (master key)
-- 3. See special tabs like "Website Content" in rental dashboards

-- =====================================================
-- IMPORTANT: How to Create Super Admin
-- =====================================================
-- Super admins CANNOT be created with pure SQL because they require:
-- 1. Creating a user in auth.users table (requires Supabase Admin API)
-- 2. Linking to app_users table with is_super_admin = true

-- =====================================================
-- Method 1: Using Supabase Dashboard (EASIEST)
-- =====================================================
-- 1. Go to Supabase Dashboard → Authentication → Users
-- 2. Click "Add User" → "Create New User"
-- 3. Enter email and password
-- 4. Copy the auth_user_id (UUID) from the created user
-- 5. Run the SQL below to link them to app_users as super admin

-- =====================================================
-- Method 2: Using Admin Create User Edge Function (RECOMMENDED)
-- =====================================================
-- Use the admin-create-user edge function:

/*
curl -X POST 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/admin-create-user' \
  -H 'Authorization: Bearer <your_service_role_key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "superadmin@drive-247.com",
    "password": "SecurePassword123!",
    "name": "Super Admin",
    "role": "head_admin",
    "is_super_admin": true
  }'
*/

-- Note: tenant_id should be NULL for super admins

-- =====================================================
-- Method 3: Manual SQL (After creating auth user)
-- =====================================================
-- Step 1: Create the auth user via Supabase Dashboard first
-- Step 2: Get the auth_user_id from auth.users table
-- Step 3: Run this SQL to create the app_users record:

/*
-- Replace <auth_user_id> with the actual UUID from auth.users
INSERT INTO app_users (
  auth_user_id,
  tenant_id,
  email,
  name,
  role,
  is_active,
  must_change_password,
  is_super_admin,
  created_at,
  updated_at
) VALUES (
  '<auth_user_id>',  -- Get this from auth.users after creating user in dashboard
  NULL,              -- Super admins don't belong to a specific tenant
  'superadmin@drive-247.com',
  'Super Admin',
  'head_admin',
  true,
  false,
  true,              -- This makes them a super admin!
  now(),
  now()
)
ON CONFLICT (auth_user_id) DO UPDATE SET
  is_super_admin = true,
  updated_at = now();
*/

-- =====================================================
-- Existing Super Admin Credentials
-- =====================================================
-- You mentioned you already have super admin credentials:
--   Email: admin@cortek.io
--   Password: Admin@Cortek2024

-- To verify this user is a super admin:
SELECT
  au.id,
  au.email,
  au.name,
  au.role,
  au.is_super_admin,
  au.is_active,
  au.tenant_id,
  au.created_at
FROM app_users au
WHERE au.email = 'admin@cortek.io';

-- If is_super_admin is false or NULL, update it:
/*
UPDATE app_users
SET is_super_admin = true, updated_at = now()
WHERE email = 'admin@cortek.io';
*/

-- =====================================================
-- Create Additional Super Admin (Example)
-- =====================================================
-- If you want to create another super admin called 'platform-admin':

-- 1. First create the auth user in Supabase Dashboard with:
--    Email: platform-admin@drive-247.com
--    Password: Choose a secure password

-- 2. Get the auth_user_id from the created user

-- 3. Run this (replace <auth_user_id>):
/*
INSERT INTO app_users (
  auth_user_id,
  tenant_id,
  email,
  name,
  role,
  is_active,
  must_change_password,
  is_super_admin,
  created_at,
  updated_at
) VALUES (
  '<auth_user_id>',
  NULL,
  'platform-admin@drive-247.com',
  'Platform Administrator',
  'head_admin',
  true,
  false,
  true,
  now(),
  now()
);
*/

-- =====================================================
-- List All Super Admins
-- =====================================================
SELECT
  au.id,
  au.email,
  au.name,
  au.role,
  au.is_super_admin,
  au.is_active,
  au.is_primary_super_admin,
  au.created_at
FROM app_users au
WHERE au.is_super_admin = true
ORDER BY au.created_at;

-- =====================================================
-- Make Primary Super Admin (Special Privileges)
-- =====================================================
-- Primary super admin can manage other super admins
/*
UPDATE app_users
SET is_primary_super_admin = true, updated_at = now()
WHERE email = 'admin@cortek.io';
*/

-- =====================================================
-- Super Admin Capabilities
-- =====================================================
-- Once created, super admins can:
-- 1. Login to admin.drive-247.com with their credentials
-- 2. View/create/edit/suspend all rental companies
-- 3. Generate master passwords for tenants
-- 4. Login to ANY rental dashboard using their OWN credentials
-- 5. See special sidebar tabs (Website Content, etc.) when logged into rental dashboards
-- 6. Bypass is_active checks and password change requirements
