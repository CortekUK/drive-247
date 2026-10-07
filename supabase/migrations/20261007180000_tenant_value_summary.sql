-- APPLIED to production 2026-10-07 via the Management API.
--
-- "What Drive247 did for you this month" — the card at the bottom of the
-- portal home (v1 and v2). One call returns the four numbers for a tenant over
-- [p_from, p_to):
--
--   bookings          rentals created in the range, not Cancelled / Rejected
--   rental_revenue    money collected: payments in a collected status, net of
--                     refunds, by payment_date — the same definition as the v2
--                     revenue chart (use-dashboard-revenue-series.ts)
--   repeat_customers  customers who booked in the range AND have more than one
--                     (non-cancelled) rental with this tenant, ever
--   messages_sent     what the platform sent customers on the operator's
--                     behalf: customer notifications (booking approved,
--                     agreement to sign, …), PAYG / instalment / extension
--                     reminders, lockbox codes and system chat messages
--
-- SECURITY DEFINER because portal users cannot read customer_notifications
-- (customer-only RLS); it is safe because it only ever answers for the
-- caller's own tenant (or any tenant, for a super admin).

CREATE OR REPLACE FUNCTION public.get_tenant_value_summary(p_tenant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bookings integer;
  v_revenue numeric;
  v_repeat integer;
  v_messages integer;
BEGIN
  IF p_tenant_id IS NULL OR p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'tenant and range are required';
  END IF;
  IF NOT (public.is_super_admin() OR p_tenant_id = public.get_user_tenant_id()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_bookings
  FROM rentals
  WHERE tenant_id = p_tenant_id
    AND created_at >= p_from AND created_at < p_to
    AND coalesce(status, '') NOT IN ('Cancelled', 'Rejected');

  SELECT coalesce(sum(amount - coalesce(refund_amount, 0)), 0) INTO v_revenue
  FROM payments
  WHERE tenant_id = p_tenant_id
    AND status IN ('Applied', 'Completed', 'Partial', 'Credit', 'Partial Refund')
    AND payment_date >= p_from::date AND payment_date < p_to::date;

  SELECT count(*) INTO v_repeat
  FROM (
    SELECT DISTINCT r.customer_id
    FROM rentals r
    WHERE r.tenant_id = p_tenant_id
      AND r.customer_id IS NOT NULL
      AND r.created_at >= p_from AND r.created_at < p_to
      AND coalesce(r.status, '') NOT IN ('Cancelled', 'Rejected')
  ) booked
  WHERE (
    SELECT count(*) FROM rentals r2
    WHERE r2.tenant_id = p_tenant_id
      AND r2.customer_id = booked.customer_id
      AND coalesce(r2.status, '') NOT IN ('Cancelled', 'Rejected')
  ) > 1;

  SELECT
      (SELECT count(*) FROM customer_notifications
        WHERE tenant_id = p_tenant_id AND created_at >= p_from AND created_at < p_to)
    + (SELECT count(*) FROM payg_reminder_log
        WHERE tenant_id = p_tenant_id AND sent_at >= p_from AND sent_at < p_to AND success IS NOT FALSE)
    + (SELECT count(*) FROM installment_notifications
        WHERE tenant_id = p_tenant_id AND sent_at >= p_from AND sent_at < p_to AND coalesce(status, 'sent') IN ('sent', 'success', 'delivered'))
    + (SELECT count(*) FROM auto_extension_reminders
        WHERE tenant_id = p_tenant_id AND sent_at >= p_from AND sent_at < p_to AND coalesce(status, 'sent') IN ('sent', 'success', 'delivered'))
    + (SELECT count(*) FROM lockbox_send_log
        WHERE tenant_id = p_tenant_id AND created_at >= p_from AND created_at < p_to)
    + (SELECT count(*) FROM chat_channel_messages m
        JOIN chat_channels c ON c.id = m.channel_id
        WHERE c.tenant_id = p_tenant_id AND m.sender_type = 'system'
          AND m.created_at >= p_from AND m.created_at < p_to)
  INTO v_messages;

  RETURN jsonb_build_object(
    'bookings', v_bookings,
    'rental_revenue', v_revenue,
    'repeat_customers', v_repeat,
    'messages_sent', v_messages
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_value_summary(uuid, timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_value_summary(uuid, timestamptz, timestamptz) TO authenticated;
