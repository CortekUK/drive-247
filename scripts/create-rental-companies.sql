-- =====================================================
-- Script to Create Rental Companies (Tenants)
-- =====================================================
-- This script creates three rental companies:
-- 1. fleetvana
-- 2. globalmotiontransport
-- 3. demo-rental

-- =====================================================
-- 1. FleetVana Rental Company
-- =====================================================
INSERT INTO tenants (
  slug,
  company_name,
  status,
  contact_email,
  contact_phone,
  subscription_plan,
  created_at,
  updated_at
) VALUES (
  'fleetvana',
  'FleetVana',
  'active',
  'admin@fleetvana.com',
  '+1-555-0101',
  'pro',
  now(),
  now()
)
ON CONFLICT (slug) DO UPDATE SET
  company_name = EXCLUDED.company_name,
  contact_email = EXCLUDED.contact_email,
  contact_phone = EXCLUDED.contact_phone,
  status = EXCLUDED.status,
  subscription_plan = EXCLUDED.subscription_plan,
  updated_at = now();

-- =====================================================
-- 2. Global Motion Transport
-- =====================================================
INSERT INTO tenants (
  slug,
  company_name,
  status,
  contact_email,
  contact_phone,
  subscription_plan,
  created_at,
  updated_at
) VALUES (
  'globalmotiontransport',
  'Global Motion Transport',
  'active',
  'admin@globalmotiontransport.com',
  '+1-555-0102',
  'enterprise',
  now(),
  now()
)
ON CONFLICT (slug) DO UPDATE SET
  company_name = EXCLUDED.company_name,
  contact_email = EXCLUDED.contact_email,
  contact_phone = EXCLUDED.contact_phone,
  status = EXCLUDED.status,
  subscription_plan = EXCLUDED.subscription_plan,
  updated_at = now();

-- =====================================================
-- 3. Demo Rental (Demo Company)
-- =====================================================
INSERT INTO tenants (
  slug,
  company_name,
  status,
  contact_email,
  contact_phone,
  subscription_plan,
  trial_ends_at,
  created_at,
  updated_at
) VALUES (
  'demo-rental',
  'Demo Rental Company',
  'trial',
  'demo@drive-247.com',
  '+1-555-DEMO',
  'basic',
  now() + interval '30 days',  -- 30-day trial
  now(),
  now()
)
ON CONFLICT (slug) DO UPDATE SET
  company_name = EXCLUDED.company_name,
  contact_email = EXCLUDED.contact_email,
  contact_phone = EXCLUDED.contact_phone,
  status = EXCLUDED.status,
  subscription_plan = EXCLUDED.subscription_plan,
  trial_ends_at = EXCLUDED.trial_ends_at,
  updated_at = now();

-- =====================================================
-- Verification Query - Run this to verify the tenants were created
-- =====================================================
SELECT
  id,
  slug,
  company_name,
  status,
  contact_email,
  subscription_plan,
  created_at
FROM tenants
WHERE slug IN ('fleetvana', 'globalmotiontransport', 'demo-rental')
ORDER BY created_at DESC;
