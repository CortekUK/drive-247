-- enforce_payment_target_categories
CREATE OR REPLACE FUNCTION public.enforce_payment_target_categories()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_categories jsonb;
  v_charge_category   text;
BEGIN
  -- Defensive: payment_applications.payment_id and .charge_entry_id are nullable
  -- in schema. Skip the check when either is null — the FK / app code handles
  -- those cases elsewhere.
  IF NEW.payment_id IS NULL OR NEW.charge_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT target_categories INTO v_target_categories
  FROM public.payments
  WHERE id = NEW.payment_id;

  -- No target_categories means "universal FIFO" mode is intentional (booking
  -- flow, customer pays a generic amount). Allow any allocation.
  IF v_target_categories IS NULL
     OR jsonb_typeof(v_target_categories) <> 'array'
     OR jsonb_array_length(v_target_categories) = 0
  THEN
    RETURN NEW;
  END IF;

  SELECT category INTO v_charge_category
  FROM public.ledger_entries
  WHERE id = NEW.charge_entry_id;

  -- Charge row missing? Let the FK do its job, don't double-fault.
  IF v_charge_category IS NULL THEN
    RETURN NEW;
  END IF;

  -- @> checks whether the jsonb array contains the given value.
  -- to_jsonb('Tax'::text) produces "Tax" (a JSON string), so this matches
  -- a string element inside the array.
  IF NOT (v_target_categories @> to_jsonb(v_charge_category)) THEN
    RAISE EXCEPTION
      'payment_applications: payment % is targeted to % but charge % has category %',
      NEW.payment_id, v_target_categories::text, NEW.charge_entry_id, v_charge_category
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;

-- enqueue_financial_event_for_ledger_entry
CREATE OR REPLACE FUNCTION public.enqueue_financial_event_for_ledger_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event_type text;
  v_amount_cents integer;
  v_currency text;
  v_description text;
BEGIN
  -- Skip rows without a tenant_id (legacy / malformed entries).
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Map ledger row → financial_event_type.
  IF NEW.type = 'Payment' THEN
    v_event_type := 'payment_receipt';
  ELSIF NEW.type = 'Charge' THEN
    v_event_type := CASE LOWER(COALESCE(NEW.category, ''))
      WHEN 'rental'              THEN 'rental_charge'
      WHEN 'tax'                 THEN 'rental_charge'
      WHEN 'service fee'         THEN 'rental_charge'
      WHEN 'initial fees'        THEN 'rental_charge'
      WHEN 'unlimited mileage'   THEN 'mileage_charge'
      WHEN 'late fee'            THEN 'late_fee'
      WHEN 'damage'              THEN 'damage_charge'
      WHEN 'mileage'             THEN 'mileage_charge'
      WHEN 'charging'            THEN 'charging_cost'
      WHEN 'insurance'           THEN 'insurance_charge'
      WHEN 'fines'               THEN 'late_fee'
      -- Refundable money held on the renter's behalf, NOT revenue. It maps to
      -- deposit_capture rather than rental_charge so the accounting layer books
      -- it against the deposit account, not income.
      WHEN 'security deposit'    THEN 'deposit_capture'
      ELSE NULL
    END;
  ELSE
    RETURN NEW;
  END IF;

  -- Unmapped category — skip silently.
  IF v_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve currency from tenant (default USD).
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
    FROM public.tenants WHERE id = NEW.tenant_id;

  -- amount_cents: ledger payment amounts are stored negative (-540.00) → flip sign.
  v_amount_cents := ROUND(ABS(COALESCE(NEW.amount, 0))::numeric * 100)::integer;
  IF v_amount_cents = 0 THEN
    RETURN NEW;
  END IF;

  -- Friendly description for the sync log.
  v_description := CASE
    WHEN NEW.type = 'Payment' THEN 'Payment received'
    WHEN LOWER(COALESCE(NEW.category, '')) = 'security deposit' THEN 'Security deposit (refundable)'
    ELSE COALESCE(NEW.category, 'Charge') || ' charge'
  END;

  -- Fire and forget. enqueue_financial_event handles the per-provider
  -- sync_state row fan-out. Wrapped in a sub-block so a failure here
  -- never bubbles up and aborts the parent rental/payment transaction.
  BEGIN
    PERFORM public.enqueue_financial_event(
      p_tenant_id    := NEW.tenant_id,
      p_event_type   := v_event_type::public.financial_event_type,
      p_amount_cents := v_amount_cents,
      p_currency     := v_currency,
      p_rental_id    := NEW.rental_id,
      p_customer_id  := NEW.customer_id,
      p_vehicle_id   := NEW.vehicle_id,
      p_source_table := 'ledger_entries',
      p_source_id    := NEW.id,
      p_description  := v_description,
      p_tax_cents    := 0,
      p_metadata     := jsonb_build_object(
        'ledger_type',     NEW.type,
        'ledger_category', NEW.category,
        'entry_date',      NEW.entry_date
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Best-effort. Don't crash the parent transaction over a sync hiccup.
    RAISE WARNING 'enqueue_financial_event_for_ledger_entry failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$
;

-- finalize_rental_extension
CREATE OR REPLACE FUNCTION public.finalize_rental_extension(p_extension_id uuid, p_payment_id uuid)
 RETURNS TABLE(out_extension_id uuid, out_rental_id uuid, out_previous_end_date date, out_new_end_date date, out_status text, out_end_date_updated boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ext_rental_id UUID;
    v_ext_previous_end DATE;
    v_ext_new_end DATE;
    v_ext_status TEXT;
    v_payment_intent TEXT;
    v_payment_extension_id UUID;
    v_payment_amount NUMERIC;
    v_current_end DATE;
    v_updated_end BOOLEAN := false;
BEGIN
    SELECT re.rental_id, re.previous_end_date, re.new_end_date, re.status
    INTO v_ext_rental_id, v_ext_previous_end, v_ext_new_end, v_ext_status
    FROM public.rental_extensions re
    WHERE re.id = p_extension_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'rental_extension % not found', p_extension_id;
    END IF;

    SELECT p.stripe_payment_intent_id, p.extension_id, p.amount
    INTO v_payment_intent, v_payment_extension_id, v_payment_amount
    FROM public.payments p
    WHERE p.id = p_payment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment % not found', p_payment_id;
    END IF;

    IF v_payment_extension_id IS NULL THEN
        UPDATE public.payments
        SET extension_id = p_extension_id,
            updated_at = now()
        WHERE id = p_payment_id;
    END IF;

    UPDATE public.rental_extensions re
    SET status = CASE WHEN re.status = 'refunded' THEN 'refunded' ELSE 'paid' END,
        paid_at = COALESCE(re.paid_at, now()),
        paid_amount = GREATEST(re.paid_amount, v_payment_amount),
        stripe_payment_intent_id = COALESCE(re.stripe_payment_intent_id, v_payment_intent),
        updated_at = now()
    WHERE re.id = p_extension_id;

    IF v_ext_new_end IS NOT NULL THEN
        SELECT r.end_date INTO v_current_end
        FROM public.rentals r
        WHERE r.id = v_ext_rental_id
        FOR UPDATE;

        IF v_current_end IS NULL OR v_ext_new_end > v_current_end THEN
            UPDATE public.rentals r
            SET end_date = v_ext_new_end,
                is_extended = false,
                extension_checkout_url = NULL,
                extension_amount = NULL,
                previous_end_date = COALESCE(r.previous_end_date, v_ext_previous_end),
                original_end_date = COALESCE(r.original_end_date, v_ext_previous_end),
                updated_at = now()
            WHERE r.id = v_ext_rental_id;
            v_updated_end := true;
        ELSE
            UPDATE public.rentals
            SET is_extended = false,
                extension_checkout_url = NULL,
                extension_amount = NULL,
                updated_at = now()
            WHERE id = v_ext_rental_id;
        END IF;
    ELSE
        UPDATE public.rentals
        SET is_extended = false,
            extension_checkout_url = NULL,
            extension_amount = NULL,
            updated_at = now()
        WHERE id = v_ext_rental_id;
    END IF;

    RETURN QUERY
    SELECT p_extension_id,
           v_ext_rental_id,
           v_ext_previous_end,
           v_ext_new_end,
           'paid'::text,
           v_updated_end;
END;
$function$
;

-- get_user_tenant_id
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1;
$function$
;

-- installment_settle_invoice
CREATE OR REPLACE FUNCTION public.installment_settle_invoice(p_payment_id uuid, p_installment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id            uuid;
  v_installment_number integer;
  v_already_paid       boolean;
  v_target_categories  jsonb;
BEGIN
  -- NEW GUARD (added in migration add_payment_category_guard_and_installment_rpc_guard):
  -- refuse to settle an installment slot when the payment is category-targeted
  -- to a list that doesn't include 'Rental'. This stops a Tax / Service Fee /
  -- Insurance / etc. payment from accidentally settling an installment (which
  -- would corrupt the plan by flipping upfront_paid=true and stamping the
  -- wrong upfront_payment_id). Mirrors the guards in apply-payment +
  -- stripe-webhook-test + stripe-webhook-live + process-pending-payment.
  SELECT target_categories INTO v_target_categories
  FROM public.payments
  WHERE id = p_payment_id;

  IF v_target_categories IS NOT NULL
     AND jsonb_typeof(v_target_categories) = 'array'
     AND jsonb_array_length(v_target_categories) > 0
     AND NOT (v_target_categories @> to_jsonb('Rental'::text))
  THEN
    RAISE EXCEPTION
      'installment_settle_invoice refused: payment % is targeted to % (Rental not in list)',
      p_payment_id, v_target_categories::text
      USING ERRCODE = 'check_violation';
  END IF;

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
$function$
;

-- is_super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT is_super_admin FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1),
    false
  );
$function$
;

-- payg_settle_invoice
CREATE OR REPLACE FUNCTION public.payg_settle_invoice(p_payment_id uuid, p_accrual_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Supersede earlier OPEN accruals (original behaviour)
  -- AND earlier 'paid' accruals that were settled by the SAME payment
  -- (consolidates a multi-accrual single-Stripe-payment batch into the latest
  -- accrual, which becomes the canonical "paid invoice" carrying the cumulative).
  UPDATE public.payg_accruals
     SET invoice_status          = 'superseded',
         superseded_by_accrual_id = p_accrual_id
   WHERE rental_id = v_rental_id
     AND accrual_day_index < v_day_index
     AND id != p_accrual_id
     AND (
       invoice_status = 'open'
       OR (invoice_status = 'paid' AND settling_payment_id = p_payment_id)
     );
END;
$function$
;

-- payment_apply_fifo_v2
CREATE OR REPLACE FUNCTION public.payment_apply_fifo_v2(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_amt NUMERIC;
  v_already NUMERIC;
  v_left NUMERIC;
  v_rental UUID;
  v_customer UUID;
  v_vehicle UUID;
  v_tenant UUID;
  v_pay_date DATE;
  v_is_early BOOLEAN;
  v_extension UUID;
  v_targets_jsonb JSONB;
  v_targets TEXT[];
  c RECORD;
  to_apply NUMERIC;
  next_due_date DATE;
BEGIN
  SELECT amount, rental_id, customer_id, vehicle_id, payment_date, is_early, extension_id, target_categories, tenant_id
    INTO v_amt, v_rental, v_customer, v_vehicle, v_pay_date, v_is_early, v_extension, v_targets_jsonb, v_tenant
  FROM payments WHERE id = p_id;

  IF v_customer IS NULL THEN RETURN; END IF;

  -- Belt-and-braces: a payment row missing tenant_id would otherwise orphan
  -- every P&L row it writes (invisible to the tenant-scoped P&L dashboard).
  IF v_tenant IS NULL AND v_vehicle IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant FROM vehicles WHERE id = v_vehicle;
  END IF;

  IF v_targets_jsonb IS NOT NULL AND jsonb_typeof(v_targets_jsonb) = 'array' THEN
    SELECT ARRAY(SELECT jsonb_array_elements_text(v_targets_jsonb)) INTO v_targets;
  END IF;

  SELECT COALESCE(SUM(amount_applied), 0) INTO v_already
  FROM payment_applications WHERE payment_id = p_id;

  v_left := v_amt - v_already;
  IF v_left <= 0 THEN
    UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p_id;
    RETURN;
  END IF;

  IF NOT v_is_early THEN
    SELECT MIN(due_date) INTO next_due_date
    FROM ledger_entries
    WHERE customer_id = v_customer AND type='Charge' AND category='Rental' AND remaining_amount > 0;

    IF next_due_date IS NOT NULL AND v_pay_date < next_due_date THEN
      v_is_early := TRUE;
      UPDATE payments SET is_early = TRUE WHERE id = p_id;
    END IF;
  END IF;

  FOR c IN
    WITH cat_order AS (
      SELECT 'Rental'::text AS cat, 1 AS pri UNION ALL
      SELECT 'Tax', 2 UNION ALL
      SELECT 'Service Fee', 3 UNION ALL
      SELECT 'Delivery Fee', 4 UNION ALL
      SELECT 'Collection Fee', 5 UNION ALL
      SELECT 'Insurance', 6 UNION ALL
      SELECT 'Extras', 7 UNION ALL
      SELECT 'Extension Rental', 8 UNION ALL
      SELECT 'Extension Tax', 9 UNION ALL
      SELECT 'Extension Service Fee', 10 UNION ALL
      SELECT 'Extension Insurance', 11 UNION ALL
      SELECT 'Fine', 12 UNION ALL
      SELECT 'Fines', 12 UNION ALL
      SELECT 'Other', 13 UNION ALL
      -- Deliberately last: refundable money, not earned money. See header.
      SELECT 'Security Deposit', 14
    )
    SELECT le.id, le.remaining_amount, le.due_date, le.category, co.pri
      FROM ledger_entries le
      JOIN cat_order co ON co.cat = le.category
     WHERE le.customer_id = v_customer
       AND le.type = 'Charge'
       AND le.remaining_amount > 0
       AND (v_rental IS NULL OR le.rental_id = v_rental)
       AND (v_extension IS NULL OR le.extension_id = v_extension OR le.category NOT LIKE 'Extension%')
       AND (v_targets IS NULL OR cardinality(v_targets) = 0 OR le.category = ANY(v_targets))
     ORDER BY co.pri ASC, le.due_date ASC, le.entry_date ASC, le.id ASC
  LOOP
    EXIT WHEN v_left <= 0;
    to_apply := LEAST(c.remaining_amount, v_left);

    INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
    VALUES (p_id, c.id, to_apply)
    ON CONFLICT ON CONSTRAINT ux_payment_app_unique DO NOTHING;

    UPDATE ledger_entries
       SET remaining_amount = remaining_amount - to_apply
     WHERE id = c.id;

    -- A security deposit is a LIABILITY, not revenue: it is the renter's money
    -- held against damage, refundable in full or in part at the end of the
    -- rental. Booking it as Revenue overstates earnings now and would need a
    -- negative correction at refund time. chk_pnl_category_valid ALLOWS
    -- 'Security Deposit', so nothing but this guard stops it. The ledger is the
    -- sole record of deposits; P&L sees them only if they are forfeited, which
    -- is recorded separately as a Fine/Other charge.
    IF c.category <> 'Security Deposit' THEN
      -- P&L keeps fine revenue under 'Fines' (plural) to match existing pnl_entries
      -- data and the chk_pnl_category_valid constraint, even though the ledger
      -- charge category is 'Fine' (singular). Only the display name is normalized;
      -- the amount/allocation is unchanged.
      INSERT INTO pnl_entries(vehicle_id, tenant_id, entry_date, side, category, amount, source_ref)
      VALUES (v_vehicle, v_tenant, c.due_date, 'Revenue',
              CASE WHEN c.category = 'Fine' THEN 'Fines' ELSE c.category END,
              to_apply, p_id::text || '_' || c.id::text)
      ON CONFLICT (vehicle_id, category, source_ref)
      DO UPDATE SET amount = pnl_entries.amount + EXCLUDED.amount;
    END IF;

    v_left := v_left - to_apply;
  END LOOP;

  IF v_left <= 0 THEN
    UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p_id;
  ELSIF v_left = v_amt THEN
    UPDATE payments SET status = 'Credit', remaining_amount = v_left WHERE id = p_id;
  ELSE
    UPDATE payments SET status = 'Partial', remaining_amount = v_left WHERE id = p_id;
  END IF;
END;
$function$
;

-- payments_payment_provider_immutable
CREATE OR REPLACE FUNCTION public.payments_payment_provider_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.payment_provider IS DISTINCT FROM OLD.payment_provider THEN
    RAISE EXCEPTION 'payments.payment_provider is immutable (% -> %)',
      OLD.payment_provider, NEW.payment_provider USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$
;

-- set_ledger_entry_tenant_id
CREATE OR REPLACE FUNCTION public.set_ledger_entry_tenant_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- If tenant_id is not set, try to get it from the rental
  IF NEW.tenant_id IS NULL AND NEW.rental_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM rentals
    WHERE id = NEW.rental_id;
  END IF;

  -- If still null and customer_id is set, try to get from customer
  IF NEW.tenant_id IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM customers
    WHERE id = NEW.customer_id;
  END IF;

  RETURN NEW;
END;
$function$
;

-- set_payment_application_tenant_id
CREATE OR REPLACE FUNCTION public.set_payment_application_tenant_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- If tenant_id is not set, try to get it from the payment
  IF NEW.tenant_id IS NULL AND NEW.payment_id IS NOT NULL THEN
    SELECT tenant_id INTO NEW.tenant_id
    FROM payments
    WHERE id = NEW.payment_id;
  END IF;

  RETURN NEW;
END;
$function$
;

-- set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

-- sync_fine_status_on_charge_settled
CREATE OR REPLACE FUNCTION public.sync_fine_status_on_charge_settled()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.type = 'Charge'
     AND NEW.category = 'Fine'
     AND NEW.reference LIKE 'FINE-%'
     AND substring(NEW.reference from 6) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND COALESCE(NEW.remaining_amount, 0) <= 0
     AND COALESCE(OLD.remaining_amount, 1) > 0
  THEN
    UPDATE public.fines
       SET status = 'Paid'
     WHERE id = substring(NEW.reference from 6)::uuid
       AND status IN ('Open', 'Charged');
  END IF;
  RETURN NEW;
END;
$function$
;

-- trigger_apply_fifo_on_payment_completed
CREATE OR REPLACE FUNCTION public.trigger_apply_fifo_on_payment_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only fire on the transition INTO Completed (not already Completed before)
  -- Only for customer-facing Payment rows (not InitialFee / Fine refund / etc)
  -- Only when there's still money to allocate (avoid no-op work)
  IF NEW.status = 'Completed'
     AND (OLD.status IS DISTINCT FROM 'Completed')
     AND COALESCE(NEW.payment_type, 'Payment') = 'Payment'
     AND COALESCE(NEW.remaining_amount, NEW.amount) > 0 THEN
    PERFORM public.payment_apply_fifo_v2(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$
;

-- trigger_apply_fifo_on_payment_insert
CREATE OR REPLACE FUNCTION public.trigger_apply_fifo_on_payment_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'Completed'
     AND COALESCE(NEW.payment_type, 'Payment') = 'Payment'
     AND COALESCE(NEW.remaining_amount, NEW.amount) > 0 THEN
    PERFORM public.payment_apply_fifo_v2(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$
;

-- trigger_auto_allocate_payments
CREATE OR REPLACE FUNCTION public.trigger_auto_allocate_payments()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only trigger on rental charges
  IF NEW.type = 'Charge' AND NEW.category = 'Rental' AND NEW.remaining_amount > 0 THEN
    DECLARE
      credit_payment RECORD;
    BEGIN
      FOR credit_payment IN
        SELECT p.id
        FROM payments p
        WHERE p.customer_id = NEW.customer_id
          AND p.status IN ('Credit', 'Partial')
          AND p.remaining_amount > 0
        ORDER BY p.payment_date ASC, p.id ASC
      LOOP
        PERFORM payment_apply_fifo_v2(credit_payment.id);

        SELECT remaining_amount INTO NEW.remaining_amount
        FROM ledger_entries
        WHERE id = NEW.id;

        EXIT WHEN NEW.remaining_amount <= 0;
      END LOOP;
    END;
  END IF;

  RETURN NEW;
END;
$function$
;

-- trigger_payg_settle_on_ledger_drain
CREATE OR REPLACE FUNCTION public.trigger_payg_settle_on_ledger_drain()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_accrual record;
  v_all_paid boolean;
  v_payment_id uuid;
BEGIN
  IF NEW.remaining_amount IS NULL OR NEW.remaining_amount > 0 THEN
    RETURN NEW;
  END IF;
  IF OLD.remaining_amount IS NOT NULL AND OLD.remaining_amount = 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.type IS DISTINCT FROM 'Charge' THEN
    RETURN NEW;
  END IF;
  IF NEW.category NOT IN ('Rental', 'Tax', 'Service Fee') THEN
    RETURN NEW;
  END IF;
  IF NEW.rental_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, ledger_entry_ids
  INTO v_accrual
  FROM public.payg_accruals
  WHERE rental_id = NEW.rental_id
    AND invoice_status = 'open'
    AND NEW.id = ANY(ledger_entry_ids)
  ORDER BY accrual_day_index DESC
  LIMIT 1;

  IF v_accrual.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.ledger_entries le
    WHERE le.id = ANY(v_accrual.ledger_entry_ids) AND COALESCE(le.remaining_amount, 0) > 0
  ) INTO v_all_paid;

  IF NOT v_all_paid THEN
    RETURN NEW;
  END IF;

  -- Most recent payment that contributed to any of these ledger entries.
  -- Join to payments for a real timestamp, then fall back to any rental payment.
  SELECT p.id INTO v_payment_id
  FROM public.payment_applications pa
  JOIN public.payments p ON p.id = pa.payment_id
  WHERE pa.charge_entry_id = ANY(v_accrual.ledger_entry_ids)
  ORDER BY p.created_at DESC NULLS LAST, p.id DESC
  LIMIT 1;

  IF v_payment_id IS NULL THEN
    SELECT p.id INTO v_payment_id
    FROM public.payments p
    WHERE p.rental_id = NEW.rental_id
      AND p.status IN ('Applied','Partial','Credit','Completed')
    ORDER BY p.created_at DESC
    LIMIT 1;
  END IF;

  IF v_payment_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.payg_settle_invoice(v_payment_id, v_accrual.id);
  RETURN NEW;
END;
$function$
;

-- trigger_settle_ghost_paid_payg_accruals
CREATE OR REPLACE FUNCTION public.trigger_settle_ghost_paid_payg_accruals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_acc record;
BEGIN
  IF NEW.rental_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('Completed', 'Applied', 'Credit', 'Partial') THEN
    RETURN NEW;
  END IF;
  -- Only on the meaningful transition: new row, or status changed to one of these
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  FOR v_acc IN
    SELECT a.id AS accrual_id, a.ledger_entry_ids
    FROM public.payg_accruals a
    WHERE a.rental_id = NEW.rental_id
      AND a.invoice_status = 'open'
      AND COALESCE(array_length(a.ledger_entry_ids, 1), 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.ledger_entries le
        WHERE le.id = ANY(a.ledger_entry_ids) AND COALESCE(le.remaining_amount, 0) > 0
      )
    ORDER BY a.accrual_day_index ASC
  LOOP
    PERFORM public.payg_settle_invoice(NEW.id, v_acc.accrual_id);
  END LOOP;

  RETURN NEW;
END;
$function$
;