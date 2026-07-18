-- ============================================================================
-- Universal operator "payment_received" bell via a DB trigger on public.payments
-- Mirrors notify_new_rental (broadcast row, user_id=NULL) so it fires from EVERY
-- settlement path (webhooks, edge functions, client direct-DB writes) exactly once.
-- Root cause: the payment_received bell previously lived in only ONE code path
-- (stripe webhook checkout.session.completed auto-branch), so admin "Collect
-- Payment" / apply-payment / payment_intent.succeeded / installment settlements
-- never produced a bell. A status-transition trigger catches them all.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_payment_received()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id   uuid;
  _currency    text := 'USD';
  _symbol      text;
  _amount_txt  text;
  _booking_ref text;
  _link        text;
BEGIN
  -- Fire only on the FIRST transition INTO a settled/received state.
  -- (INSERT triggers cannot reference OLD, so branch on TG_OP in the body.)
  IF NOT (
       (TG_OP = 'INSERT' AND NEW.status IN ('Applied','Completed'))
    OR (TG_OP = 'UPDATE'
        AND NEW.status IN ('Applied','Completed')
        AND COALESCE(OLD.status,'') NOT IN ('Applied','Completed'))
  ) THEN
    RETURN NEW;
  END IF;

  -- Ignore zero/negative rows.
  IF COALESCE(NEW.amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Resolve tenant (payments.tenant_id can be NULL at settle time).
  _tenant_id := NEW.tenant_id;
  IF _tenant_id IS NULL AND NEW.rental_id IS NOT NULL THEN
    SELECT tenant_id INTO _tenant_id FROM rentals WHERE id = NEW.rental_id;
  END IF;
  IF _tenant_id IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT tenant_id INTO _tenant_id FROM customers WHERE id = NEW.customer_id;
  END IF;
  IF _tenant_id IS NULL THEN
    -- A null-tenant broadcast is invisible under notifications RLS; nothing to do.
    RETURN NEW;
  END IF;

  -- Idempotency: never emit a second payment_received for this payment.
  -- Uses the SAME dedupe_key contract as _shared/notify-inapp.ts (payment id),
  -- so trigger and webhook mutually suppress during the rollout window.
  IF EXISTS (
    SELECT 1 FROM notifications
    WHERE tenant_id = _tenant_id
      AND type = 'payment_received'
      AND user_id IS NULL
      AND metadata->>'dedupe_key' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  -- Currency formatting (matches webhook's formatCurrency style).
  SELECT COALESCE(currency_code,'USD') INTO _currency FROM tenants WHERE id = _tenant_id;
  _currency := COALESCE(_currency,'USD');
  _symbol := CASE _currency
               WHEN 'USD' THEN '$'
               WHEN 'GBP' THEN '£'
               WHEN 'EUR' THEN '€'
               ELSE _currency || ' '
             END;
  _amount_txt := _symbol || to_char(NEW.amount, 'FM999999990.00');

  -- Booking ref matches the webhook's rentalId.substring(0,8).toUpperCase().
  _booking_ref := CASE WHEN NEW.rental_id IS NOT NULL
                       THEN UPPER(LEFT(NEW.rental_id::text, 8)) END;
  _link := CASE WHEN NEW.rental_id IS NOT NULL
                THEN '/rentals/' || NEW.rental_id::text
                ELSE '/invoices' END;

  INSERT INTO notifications (user_id, tenant_id, title, message, type, is_read, link, metadata)
  VALUES (
    NULL,                                   -- broadcast to all operators of the tenant
    _tenant_id,
    'Payment received',
    'Payment of ' || _amount_txt
      || COALESCE(' received for booking ' || _booking_ref, ' received'),
    'payment_received',
    false,
    _link,
    jsonb_build_object(
      'rental_id',  NEW.rental_id,
      'payment_id', NEW.id,
      'amount',     NEW.amount,
      'dedupe_key', NEW.id::text
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_payment_received_notify ON public.payments;

CREATE TRIGGER on_payment_received_notify
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_payment_received();
