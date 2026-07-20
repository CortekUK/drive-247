-- A VOIDED (never-paid) payment link is soft-cancelled to status='Reversed' by
-- void-payment-link, but it is NOT a refund — no money moved. Without this guard,
-- the on_refund_processed_notify trigger fired a phantom "Refund of $X processed"
-- operator notification + email on every voided link (refund_amount is null, so it
-- fell back to NEW.amount = the full link amount). Suppress the refund bell only for
-- voided links (refund_reason '[VOIDED]…'); reverse-payment's real reversal writes
-- '[REVERSED]…' and its refund notification stays legitimate.
-- (Applied live via the Management API this session; captured here for repo parity.)
CREATE OR REPLACE FUNCTION public.notify_refund_processed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
