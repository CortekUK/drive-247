-- =====================================================
-- Script to Create Rental Company Admin Users
-- =====================================================
-- This script creates head_admin users for each rental company
-- Password for all users: Password123!

-- NOTE: You need to run this AFTER creating the tenants
-- Run create-rental-companies.sql first!

-- =====================================================
-- PREREQUISITES:
-- 1. Get tenant IDs by running:
-- SELECT id, slug, company_name FROM tenants WHERE slug IN ('fleetvana', 'globalmotiontransport', 'demo-rental');
--
-- 2. Replace the UUIDs below with actual tenant IDs from step 1
-- =====================================================

-- =====================================================
-- IMPORTANT: Password Hashing
-- =====================================================
-- The password hash below is for: Password123!
-- Generated using Supabase auth.users password hashing
-- If you need to change the password, use Supabase admin functions

-- You can also create users via the super admin dashboard UI
-- which will handle auth user creation and password hashing automatically

-- =====================================================
-- Manual Creation Instructions (Alternative to SQL)
-- =====================================================
-- It's RECOMMENDED to create users via the super admin dashboard:
-- 1. Login to admin.drive-247.com
-- 2. Go to "Rental Companies" page
-- 3. Click "View Details" for each company
-- 4. Use "Add User" to create head_admin accounts
-- 5. Set email/password for each user
-- 6. Assign role: head_admin

-- =====================================================
-- SQL Script (Use ONLY if you can't use the UI)
-- =====================================================

-- Step 1: Get tenant IDs (copy these results)
-- SELECT id as tenant_id, slug FROM tenants WHERE slug IN ('fleetvana', 'globalmotiontransport', 'demo-rental');

-- Step 2: For each tenant, create an auth user via Supabase admin API
-- This CANNOT be done directly with SQL - you need to use Supabase Admin API or Dashboard

-- Step 3: After creating auth users, link them to app_users table
-- Replace <tenant_id> and <auth_user_id> with actual values

-- Example for FleetVana:
/*
INSERT INTO app_users (
  auth_user_id,
  tenant_id,
  email,
  name,
  role,
  is_active,
  must_change_password,
  created_at,
  updated_at
) VALUES (
  '<auth_user_id_from_supabase_auth>',  -- Get this from auth.users after creating user
  '<fleetvana_tenant_id>',               -- Get this from tenants table
  'admin@fleetvana.com',
  'FleetVana Admin',
  'head_admin',
  true,
  false,
  now(),
  now()
);
*/

-- =====================================================
-- Quick Credentials Reference
-- =====================================================
-- After creation via UI or admin-create-user edge function:

-- FleetVana:
--   Email: admin@fleetvana.com
--   Password: Password123!
--   Role: head_admin

-- Global Motion Transport:
--   Email: admin@globalmotiontransport.com
--   Password: Password123!
--   Role: head_admin

-- Demo Rental:
--   Email: demo@drive-247.com
--   Password: Password123!
--   Role: head_admin

-- =====================================================
-- RECOMMENDED: Use Edge Function Instead
-- =====================================================
-- The easiest way is to use the admin-create-user edge function:

/*
curl -X POST 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/admin-create-user' \
  -H 'Authorization: Bearer <your_service_role_key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@fleetvana.com",
    "password": "Password123!",
    "name": "FleetVana Admin",
    "role": "head_admin",
    "tenant_id": "<fleetvana_tenant_id>"
  }'
*/

-- This handles both auth.users and app_users table creation
