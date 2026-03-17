-- Fix both triggers to create broadcast notifications (user_id = NULL)
-- instead of per-user notifications. This prevents duplicates when
-- admins/super admins view notifications.

-- 1. Fix rental notification trigger
CREATE OR REPLACE FUNCTION notify_new_rental()
RETURNS TRIGGER AS $$
DECLARE
  _customer_name TEXT;
  _vehicle_info TEXT;
BEGIN
  -- Get customer name
  SELECT name INTO _customer_name
  FROM customers
  WHERE id = NEW.customer_id;

  -- Get vehicle info
  SELECT COALESCE(make || ' ' || model, reg, 'Vehicle') INTO _vehicle_info
  FROM vehicles
  WHERE id = NEW.vehicle_id;

  -- Create a single broadcast notification for the tenant (user_id = NULL)
  INSERT INTO notifications (user_id, tenant_id, title, message, type, is_read, link, metadata)
  VALUES (
    NULL,
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Fix chat message notification trigger
CREATE OR REPLACE FUNCTION notify_new_chat_message()
RETURNS TRIGGER AS $$
DECLARE
  _channel RECORD;
  _sender_name TEXT;
BEGIN
  -- Get channel info
  SELECT tenant_id, customer_id INTO _channel
  FROM chat_channels
  WHERE id = NEW.channel_id;

  IF _channel IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_type = 'customer' THEN
    -- Customer sent a message -> create one broadcast notification for tenant staff
    SELECT COALESCE(name, 'A customer') INTO _sender_name
    FROM customers WHERE id = NEW.sender_id;

    INSERT INTO notifications (user_id, tenant_id, title, message, type, is_read, link, metadata)
    VALUES (
      NULL,
      _channel.tenant_id,
      'New Message',
      COALESCE(_sender_name, 'Customer') || ': ' || LEFT(NEW.content, 100),
      'chat_message',
      false,
      '/messages',
      jsonb_build_object(
        'channel_id', NEW.channel_id,
        'message_id', NEW.id,
        'sender_type', NEW.sender_type,
        'sender_id', NEW.sender_id,
        'customer_id', _channel.customer_id,
        'sender_name', COALESCE(_sender_name, 'Customer')
      )
    );

  ELSIF NEW.sender_type = 'tenant' THEN
    -- Tenant staff sent a message -> notify the customer
    SELECT COALESCE(
      (SELECT company_name FROM tenants WHERE id = _channel.tenant_id),
      'Support'
    ) INTO _sender_name;

    INSERT INTO customer_notifications (customer_user_id, tenant_id, title, message, type, is_read, link, metadata)
    SELECT
      cu.id,
      _channel.tenant_id,
      'New Message from ' || _sender_name,
      LEFT(NEW.content, 100),
      'chat_message',
      false,
      '/portal/messages',
      jsonb_build_object(
        'channel_id', NEW.channel_id,
        'message_id', NEW.id,
        'sender_type', NEW.sender_type,
        'sender_id', NEW.sender_id,
        'sender_name', _sender_name
      )
    FROM customer_users cu
    WHERE cu.customer_id = _channel.customer_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
