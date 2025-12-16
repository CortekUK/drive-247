-- ============================================
-- PERMISSIVE RLS POLICIES - SOFT APPROACH
-- ============================================
-- This migration enables RLS but with permissive policies
-- All authenticated users can access all data for now
-- This allows the app to work while we prepare for tenant isolation

-- Enable RLS on tables (required to be enabled)
ALTER TABLE IF EXISTS vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS plates ENABLE ROW LEVEL SECURITY;

-- ============================================
-- DROP EXISTING POLICIES (if any)
-- ============================================
DROP POLICY IF EXISTS allow_all_select ON vehicles;
DROP POLICY IF EXISTS allow_all_insert ON vehicles;
DROP POLICY IF EXISTS allow_all_update ON vehicles;
DROP POLICY IF EXISTS allow_all_delete ON vehicles;

DROP POLICY IF EXISTS allow_all_select ON customers;
DROP POLICY IF EXISTS allow_all_insert ON customers;
DROP POLICY IF EXISTS allow_all_update ON customers;
DROP POLICY IF EXISTS allow_all_delete ON customers;

DROP POLICY IF EXISTS allow_all_select ON rentals;
DROP POLICY IF EXISTS allow_all_insert ON rentals;
DROP POLICY IF EXISTS allow_all_update ON rentals;
DROP POLICY IF EXISTS allow_all_delete ON rentals;

DROP POLICY IF EXISTS allow_all_select ON payments;
DROP POLICY IF EXISTS allow_all_insert ON payments;
DROP POLICY IF EXISTS allow_all_update ON payments;
DROP POLICY IF EXISTS allow_all_delete ON payments;

DROP POLICY IF EXISTS allow_all_select ON fines;
DROP POLICY IF EXISTS allow_all_insert ON fines;
DROP POLICY IF EXISTS allow_all_update ON fines;
DROP POLICY IF EXISTS allow_all_delete ON fines;

DROP POLICY IF EXISTS allow_all_select ON plates;
DROP POLICY IF EXISTS allow_all_insert ON plates;
DROP POLICY IF EXISTS allow_all_update ON plates;
DROP POLICY IF EXISTS allow_all_delete ON plates;

-- ============================================
-- PERMISSIVE POLICIES: VEHICLES
-- Allow all authenticated users
-- ============================================
CREATE POLICY allow_all_select ON vehicles
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_insert ON vehicles
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_update ON vehicles
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_delete ON vehicles
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- PERMISSIVE POLICIES: CUSTOMERS
-- ============================================
CREATE POLICY allow_all_select ON customers
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_insert ON customers
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_update ON customers
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_delete ON customers
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- PERMISSIVE POLICIES: RENTALS
-- ============================================
CREATE POLICY allow_all_select ON rentals
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_insert ON rentals
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_update ON rentals
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_delete ON rentals
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- PERMISSIVE POLICIES: PAYMENTS
-- ============================================
CREATE POLICY allow_all_select ON payments
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_insert ON payments
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_update ON payments
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_delete ON payments
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- PERMISSIVE POLICIES: FINES
-- ============================================
CREATE POLICY allow_all_select ON fines
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_insert ON fines
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_update ON fines
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_delete ON fines
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- PERMISSIVE POLICIES: PLATES
-- ============================================
CREATE POLICY allow_all_select ON plates
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_insert ON plates
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_update ON plates
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_delete ON plates
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- TENANTS TABLE: Allow all authenticated users
-- ============================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_tenants_select ON tenants;
DROP POLICY IF EXISTS allow_all_tenants_insert ON tenants;
DROP POLICY IF EXISTS allow_all_tenants_update ON tenants;
DROP POLICY IF EXISTS allow_all_tenants_delete ON tenants;

CREATE POLICY allow_all_tenants_select ON tenants
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_tenants_insert ON tenants
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_tenants_update ON tenants
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_all_tenants_delete ON tenants
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- CONTACT_REQUESTS: Public insert, authenticated read
-- ============================================
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_authenticated_contact_select ON contact_requests;
DROP POLICY IF EXISTS allow_authenticated_contact_update ON contact_requests;
DROP POLICY IF EXISTS public_contact_insert ON contact_requests;

CREATE POLICY allow_authenticated_contact_select ON contact_requests
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY allow_authenticated_contact_update ON contact_requests
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Anyone can insert contact requests (for landing page form)
CREATE POLICY public_contact_insert ON contact_requests
  FOR INSERT
  WITH CHECK (true);

COMMENT ON POLICY allow_all_select ON vehicles IS 'Permissive policy - allows all authenticated users to view vehicles';
COMMENT ON POLICY allow_all_tenants_select ON tenants IS 'Permissive policy - allows all authenticated users to view tenants';
