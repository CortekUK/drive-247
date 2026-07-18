-- ============================================================================
-- Universal operator bells for refunds and fines, via DB triggers.
-- Mirrors notify_payment_received / notify_new_rental (broadcast, user_id=NULL).
--   refund_processed: fires when a payment enters a refunded/reversed state from
--                     ANY path (Stripe charge.refunded, manual/ledger refund,
--                     cancel-rental-refund, reverse-payment). Dedupe_key = payment
--                     id, so it mutually suppresses with the webhook refund bell.
--   fine_new:         fires when a fine row is created from ANY path (apply-fine,
--                     record-authority-payment, manual). Previously never fired
--                     (notify-fine-recorded had zero callers).
-- ============================================================================

-- ---------- refund_processed ------------------------------------------------
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

DROP TRIGGER IF EXISTS on_refund_processed_notify ON public.payments;
CREATE TRIGGER on_refund_processed_notify
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_refund_processed();

-- ---------- fine_new --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_fine_new()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id  uuid;
  _currency   text := 'USD';
  _symbol     text;
  _amount_txt text;
  _ref        text;
  _link       text;
BEGIN
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
    WHERE tenant_id = _tenant_id AND type = 'fine_new'
      AND user_id IS NULL AND metadata->>'dedupe_key' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(currency_code,'USD') INTO _currency FROM tenants WHERE id = _tenant_id;
  _currency := COALESCE(_currency,'USD');
  _symbol := CASE _currency WHEN 'USD' THEN '$' WHEN 'GBP' THEN '£' WHEN 'EUR' THEN '€' ELSE _currency || ' ' END;
  _amount_txt := _symbol || to_char(COALESCE(NEW.amount,0), 'FM999999990.00');

  _ref  := CASE WHEN NEW.rental_id IS NOT NULL THEN UPPER(LEFT(NEW.rental_id::text, 8)) END;
  _link := CASE WHEN NEW.rental_id IS NOT NULL THEN '/rentals/' || NEW.rental_id::text
                WHEN NEW.customer_id IS NOT NULL THEN '/customers/' || NEW.customer_id::text
                ELSE '/rentals' END;

  INSERT INTO notifications (user_id, tenant_id, title, message, type, is_read, link, metadata)
  VALUES (
    NULL, _tenant_id,
    'Fine recorded',
    'Fine recorded' || COALESCE(' (' || NEW.type || ')', '') || ': ' || _amount_txt
      || COALESCE(' for booking ' || _ref, ''),
    'fine_new', false, _link,
    jsonb_build_object('fine_id', NEW.id, 'rental_id', NEW.rental_id, 'customer_id', NEW.customer_id,
                       'amount', NEW.amount, 'dedupe_key', NEW.id::text)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_fine_new_notify ON public.fines;
CREATE TRIGGER on_fine_new_notify
  AFTER INSERT ON public.fines
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_fine_new();
