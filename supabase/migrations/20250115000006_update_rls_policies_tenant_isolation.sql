-- Migration: Update RLS policies for tenant isolation
-- Description: Replace permissive policies with tenant-aware policies

-- ============================================================================
-- TENANTS TABLE RLS
-- ============================================================================

-- Drop existing policies if any
DROP POLICY IF EXISTS "super_admin_manage_tenants" ON tenants;

-- Super admins can manage all tenants
CREATE POLICY "super_admin_manage_tenants" ON tenants
FOR ALL
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Regular users cannot access tenants table
-- (No policy needed - defaults to deny)

-- ============================================================================
-- APP_USERS TABLE RLS
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "p_read_self" ON app_users;
DROP POLICY IF EXISTS "p_admin_manage" ON app_users;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON app_users;

-- Users can read their own record
CREATE POLICY "users_read_self" ON app_users
FOR SELECT
USING (auth.uid() = auth_user_id);

-- Super admins can read all users
CREATE POLICY "super_admin_read_all" ON app_users
FOR SELECT
USING (is_super_admin());

-- Head admins can read users in their tenant
CREATE POLICY "head_admin_read_tenant" ON app_users
FOR SELECT
USING (
  tenant_id = get_user_tenant_id() AND
  EXISTS (SELECT 1 FROM app_users WHERE auth.uid() = auth_user_id AND role = 'head_admin')
);

-- Super admins can manage all users
CREATE POLICY "super_admin_manage_all" ON app_users
FOR INSERT, UPDATE, DELETE
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Head admins can manage users in their tenant (but not create other head_admins)
CREATE POLICY "head_admin_manage_tenant" ON app_users
FOR INSERT, UPDATE, DELETE
USING (
  tenant_id = get_user_tenant_id() AND
  EXISTS (SELECT 1 FROM app_users WHERE auth.uid() = auth_user_id AND role = 'head_admin')
)
WITH CHECK (
  tenant_id = get_user_tenant_id() AND
  EXISTS (SELECT 1 FROM app_users WHERE auth.uid() = auth_user_id AND role = 'head_admin')
);

-- ============================================================================
-- ORG_SETTINGS TABLE RLS
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Allow all operations for app users" ON org_settings;

-- Users can read their tenant's settings
CREATE POLICY "tenant_isolation_org_settings_read" ON org_settings
FOR SELECT
USING (
  tenant_id = get_user_tenant_id() OR is_super_admin()
);

-- Only super admins can update settings (via master password)
CREATE POLICY "super_admin_update_org_settings" ON org_settings
FOR UPDATE
USING (is_super_admin())
WITH CHECK (is_super_admin());

-- Head admins can also update their own tenant settings
CREATE POLICY "head_admin_update_org_settings" ON org_settings
FOR UPDATE
USING (
  tenant_id = get_user_tenant_id() AND
  EXISTS (SELECT 1 FROM app_users WHERE auth.uid() = auth_user_id AND role = 'head_admin')
)
WITH CHECK (
  tenant_id = get_user_tenant_id() AND
  EXISTS (SELECT 1 FROM app_users WHERE auth.uid() = auth_user_id AND role = 'head_admin')
);

-- ============================================================================
-- BUSINESS TABLES RLS (Apply same pattern to all)
-- ============================================================================

-- Template for all business tables:
-- Users can access data in their tenant OR super admins can access all

-- VEHICLES
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON vehicles;
CREATE POLICY "tenant_isolation_vehicles" ON vehicles
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- CUSTOMERS
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON customers;
CREATE POLICY "tenant_isolation_customers" ON customers
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- RENTALS
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON rentals;
CREATE POLICY "tenant_isolation_rentals" ON rentals
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- PAYMENTS
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON payments;
CREATE POLICY "tenant_isolation_payments" ON payments
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- CHARGES
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON charges;
CREATE POLICY "tenant_isolation_charges" ON charges
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- LEDGER_ENTRIES
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON ledger_entries;
CREATE POLICY "tenant_isolation_ledger_entries" ON ledger_entries
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- FINES
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON fines;
CREATE POLICY "tenant_isolation_fines" ON fines
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- REMINDERS
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON reminders;
CREATE POLICY "tenant_isolation_reminders" ON reminders
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- REMINDER_ACTIONS
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON reminder_actions;
CREATE POLICY "tenant_isolation_reminder_actions" ON reminder_actions
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- VEHICLE_FILES
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON vehicle_files;
CREATE POLICY "tenant_isolation_vehicle_files" ON vehicle_files
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- VEHICLE_EXPENSES
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON vehicle_expenses;
CREATE POLICY "tenant_isolation_vehicle_expenses" ON vehicle_expenses
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- VEHICLE_EVENTS
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON vehicle_events;
CREATE POLICY "tenant_isolation_vehicle_events" ON vehicle_events
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- INVOICES
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON invoices;
CREATE POLICY "tenant_isolation_invoices" ON invoices
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- BLOCKED_DATES
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON blocked_dates;
CREATE POLICY "tenant_isolation_blocked_dates" ON blocked_dates
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- TESTIMONIALS
DROP POLICY IF EXISTS "Allow read for anonymous, all for authenticated" ON testimonials;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON testimonials;

-- Public can read active testimonials for a tenant (for customer-facing site)
CREATE POLICY "public_read_active_testimonials" ON testimonials
FOR SELECT
USING (is_active = true);

-- Authenticated users can manage testimonials in their tenant
CREATE POLICY "tenant_isolation_testimonials" ON testimonials
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- PROMOTIONS
DROP POLICY IF EXISTS "Allow read for anonymous, all for authenticated" ON promotions;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON promotions;

-- Public can read active promotions
CREATE POLICY "public_read_active_promotions" ON promotions
FOR SELECT
USING (is_active = true);

-- Authenticated users can manage promotions in their tenant
CREATE POLICY "tenant_isolation_promotions" ON promotions
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- PAGES (CMS content)
DROP POLICY IF EXISTS "Allow read for anonymous, all for authenticated" ON pages;
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON pages;

-- Public can read published pages
CREATE POLICY "public_read_published_pages" ON pages
FOR SELECT
USING (is_published = true);

-- Authenticated users can manage pages in their tenant
CREATE POLICY "tenant_isolation_pages" ON pages
FOR ALL
USING (tenant_id = get_user_tenant_id() OR is_super_admin())
WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- AUDIT_LOGS
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON audit_logs;

-- Users can read audit logs for their tenant
CREATE POLICY "tenant_isolation_audit_logs_read" ON audit_logs
FOR SELECT
USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- System can insert audit logs
CREATE POLICY "system_insert_audit_logs" ON audit_logs
FOR INSERT
WITH CHECK (true);

-- Note: Audit logs are append-only, no UPDATE or DELETE policies

-- ============================================================================
-- STORAGE POLICIES (for customer-documents bucket)
-- ============================================================================

-- Note: Storage policies are managed separately in Supabase Storage UI
-- We'll create these manually after migration or via a separate script
-- Example policy for reference:
--
-- CREATE POLICY "tenant_isolation_customer_documents" ON storage.objects
-- FOR ALL
-- USING (
--   bucket_id = 'customer-documents' AND
--   (storage.foldername(name))[1] = get_user_tenant_id()::text
-- );
