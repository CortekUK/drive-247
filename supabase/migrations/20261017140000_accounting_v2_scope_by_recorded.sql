-- APPLIED to production 2026-10-17
--
-- Accounting sync v2 — scope by when money was RECORDED, not by its date.
--
-- The bug: "does this transaction belong in the books?" compared the item's
-- business date (payments.payment_date, a DATE) with the connection's
-- sync_from. A manual payment recorded after connecting but dated the day
-- before (back-dated, or simply a date-only field read as midnight UTC) fell
-- "before" the connection: the worker dropped it and the reconciler never
-- looked at it. Found on northwind's first test payment.
--
-- The fix: an item carries two times.
--   occurred_at  the business date — what the Sync table shows and sorts by
--   scope_at     the latest of the business date and when Drive recorded it —
--                what the start point is checked against
-- So anything recorded after connecting syncs, whatever date it carries, and
-- "sync past transactions from…" still reaches back by business date.

ALTER TABLE public.accounting_sync_items ADD COLUMN IF NOT EXISTS scope_at timestamptz;
UPDATE public.accounting_sync_items SET scope_at = occurred_at WHERE scope_at IS NULL;

DROP FUNCTION IF EXISTS public.accounting_v2_describe(uuid, text, uuid, jsonb);

CREATE FUNCTION public.accounting_v2_describe(
  p_tenant uuid, p_source_type text, p_source_id uuid, p_row jsonb DEFAULT NULL
) RETURNS TABLE (
  exists_now boolean, in_scope_at timestamptz, shown_at timestamptz, invoice_id uuid, invoice_number text,
  customer_id uuid, customer_name text, direction text, amount numeric, description text, fingerprint text, row_data jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row jsonb; v_rental uuid; v_cats text; v_alloc text; v_inv record; v_cust uuid; v_last_charge timestamptz;
BEGIN
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

CREATE OR REPLACE FUNCTION public.accounting_v2_enqueue(
  p_tenant uuid, p_source_type text, p_source_id uuid, p_operation text DEFAULT 'sync',
  p_row jsonb DEFAULT NULL, p_provider public.accounting_provider DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d record; c record; v_currency text; v_n integer := 0;
BEGIN
  IF p_tenant IS NULL OR p_source_id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO d FROM public.accounting_v2_describe(p_tenant, p_source_type, p_source_id, p_row);
  IF NOT FOUND OR d.description IS NULL THEN RETURN 0; END IF;
  SELECT coalesce(nullif(currency_code, ''), 'USD') INTO v_currency FROM public.tenants WHERE id = p_tenant;

  FOR c IN
    SELECT provider FROM public.accounting_v2_connections
     WHERE tenant_id = p_tenant AND status IN ('connected','needs_reauth','error')
       AND (p_provider IS NULL OR provider = p_provider)
  LOOP
    INSERT INTO public.accounting_sync_items AS i (
      tenant_id, provider, source_type, source_id, operation, invoice_id, invoice_number, customer_id,
      customer_name, direction, amount, currency, description, occurred_at, scope_at, status, next_attempt_at,
      fingerprint, payload, idempotency_key
    ) VALUES (
      p_tenant, c.provider, p_source_type, p_source_id, p_operation, d.invoice_id, d.invoice_number, d.customer_id,
      d.customer_name, d.direction, coalesce(d.amount, 0), v_currency,
      CASE WHEN p_operation = 'delete' THEN 'Deleted · ' ELSE '' END || d.description,
      coalesce(d.shown_at, d.in_scope_at, now()), coalesce(d.in_scope_at, d.shown_at, now()),
      'waiting', now() + interval '20 seconds',
      d.fingerprint, coalesce(d.row_data, p_row),
      md5(c.provider::text || ':' || p_source_type || ':' || p_source_id::text || ':' || p_operation)
    )
    ON CONFLICT ON CONSTRAINT accounting_sync_items_uniq DO UPDATE SET
      -- Same money as what was sent → nothing to do (pure non-money edit).
      status          = CASE WHEN i.status = 'sent' AND i.fingerprint IS NOT DISTINCT FROM excluded.fingerprint
                             THEN 'sent' ELSE 'waiting' END,
      generation      = CASE WHEN i.status = 'sent' AND i.fingerprint IS NOT DISTINCT FROM excluded.fingerprint
                             THEN i.generation ELSE i.generation + 1 END,
      attempts        = CASE WHEN i.status = 'sent' AND i.fingerprint IS NOT DISTINCT FROM excluded.fingerprint
                             THEN i.attempts ELSE 0 END,
      next_attempt_at = CASE WHEN i.status = 'sent' AND i.fingerprint IS NOT DISTINCT FROM excluded.fingerprint
                             THEN i.next_attempt_at ELSE now() + interval '20 seconds' END,
      last_error      = CASE WHEN i.status = 'sent' AND i.fingerprint IS NOT DISTINCT FROM excluded.fingerprint
                             THEN i.last_error ELSE NULL END,
      fingerprint     = excluded.fingerprint,
      invoice_id      = excluded.invoice_id,
      invoice_number  = excluded.invoice_number,
      customer_id     = excluded.customer_id,
      customer_name   = excluded.customer_name,
      amount          = excluded.amount,
      description     = excluded.description,
      occurred_at     = excluded.occurred_at,
      scope_at        = greatest(i.scope_at, excluded.scope_at),
      payload         = coalesce(excluded.payload, i.payload),
      updated_at      = now();
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- The reconciler's candidate sweep uses the same rule: recorded OR dated on or
-- after the start point.
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

REVOKE ALL ON FUNCTION public.accounting_v2_describe(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_v2_describe(uuid, text, uuid, jsonb) TO service_role;
