-- Per-occurrence schedule exceptions for auto-extension (skip / move a specific
-- renewal date while keeping the overall cadence). Shape:
--   { "skips": ["2026-01-06"], "moves": { "2026-01-13": "2026-01-15" } }
-- Keyed by the date the cadence would land on (the "grid" date).
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS auto_extend_exceptions jsonb NOT NULL DEFAULT '{"skips":[],"moves":{}}'::jsonb;
