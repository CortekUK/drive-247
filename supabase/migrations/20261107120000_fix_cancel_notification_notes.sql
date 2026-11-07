-- Cancelling a rental for a customer who has a portal account failed on every
-- tenant since 20260317170000: the Cancelled branch read NEW.notes, and rentals
-- has no notes column ("record new has no field notes"). Only rejections, which
-- use cancellation_reason, went through. Use cancellation_reason here too.
-- Found by test sheet C12 (cancelling the test bookings).

CREATE OR REPLACE FUNCTION public.notify_customer_rental_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  -- Cancelled: status changed to Cancelled (regular cancellation, not rejection)
  IF NEW.status = 'Cancelled' AND (NEW.approval_status IS NULL OR NEW.approval_status != 'rejected') AND OLD.status NOT IN ('Cancelled') THEN
    INSERT INTO customer_notifications (customer_user_id, tenant_id, title, message, type, is_read, link, metadata)
    VALUES (
      _customer_user_id,
      NEW.tenant_id,
      'Booking Cancelled',
      'Your booking ' || _rental_ref || ' for ' || COALESCE(_vehicle_info, 'your vehicle') || ' has been cancelled by ' || _company_name || '.' ||
        CASE WHEN NEW.cancellation_reason IS NOT NULL AND NEW.cancellation_reason != ''
          THEN ' ' || LEFT(NEW.cancellation_reason, 150)
          ELSE ''
        END,
      'booking_cancelled',
      false,
      '/portal/bookings',
      jsonb_build_object(
        'rental_id', NEW.id,
        'vehicle', COALESCE(_vehicle_info, 'Unknown'),
        'status', NEW.status
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;
