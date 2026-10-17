-- APPLIED to production 2026-10-17
--
-- Accounting sync v2 — reconciler: no false "drift" for deleted sources.
--
-- The drift check described a source with no snapshot. For a payment or a
-- standalone charge that has since been deleted, that returns nothing, so its
-- fingerprint never matched and the same rows were re-queued and logged as
-- drift every hour (seen on the live test rows). It now falls back to the
-- item's last snapshot (`payload`): a deleted source reads as "gone" once,
-- its item is re-armed with that fingerprint, and the next run is quiet.
-- Live sources are unaffected (describe prefers the live row).

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
      SELECT i.status, i.fingerprint, i.payload INTO d FROM public.accounting_sync_items i
       WHERE i.provider = c.provider AND i.source_type = s.st AND i.source_id = s.sid AND i.operation = 'sync';
      IF NOT FOUND THEN
        IF public.accounting_v2_enqueue(c.tenant_id, s.st, s.sid, 'sync', NULL, c.provider) > 0 THEN
          INSERT INTO public.accounting_v2_reconcile_log (tenant_id, provider, kind, source_type, source_id)
          VALUES (c.tenant_id, c.provider, 'missing', s.st, s.sid);
          v_found := v_found + 1;
        END IF;
      -- Compared with the last snapshot as a fallback, so a source that has
      -- since been deleted reads as "gone" (once) instead of drifting forever.
      ELSIF d.status = 'sent' AND d.fingerprint IS DISTINCT FROM
            (SELECT x.fingerprint FROM public.accounting_v2_describe(c.tenant_id, s.st, s.sid, d.payload) x) THEN
        PERFORM public.accounting_v2_enqueue(c.tenant_id, s.st, s.sid, 'sync', d.payload, c.provider);
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
