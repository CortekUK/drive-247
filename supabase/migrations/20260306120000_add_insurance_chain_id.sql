-- Add chain_id to bonzah_insurance_policies to link multiple sequential policies
-- that cover a rental period longer than Bonzah's 30-day max policy duration.
-- All policies in the same chain share the same chain_id UUID.

ALTER TABLE bonzah_insurance_policies
ADD COLUMN IF NOT EXISTS chain_id UUID DEFAULT NULL;

-- Index for efficient chain lookups
CREATE INDEX IF NOT EXISTS idx_bonzah_insurance_policies_chain_id
ON bonzah_insurance_policies (chain_id)
WHERE chain_id IS NOT NULL;
