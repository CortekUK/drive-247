-- Declined / never-captured card payments are set to status 'Reversed' with
-- capture_status 'cancelled' and no paid_at (square-webhook, square-adapter,
-- cancelled Stripe authorisations). on_refund_processed_notify treated them as
-- refunds and the operator's team was emailed "Refund of $X processed" for money
-- that never arrived (Luxurious Car Rentals, R-ace6de, 2026-11-19). Skip those.
-- Real refunds ('Refunded', 'Partial Refund') and real reversals of recorded
-- payments are unchanged. Applied live via the Management API on 2026-11-20.
CREATE OR REPLACE FUNCTION public.notify_refund_processed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id  uuid;
  _currency   text := 'USD';
  _symbol     text;
  _amt        numeric;
  _amount_txt text;
  _ref        text;
  _link       text;
BEGIN
  -- Fire only on the FIRST transition into a refunded/reversed state.
  IF NOT (
       (TG_OP = 'INSERT' AND NEW.status IN ('Refunded','Partial Refund','Reversed'))
    OR (TG_OP = 'UPDATE'
        AND NEW.status IN ('Refunded','Partial Refund','Reversed')
        AND COALESCE(OLD.status,'') NOT IN ('Refunded','Partial Refund','Reversed'))
  ) THEN
    RETURN NEW;
  END IF;

  -- A voided unpaid payment LINK is Reversed but carries no money — not a refund.
  IF COALESCE(NEW.refund_reason,'') LIKE '[VOIDED]%' THEN
    RETURN NEW;
  END IF;

  -- A card payment that was DECLINED or never captured is also set to
  -- 'Reversed' (square-webhook / square-adapter, and Stripe's cancelled
  -- authorisations), with capture_status 'cancelled' and no paid_at. No money
  -- ever arrived, so it is not a refund: Luxurious Car Rentals' team got
  -- "Refund of $559.74 processed for booking ACE6DE07" for a card the bank
  -- declined (TRANSACTION_LIMIT, R-ace6de, 2026-11-19).
  IF NEW.status = 'Reversed' AND NEW.paid_at IS NULL AND COALESCE(NEW.capture_status,'') = 'cancelled' THEN
    RETURN NEW;
  END IF;

  _amt := COALESCE(NEW.refund_amount, NEW.amount, 0);
  IF _amt <= 0 THEN RETURN NEW; END IF;

  _tenant_id := NEW.tenant_id;
  IF _tenant_id IS NULL AND NEW.rental_id IS NOT NULL THEN
    SELECT tenant_id INTO _tenant_id FROM rentals WHERE id = NEW.rental_id;
  END IF;
  IF _tenant_id IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT tenant_id INTO _tenant_id FROM customers WHERE id = NEW.customer_id;
  END IF;
  IF _tenant_id IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM notifications
    WHERE tenant_id = _tenant_id AND type = 'refund_processed'
      AND user_id IS NULL AND metadata->>'dedupe_key' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(currency_code,'USD') INTO _currency FROM tenants WHERE id = _tenant_id;
  _currency := COALESCE(_currency,'USD');
  _symbol := CASE _currency WHEN 'USD' THEN '$' WHEN 'GBP' THEN '£' WHEN 'EUR' THEN '€' ELSE _currency || ' ' END;
  _amount_txt := _symbol || to_char(_amt, 'FM999999990.00');

  _ref  := CASE WHEN NEW.rental_id IS NOT NULL THEN UPPER(LEFT(NEW.rental_id::text, 8)) END;
  _link := CASE WHEN NEW.rental_id IS NOT NULL THEN '/rentals/' || NEW.rental_id::text ELSE '/payments' END;

  INSERT INTO notifications (user_id, tenant_id, title, message, type, is_read, link, metadata)
  VALUES (
    NULL, _tenant_id,
    'Refund processed',
    'Refund of ' || _amount_txt || COALESCE(' processed for booking ' || _ref, ' processed'),
    'refund_processed', false, _link,
    jsonb_build_object('rental_id', NEW.rental_id, 'payment_id', NEW.id, 'amount', _amt, 'dedupe_key', NEW.id::text)
  );

  RETURN NEW;
END;
$function$;
