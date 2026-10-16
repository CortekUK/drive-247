-- APPLIED to production 2026-10-17
--
-- Accounting sync v2 — Xero + Zoho Books, one provider-agnostic engine.
--
-- WHY NEW TABLES (not v1's `accounting_connections` / `financial_event_sync_state`):
-- v1's `enqueue_financial_event()` fans every ledger insert out to EVERY
-- `accounting_connections` row with status 'active'. A v2 connection stored
-- there would be picked up by the v1 worker too and every transaction would
-- land in the tenant's books twice. v2 therefore keeps its own connection
-- table, which v1 cannot see. Nothing in v1 is altered by this file.
--
-- THE GUARANTEE. Money is captured by AFTER triggers on the four tables every
-- code path writes to — payments, payment_applications, ledger_entries,
-- invoices — so no app code, webhook, edge function or admin script can move
-- money without an `accounting_sync_items` row being written in the SAME
-- transaction. The triggers never abort the caller's write (V2_PLAN §6): a
-- capture that raises is recorded in `accounting_v2_capture_errors`, and the
-- hourly reconciler (`accounting_v2_reconcile`) re-derives everything the
-- Finances tab would show and enqueues anything that is missing or has
-- drifted. That is the safety net under the trigger.
--
-- TENANT GUARD. Every trigger's first statement is "does this tenant have a v2
-- connection?" — one indexed lookup. Only the v2 Integrations panel can create
-- one, so for every v1 tenant the triggers do nothing at all.
--
-- CONVERGING ITEMS. A sync item means "make the books match Drive's current
-- state for this source", not "replay this event". The worker reads Drive when
-- it sends, so edits, re-allocations and retries are idempotent, and a second
-- edit re-arms the existing item (bumping `generation`) instead of queueing a
-- duplicate. A `fingerprint` of the money fields means a non-money edit (a typo
-- in a note, a verification stamp) re-arms nothing.

-- ── connections ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.accounting_v2_connections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider                public.accounting_provider NOT NULL,
  -- pending_org: authorised, but the operator authorised several organisations
  -- and has not picked one yet. Nothing is captured until 'connected'.
  status                  text NOT NULL DEFAULT 'pending_org'
                          CHECK (status IN ('pending_org','connected','disconnected','error','needs_reauth')),
  external_org_id         text,
  external_org_name       text,
  external_org_short_code text,           -- Xero ShortCode, for "Open Xero" deep links
  external_connection_id  text,           -- Xero /connections id, deleted on disconnect
  available_orgs          jsonb,          -- [{id, name, connection_id?}] while pending_org
  region                  text,           -- Zoho data centre suffix: com | eu | in | com.au | jp | sa | ca
  api_domain              text,           -- Zoho api_domain, e.g. https://www.zohoapis.eu
  accounts_server         text,           -- Zoho accounts server, e.g. https://accounts.zoho.eu
  access_token_secret_id  uuid,           -- vault.secrets ids; tokens never leave the server
  refresh_token_secret_id uuid,
  token_expires_at        timestamptz,
  scopes                  text,
  connected_by_user_id    uuid,
  connected_at            timestamptz,
  disconnected_at         timestamptz,
  -- Start point. Transactions from here on sync; defaults to connected_at and
  -- is moved earlier by "sync past transactions from…" (the reconciler does it).
  sync_from               timestamptz,
  last_sync_at            timestamptz,
  last_error              text,
  paused_until            timestamptz,    -- rate-limit back-off for the whole org
  settings                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- account mapping, see accounting-v2 edge fn
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

COMMENT ON TABLE public.accounting_v2_connections IS
  'v2 Xero/Zoho connection, one per tenant per provider. Tokens live in Vault. Written by accounting-v2 edge functions only.';

-- ── the outbox / ledger the Sync screen reads ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.accounting_sync_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider        public.accounting_provider NOT NULL,
  source_type     text NOT NULL CHECK (source_type IN ('invoice','payment','refund')),
  -- invoice → rentals.id (one upstream invoice set per rental, built from its
  -- Charge rows); payment → payments.id; refund → payments.id (the refund of it)
  source_id       uuid NOT NULL,
  operation       text NOT NULL DEFAULT 'sync' CHECK (operation IN ('sync','delete')),
  invoice_id      uuid,
  invoice_number  text,
  customer_id     uuid,
  customer_name   text,
  direction       text NOT NULL CHECK (direction IN ('in','out','none')),
  amount          numeric(12,2) NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD',
  description     text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','sent','failed')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  generation      integer NOT NULL DEFAULT 1,
  fingerprint     text,
  payload         jsonb,           -- last row snapshot; what a 'delete' reverses
  last_error      text,
  external_id     text,
  idempotency_key text NOT NULL,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- A transaction can never be queued twice.
  CONSTRAINT accounting_sync_items_uniq UNIQUE (provider, source_type, source_id, operation)
);

CREATE INDEX IF NOT EXISTS accounting_sync_items_list_idx
  ON public.accounting_sync_items (tenant_id, provider, occurred_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS accounting_sync_items_due_idx
  ON public.accounting_sync_items (next_attempt_at) WHERE status <> 'sent';
CREATE INDEX IF NOT EXISTS accounting_sync_items_source_idx
  ON public.accounting_sync_items (source_id);

-- ── Drive ↔ provider ids ────────────────────────────────────────────────────
--
-- entity_type:
--   contact      drive_id = customers.id
--   invoice      drive_id = rentals.id, part = '0' (the main invoice), '1', '2'… (supplementary)
--   charge       drive_id = ledger_entries.id, part = '' — amount = what upstream holds for it,
--                meta.invoice_external_id = the upstream invoice it landed on
--   credit_note  drive_id = rentals.id, part = 'adj-N' (a charge reduced after it was invoiced)
--   payment      drive_id = payments.id, part = upstream invoice id | 'prepay'
--   refund       drive_id = payments.id, part = upstream invoice id | 'prepay',
--                external_id = credit note id, meta.refund_external_id = the cash refund
CREATE TABLE IF NOT EXISTS public.accounting_entity_map (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider        public.accounting_provider NOT NULL,
  entity_type     text NOT NULL CHECK (entity_type IN ('contact','invoice','charge','credit_note','payment','refund')),
  drive_id        uuid NOT NULL,
  part            text NOT NULL DEFAULT '',
  external_id     text NOT NULL,
  external_number text,
  amount          numeric(12,2),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounting_entity_map_uniq UNIQUE (tenant_id, provider, entity_type, drive_id, part)
);

-- ── safety-net bookkeeping ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.accounting_v2_capture_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  table_name  text NOT NULL,
  op          text NOT NULL,
  row_id      uuid,
  error       text,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accounting_v2_reconcile_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  provider    public.accounting_provider NOT NULL,
  kind        text NOT NULL,        -- missing | drift | deleted | capture_error
  source_type text NOT NULL,
  source_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounting_v2_reconcile_log_tenant_idx
  ON public.accounting_v2_reconcile_log (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.accounting_v2_oauth_state (
  nonce         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider      public.accounting_provider NOT NULL,
  region        text,
  redirect_back text NOT NULL,
  initiated_by  uuid,
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── access ──────────────────────────────────────────────────────────────────
--
-- Tenants READ their own rows; every write goes through service_role edge
-- functions or the SECURITY DEFINER functions below. The connections table
-- grants column-level SELECT so the vault ids can never be selected by a
-- browser. Super admins may read (support) — they carry tenant_id = NULL, so
-- the portal code always adds its own tenant filter too (V2_PLAN §5).

ALTER TABLE public.accounting_v2_connections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_sync_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_entity_map       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_v2_capture_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_v2_reconcile_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_v2_oauth_state   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.accounting_v2_connections, public.accounting_sync_items, public.accounting_entity_map,
              public.accounting_v2_capture_errors, public.accounting_v2_reconcile_log, public.accounting_v2_oauth_state
  FROM anon, authenticated;

GRANT SELECT (id, tenant_id, provider, status, external_org_id, external_org_name, external_org_short_code,
              available_orgs, region, api_domain, token_expires_at, scopes, connected_by_user_id, connected_at,
              disconnected_at, sync_from, last_sync_at, last_error, paused_until, settings, created_at, updated_at)
  ON public.accounting_v2_connections TO authenticated;
GRANT SELECT ON public.accounting_sync_items TO authenticated;
GRANT SELECT ON public.accounting_entity_map TO authenticated;

DROP POLICY IF EXISTS accounting_v2_connections_read ON public.accounting_v2_connections;
CREATE POLICY accounting_v2_connections_read ON public.accounting_v2_connections
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS accounting_sync_items_read ON public.accounting_sync_items;
CREATE POLICY accounting_sync_items_read ON public.accounting_sync_items
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS accounting_entity_map_read ON public.accounting_entity_map;
CREATE POLICY accounting_entity_map_read ON public.accounting_entity_map
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Shown live on the Sync screen and the invoice drawer.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.accounting_sync_items;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── tokens (Vault) ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accounting_v2_store_tokens(
  p_connection_id uuid, p_access_token text, p_refresh_token text, p_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions AS $$
DECLARE
  v_access uuid; v_refresh uuid;
BEGIN
  SELECT access_token_secret_id, refresh_token_secret_id INTO v_access, v_refresh
    FROM public.accounting_v2_connections WHERE id = p_connection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'accounting_v2_store_tokens: no connection %', p_connection_id; END IF;

  IF v_access IS NULL THEN
    v_access := vault.create_secret(p_access_token, 'acct_v2_access_' || p_connection_id || '_' || extract(epoch from now()));
  ELSE
    PERFORM vault.update_secret(v_access, p_access_token);
  END IF;
  -- Xero rotates the refresh token on every refresh: the new one MUST be kept.
  IF p_refresh_token IS NOT NULL THEN
    IF v_refresh IS NULL THEN
      v_refresh := vault.create_secret(p_refresh_token, 'acct_v2_refresh_' || p_connection_id || '_' || extract(epoch from now()));
    ELSE
      PERFORM vault.update_secret(v_refresh, p_refresh_token);
    END IF;
  END IF;

  UPDATE public.accounting_v2_connections
     SET access_token_secret_id = v_access, refresh_token_secret_id = v_refresh,
         token_expires_at = p_expires_at, updated_at = now()
   WHERE id = p_connection_id;
END $$;

CREATE OR REPLACE FUNCTION public.accounting_v2_get_tokens(p_connection_id uuid)
RETURNS TABLE (access_token text, refresh_token text, expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public, vault, extensions AS $$
  SELECT (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = c.access_token_secret_id),
         (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = c.refresh_token_secret_id),
         c.token_expires_at
    FROM public.accounting_v2_connections c WHERE c.id = p_connection_id;
$$;

CREATE OR REPLACE FUNCTION public.accounting_v2_clear_tokens(p_connection_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions AS $$
DECLARE v_access uuid; v_refresh uuid;
BEGIN
  SELECT access_token_secret_id, refresh_token_secret_id INTO v_access, v_refresh
    FROM public.accounting_v2_connections WHERE id = p_connection_id FOR UPDATE;
  UPDATE public.accounting_v2_connections
     SET access_token_secret_id = NULL, refresh_token_secret_id = NULL, token_expires_at = NULL, updated_at = now()
   WHERE id = p_connection_id;
  IF v_access IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_access; END IF;
  IF v_refresh IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_refresh; END IF;
END $$;

-- ── what counts as money ────────────────────────────────────────────────────
--
-- Exactly the Finances tab's rules (components/finances-v2/finance-data.ts):
-- LANDED statuses are the payments whose money arrived; a refund is
-- min(refund_amount, amount) on the payment. One deliberate difference: a
-- refund still processing / scheduled / failed has not left the bank, so it
-- is not booked until it settles.

CREATE OR REPLACE FUNCTION public.accounting_v2_is_landed(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_status, '') IN ('Applied','Completed','Partial','Credit','Partial Refund','Refunded');
$$;

CREATE OR REPLACE FUNCTION public.accounting_v2_refund_amount(p jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL THEN 0
    WHEN lower(coalesce(p->>'refund_status', '')) IN ('processing','scheduled','pending','failed') THEN 0
    WHEN coalesce((p->>'refund_amount')::numeric, 0) <= 0.005 THEN 0
    ELSE least((p->>'refund_amount')::numeric,
               CASE WHEN coalesce((p->>'amount')::numeric, 0) > 0 THEN (p->>'amount')::numeric
                    ELSE (p->>'refund_amount')::numeric END)
  END;
$$;

-- ── describe a source: display fields + money fingerprint ───────────────────

CREATE OR REPLACE FUNCTION public.accounting_v2_describe(
  p_tenant uuid, p_source_type text, p_source_id uuid, p_row jsonb DEFAULT NULL
) RETURNS TABLE (
  exists_now boolean, in_scope_at timestamptz, invoice_id uuid, invoice_number text, customer_id uuid,
  customer_name text, direction text, amount numeric, description text, fingerprint text, row_data jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row jsonb; v_rental uuid; v_cats text; v_alloc text; v_inv record; v_cust uuid;
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
      in_scope_at := coalesce((v_row->>'paid_at')::timestamptz, (v_row->>'payment_date')::timestamptz, (v_row->>'created_at')::timestamptz);
      fingerprint := md5(concat_ws('|', v_row->>'status', v_row->>'amount', v_row->>'rental_id', v_row->>'customer_id',
                       v_row->>'paid_at', v_row->>'payment_date', v_row->>'method', v_row->>'stripe_payment_intent_id',
                       v_row->>'stripe_checkout_session_id', v_row->>'square_payment_id', v_alloc,
                       CASE WHEN exists_now THEN 'live' ELSE 'gone' END));
    ELSE
      direction := 'out';
      amount := public.accounting_v2_refund_amount(v_row);
      in_scope_at := coalesce((v_row->>'refund_processed_at')::timestamptz, (v_row->>'updated_at')::timestamptz);
      fingerprint := md5(concat_ws('|', amount::text, v_row->>'amount', v_row->>'refund_status', v_row->>'rental_id',
                       v_row->>'customer_id', v_alloc, v_row->>'stripe_refund_id', v_row->>'square_refund_id',
                       CASE WHEN exists_now THEN 'live' ELSE 'gone' END));
    END IF;
  ELSE
    -- invoice: the rental's Charge rows ARE its line items.
    v_rental := p_source_id;
    SELECT coalesce(sum(le.amount), 0),
           md5(coalesce(string_agg(le.id::text || ':' || le.amount::text || ':' || coalesce(le.category, ''), ',' ORDER BY le.id), '')),
           min(le.created_at)
      INTO amount, fingerprint, in_scope_at
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
      in_scope_at := coalesce(v_inv.created_at, in_scope_at);
      fingerprint := md5(concat_ws('|', fingerprint, v_inv.invoice_number, v_inv.id::text));
    END IF;
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

-- ── enqueue (idempotent, re-arming) ─────────────────────────────────────────

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
      customer_name, direction, amount, currency, description, occurred_at, status, next_attempt_at,
      fingerprint, payload, idempotency_key
    ) VALUES (
      p_tenant, c.provider, p_source_type, p_source_id, p_operation, d.invoice_id, d.invoice_number, d.customer_id,
      d.customer_name, d.direction, coalesce(d.amount, 0), v_currency,
      CASE WHEN p_operation = 'delete' THEN 'Deleted · ' ELSE '' END || d.description,
      coalesce(d.in_scope_at, now()), 'waiting', now() + interval '20 seconds',
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
      payload         = coalesce(excluded.payload, i.payload),
      updated_at      = now();
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- ── capture: the triggers ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accounting_v2_capture_change(
  p_table text, p_op text, p_tenant uuid, o jsonb, n jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pid uuid; v_pay jsonb; v_rental uuid;
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
    IF coalesce(n->>'type', o->>'type') <> 'Charge' THEN RETURN; END IF;
    IF p_op = 'UPDATE'
       AND (o->>'amount') IS NOT DISTINCT FROM (n->>'amount')
       AND (o->>'category') IS NOT DISTINCT FROM (n->>'category')
       AND (o->>'rental_id') IS NOT DISTINCT FROM (n->>'rental_id')
       AND (o->>'type') IS NOT DISTINCT FROM (n->>'type') THEN
      RETURN;   -- remaining_amount moving is a payment landing, captured on payments
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

CREATE OR REPLACE FUNCTION public.accounting_v2_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_tenant uuid;
  v_err text;
BEGIN
  -- Tenant guard FIRST (V2_PLAN §6): no v2 connection ⇒ do nothing at all.
  v_tenant := nullif(coalesce(n, o)->>'tenant_id', '')::uuid;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounting_v2_connections c
     WHERE c.tenant_id = v_tenant AND c.status IN ('connected','needs_reauth','error')
  ) THEN
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM public.accounting_v2_capture_change(TG_TABLE_NAME, TG_OP, v_tenant, o, n);
  EXCEPTION WHEN OTHERS THEN
    -- Never abort the caller's money write for a side effect. Record it; the
    -- reconciler re-enqueues it within the hour.
    v_err := SQLERRM;
    RAISE WARNING 'accounting_v2_capture % % failed: %', TG_TABLE_NAME, TG_OP, v_err;
    BEGIN
      INSERT INTO public.accounting_v2_capture_errors (tenant_id, table_name, op, row_id, error)
      VALUES (v_tenant, TG_TABLE_NAME, TG_OP, nullif(coalesce(n, o)->>'id', '')::uuid, v_err);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'accounting_v2_capture: could not record the failure: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS accounting_v2_capture_payments ON public.payments;
CREATE TRIGGER accounting_v2_capture_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.accounting_v2_capture();

DROP TRIGGER IF EXISTS accounting_v2_capture_payment_applications ON public.payment_applications;
CREATE TRIGGER accounting_v2_capture_payment_applications
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_applications
  FOR EACH ROW EXECUTE FUNCTION public.accounting_v2_capture();

DROP TRIGGER IF EXISTS accounting_v2_capture_ledger_entries ON public.ledger_entries;
CREATE TRIGGER accounting_v2_capture_ledger_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.accounting_v2_capture();

DROP TRIGGER IF EXISTS accounting_v2_capture_invoices ON public.invoices;
CREATE TRIGGER accounting_v2_capture_invoices
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.accounting_v2_capture();

-- ── reconciler: the safety net ──────────────────────────────────────────────
--
-- For every live connection, re-derive what the Finances tab shows since
-- `sync_from` and compare it with the outbox:
--   missing  a landed payment / settled refund / invoiced rental with no item
--   drift    an item marked sent whose source's money fingerprint has moved
--   deleted  a sent payment whose row is gone with no delete item
--   capture_error  a trigger capture that raised
-- Every finding is written to accounting_v2_reconcile_log and RAISEd.

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

    -- Every candidate source: landed payments, settled refunds, rentals with charges.
    FOR s IN
      SELECT 'payment'::text AS st, p.id AS sid FROM public.payments p
       WHERE p.tenant_id = c.tenant_id AND public.accounting_v2_is_landed(p.status)
         AND coalesce(p.paid_at, p.payment_date::timestamptz, p.created_at) >= v_from
      UNION ALL
      SELECT 'refund', p.id FROM public.payments p
       WHERE p.tenant_id = c.tenant_id AND public.accounting_v2_refund_amount(to_jsonb(p)) > 0
         AND coalesce(p.refund_processed_at, p.updated_at) >= v_from
      UNION ALL
      SELECT DISTINCT 'invoice', le.rental_id FROM public.ledger_entries le
       LEFT JOIN public.invoices i ON i.rental_id = le.rental_id AND i.tenant_id = c.tenant_id
       WHERE le.tenant_id = c.tenant_id AND le.type = 'Charge' AND le.rental_id IS NOT NULL
         AND coalesce(i.created_at, le.created_at) >= v_from
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

    -- Sent payments / refunds whose row has vanished without a delete item.
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

  -- Trigger captures that raised: they are covered by the sweep above once the
  -- connection is live; mark them so they are not reported twice.
  UPDATE public.accounting_v2_capture_errors SET resolved_at = now()
   WHERE resolved_at IS NULL AND (p_tenant IS NULL OR tenant_id = p_tenant);

  IF v_found > 0 THEN
    RAISE WARNING 'accounting_v2_reconcile: % transaction(s) were missing or had drifted and have been queued — see accounting_v2_reconcile_log', v_found;
  END IF;
  RETURN v_found;
END $$;

-- ── worker claim / finish ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accounting_v2_claim(
  p_limit integer DEFAULT 60, p_tenant uuid DEFAULT NULL, p_provider public.accounting_provider DEFAULT NULL
) RETURNS SETOF public.accounting_sync_items
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
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
     ORDER BY i.tenant_id, i.provider,
              CASE i.source_type WHEN 'invoice' THEN 0 WHEN 'payment' THEN 1 ELSE 2 END,
              i.occurred_at, i.created_at
     LIMIT greatest(p_limit, 1)
     FOR UPDATE OF i SKIP LOCKED
  )
  UPDATE public.accounting_sync_items i SET claimed_at = now()
    FROM due WHERE i.id = due.id
  RETURNING i.*;
$$;

-- p_outcome: sent | failed | retry (rate-limited / not an error: stays waiting,
-- attempt not counted) | drop (nothing to send and never sent: removed).
CREATE OR REPLACE FUNCTION public.accounting_v2_finish(
  p_id uuid, p_generation integer, p_outcome text, p_external_id text DEFAULT NULL,
  p_error text DEFAULT NULL, p_retry_at timestamptz DEFAULT NULL, p_description text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_outcome = 'drop' THEN
    DELETE FROM public.accounting_sync_items WHERE id = p_id AND generation = p_generation;
    IF FOUND THEN RETURN; END IF;
  END IF;
  UPDATE public.accounting_sync_items SET
    -- Re-armed while it was being sent: send again with the newer state.
    status          = CASE WHEN generation <> p_generation OR p_outcome IN ('retry','drop') THEN 'waiting'
                           WHEN p_outcome = 'sent' THEN 'sent' ELSE 'failed' END,
    attempts        = CASE WHEN p_outcome = 'failed' THEN attempts + 1 ELSE attempts END,
    next_attempt_at = CASE WHEN generation <> p_generation THEN now()
                           ELSE coalesce(p_retry_at, next_attempt_at) END,
    last_error      = CASE WHEN p_outcome IN ('failed','retry') THEN p_error ELSE NULL END,
    external_id     = coalesce(p_external_id, external_id),
    description     = coalesce(p_description, description),
    sent_at         = CASE WHEN p_outcome = 'sent' THEN now() ELSE sent_at END,
    claimed_at      = NULL,
    updated_at      = now()
  WHERE id = p_id;
END $$;

-- ── who may call what ───────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.accounting_v2_store_tokens(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_v2_get_tokens(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_v2_clear_tokens(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_v2_describe(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_v2_enqueue(uuid, text, uuid, text, jsonb, public.accounting_provider) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_v2_capture_change(text, text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_v2_reconcile(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_v2_claim(integer, uuid, public.accounting_provider) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_v2_finish(uuid, integer, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_v2_store_tokens(uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_v2_get_tokens(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_v2_clear_tokens(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_v2_describe(uuid, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_v2_enqueue(uuid, text, uuid, text, jsonb, public.accounting_provider) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_v2_reconcile(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_v2_claim(integer, uuid, public.accounting_provider) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_v2_finish(uuid, integer, text, text, text, timestamptz, text) TO service_role;

-- The cron schedules (worker every minute, reconciler hourly) are in
-- 20261017130000_accounting_v2_cron.sql — applied separately, on go-ahead,
-- because they are what starts sending to the providers.
