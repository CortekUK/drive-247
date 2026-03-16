-- Update the rental INSERT trigger to also notify the customer when a renewal is created

CREATE OR REPLACE FUNCTION notify_new_rental()
RETURNS TRIGGER AS $$
DECLARE
  _customer_name TEXT;
  _vehicle_info TEXT;
  _customer_user_id UUID;
  _company_name TEXT;
  _rental_ref TEXT;
BEGIN
  -- Get customer name
  SELECT name INTO _customer_name
  FROM customers
  WHERE id = NEW.customer_id;

  -- Get vehicle info
  SELECT COALESCE(make || ' ' || model, reg, 'Vehicle') INTO _vehicle_info
  FROM vehicles
  WHERE id = NEW.vehicle_id;

  -- 1. Broadcast notification for portal staff (all roles see it)
  INSERT INTO notifications (user_id, tenant_id, title, message, type, is_read, link, metadata)
  VALUES (
    NULL,
    NEW.tenant_id,
    CASE WHEN NEW.renewed_from_rental_id IS NOT NULL THEN 'Rental Renewed' ELSE 'New Booking Pending' END,
    COALESCE(_customer_name, 'A customer') ||
      CASE WHEN NEW.renewed_from_rental_id IS NOT NULL
        THEN ' has renewed their booking for '
        ELSE ' has requested a booking for '
      END || COALESCE(_vehicle_info, 'a vehicle'),
    CASE WHEN NEW.renewed_from_rental_id IS NOT NULL THEN 'booking_renewed' ELSE 'booking_new' END,
    false,
    '/rentals/' || NEW.id,
    jsonb_build_object(
      'rental_id', NEW.id,
      'customer_name', COALESCE(_customer_name, 'Unknown'),
      'vehicle', COALESCE(_vehicle_info, 'Unknown'),
      'renewed_from', NEW.renewed_from_rental_id
    )
  );

  -- 2. If this is a renewal, also notify the customer
  IF NEW.renewed_from_rental_id IS NOT NULL THEN
    SELECT cu.id INTO _customer_user_id
    FROM customer_users cu
    WHERE cu.customer_id = NEW.customer_id
    LIMIT 1;

    SELECT COALESCE(company_name, 'Your rental company') INTO _company_name
    FROM tenants WHERE id = NEW.tenant_id;

    _rental_ref := 'R-' || UPPER(LEFT(NEW.id::text, 6));

    IF _customer_user_id IS NOT NULL THEN
      INSERT INTO customer_notifications (customer_user_id, tenant_id, title, message, type, is_read, link, metadata)
      VALUES (
        _customer_user_id,
        NEW.tenant_id,
        'Booking Renewed',
        'Your rental for ' || COALESCE(_vehicle_info, 'your vehicle') || ' has been renewed by ' || _company_name || '. New booking reference: ' || _rental_ref || '.',
        'booking_renewed',
        false,
        '/portal/bookings',
        jsonb_build_object(
          'rental_id', NEW.id,
          'renewed_from', NEW.renewed_from_rental_id,
          'vehicle', COALESCE(_vehicle_info, 'Unknown')
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
