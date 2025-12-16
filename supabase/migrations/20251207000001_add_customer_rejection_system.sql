-- Migration: Add Customer Rejection System
-- This migration adds fields for customer rejection/approval workflow and extends audit_logs

-- Step 1: Add rejection-related columns to customers table
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES app_users(id);

-- Step 2: Add entity_type and entity_id columns to audit_logs for extensibility
-- This allows audit_logs to track actions on any entity (customers, rentals, etc.)
ALTER TABLE audit_logs
ADD COLUMN IF NOT EXISTS entity_type TEXT,
ADD COLUMN IF NOT EXISTS entity_id UUID;

-- Step 3: Create index for faster queries on entity lookups
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
ON audit_logs(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
ON audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_status
ON customers(status);

-- Step 4: Add comment for documentation
COMMENT ON COLUMN customers.rejection_reason IS 'Reason provided when customer was rejected';
COMMENT ON COLUMN customers.rejected_at IS 'Timestamp when customer was rejected';
COMMENT ON COLUMN customers.rejected_by IS 'Admin user who rejected the customer';
COMMENT ON COLUMN audit_logs.entity_type IS 'Type of entity (customer, rental, payment, etc.)';
COMMENT ON COLUMN audit_logs.entity_id IS 'UUID of the entity being audited';
