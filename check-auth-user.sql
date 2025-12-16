-- ============================================
-- CHECK AUTH USER AND APP USER
-- ============================================

-- Step 1: Check if auth user exists
SELECT
  id,
  email,
  email_confirmed_at,
  created_at,
  updated_at,
  last_sign_in_at
FROM auth.users
WHERE email = 'admin@cortek.io';

-- Step 2: Check app_users record
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
  au.must_change_password,
  au.created_at
FROM app_users au
WHERE au.email = 'admin@cortek.io' OR au.auth_user_id = '979d59ae-b597-4ae3-bacf-73715af538ab';

-- Step 3: Check if there's a mismatch
SELECT
  auth_users.id as auth_id,
  auth_users.email as auth_email,
  au.auth_user_id as app_auth_id,
  au.email as app_email,
  CASE
    WHEN auth_users.id = au.auth_user_id THEN '✅ IDs MATCH'
    ELSE '❌ IDs DO NOT MATCH'
  END as id_check,
  CASE
    WHEN auth_users.email = au.email THEN '✅ EMAILS MATCH'
    ELSE '❌ EMAILS DO NOT MATCH'
  END as email_check
FROM auth.users auth_users
FULL OUTER JOIN app_users au ON auth_users.id = au.auth_user_id
WHERE auth_users.email = 'admin@cortek.io' OR au.email = 'admin@cortek.io';

-- ============================================
-- POSSIBLE ISSUES:
-- ============================================
-- 1. Password might not be set correctly in Supabase Auth
-- 2. Email might not match exactly (case sensitive)
-- 3. Auth user might not be confirmed
-- 4. Account might be disabled in auth.users
-- ============================================

-- If auth user doesn't exist, you need to create it via Supabase Dashboard:
-- Authentication → Users → Add user → Create new user
-- Email: admin@cortek.io
-- Password: Admin@Cortek2024
-- Then get the ID and update app_users with that ID
