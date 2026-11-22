-- APPLIED to production 2026-11-13 (R5 QA, branch Rental_testing-13nov)
--
-- rental_edit_blocker_v2 locked a rental's dates, handover and price as soon as
-- ANY payments row existed ("Money has already been taken or arranged."). Since
-- create-booking-payment-intent went live (2026-11-13) the booking site writes a
-- Pending payments row the moment the card form opens, before the customer
-- pays. So every booking where the customer reached the card form but did not
-- pay became uneditable for staff.
--
-- An embedded-card attempt that has not been paid is not money. It is
-- recognised exactly as that function writes it: status 'Pending',
-- capture_status 'requires_capture', a PaymentIntent and no Checkout Session.
-- Nothing else produced such rows before (0 rows on 2026-11-13). When the price
-- changes, create-booking-payment-intent cancels the stale PaymentIntent and
-- re-points the same row at a new one, so an outdated amount cannot be paid.
--
-- Hosted-checkout links (stripe_checkout_session_id set) still lock, unchanged.
--
-- Rollback: re-run the previous definition (same body without the AND NOT (...)
-- clause on the payments EXISTS).

CREATE OR REPLACE FUNCTION public.rental_edit_blocker_v2(p_rental_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v record;
BEGIN
  SELECT status, insurance_status, docusign_envelope_id, signed_document_id
    INTO v FROM rentals WHERE id = p_rental_id;
  IF NOT FOUND THEN RETURN 'This rental does not exist.'; END IF;

  RETURN CASE
    WHEN lower(COALESCE(v.status, '')) <> 'pending'
      THEN 'Only a pending rental can be changed here. This one is ' || COALESCE(v.status, 'without a status') || '.'
    WHEN v.docusign_envelope_id IS NOT NULL OR v.signed_document_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM rental_agreements a WHERE a.rental_id = p_rental_id
                   AND (a.envelope_sent_at IS NOT NULL OR a.signed_document_id IS NOT NULL))
      THEN 'The agreement has already gone out.'
    WHEN lower(COALESCE(v.insurance_status, 'pending')) <> 'pending'
      OR EXISTS (SELECT 1 FROM bonzah_insurance_policies b WHERE b.rental_id = p_rental_id)
      OR EXISTS (SELECT 1 FROM insurance_verifications i WHERE i.rental_id = p_rental_id)
      OR EXISTS (SELECT 1 FROM rental_insurance_verifications ri WHERE ri.rental_id = p_rental_id)
      THEN 'Insurance has already been set up.'
    WHEN EXISTS (SELECT 1 FROM payments p WHERE p.rental_id = p_rental_id
                   AND COALESCE(p.status, '') NOT IN ('Reversed', 'Refunded')
                   -- an unpaid embedded-card attempt (create-booking-payment-intent)
                   AND NOT (p.status = 'Pending'
                            AND p.capture_status = 'requires_capture'
                            AND p.stripe_checkout_session_id IS NULL
                            AND p.stripe_payment_intent_id IS NOT NULL))
      OR EXISTS (SELECT 1 FROM installment_plans ip WHERE ip.rental_id = p_rental_id)
      OR EXISTS (SELECT 1 FROM rental_card_mandates m WHERE m.rental_id = p_rental_id)
      THEN 'Money has already been taken or arranged.'
    WHEN EXISTS (SELECT 1 FROM rental_key_handovers k WHERE k.rental_id = p_rental_id AND k.handed_at IS NOT NULL)
      THEN 'The car has already been handed over.'
    ELSE NULL
  END;
END $function$;
