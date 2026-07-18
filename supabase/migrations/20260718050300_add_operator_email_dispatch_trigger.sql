-- ============================================================================
-- Universal operator-EMAIL parity for the always-on portal bells.
-- Every broadcast operator notification fires a fire-and-forget pg_net call to
-- the notify-operator-email edge function, which applies the per-category gate
-- (master switch + category pref) and routes to the configured recipient.
-- This gives EMAIL coverage for every event that has a bell — from one place —
-- instead of the old scattered / single-path / orphaned operator emails.
--
-- Guards (in order, cheapest first):
--   * only broadcast rows (user_id IS NULL) with a tenant
--   * only emailable operator types (booking_new excluded: send-booking-
--     notification already emails it; chat/reminder/etc. get no operator email)
--   * only tenants whose master email switch is ON (skips the HTTP call for the
--     ~all tenants who have email off — the category pref is re-checked in the fn)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_operator_email_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only TRANSACTIONAL types dispatch a per-event email. Reminder/digest types
  -- (return_overdue, pickup_reminder, preauth_expiring, rental_reminder,
  -- insurance_reminder) keep their own in-function digest email, so they are
  -- excluded here to avoid double-sending.
  IF NEW.type NOT IN (
      'payment_received','payment_failed','refund_processed',
      'fine_new','signing_completed','identity_verified',
      'booking_approved','booking_rejected','booking_cancelled',
      'rental_started','rental_completed','rental_extended'
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenants
    WHERE id = NEW.tenant_id AND email_notifications_enabled = true
  ) THEN
    RETURN NEW;
  END IF;

  -- Pass ONLY the id; the function re-reads the row (never trusts caller content).
  PERFORM net.http_post(
    url     := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/notify-operator-email',
    body    := jsonb_build_object('notification_id', NEW.id),
    headers := jsonb_build_object('Content-Type','application/json')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let email dispatch break a notification insert.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_notification_operator_email ON public.notifications;
CREATE TRIGGER on_notification_operator_email
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_operator_email_dispatch();
