-- Create a function that auto-creates notifications when a new rental is inserted
-- This runs server-side so it works regardless of which frontend/flow creates the rental

CREATE OR REPLACE FUNCTION notify_new_rental()
RETURNS TRIGGER AS $$
DECLARE
  _customer_name TEXT;
  _vehicle_info TEXT;
  _staff RECORD;
BEGIN
  -- Get customer name
  SELECT name INTO _customer_name
  FROM customers
  WHERE id = NEW.customer_id;

  -- Get vehicle info
  SELECT COALESCE(make || ' ' || model, reg, 'Vehicle') INTO _vehicle_info
  FROM vehicles
  WHERE id = NEW.vehicle_id;

  -- Create notification for each admin, head_admin, manager, and ops user in this tenant
  FOR _staff IN
    SELECT id FROM app_users
    WHERE tenant_id = NEW.tenant_id
      AND role IN ('admin', 'head_admin', 'manager', 'ops')
      AND is_active = true
  LOOP
    INSERT INTO notifications (user_id, tenant_id, title, message, type, is_read, link, metadata)
    VALUES (
      _staff.id,
      NEW.tenant_id,
      'New Booking Pending',
      COALESCE(_customer_name, 'A customer') || ' has requested a booking for ' || COALESCE(_vehicle_info, 'a vehicle'),
      'booking_new',
      false,
      '/rentals/' || NEW.id,
      jsonb_build_object(
        'rental_id', NEW.id,
        'customer_name', COALESCE(_customer_name, 'Unknown'),
        'vehicle', COALESCE(_vehicle_info, 'Unknown')
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it exists, then create
DROP TRIGGER IF EXISTS on_rental_created_notify ON rentals;

CREATE TRIGGER on_rental_created_notify
  AFTER INSERT ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_rental();
