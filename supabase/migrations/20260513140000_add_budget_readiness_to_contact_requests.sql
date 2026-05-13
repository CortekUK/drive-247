-- Add budget and readiness fields for strategy call qualifier form
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS budget TEXT;
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS readiness TEXT;
