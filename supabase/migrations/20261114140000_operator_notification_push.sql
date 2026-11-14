-- QA R15.6 / R15.7 (2026-11-14): operator bell notifications (new booking,
-- agreement signed, payment received...) never reached staff phones. Every
-- tenant-wide notification now also asks push-operator-notification to push it
-- to that tenant's staff devices. Same shape as on_notification_operator_email:
-- only the id travels; the function re-reads the row, pushes once, fresh only.
CREATE OR REPLACE FUNCTION public.notify_operator_push_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only when the tenant has at least one live staff device.
  IF NOT EXISTS (
    SELECT 1 FROM push_subscriptions
     WHERE tenant_id = NEW.tenant_id AND audience = 'staff' AND is_active = true AND revoked_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;
  PERFORM net.http_post(
    url     := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/push-operator-notification',
    body    := jsonb_build_object('notification_id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a push break a notification insert.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_notification_operator_push ON public.notifications;
CREATE TRIGGER on_notification_operator_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_operator_push_dispatch();
