-- Rework the rental overlap trigger so that extensions (end_date increasing)
-- only validate the newly-added range, not the entire rental period.
--
-- Reason: when a rental was created before the overlap trigger existed (or
-- when two rentals legitimately overlap due to historical data), any future
-- UPDATE of that rental — including a pure extension — would re-evaluate the
-- full range and fail because of the pre-existing overlap. An extension
-- should only be blocked if the NEW portion of the range collides.

CREATE OR REPLACE FUNCTION check_rental_overlap()
RETURNS TRIGGER AS $$
DECLARE
  check_start date;
BEGIN
  IF NEW.status IN ('Cancelled', 'Rejected', 'Closed') THEN
    RETURN NEW;
  END IF;

  IF NEW.vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- On a pure extension (same vehicle, same start_date, end_date moved later),
  -- only validate the new tail. Otherwise fall back to the full-range check.
  IF TG_OP = 'UPDATE'
     AND OLD.end_date IS NOT NULL
     AND NEW.end_date IS NOT NULL
     AND NEW.vehicle_id = OLD.vehicle_id
     AND NEW.start_date = OLD.start_date
     AND NEW.end_date > OLD.end_date THEN
    check_start := OLD.end_date;
  ELSE
    check_start := NEW.start_date;
  END IF;

  IF EXISTS (
    SELECT 1 FROM rentals
    WHERE vehicle_id = NEW.vehicle_id
      AND id != NEW.id
      AND status NOT IN ('Cancelled', 'Rejected', 'Closed')
      AND start_date <= COALESCE(NEW.end_date, '9999-12-31'::date)
      AND COALESCE(end_date, '9999-12-31'::date) >= check_start
  ) THEN
    RAISE EXCEPTION 'Vehicle rental overlap: another active or pending rental exists for this vehicle during the requested dates'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
