-- Create notifications when a chat message is sent
-- Portal staff get notified of customer messages, customers get notified of tenant messages

CREATE OR REPLACE FUNCTION notify_new_chat_message()
RETURNS TRIGGER AS $$
DECLARE
  _channel RECORD;
  _sender_name TEXT;
  _staff RECORD;
BEGIN
  -- Get channel info (tenant_id and customer_id)
  SELECT tenant_id, customer_id INTO _channel
  FROM chat_channels
  WHERE id = NEW.channel_id;

  IF _channel IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_type = 'customer' THEN
    -- Customer sent a message -> notify all active tenant staff (admin, head_admin, manager, ops)
    SELECT COALESCE(name, 'A customer') INTO _sender_name
    FROM customers WHERE id = NEW.sender_id;

    FOR _staff IN
      SELECT id FROM app_users
      WHERE tenant_id = _channel.tenant_id
        AND role IN ('admin', 'head_admin', 'manager', 'ops')
        AND is_active = true
    LOOP
      INSERT INTO notifications (user_id, tenant_id, title, message, type, is_read, link, metadata)
      VALUES (
        _staff.id,
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
    END LOOP;

  ELSIF NEW.sender_type = 'tenant' THEN
    -- Tenant staff sent a message -> notify the customer
    SELECT COALESCE(
      (SELECT company_name FROM tenants WHERE id = _channel.tenant_id),
      'Support'
    ) INTO _sender_name;

    -- Insert into customer_notifications table (used by booking app)
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

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS on_chat_message_notify ON chat_channel_messages;

CREATE TRIGGER on_chat_message_notify
  AFTER INSERT ON chat_channel_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_chat_message();
