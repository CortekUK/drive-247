-- Tesla Fleet API Integration
-- Adds Supercharger billing tracking: tenant-level Tesla auth, per-vehicle enablement,
-- and a charges table for recording Tesla Supercharger sessions linked to rentals.

-- ============================================================================
-- TENANT COLUMNS — account-level Tesla Fleet API configuration
-- ============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS integration_tesla_fleet BOOLEAN DEFAULT false;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tesla_fleet_mode TEXT DEFAULT 'test'
  CHECK (tesla_fleet_mode IN ('test', 'live'));

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tesla_fleet_api_token TEXT;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tesla_fleet_refresh_token TEXT;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tesla_fleet_token_expires_at TIMESTAMPTZ;

-- ============================================================================
-- VEHICLE COLUMNS — per-vehicle Fleet API enablement
-- ============================================================================

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS tesla_fleet_enabled BOOLEAN DEFAULT false;

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS tesla_fleet_vehicle_id TEXT;

-- ============================================================================
-- TESLA SUPERCHARGER CHARGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS tesla_supercharger_charges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  rental_id       UUID REFERENCES rentals(id) ON DELETE SET NULL,
  charge_date     TIMESTAMPTZ NOT NULL,
  location        TEXT,
  kwh_used        NUMERIC,
  amount          NUMERIC NOT NULL,
  currency        TEXT DEFAULT 'USD',
  tesla_charge_id TEXT UNIQUE,
  status          TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'charged', 'waived', 'partially_charged')),
  charged_amount  NUMERIC,
  ledger_entry_id UUID REFERENCES ledger_entries(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tesla_charges_tenant ON tesla_supercharger_charges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tesla_charges_rental ON tesla_supercharger_charges(rental_id);
CREATE INDEX IF NOT EXISTS idx_tesla_charges_vehicle ON tesla_supercharger_charges(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_tesla_charges_status ON tesla_supercharger_charges(status);

-- Updated_at trigger
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON tesla_supercharger_charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE tesla_supercharger_charges ENABLE ROW LEVEL SECURITY;

-- Tenant users can read their own charges
CREATE POLICY "Tenant users can view their own supercharger charges"
  ON tesla_supercharger_charges FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Tenant users can insert charges (via edge functions with service_role, but allow tenant too)
CREATE POLICY "Service role can manage supercharger charges"
  ON tesla_supercharger_charges FOR ALL
  USING (true)
  WITH CHECK (true);

-- Restrict the ALL policy to service_role only
DROP POLICY IF EXISTS "Service role can manage supercharger charges" ON tesla_supercharger_charges;

CREATE POLICY "Service role can insert supercharger charges"
  ON tesla_supercharger_charges FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Service role can update supercharger charges"
  ON tesla_supercharger_charges FOR UPDATE
  USING (tenant_id = get_user_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Service role can delete supercharger charges"
  ON tesla_supercharger_charges FOR DELETE
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- ============================================================================
-- UPDATE LEDGER ENTRIES CHECK CONSTRAINT — add 'Supercharger' category
-- ============================================================================

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_category_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_category_check
  CHECK (category = ANY (ARRAY[
    'Rental'::text, 'InitialFee'::text, 'Initial Fees'::text, 'Fine'::text, 'Fines'::text,
    'Adjustment'::text, 'Tax'::text, 'Service Fee'::text, 'Security Deposit'::text,
    'Extension'::text, 'Extension Rental'::text, 'Extension Tax'::text, 'Extension Service Fee'::text,
    'Extension Insurance'::text, 'Excess Mileage'::text, 'Insurance'::text, 'Delivery Fee'::text,
    'Collection Fee'::text, 'Extras'::text, 'Supercharger'::text, 'Other'::text
  ]));
