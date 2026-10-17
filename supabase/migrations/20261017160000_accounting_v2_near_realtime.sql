-- APPLIED to production 2026-10-17
--
-- Accounting sync v2 — near real time.
--
-- Before: an item waited 20 s (so the payment's allocation could land first)
-- and the worker ran once a minute: 20–80 s from payment to Xero / Zoho.
-- After: a 5 s settle and a worker every 10 s: typically 5–15 s.
--
-- Running every 10 s means runs can overlap (one may still be sending when
-- the next starts). Two runs working the SAME company's books at once could
-- both create that rental's invoice (Xero dedupes on Idempotency-Key, Zoho has
-- no such header). So claiming is serialised and a company/provider whose
-- items are in flight is skipped until that run finishes: one sender per set
-- of books, any number of books in parallel.

CREATE OR REPLACE FUNCTION public.accounting_v2_enqueue(p_tenant uuid, p_source_type text, p_source_id uuid, p_operation text DEFAULT 'sync'::text, p_row jsonb DEFAULT NULL::jsonb, p_provider accounting_provider DEFAULT NULL::accounting_provider)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'waiting', now() + interval '5 seconds',
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
                             THEN i.next_attempt_at ELSE now() + interval '5 seconds' END,
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
END $function$
;

CREATE OR REPLACE FUNCTION public.accounting_v2_claim(
  p_limit integer DEFAULT 60, p_tenant uuid DEFAULT NULL, p_provider public.accounting_provider DEFAULT NULL
) RETURNS SETOF public.accounting_sync_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- One claim at a time, so the in-flight check below cannot race.
  PERFORM pg_advisory_xact_lock(hashtext('accounting_v2_claim'));
  RETURN QUERY
  WITH due AS (
    SELECT i.id
      FROM public.accounting_sync_items i
      JOIN public.accounting_v2_connections c ON c.tenant_id = i.tenant_id AND c.provider = i.provider
     WHERE i.status IN ('waiting','failed')
       AND i.next_attempt_at <= now()
       AND (i.claimed_at IS NULL OR i.claimed_at < now() - interval '10 minutes')
       AND c.status = 'connected'
       AND (c.paused_until IS NULL OR c.paused_until <= now())
       AND (p_tenant IS NULL OR i.tenant_id = p_tenant)
       AND (p_provider IS NULL OR i.provider = p_provider)
       -- These books are being written by another run: leave them to it.
       AND NOT EXISTS (
         SELECT 1 FROM public.accounting_sync_items x
          WHERE x.tenant_id = i.tenant_id AND x.provider = i.provider
            AND x.claimed_at IS NOT NULL AND x.claimed_at >= now() - interval '10 minutes')
     ORDER BY i.tenant_id, i.provider,
              CASE i.source_type WHEN 'invoice' THEN 0 WHEN 'payment' THEN 1 ELSE 2 END,
              i.occurred_at, i.created_at
     LIMIT greatest(p_limit, 1)
     FOR UPDATE OF i SKIP LOCKED
  )
  UPDATE public.accounting_sync_items i SET claimed_at = now()
    FROM due WHERE i.id = due.id
  RETURNING i.*;
END $$;

REVOKE ALL ON FUNCTION public.accounting_v2_claim(integer, uuid, public.accounting_provider) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_v2_claim(integer, uuid, public.accounting_provider) TO service_role;

-- Worker every 10 seconds (pg_cron interval syntax, as customer-management-run).
SELECT cron.alter_job(jobid, schedule := '10 seconds') FROM cron.job WHERE jobname = 'accounting-sync-v2';
