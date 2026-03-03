-- Add BoldSign test/live mode support to tenants
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS boldsign_mode TEXT NOT NULL DEFAULT 'test'
CHECK (boldsign_mode IN ('test', 'live'));

-- Separate brand IDs for test vs live (BoldSign brands are environment-specific)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS boldsign_test_brand_id TEXT;

-- Rename existing column for clarity
ALTER TABLE tenants
RENAME COLUMN boldsign_brand_id TO boldsign_live_brand_id;

-- Track which BoldSign mode was used when creating a rental agreement
ALTER TABLE rentals
ADD COLUMN IF NOT EXISTS boldsign_mode TEXT;

-- Index for querying tenants by mode
CREATE INDEX IF NOT EXISTS idx_tenants_boldsign_mode ON tenants(boldsign_mode);
