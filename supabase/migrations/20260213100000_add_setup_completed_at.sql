-- Add setup_completed_at to tenants for tracking when auto go-live has fired
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ DEFAULT NULL;
