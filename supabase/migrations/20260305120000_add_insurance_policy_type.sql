-- Add policy_type column to bonzah_insurance_policies
-- 'original' = standard policy purchased for a rental
-- 'extension' = supplemental policy covering the gap period after a rental extension
ALTER TABLE bonzah_insurance_policies
  ADD COLUMN IF NOT EXISTS policy_type TEXT NOT NULL DEFAULT 'original'
  CHECK (policy_type IN ('original', 'extension'));

-- Backfill existing rows (all are originals)
UPDATE bonzah_insurance_policies SET policy_type = 'original' WHERE policy_type IS NULL;

-- Index for efficient lookup of all policies for a rental by type
CREATE INDEX IF NOT EXISTS idx_bonzah_policies_rental_type
  ON bonzah_insurance_policies(rental_id, policy_type);
