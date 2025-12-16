-- Migration: Add tenant_id to all business tables for data isolation
-- Description: Every business entity must belong to a tenant

-- Add tenant_id to core business tables
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Add tenant_id to operational tables
ALTER TABLE fines ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE reminder_actions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Add tenant_id to vehicle-related tables
ALTER TABLE vehicle_files ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE vehicle_expenses ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE vehicle_events ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Add tenant_id to financial tables
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Add tenant_id to booking-related tables
ALTER TABLE blocked_dates ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Add tenant_id to content/marketing tables
ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Add tenant_id to audit table
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS is_super_admin_action BOOLEAN DEFAULT false;

-- Create indexes for fast tenant-based queries
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_id ON vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rentals_tenant_id ON rentals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_charges_tenant_id ON charges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_tenant_id ON ledger_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fines_tenant_id ON fines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reminders_tenant_id ON reminders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reminder_actions_tenant_id ON reminder_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_files_tenant_id ON vehicle_files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_tenant_id ON vehicle_expenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_tenant_id ON vehicle_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_blocked_dates_tenant_id ON blocked_dates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_testimonials_tenant_id ON testimonials(tenant_id);
CREATE INDEX IF NOT EXISTS idx_promotions_tenant_id ON promotions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pages_tenant_id ON pages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);

-- Add helpful comments
COMMENT ON COLUMN audit_logs.is_super_admin_action IS 'TRUE when action performed by super admin via master password';

-- Note: This migration adds columns as NULLABLE
-- Next migration will make them NOT NULL after backfilling data
