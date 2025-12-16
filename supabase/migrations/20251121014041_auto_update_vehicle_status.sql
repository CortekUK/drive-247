-- Function to automatically update vehicle status based on rental status changes
CREATE OR REPLACE FUNCTION update_vehicle_status_on_rental_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle INSERT (new rental created)
  IF TG_OP = 'INSERT' THEN
    -- If new rental is Active, set vehicle to Rented
    IF NEW.status = 'Active' THEN
      UPDATE vehicles
      SET status = 'Rented'
      WHERE id = NEW.vehicle_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Handle UPDATE (rental status changed)
  IF TG_OP = 'UPDATE' THEN
    -- If rental became Active, set vehicle to Rented
    IF NEW.status = 'Active' AND OLD.status != 'Active' THEN
      UPDATE vehicles
      SET status = 'Rented'
      WHERE id = NEW.vehicle_id;

    -- If rental became Completed, Cancelled, or Closed, set vehicle to Available
    ELSIF (NEW.status = 'Completed' OR NEW.status = 'Cancelled' OR NEW.status = 'Closed')
       AND OLD.status = 'Active' THEN
      UPDATE vehicles
      SET status = 'Available'
      WHERE id = NEW.vehicle_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Handle DELETE (rental deleted)
  IF TG_OP = 'DELETE' THEN
    -- If deleted rental was Active, set vehicle back to Available
    IF OLD.status = 'Active' THEN
      UPDATE vehicles
      SET status = 'Available'
      WHERE id = OLD.vehicle_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_update_vehicle_status_on_rental ON rentals;

-- Create trigger on rentals table
CREATE TRIGGER trigger_update_vehicle_status_on_rental
  AFTER INSERT OR UPDATE OR DELETE ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_status_on_rental_change();

COMMENT ON FUNCTION update_vehicle_status_on_rental_change() IS 'Automatically updates vehicle status to Rented when rental is Active, and to Available when rental is Completed, Cancelled, or Closed';
