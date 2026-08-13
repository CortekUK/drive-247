-- Finance Sync — Sprint 7 (hardening). Fixes three defects that between them
-- wedged the production sync queue from 2026-05-26 until 2026-08-13.
--
-- ══════════════════════════════════════════════════════════════════════════
-- DEFECT 1 — the claim RPC never existed.
--
--   process-accounting-sync calls `process_accounting_sync_claim_batch`. That
--   function was never written in any migration. Every cron tick since launch
--   therefore fell into `claimBatchFallback()`, which bulk-UPDATEs up to 100
--   rows to state='syncing' in one statement and then processes them serially.
--
--   The worker only ever re-selects state IN ('pending','failed'). So every row
--   still unprocessed when the function died (Xero 429, wall-clock timeout,
--   redeploy) was stranded in 'syncing' with nothing on earth to pick it up
--   again. Production ended up with 36 permanently orphaned rows, the oldest
--   frozen since 2026-06-04.
--
-- DEFECT 2 — dead-letter never worked, because NULL meant two opposite things.
--
--   backoff.ts returns next_attempt_at = NULL to mean "never retry this"
--   (dead-letter, or an auth/validation class error). But the claim predicate
--   is `next_attempt_at IS NULL OR next_attempt_at <= now()`, where NULL means
--   "first-time pending, claim immediately".
--
--   So every dead-lettered row was re-claimed every 2 minutes, forever. The
--   dead-letter threshold is 5 attempts; production rows reached **56,137**,
--   each attempt burning Xero API calls against a connection that expired on
--   2026-06-21. That call volume is what produced the 429s that stranded the
--   rows in Defect 1 — the two failures fed each other.
--
-- DEFECT 3 — no visibility timeout, so a claim was permanent.
--
--   Nothing reclaimed in-flight work. Fixed here with claimed_at + a lease.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Schema ────────────────────────────────────────────────────────────────

-- Explicit dead-letter marker. Replaces the overloaded NULL sentinel so
-- "never retry" and "retry immediately" stop being the same value.
ALTER TABLE public.financial_event_sync_state
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;

-- When the current worker claimed this row. Drives the visibility timeout:
-- a row whose lease has expired is fair game for the next tick.
ALTER TABLE public.financial_event_sync_state
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.financial_event_sync_state.dead_lettered_at IS
  'Set when the row will no longer be auto-retried (attempt budget exhausted, or an auth/validation error needing operator action). Only a manual retry from the sync log clears it. Distinct from next_attempt_at IS NULL, which means "claim on the next tick".';
COMMENT ON COLUMN public.financial_event_sync_state.claimed_at IS
  'When a worker claimed this row (state=syncing). Rows whose claim is older than the visibility timeout are reclaimed — without this a crashed worker stranded its batch permanently.';

-- Consecutive refresh failures. refresh-accounting-tokens declares
-- MAX_CONSECUTIVE_FAILURES = 3 but never had anywhere to count, so it expired
-- the connection on the FIRST 4xx. Xero rotates its refresh token on every use,
-- which makes a lone 400 a routine outcome of two overlapping refreshes rather
-- than proof the grant is dead — and expiring is not self-healing, it requires
-- the operator to re-run the whole OAuth consent flow. Both production
-- connections died this way.
ALTER TABLE public.accounting_connections
  ADD COLUMN IF NOT EXISTS refresh_failure_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.accounting_connections.refresh_failure_count IS
  'Consecutive token-refresh failures. Reset to 0 on any success. The connection is only marked expired once this reaches MAX_CONSECUTIVE_FAILURES in refresh-accounting-tokens.';

-- The old partial index cannot serve the reaper, which needs to find stale
-- 'syncing' rows. Replace it with one covering all three claimable states.
DROP INDEX IF EXISTS public.financial_event_sync_state_pending_idx;
CREATE INDEX IF NOT EXISTS financial_event_sync_state_claimable_idx
  ON public.financial_event_sync_state (state, next_attempt_at, claimed_at)
  WHERE state IN ('pending', 'failed', 'syncing') AND dead_lettered_at IS NULL;

-- ── Repair the rows the defects left behind ───────────────────────────────
-- Deliberately conservative: this only touches rows that are provably stuck,
-- and it never invents a success. Nothing here writes to any money table —
-- financial_events, payments and ledger_entries are untouched.

-- 1. Rows already past the attempt budget are marked dead-lettered rather than
--    left to spin. They stay 'failed' and remain visible in the sync log, where
--    the operator can retry them deliberately once Xero is reconnected.
UPDATE public.financial_event_sync_state
   SET dead_lettered_at = COALESCE(last_attempt_at, now())
 WHERE dead_lettered_at IS NULL
   AND state = 'failed'
   AND attempts >= 5;

-- 2. Orphans: claimed, never finished, no worker alive to finish them. Return
--    them to 'pending' so the new claim path can pick them up. attempts is
--    reset to 0 because the recorded count is an artefact of Defect 2 (values
--    in the tens of thousands), not a real measure of how often we tried to
--    talk to Xero about this event.
UPDATE public.financial_event_sync_state
   SET state = 'pending',
       attempts = 0,
       claimed_at = NULL,
       next_attempt_at = NULL,
       last_error = COALESCE(last_error, '') ||
                    ' [reclaimed by 20260813120000: orphaned in syncing]'
 WHERE state = 'syncing';

-- ── The claim RPC that should have existed all along ──────────────────────

CREATE OR REPLACE FUNCTION public.process_accounting_sync_claim_batch(
  p_batch_size INTEGER DEFAULT 40,
  p_claim_timeout_minutes INTEGER DEFAULT 15
)
RETURNS TABLE (
  sync_id             UUID,
  financial_event_id  UUID,
  tenant_id           UUID,
  provider            public.accounting_provider,
  state               public.sync_state,
  attempts            INTEGER,
  external_invoice_id TEXT,
  id                  UUID,      -- financial_events.id (worker reads row.id)
  rental_id           UUID,
  customer_id         UUID,
  vehicle_id          UUID,
  event_type          TEXT,
  amount_cents        INTEGER,
  tax_cents           INTEGER,
  currency            TEXT,
  occurred_at         TIMESTAMPTZ,
  description         TEXT,
  metadata            JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- The RETURNS TABLE columns above declare OUT parameters named id, tenant_id,
-- state, provider, attempts, currency, metadata … every one of which is also a
-- real column on the tables this body touches. Without this directive plpgsql
-- resolves a bare identifier to the VARIABLE, so `SET state = 'syncing'` and the
-- WHERE clauses could silently bind to the OUT param instead of the column.
-- Force column resolution; the only true variables here (p_batch_size,
-- p_claim_timeout_minutes, v_cutoff) share no name with any column.
#variable_conflict use_column
DECLARE
  v_cutoff TIMESTAMPTZ := now() - make_interval(mins => GREATEST(p_claim_timeout_minutes, 1));
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT s.id
      FROM public.financial_event_sync_state s
     WHERE s.dead_lettered_at IS NULL
       AND (
             -- Fresh work, or a backoff window that has come due.
             (s.state IN ('pending', 'failed')
              AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now()))
             -- The reaper: a claim whose lease expired. Covers a worker that
             -- was killed mid-batch, which is exactly how the 36 production
             -- rows were stranded.
          OR (s.state = 'syncing'
              AND COALESCE(s.claimed_at, s.last_attempt_at) < v_cutoff)
           )
     ORDER BY s.next_attempt_at ASC NULLS FIRST, s.created_at ASC
     LIMIT GREATEST(p_batch_size, 1)
     -- SKIP LOCKED is the whole point: overlapping cron ticks take disjoint
     -- rows instead of both grabbing the same one. This is what the PostgREST
     -- fallback could not express, and why it double-processed.
     FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.financial_event_sync_state s
       SET state = 'syncing',
           claimed_at = now(),
           last_attempt_at = now()
      FROM claimable c
     WHERE s.id = c.id
     RETURNING s.*
  )
  SELECT c.id                AS sync_id,
         c.financial_event_id,
         c.tenant_id,
         c.provider,
         c.state,
         c.attempts,
         c.external_invoice_id,
         e.id,
         e.rental_id,
         e.customer_id,
         e.vehicle_id,
         e.event_type::TEXT,
         e.amount_cents,
         e.tax_cents,
         e.currency,
         e.occurred_at,
         e.description,
         e.metadata
    FROM claimed c
    JOIN public.financial_events e ON e.id = c.financial_event_id;
END;
$$;

COMMENT ON FUNCTION public.process_accounting_sync_claim_batch IS
  'Atomically claims a batch of sync rows for process-accounting-sync using FOR UPDATE SKIP LOCKED. Also reclaims rows whose in-flight lease expired, and never returns dead-lettered rows. Replaces the PostgREST fallback in the worker, which could not lock and stranded rows in syncing.';

REVOKE ALL ON FUNCTION public.process_accounting_sync_claim_batch(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_accounting_sync_claim_batch(INTEGER, INTEGER) TO service_role;

-- ── Re-enqueue helper for reconnection ────────────────────────────────────
-- enqueue_financial_event only fans out to connections that are 'active' at
-- insert time. Every event recorded while a tenant's connection was expired
-- got no sync row at all and is invisible to the queue forever — production
-- has 6,544 ledger events for the connected tenant against 53 sync rows.
--
-- Reconnecting does not retro-enqueue, so this backfills the gap. Called by
-- the OAuth callback after a successful (re)connect.
CREATE OR REPLACE FUNCTION public.backfill_missing_sync_rows(
  p_tenant_id UUID,
  p_provider public.accounting_provider,
  p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER;
  v_revived  INTEGER;
BEGIN
  -- 1. Enqueue events that never got a sync row for this provider.
  INSERT INTO public.financial_event_sync_state (financial_event_id, tenant_id, provider, state)
  SELECT e.id, e.tenant_id, p_provider, 'pending'
    FROM public.financial_events e
   WHERE e.tenant_id = p_tenant_id
     AND (p_since IS NULL OR e.occurred_at >= p_since)
  ON CONFLICT (financial_event_id, provider) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- 2. Revive rows that were dead-lettered ONLY because there was no live
  --    connection to sync through.
  --
  --    Without this, reconnecting does not actually recover anything: an
  --    auth-class failure dead-letters immediately (no retry budget), and step 1
  --    cannot help because those rows already exist, so ON CONFLICT DO NOTHING
  --    skips them. The events would stay stranded until someone clicked retry on
  --    each one individually — which is precisely the failure this whole
  --    migration exists to stop.
  --
  --    Deliberately narrow: only connection-class errors are revived. A genuine
  --    validation failure (bad account mapping, unsupported currency) is NOT
  --    fixed by reconnecting and must stay dead-lettered for the operator.
  UPDATE public.financial_event_sync_state
     SET state           = 'pending',
         dead_lettered_at = NULL,
         next_attempt_at  = NULL,
         claimed_at       = NULL,
         attempts         = 0
   WHERE tenant_id = p_tenant_id
     AND provider  = p_provider
     AND state     = 'failed'
     AND dead_lettered_at IS NOT NULL
     AND (
           last_error_code IN ('NO_ACTIVE_CONNECTION', 'TOKEN_FETCH_FAILED', 'auth')
        OR last_error ILIKE '%No active%connection%'
         );
  GET DIAGNOSTICS v_revived = ROW_COUNT;

  RETURN v_inserted + v_revived;
END;
$$;

COMMENT ON FUNCTION public.backfill_missing_sync_rows IS
  'Creates pending sync rows for financial_events that have none for this provider — i.e. events recorded while the connection was expired. Idempotent via the (financial_event_id, provider) unique index.';

REVOKE ALL ON FUNCTION public.backfill_missing_sync_rows(UUID, public.accounting_provider, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_missing_sync_rows(UUID, public.accounting_provider, TIMESTAMPTZ) TO service_role;
