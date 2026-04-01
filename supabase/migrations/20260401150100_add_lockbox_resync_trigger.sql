-- Trigger: Reset lockbox_sent_at when rental start_date or pickup_time changes
-- This ensures the cron re-evaluates the send time for rescheduled rentals

CREATE OR REPLACE FUNCTION reset_lockbox_sent_on_reschedule()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.delivery_method = 'lockbox' AND (
    OLD.start_date IS DISTINCT FROM NEW.start_date OR
    OLD.pickup_time IS DISTINCT FROM NEW.pickup_time
  ) THEN
    NEW.lockbox_sent_at := NULL;

    INSERT INTO public.lockbox_send_log (rental_id, tenant_id, event_type, channel, details)
    VALUES (
      NEW.id,
      NEW.tenant_id,
      'rescheduled',
      'email',
      format('Rental rescheduled: %s %s → %s %s',
        OLD.start_date, COALESCE(OLD.pickup_time, '09:00'),
        NEW.start_date, COALESCE(NEW.pickup_time, '09:00'))
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_reset_lockbox_on_reschedule ON public.rentals;

CREATE TRIGGER trg_reset_lockbox_on_reschedule
  BEFORE UPDATE ON public.rentals
  FOR EACH ROW
  WHEN (OLD.start_date IS DISTINCT FROM NEW.start_date OR OLD.pickup_time IS DISTINCT FROM NEW.pickup_time)
  EXECUTE FUNCTION reset_lockbox_sent_on_reschedule();
