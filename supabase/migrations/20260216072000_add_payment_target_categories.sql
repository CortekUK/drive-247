-- Store target_categories on payment record for reliable cross-tab/webhook access
-- This replaces the fragile localStorage approach
ALTER TABLE payments ADD COLUMN IF NOT EXISTS target_categories jsonb DEFAULT NULL;
