-- payg_settle_invoice: called by the Stripe webhook when a PAYG invoice payment succeeds.
-- Marks the target accrual as 'paid' and flips every prior 'open' accrual on the same
-- rental to 'superseded' by it. Idempotent: the WHERE clauses filter out already-
-- settled rows, so double-invocation is safe.

CREATE OR REPLACE FUNCTION public.payg_settle_invoice(
  p_payment_id uuid,
  p_accrual_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rental_id uuid;
  v_day_index integer;
BEGIN
  SELECT rental_id, accrual_day_index
    INTO v_rental_id, v_day_index
    FROM public.payg_accruals
   WHERE id = p_accrual_id;

  IF v_rental_id IS NULL THEN
    RAISE NOTICE 'payg_settle_invoice: accrual % not found', p_accrual_id;
    RETURN;
  END IF;

  UPDATE public.payg_accruals
     SET invoice_status     = 'paid',
         paid_at            = now(),
         settling_payment_id = p_payment_id
   WHERE id = p_accrual_id
     AND invoice_status = 'open';

  UPDATE public.payg_accruals
     SET invoice_status          = 'superseded',
         superseded_by_accrual_id = p_accrual_id
   WHERE rental_id = v_rental_id
     AND accrual_day_index < v_day_index
     AND invoice_status = 'open';
END;
$$;

GRANT EXECUTE ON FUNCTION public.payg_settle_invoice(uuid, uuid) TO service_role;
