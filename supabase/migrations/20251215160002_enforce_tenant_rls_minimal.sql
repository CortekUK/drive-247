-- ============================================
-- TENANT ROW LEVEL SECURITY (RLS) POLICIES - MINIMAL VERSION
-- ============================================
-- This migration enforces strict tenant isolation across all tables
-- Only includes tables that actually exist in the database

-- Enable RLS on existing tenant-scoped tables
ALTER TABLE IF EXISTS vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS plates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS blocked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS blocked_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================
-- HELPER FUNCTION: Get current user's tenant_id
-- ============================================
CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID AS $$
BEGIN
  -- Get tenant_id from app_users table based on auth.uid()
  RETURN (
    SELECT tenant_id
    FROM app_users
    WHERE auth_user_id = auth.uid()
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- HELPER FUNCTION: Check if user is super admin
-- ============================================
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT is_super_admin
    FROM app_users
    WHERE auth_user_id = auth.uid()
    LIMIT 1
  ) = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- DROP EXISTING POLICIES (if any)
-- ============================================
DROP POLICY IF EXISTS tenant_isolation_select ON vehicles;
DROP POLICY IF EXISTS tenant_isolation_insert ON vehicles;
DROP POLICY IF EXISTS tenant_isolation_update ON vehicles;
DROP POLICY IF EXISTS tenant_isolation_delete ON vehicles;

DROP POLICY IF EXISTS tenant_isolation_select ON customers;
DROP POLICY IF EXISTS tenant_isolation_insert ON customers;
DROP POLICY IF EXISTS tenant_isolation_update ON customers;
DROP POLICY IF EXISTS tenant_isolation_delete ON customers;

DROP POLICY IF EXISTS tenant_isolation_select ON rentals;
DROP POLICY IF EXISTS tenant_isolation_insert ON rentals;
DROP POLICY IF EXISTS tenant_isolation_update ON rentals;
DROP POLICY IF EXISTS tenant_isolation_delete ON rentals;

DROP POLICY IF EXISTS tenant_isolation_select ON payments;
DROP POLICY IF EXISTS tenant_isolation_insert ON payments;
DROP POLICY IF EXISTS tenant_isolation_update ON payments;
DROP POLICY IF EXISTS tenant_isolation_delete ON payments;

DROP POLICY IF EXISTS tenant_isolation_select ON fines;
DROP POLICY IF EXISTS tenant_isolation_insert ON fines;
DROP POLICY IF EXISTS tenant_isolation_update ON fines;
DROP POLICY IF EXISTS tenant_isolation_delete ON fines;

DROP POLICY IF EXISTS tenant_isolation_select ON plates;
DROP POLICY IF EXISTS tenant_isolation_insert ON plates;
DROP POLICY IF EXISTS tenant_isolation_update ON plates;
DROP POLICY IF EXISTS tenant_isolation_delete ON plates;

DROP POLICY IF EXISTS tenant_isolation_select ON blocked_dates;
DROP POLICY IF EXISTS tenant_isolation_insert ON blocked_dates;
DROP POLICY IF EXISTS tenant_isolation_update ON blocked_dates;
DROP POLICY IF EXISTS tenant_isolation_delete ON blocked_dates;

DROP POLICY IF EXISTS tenant_isolation_select ON blocked_customers;
DROP POLICY IF EXISTS tenant_isolation_insert ON blocked_customers;
DROP POLICY IF EXISTS tenant_isolation_update ON blocked_customers;
DROP POLICY IF EXISTS tenant_isolation_delete ON blocked_customers;

DROP POLICY IF EXISTS tenant_isolation_select ON testimonials;
DROP POLICY IF EXISTS tenant_isolation_insert ON testimonials;
DROP POLICY IF EXISTS tenant_isolation_update ON testimonials;
DROP POLICY IF EXISTS tenant_isolation_delete ON testimonials;

DROP POLICY IF EXISTS tenant_isolation_select ON promotions;
DROP POLICY IF EXISTS tenant_isolation_insert ON promotions;
DROP POLICY IF EXISTS tenant_isolation_update ON promotions;
DROP POLICY IF EXISTS tenant_isolation_delete ON promotions;

DROP POLICY IF EXISTS tenant_isolation_select ON documents;
DROP POLICY IF EXISTS tenant_isolation_insert ON documents;
DROP POLICY IF EXISTS tenant_isolation_update ON documents;
DROP POLICY IF EXISTS tenant_isolation_delete ON documents;

DROP POLICY IF EXISTS tenant_isolation_select ON invoices;
DROP POLICY IF EXISTS tenant_isolation_insert ON invoices;
DROP POLICY IF EXISTS tenant_isolation_update ON invoices;
DROP POLICY IF EXISTS tenant_isolation_delete ON invoices;

DROP POLICY IF EXISTS tenant_isolation_select ON audit_logs;
DROP POLICY IF EXISTS tenant_isolation_insert ON audit_logs;

-- ============================================
-- CREATE RLS POLICIES: VEHICLES
-- ============================================
CREATE POLICY tenant_isolation_select ON vehicles
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON vehicles
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON vehicles
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON vehicles
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: CUSTOMERS
-- ============================================
CREATE POLICY tenant_isolation_select ON customers
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON customers
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON customers
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON customers
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: RENTALS
-- ============================================
CREATE POLICY tenant_isolation_select ON rentals
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON rentals
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON rentals
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON rentals
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: PAYMENTS
-- ============================================
CREATE POLICY tenant_isolation_select ON payments
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON payments
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON payments
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON payments
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: FINES
-- ============================================
CREATE POLICY tenant_isolation_select ON fines
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON fines
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON fines
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON fines
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: PLATES
-- ============================================
CREATE POLICY tenant_isolation_select ON plates
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON plates
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON plates
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON plates
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: BLOCKED_DATES
-- ============================================
CREATE POLICY tenant_isolation_select ON blocked_dates
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON blocked_dates
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON blocked_dates
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON blocked_dates
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: BLOCKED_CUSTOMERS
-- ============================================
CREATE POLICY tenant_isolation_select ON blocked_customers
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON blocked_customers
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON blocked_customers
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON blocked_customers
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: TESTIMONIALS
-- ============================================
CREATE POLICY tenant_isolation_select ON testimonials
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON testimonials
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON testimonials
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON testimonials
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: PROMOTIONS
-- ============================================
CREATE POLICY tenant_isolation_select ON promotions
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON promotions
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON promotions
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON promotions
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: DOCUMENTS
-- ============================================
CREATE POLICY tenant_isolation_select ON documents
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON documents
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON documents
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON documents
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: INVOICES
-- ============================================
CREATE POLICY tenant_isolation_select ON invoices
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON invoices
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_update ON invoices
  FOR UPDATE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_delete ON invoices
  FOR DELETE
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- CREATE RLS POLICIES: AUDIT_LOGS
-- ============================================
CREATE POLICY tenant_isolation_select ON audit_logs
  FOR SELECT
  USING (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

CREATE POLICY tenant_isolation_insert ON audit_logs
  FOR INSERT
  WITH CHECK (
    is_super_admin() OR tenant_id = get_user_tenant_id()
  );

-- ============================================
-- TENANTS TABLE: Super admins can see all, regular users see none
-- ============================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS super_admin_only_select ON tenants;
DROP POLICY IF EXISTS super_admin_only_insert ON tenants;
DROP POLICY IF EXISTS super_admin_only_update ON tenants;
DROP POLICY IF EXISTS super_admin_only_delete ON tenants;

CREATE POLICY super_admin_only_select ON tenants
  FOR SELECT
  USING (is_super_admin());

CREATE POLICY super_admin_only_insert ON tenants
  FOR INSERT
  WITH CHECK (is_super_admin());

CREATE POLICY super_admin_only_update ON tenants
  FOR UPDATE
  USING (is_super_admin());

CREATE POLICY super_admin_only_delete ON tenants
  FOR DELETE
  USING (is_super_admin());

-- ============================================
-- CONTACT_REQUESTS: Super admins can see all
-- ============================================
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS super_admin_contact_select ON contact_requests;
DROP POLICY IF EXISTS super_admin_contact_update ON contact_requests;
DROP POLICY IF EXISTS public_contact_insert ON contact_requests;

CREATE POLICY super_admin_contact_select ON contact_requests
  FOR SELECT
  USING (is_super_admin());

CREATE POLICY super_admin_contact_update ON contact_requests
  FOR UPDATE
  USING (is_super_admin());

-- Anyone can insert contact requests (for landing page form)
CREATE POLICY public_contact_insert ON contact_requests
  FOR INSERT
  WITH CHECK (true);

COMMENT ON POLICY tenant_isolation_select ON vehicles IS 'Tenants can only view their own vehicles, super admins can view all';
COMMENT ON POLICY super_admin_only_select ON tenants IS 'Only super admins can manage tenants';
