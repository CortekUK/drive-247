-- Add per-vehicle availability toggles for daily/weekly/monthly booking durations
-- All default to true so existing vehicles remain fully available
ALTER TABLE vehicles ADD COLUMN available_daily BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE vehicles ADD COLUMN available_weekly BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE vehicles ADD COLUMN available_monthly BOOLEAN NOT NULL DEFAULT true;
