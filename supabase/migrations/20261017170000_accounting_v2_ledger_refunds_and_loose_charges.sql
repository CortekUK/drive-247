-- APPLIED to production 2026-10-17
--
-- Accounting sync v2 — close the last gaps in "every customer money movement".
--
-- An audit of production found money that moved between a company and its
-- customer but could never reach the books:
--
--   1. Refunds recorded only in the ledger. process-refund records a refund on
--      the payment only when the refunded charge had payments applied to it; a
--      deposit handed back, a fine refunded from the dialog, or a remainder past
--      what Stripe would refund is written as a ledger `Refund` row and nowhere
--      else (e.g. $350 deposit at luxurious-car-rentals, $90 at goniko). New
--      source `rental_refund`: per rental, Refund rows minus what its payments
--      already carry as refunded — booked as credit note + cash refund.
--   2. Charges with no rental. apply-fine, the fine dialog without a rental and
--      adjust-customer-balance post `Charge` rows with rental_id NULL; invoices
--      were built per rental, so these had none. New source `charge`: one bill
--      per such charge (invoice, or credit note when negative); payments
--      against it are applied to it.
--   3. (engine) A landed payment never split over charges paid nothing in the
--      books but a prepayment; it now pays its rental's invoice.
--
-- Both new sources are captured by the same triggers and swept by the hourly
-- reconciler, like the rest.

ALTER TABLE public.accounting_sync_items DROP CONSTRAINT IF EXISTS accounting_sync_items_source_type_check;
ALTER TABLE public.accounting_sync_items ADD CONSTRAINT accounting_sync_items_source_type_check
  CHECK (source_type IN ('invoice','payment','refund','charge','rental_refund'));

CREATE OR REPLACE FUNCTION public.accounting_v2_describe(
  p_tenant uuid, p_source_type text, p_source_id uuid, p_row jsonb DEFAULT NULL
) RETURNS TABLE (
  exists_now boolean, in_scope_at timestamptz, shown_at timestamptz, invoice_id uuid, invoice_number text,
  customer_id uuid, customer_name text, direction text, amount numeric, description text, fingerprint text, row_data jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row jsonb; v_rental uuid; v_cats text; v_alloc text; v_inv record; v_cust uuid; v_last_charge timestamptz;
  v_ledger numeric; v_paid_back numeric; v_n integer; v_last timestamptz;
BEGIN
  IF p_source_type = 'charge' THEN
    -- A charge with no rental (a fine, an account adjustment): billed on its own.
    SELECT to_jsonb(le) INTO v_row FROM public.ledger_entries le
     WHERE le.id = p_source_id AND le.tenant_id = p_tenant AND le.type = 'Charge';
    exists_now := v_row IS NOT NULL;
    -- It joined a rental: the rental's invoice carries it from now on.
    IF exists_now AND nullif(v_row->>'rental_id', '') IS NOT NULL THEN RETURN; END IF;
    v_row := coalesce(v_row, p_row);
    IF v_row IS NULL THEN RETURN; END IF;
    customer_id := nullif(v_row->>'customer_id', '')::uuid;
    SELECT c.name INTO customer_name FROM public.customers c WHERE c.id = customer_id AND c.tenant_id = p_tenant;
    direction := 'none';
    amount := CASE WHEN exists_now THEN coalesce((v_row->>'amount')::numeric, 0) ELSE 0 END;
    shown_at := (v_row->>'created_at')::timestamptz;
    in_scope_at := shown_at;
    fingerprint := md5(concat_ws('|', amount::text, v_row->>'category', v_row->>'rental_id', v_row->>'customer_id',
                     CASE WHEN exists_now THEN 'live' ELSE 'gone' END));
    invoice_number := CASE WHEN coalesce(v_row->>'reference', '') ILIKE 'FINE-%'
                           THEN 'FINE-' || substr(v_row->>'reference', 6, 8)
                           ELSE 'ADJ-' || left(p_source_id::text, 8) END;
    description := 'Charge · ' || coalesce(v_row->>'category', 'Charge') || ' · ' || invoice_number;
    row_data := v_row;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_source_type = 'rental_refund' THEN
    -- Refund money recorded only in the rental's ledger: Refund rows minus what
    -- the rental's payments already carry (those sync as 'refund' items).
    v_rental := p_source_id;
    SELECT coalesce(-sum(le.amount), 0), count(*), max(le.created_at),
           string_agg(DISTINCT le.category, ', ' ORDER BY le.category)
      INTO v_ledger, v_n, v_last, v_cats
      FROM public.ledger_entries le
     WHERE le.rental_id = v_rental AND le.tenant_id = p_tenant AND le.type = 'Refund';
    -- Nothing in the ledger and nothing queued before: no item at all.
    IF v_n = 0 AND NOT EXISTS (SELECT 1 FROM public.accounting_sync_items i
                                WHERE i.tenant_id = p_tenant AND i.source_type = 'rental_refund' AND i.source_id = v_rental) THEN
      RETURN;
    END IF;
    SELECT coalesce(sum(public.accounting_v2_refund_amount(to_jsonb(p))), 0) INTO v_paid_back
      FROM public.payments p
     WHERE p.tenant_id = p_tenant
       AND (p.rental_id = v_rental OR EXISTS (
             SELECT 1 FROM public.payment_applications pa JOIN public.ledger_entries c ON c.id = pa.charge_entry_id
              WHERE pa.payment_id = p.id AND c.rental_id = v_rental));
    exists_now := true;
    direction := 'out';
    amount := greatest(0, round(v_ledger - v_paid_back, 2));
    shown_at := v_last;
    in_scope_at := v_last;
    fingerprint := md5(concat_ws('|', v_ledger::text, v_paid_back::text, v_n::text));
    SELECT r.customer_id INTO v_cust FROM public.rentals r WHERE r.id = v_rental AND r.tenant_id = p_tenant;
    SELECT i.id, i.invoice_number INTO v_inv FROM public.invoices i
     WHERE i.rental_id = v_rental AND i.tenant_id = p_tenant ORDER BY i.created_at LIMIT 1;
    invoice_id := v_inv.id;
    invoice_number := v_inv.invoice_number;
    customer_id := v_cust;
    SELECT c.name INTO customer_name FROM public.customers c WHERE c.id = v_cust AND c.tenant_id = p_tenant;
    description := 'Refund · ' || coalesce(v_cats, 'Rental') || coalesce(' · ' || invoice_number, '');
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_source_type IN ('payment','refund') THEN
    SELECT to_jsonb(p) INTO v_row FROM public.payments p WHERE p.id = p_source_id AND p.tenant_id = p_tenant;
    exists_now := v_row IS NOT NULL;
    v_row := coalesce(v_row, p_row);
    IF v_row IS NULL THEN RETURN; END IF;
    v_rental := nullif(v_row->>'rental_id', '')::uuid;
    v_cust := nullif(v_row->>'customer_id', '')::uuid;

    SELECT string_agg(DISTINCT le.category, ', ' ORDER BY le.category),
           string_agg(pa.charge_entry_id::text || ':' || pa.amount_applied::text, ',' ORDER BY pa.charge_entry_id)
      INTO v_cats, v_alloc
      FROM public.payment_applications pa
      JOIN public.ledger_entries le ON le.id = pa.charge_entry_id
     WHERE pa.payment_id = p_source_id AND pa.tenant_id = p_tenant;
    IF v_rental IS NULL THEN
      SELECT le.rental_id INTO v_rental FROM public.payment_applications pa
        JOIN public.ledger_entries le ON le.id = pa.charge_entry_id
       WHERE pa.payment_id = p_source_id AND pa.tenant_id = p_tenant AND le.rental_id IS NOT NULL LIMIT 1;
    END IF;

    IF p_source_type = 'payment' THEN
      direction := 'in';
      amount := coalesce((v_row->>'amount')::numeric, 0);
      shown_at := coalesce((v_row->>'paid_at')::timestamptz, (v_row->>'payment_date')::timestamptz, (v_row->>'created_at')::timestamptz);
      in_scope_at := greatest(shown_at, (v_row->>'created_at')::timestamptz);
      fingerprint := md5(concat_ws('|', v_row->>'status', v_row->>'amount', v_row->>'rental_id', v_row->>'customer_id',
                       v_row->>'paid_at', v_row->>'payment_date', v_row->>'method', v_row->>'stripe_payment_intent_id',
                       v_row->>'stripe_checkout_session_id', v_row->>'square_payment_id', v_alloc,
                       CASE WHEN exists_now THEN 'live' ELSE 'gone' END));
    ELSE
      direction := 'out';
      amount := public.accounting_v2_refund_amount(v_row);
      shown_at := coalesce((v_row->>'refund_processed_at')::timestamptz, (v_row->>'updated_at')::timestamptz);
      in_scope_at := shown_at;
      fingerprint := md5(concat_ws('|', amount::text, v_row->>'amount', v_row->>'refund_status', v_row->>'rental_id',
                       v_row->>'customer_id', v_alloc, v_row->>'stripe_refund_id', v_row->>'square_refund_id',
                       CASE WHEN exists_now THEN 'live' ELSE 'gone' END));
    END IF;
  ELSE
    -- invoice: the rental's Charge rows ARE its line items.
    v_rental := p_source_id;
    SELECT coalesce(sum(le.amount), 0),
           md5(coalesce(string_agg(le.id::text || ':' || le.amount::text || ':' || coalesce(le.category, ''), ',' ORDER BY le.id), '')),
           min(le.created_at), max(le.created_at)
      INTO amount, fingerprint, shown_at, v_last_charge
      FROM public.ledger_entries le
     WHERE le.rental_id = v_rental AND le.tenant_id = p_tenant AND le.type = 'Charge';
    SELECT to_jsonb(r) INTO v_row FROM (
      SELECT rr.id, rr.customer_id, rr.rental_number FROM public.rentals rr
       WHERE rr.id = v_rental AND rr.tenant_id = p_tenant) r;
    exists_now := v_row IS NOT NULL;
    v_cust := nullif(v_row->>'customer_id', '')::uuid;
    direction := 'none';
  END IF;

  IF v_rental IS NOT NULL THEN
    SELECT i.id, i.invoice_number, i.customer_id, i.created_at INTO v_inv
      FROM public.invoices i WHERE i.rental_id = v_rental AND i.tenant_id = p_tenant
     ORDER BY i.created_at LIMIT 1;
    invoice_id := v_inv.id;
    invoice_number := v_inv.invoice_number;
    v_cust := coalesce(v_cust, v_inv.customer_id);
    IF p_source_type = 'invoice' THEN
      shown_at := coalesce(v_inv.created_at, shown_at);
      -- A charge added to an older rental after connecting brings it in.
      in_scope_at := greatest(v_inv.created_at, v_last_charge);
      fingerprint := md5(concat_ws('|', fingerprint, v_inv.invoice_number, v_inv.id::text));
    END IF;
  ELSIF p_source_type = 'invoice' THEN
    in_scope_at := v_last_charge;
  END IF;

  customer_id := v_cust;
  SELECT c.name INTO customer_name FROM public.customers c WHERE c.id = v_cust AND c.tenant_id = p_tenant;

  description := CASE p_source_type
      WHEN 'invoice' THEN 'Invoice'
      WHEN 'payment' THEN 'Payment' || ' · ' || coalesce(v_cats, 'Account credit')
      ELSE 'Refund' || coalesce(' · ' || v_cats, '')
    END
    || coalesce(' · ' || invoice_number, CASE WHEN v_row ? 'rental_number' THEN ' · ' || (v_row->>'rental_number') ELSE '' END);
  row_data := v_row;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_v2_capture_change(
  p_table text, p_op text, p_tenant uuid, o jsonb, n jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid; v_pay jsonb; v_rental uuid; v_r uuid;
BEGIN
  IF p_table = 'payments' THEN
    IF p_op = 'DELETE' THEN
      IF public.accounting_v2_is_landed(o->>'status') THEN
        PERFORM public.accounting_v2_enqueue(p_tenant, 'payment', (o->>'id')::uuid, 'delete', o);
      END IF;
      IF public.accounting_v2_refund_amount(o) > 0 THEN
        PERFORM public.accounting_v2_enqueue(p_tenant, 'refund', (o->>'id')::uuid, 'delete', o);
      END IF;
      RETURN;
    END IF;
    IF public.accounting_v2_is_landed(n->>'status') OR public.accounting_v2_is_landed(o->>'status') THEN
      PERFORM public.accounting_v2_enqueue(p_tenant, 'payment', (n->>'id')::uuid, 'sync', n);
    END IF;
    IF public.accounting_v2_refund_amount(n) > 0 OR public.accounting_v2_refund_amount(o) > 0 THEN
      PERFORM public.accounting_v2_enqueue(p_tenant, 'refund', (n->>'id')::uuid, 'sync', n);
    END IF;
    -- What a payment carries as refunded changes the rental's ledger-only gap.
    IF public.accounting_v2_refund_amount(n) IS DISTINCT FROM public.accounting_v2_refund_amount(o) THEN
      v_r := nullif(coalesce(n->>'rental_id', o->>'rental_id'), '')::uuid;
      IF v_r IS NOT NULL THEN
        PERFORM public.accounting_v2_enqueue(p_tenant, 'rental_refund', v_r, 'sync', NULL);
      END IF;
    END IF;

  ELSIF p_table = 'payment_applications' THEN
    -- Which line a payment pays changed: re-sync that payment (and its refund,
    -- whose split follows the allocation).
    v_pid := nullif(coalesce(n->>'payment_id', o->>'payment_id'), '')::uuid;
    SELECT to_jsonb(p) INTO v_pay FROM public.payments p WHERE p.id = v_pid AND p.tenant_id = p_tenant;
    IF v_pay IS NULL THEN RETURN; END IF;   -- cascade from a payment delete: the payment's own trigger has it
    IF public.accounting_v2_is_landed(v_pay->>'status') THEN
      PERFORM public.accounting_v2_enqueue(p_tenant, 'payment', v_pid, 'sync', v_pay);
    END IF;
    IF public.accounting_v2_refund_amount(v_pay) > 0 THEN
      PERFORM public.accounting_v2_enqueue(p_tenant, 'refund', v_pid, 'sync', v_pay);
    END IF;

  ELSIF p_table = 'ledger_entries' THEN
    -- Only Charge rows are line items. Payment rows mirror payment_applications
    -- and Refund rows are not money the Finances tab shows (refunds are read
    -- from the payment), so neither creates anything here.
    -- Refund rows: money handed back, possibly recorded nowhere else.
    IF coalesce(n->>'type', o->>'type') = 'Refund' OR (o->>'type') = 'Refund' THEN
      FOR v_r IN SELECT DISTINCT x FROM unnest(ARRAY[nullif(n->>'rental_id', '')::uuid, nullif(o->>'rental_id', '')::uuid]) x
                 WHERE x IS NOT NULL LOOP
        PERFORM public.accounting_v2_enqueue(p_tenant, 'rental_refund', v_r, 'sync', NULL);
      END LOOP;
    END IF;
    IF coalesce(n->>'type', o->>'type') <> 'Charge' THEN RETURN; END IF;
    IF p_op = 'UPDATE'
       AND (o->>'amount') IS NOT DISTINCT FROM (n->>'amount')
       AND (o->>'category') IS NOT DISTINCT FROM (n->>'category')
       AND (o->>'rental_id') IS NOT DISTINCT FROM (n->>'rental_id')
       AND (o->>'type') IS NOT DISTINCT FROM (n->>'type') THEN
      RETURN;   -- remaining_amount moving is a payment landing, captured on payments
    END IF;
    -- A charge with no rental is billed on its own (and when it leaves "no
    -- rental", its own bill is re-checked so it can be credited back).
    IF nullif(n->>'rental_id', '') IS NULL AND n IS NOT NULL
       OR (o IS NOT NULL AND nullif(o->>'rental_id', '') IS NULL) THEN
      PERFORM public.accounting_v2_enqueue(p_tenant, 'charge', (coalesce(n, o)->>'id')::uuid, 'sync', coalesce(n, o));
    END IF;
    v_rental := nullif(n->>'rental_id', '')::uuid;
    IF v_rental IS NOT NULL THEN
      PERFORM public.accounting_v2_enqueue(p_tenant, 'invoice', v_rental, 'sync', NULL);
    END IF;
    v_rental := nullif(o->>'rental_id', '')::uuid;
    IF v_rental IS NOT NULL AND v_rental IS DISTINCT FROM nullif(n->>'rental_id', '')::uuid THEN
      PERFORM public.accounting_v2_enqueue(p_tenant, 'invoice', v_rental, 'sync', NULL);
    END IF;

  ELSIF p_table = 'invoices' THEN
    IF p_op = 'UPDATE'
       AND (o->>'invoice_number') IS NOT DISTINCT FROM (n->>'invoice_number')
       AND (o->>'status') IS NOT DISTINCT FROM (n->>'status')
       AND (o->>'rental_id') IS NOT DISTINCT FROM (n->>'rental_id')
       AND (o->>'customer_id') IS NOT DISTINCT FROM (n->>'customer_id') THEN
      RETURN;
    END IF;
    v_rental := nullif(coalesce(n->>'rental_id', o->>'rental_id'), '')::uuid;
    IF v_rental IS NOT NULL THEN
      PERFORM public.accounting_v2_enqueue(p_tenant, 'invoice', v_rental, 'sync', NULL);
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_v2_reconcile(p_tenant uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record; s record; d record; v_found integer := 0; v_from timestamptz;
BEGIN
  FOR c IN
    SELECT * FROM public.accounting_v2_connections
     WHERE status IN ('connected','needs_reauth','error') AND (p_tenant IS NULL OR tenant_id = p_tenant)
  LOOP
    v_from := coalesce(c.sync_from, c.connected_at, now());

    FOR s IN
      SELECT 'payment'::text AS st, p.id AS sid FROM public.payments p
       WHERE p.tenant_id = c.tenant_id AND public.accounting_v2_is_landed(p.status)
         AND greatest(coalesce(p.paid_at, p.payment_date::timestamptz, p.created_at), p.created_at) >= v_from
      UNION ALL
      SELECT 'refund', p.id FROM public.payments p
       WHERE p.tenant_id = c.tenant_id AND public.accounting_v2_refund_amount(to_jsonb(p)) > 0
         AND coalesce(p.refund_processed_at, p.updated_at) >= v_from
      UNION ALL
      SELECT 'invoice', le.rental_id FROM public.ledger_entries le
       LEFT JOIN public.invoices i ON i.rental_id = le.rental_id AND i.tenant_id = c.tenant_id
       WHERE le.tenant_id = c.tenant_id AND le.type = 'Charge' AND le.rental_id IS NOT NULL
       GROUP BY le.rental_id
      HAVING greatest(max(le.created_at), max(i.created_at)) >= v_from
      UNION ALL
      SELECT 'charge', le.id FROM public.ledger_entries le
       WHERE le.tenant_id = c.tenant_id AND le.type = 'Charge' AND le.rental_id IS NULL AND le.created_at >= v_from
      UNION ALL
      SELECT DISTINCT 'rental_refund', le.rental_id FROM public.ledger_entries le
       WHERE le.tenant_id = c.tenant_id AND le.type = 'Refund' AND le.rental_id IS NOT NULL AND le.created_at >= v_from
      UNION
      -- anything already queued is checked for drift whatever its date
      SELECT i.source_type, i.source_id FROM public.accounting_sync_items i
       WHERE i.tenant_id = c.tenant_id AND i.provider = c.provider AND i.operation = 'sync'
    LOOP
      SELECT i.status, i.fingerprint INTO d FROM public.accounting_sync_items i
       WHERE i.provider = c.provider AND i.source_type = s.st AND i.source_id = s.sid AND i.operation = 'sync';
      IF NOT FOUND THEN
        IF public.accounting_v2_enqueue(c.tenant_id, s.st, s.sid, 'sync', NULL, c.provider) > 0 THEN
          INSERT INTO public.accounting_v2_reconcile_log (tenant_id, provider, kind, source_type, source_id)
          VALUES (c.tenant_id, c.provider, 'missing', s.st, s.sid);
          v_found := v_found + 1;
        END IF;
      ELSIF d.status = 'sent' AND d.fingerprint IS DISTINCT FROM
            (SELECT x.fingerprint FROM public.accounting_v2_describe(c.tenant_id, s.st, s.sid, NULL) x) THEN
        PERFORM public.accounting_v2_enqueue(c.tenant_id, s.st, s.sid, 'sync', NULL, c.provider);
        INSERT INTO public.accounting_v2_reconcile_log (tenant_id, provider, kind, source_type, source_id)
        VALUES (c.tenant_id, c.provider, 'drift', s.st, s.sid);
        v_found := v_found + 1;
      END IF;
    END LOOP;

    FOR s IN
      SELECT i.source_type AS st, i.source_id AS sid, i.payload FROM public.accounting_sync_items i
       WHERE i.tenant_id = c.tenant_id AND i.provider = c.provider AND i.operation = 'sync'
         AND i.source_type IN ('payment','refund') AND i.status = 'sent'
         AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = i.source_id)
         AND NOT EXISTS (SELECT 1 FROM public.accounting_sync_items x WHERE x.provider = i.provider
                          AND x.source_type = i.source_type AND x.source_id = i.source_id AND x.operation = 'delete')
    LOOP
      PERFORM public.accounting_v2_enqueue(c.tenant_id, s.st, s.sid, 'delete', s.payload, c.provider);
      INSERT INTO public.accounting_v2_reconcile_log (tenant_id, provider, kind, source_type, source_id)
      VALUES (c.tenant_id, c.provider, 'deleted', s.st, s.sid);
      v_found := v_found + 1;
    END LOOP;
  END LOOP;

  UPDATE public.accounting_v2_capture_errors SET resolved_at = now()
   WHERE resolved_at IS NULL AND (p_tenant IS NULL OR tenant_id = p_tenant);

  IF v_found > 0 THEN
    RAISE WARNING 'accounting_v2_reconcile: % transaction(s) were missing or had drifted and have been queued — see accounting_v2_reconcile_log', v_found;
  END IF;
  RETURN v_found;
END $$;
