-- installment_settle_invoice: PAYG-style cumulative settlement.
--
-- Marks one scheduled_installment as paid, then supersedes any earlier
-- 'open' installments on the same plan (lower installment_number) so the
-- system never holds an "installment 1 unpaid + installment 3 paid" state.
--
-- Idempotent: re-calling with the same payment_id + installment_id is a no-op.

CREATE OR REPLACE FUNCTION public.installment_settle_invoice(
  p_payment_id uuid,
  p_installment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_installment_number integer;
  v_already_paid boolean;
BEGIN
  -- Resolve the target installment + check current state
  SELECT installment_plan_id, installment_number, (invoice_status = 'paid')
    INTO v_plan_id, v_installment_number, v_already_paid
  FROM public.scheduled_installments
  WHERE id = p_installment_id
  FOR UPDATE;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'installment % not found', p_installment_id;
  END IF;

  -- Idempotency: if already paid by this same payment, do nothing
  IF v_already_paid THEN
    RETURN;
  END IF;

  -- Mark target as paid
  UPDATE public.scheduled_installments
  SET invoice_status = 'paid',
      paid_at = now(),
      settling_payment_id = p_payment_id,
      payment_id = p_payment_id,
      status = 'paid',
      updated_at = now()
  WHERE id = p_installment_id;

  -- Supersede all earlier 'open' installments on the same plan
  UPDATE public.scheduled_installments
  SET invoice_status = 'superseded',
      superseded_by_installment_id = p_installment_id,
      updated_at = now()
  WHERE installment_plan_id = v_plan_id
    AND installment_number < v_installment_number
    AND invoice_status = 'open';

  -- Roll plan-level counters
  UPDATE public.installment_plans
  SET paid_installments = (
        SELECT COUNT(*) FROM public.scheduled_installments
        WHERE installment_plan_id = v_plan_id AND invoice_status = 'paid'
      ),
      total_paid = (
        SELECT COALESCE(SUM(amount), 0) FROM public.scheduled_installments
        WHERE installment_plan_id = v_plan_id AND invoice_status = 'paid'
      ),
      consecutive_sca_failures = 0,
      updated_at = now()
  WHERE id = v_plan_id;

  -- Log a settlement event for the timeline UI
  INSERT INTO public.installment_notifications(
    installment_id, installment_plan_id, tenant_id,
    notification_type, status, payment_id, message, sent_at, created_at
  )
  SELECT
    p_installment_id,
    v_plan_id,
    si.tenant_id,
    'payment_settled',
    'success',
    p_payment_id,
    'Payment settled installment #' || v_installment_number,
    now(),
    now()
  FROM public.scheduled_installments si
  WHERE si.id = p_installment_id;
END;
$$;

-- Restrict to service_role (called from edge functions / webhooks only)
REVOKE ALL ON FUNCTION public.installment_settle_invoice(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.installment_settle_invoice(uuid, uuid) TO service_role;
