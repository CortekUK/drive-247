-- ============================================================================
-- Universal operator bells for e-sign completion and identity verification.
-- Both were HARD-BROKEN before: notify-signing-completed and
-- notify-identity-verified had ZERO callers, so the bells never fired.
-- Table triggers catch every source (BoldSign webhook, Veriff, AI, CMD).
-- ============================================================================

-- ---------- signing_completed (rental_agreements.document_status -> completed)
CREATE OR REPLACE FUNCTION public.notify_signing_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _cust      text;
  _ref       text;
BEGIN
  IF NOT (
       (TG_OP = 'INSERT' AND NEW.document_status = 'completed')
    OR (TG_OP = 'UPDATE' AND NEW.document_status = 'completed'
        AND COALESCE(OLD.document_status,'') <> 'completed')
  ) THEN
    RETURN NEW;
  END IF;

  _tenant_id := NEW.tenant_id;
  IF _tenant_id IS NULL AND NEW.rental_id IS NOT NULL THEN
    SELECT tenant_id INTO _tenant_id FROM rentals WHERE id = NEW.rental_id;
  END IF;
  IF _tenant_id IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM notifications
    WHERE tenant_id = _tenant_id AND type = 'signing_completed'
      AND user_id IS NULL AND metadata->>'dedupe_key' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  SELECT c.name INTO _cust
  FROM rentals r JOIN customers c ON c.id = r.customer_id
  WHERE r.id = NEW.rental_id;

  _ref := CASE WHEN NEW.rental_id IS NOT NULL THEN UPPER(LEFT(NEW.rental_id::text, 8)) END;

  INSERT INTO notifications (user_id, tenant_id, title, message, type, is_read, link, metadata)
  VALUES (
    NULL, _tenant_id,
    'Agreement signed',
    'Rental agreement signed' || COALESCE(' by ' || _cust, '')
      || COALESCE(' for booking ' || _ref, ''),
    'signing_completed', false,
    CASE WHEN NEW.rental_id IS NOT NULL THEN '/rentals/' || NEW.rental_id::text ELSE '/rentals' END,
    jsonb_build_object('agreement_id', NEW.id, 'rental_id', NEW.rental_id, 'dedupe_key', NEW.id::text)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_signing_completed_notify ON public.rental_agreements;
CREATE TRIGGER on_signing_completed_notify
  AFTER INSERT OR UPDATE OF document_status ON public.rental_agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_signing_completed();

-- ---------- identity_verified (identity_verifications.status -> completed/approved)
CREATE OR REPLACE FUNCTION public.notify_identity_verified()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _cust      text;
  _title     text;
  _msg       text;
BEGIN
  IF NOT (
       (TG_OP = 'INSERT' AND NEW.status IN ('completed','approved'))
    OR (TG_OP = 'UPDATE' AND NEW.status IN ('completed','approved')
        AND COALESCE(OLD.status,'') NOT IN ('completed','approved'))
  ) THEN
    RETURN NEW;
  END IF;

  _tenant_id := NEW.tenant_id;
  IF _tenant_id IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT tenant_id INTO _tenant_id FROM customers WHERE id = NEW.customer_id;
  END IF;
  IF _tenant_id IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM notifications
    WHERE tenant_id = _tenant_id AND type = 'identity_verified'
      AND user_id IS NULL AND metadata->>'dedupe_key' = NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  _cust := COALESCE(NULLIF(TRIM(COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'')), ''),
                    (SELECT name FROM customers WHERE id = NEW.customer_id),
                    'A customer');

  -- Outcome from review_result (Veriff GREEN/RED/RETRY); AI/CMD may leave it null.
  IF NEW.review_result = 'RED' THEN
    _title := 'Identity verification failed';
    _msg   := _cust || '''s identity verification was declined'
                || COALESCE(' — ' || NEW.rejection_reason, '') || '.';
  ELSIF NEW.review_result = 'RETRY' THEN
    _title := 'Identity documents need resubmission';
    _msg   := _cust || ' needs to resubmit identity documents.';
  ELSE
    _title := 'Identity verified';
    _msg   := _cust || '''s identity has been verified.';
  END IF;

  INSERT INTO notifications (user_id, tenant_id, title, message, type, is_read, link, metadata)
  VALUES (
    NULL, _tenant_id, _title, _msg, 'identity_verified', false,
    CASE WHEN NEW.customer_id IS NOT NULL THEN '/customers/' || NEW.customer_id::text ELSE '/customers' END,
    jsonb_build_object('verification_id', NEW.id, 'customer_id', NEW.customer_id,
                       'review_result', NEW.review_result, 'dedupe_key', NEW.id::text)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_identity_verified_notify ON public.identity_verifications;
CREATE TRIGGER on_identity_verified_notify
  AFTER INSERT OR UPDATE OF status ON public.identity_verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_identity_verified();
