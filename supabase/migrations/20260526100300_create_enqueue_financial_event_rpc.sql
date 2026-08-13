-- Finance Sync — Sprint 1: enqueue_financial_event RPC.
-- The single insertion point for everything that flows into the sync layer.
-- Every existing edge function that records a chargeable/refundable thing
-- gets exactly one line added: a call to this function (per spec Deviation #2
-- — we use RPC, not triggers, so the explicit choice of "which writes produce
-- sync events" stays in app code).
--
-- Idempotency: if (source_table, source_id, event_type) already exists for
-- this tenant, returns the existing financial_event_id WITHOUT creating a
-- duplicate. Callers can fire safely on every write path.

CREATE OR REPLACE FUNCTION public.enqueue_financial_event(
  p_tenant_id UUID,
  p_event_type public.financial_event_type,
  p_amount_cents INTEGER,
  p_currency TEXT,
  p_rental_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_vehicle_id UUID DEFAULT NULL,
  p_tax_cents INTEGER DEFAULT 0,
  p_occurred_at TIMESTAMPTZ DEFAULT now(),
  p_source_table TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_existing_id UUID;
  v_provider public.accounting_provider;
BEGIN
  -- Validate required inputs early — fail-fast on caller bugs.
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'enqueue_financial_event: tenant_id is required';
  END IF;
  IF p_event_type IS NULL THEN
    RAISE EXCEPTION 'enqueue_financial_event: event_type is required';
  END IF;
  IF p_amount_cents IS NULL THEN
    RAISE EXCEPTION 'enqueue_financial_event: amount_cents is required';
  END IF;
  IF p_currency IS NULL OR length(p_currency) = 0 THEN
    RAISE EXCEPTION 'enqueue_financial_event: currency is required';
  END IF;

  -- Idempotency: if a (source_table, source_id, event_type) combo already
  -- exists for this tenant, return that id. Lets callers retry safely.
  IF p_source_table IS NOT NULL AND p_source_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.financial_events
    WHERE tenant_id = p_tenant_id
      AND source_table = p_source_table
      AND source_id = p_source_id
      AND event_type = p_event_type
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  -- Insert the event row.
  INSERT INTO public.financial_events (
    tenant_id, rental_id, customer_id, vehicle_id,
    event_type, amount_cents, tax_cents, currency, occurred_at,
    source_table, source_id, description, metadata
  )
  VALUES (
    p_tenant_id, p_rental_id, p_customer_id, p_vehicle_id,
    p_event_type, p_amount_cents, p_tax_cents, p_currency, p_occurred_at,
    p_source_table, p_source_id, p_description, p_metadata
  )
  RETURNING id INTO v_event_id;

  -- Fan out one sync_state row per active accounting_connections row for
  -- this tenant. In Sprint 1 the accounting_connections table doesn't exist
  -- yet — guard with a to_regclass() check so this RPC works pre-Sprint-2.
  IF to_regclass('public.accounting_connections') IS NOT NULL THEN
    FOR v_provider IN
      EXECUTE 'SELECT provider FROM public.accounting_connections WHERE tenant_id = $1 AND status = ''active'''
      USING p_tenant_id
    LOOP
      INSERT INTO public.financial_event_sync_state (
        financial_event_id, tenant_id, provider, state
      )
      VALUES (v_event_id, p_tenant_id, v_provider, 'pending')
      ON CONFLICT (financial_event_id, provider) DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_event_id;
END;
$$;

COMMENT ON FUNCTION public.enqueue_financial_event IS
  'Single insertion point for the financial_events ledger. Idempotent on (tenant_id, source_table, source_id, event_type). Fans out sync_state rows to all active accounting_connections. Called from existing edge fns; SECURITY DEFINER so service_role caller is fine.';

-- Allow service_role + authenticated to call this. The function itself is
-- SECURITY DEFINER and validates inputs.
GRANT EXECUTE ON FUNCTION public.enqueue_financial_event TO service_role, authenticated;
