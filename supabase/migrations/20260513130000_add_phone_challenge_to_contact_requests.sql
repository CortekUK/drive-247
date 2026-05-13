-- Add phone and challenge fields for strategy call qualifier form
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS challenge TEXT;
