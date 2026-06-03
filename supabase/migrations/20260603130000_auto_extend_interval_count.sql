-- Flexible auto-extension cadence: an interval COUNT alongside the unit, so
-- operators can pick "every 10 days", "every 2 weeks", "every 3 months", etc.
-- (period = auto_extend_interval_count × auto_extend_period_unit).
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS auto_extend_interval_count integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rentals_auto_extend_interval_count_check') THEN
    ALTER TABLE public.rentals ADD CONSTRAINT rentals_auto_extend_interval_count_check
      CHECK (auto_extend_interval_count >= 1 AND auto_extend_interval_count <= 365);
  END IF;
END $$;
