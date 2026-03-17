-- Notify customers when their rental is approved or rejected
-- Inserts into customer_notifications table (used by booking app)

CREATE OR REPLACE FUNCTION notify_customer_rental_status_change()
RETURNS TRIGGER AS $$
DECLARE
  _customer_user_id UUID;
  _vehicle_info TEXT;
  _company_name TEXT;
  _rental_ref TEXT;
BEGIN
  -- Only fire when status actually changed
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Get the customer_user_id for this customer
  SELECT cu.id INTO _customer_user_id
  FROM customer_users cu
  WHERE cu.customer_id = NEW.customer_id
  LIMIT 1;

  -- No customer user account linked, skip
  IF _customer_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get vehicle info
  SELECT COALESCE(make || ' ' || model, reg, 'your vehicle') INTO _vehicle_info
  FROM vehicles WHERE id = NEW.vehicle_id;

  -- Get company name
  SELECT COALESCE(company_name, 'Your rental company') INTO _company_name
  FROM tenants WHERE id = NEW.tenant_id;

  -- Short rental ref
  _rental_ref := 'R-' || UPPER(LEFT(NEW.id::text, 6));

  -- Approved: status changed to Active or Started
  IF NEW.status IN ('Active', 'Started') AND OLD.status IN ('Pending', 'Quoted') THEN
    INSERT INTO customer_notifications (customer_user_id, tenant_id, title, message, type, is_read, link, metadata)
    VALUES (
      _customer_user_id,
      NEW.tenant_id,
      'Booking Approved',
      'Your booking ' || _rental_ref || ' for ' || COALESCE(_vehicle_info, 'your vehicle') || ' has been approved by ' || _company_name || '.',
      'booking_approved',
      false,
      '/portal/bookings',
      jsonb_build_object(
        'rental_id', NEW.id,
        'vehicle', COALESCE(_vehicle_info, 'Unknown'),
        'status', NEW.status
      )
    );
  END IF;

  -- Rejected: status changed to Cancelled with approval_status = rejected
  IF NEW.status = 'Cancelled' AND NEW.approval_status = 'rejected' AND OLD.status IN ('Pending', 'Quoted', 'Active', 'Started') THEN
    INSERT INTO customer_notifications (customer_user_id, tenant_id, title, message, type, is_read, link, metadata)
    VALUES (
      _customer_user_id,
      NEW.tenant_id,
      'Booking Rejected',
      'Your booking ' || _rental_ref || ' for ' || COALESCE(_vehicle_info, 'your vehicle') || ' has been rejected. ' ||
        CASE WHEN NEW.cancellation_reason IS NOT NULL AND NEW.cancellation_reason != 'rejected_by_admin'
          THEN 'Reason: ' || NEW.cancellation_reason
          ELSE 'Please contact ' || _company_name || ' for details.'
        END,
      'booking_rejected',
      false,
      '/portal/bookings',
      jsonb_build_object(
        'rental_id', NEW.id,
        'vehicle', COALESCE(_vehicle_info, 'Unknown'),
        'status', NEW.status,
        'reason', COALESCE(NEW.cancellation_reason, '')
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_rental_status_notify_customer ON rentals;

CREATE TRIGGER on_rental_status_notify_customer
  AFTER UPDATE ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION notify_customer_rental_status_change();
