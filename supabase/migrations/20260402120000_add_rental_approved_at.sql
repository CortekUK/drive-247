ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS approved_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.rentals.approved_at IS 'Timestamp when rental was approved. Used for lockbox auto-send timing.';
