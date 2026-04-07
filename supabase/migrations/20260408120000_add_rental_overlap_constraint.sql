-- Enable btree_gist extension (required for future exclusion constraint if needed)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Use a trigger instead of an exclusion constraint to avoid failing on existing overlapping data.
-- This only validates NEW inserts and updates, leaving existing rows untouched.
CREATE OR REPLACE FUNCTION check_rental_overlap()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip check for terminal statuses
  IF NEW.status IN ('Cancelled', 'Rejected', 'Closed') THEN
    RETURN NEW;
  END IF;

  -- Skip if no vehicle assigned
  IF NEW.vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check for overlapping rentals on the same vehicle
  IF EXISTS (
    SELECT 1 FROM rentals
    WHERE vehicle_id = NEW.vehicle_id
      AND id != NEW.id
      AND status NOT IN ('Cancelled', 'Rejected', 'Closed')
      AND start_date <= COALESCE(NEW.end_date, '9999-12-31'::date)
      AND COALESCE(end_date, '9999-12-31'::date) >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'Vehicle rental overlap: another active or pending rental exists for this vehicle during the requested dates'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_rental_overlap
  BEFORE INSERT OR UPDATE OF start_date, end_date, vehicle_id, status
  ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION check_rental_overlap();
