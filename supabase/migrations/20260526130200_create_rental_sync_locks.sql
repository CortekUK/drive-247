/**
 * rental_sync_locks — Sprint 6 patch.
 *
 * Two cron workers can pick up two events for the same rental at roughly the
 * same time. Both would call `findOpenInvoiceForRental` → same external invoice
 * id → both call `provider.appendInvoiceLine`. Xero (and Zoho) implement that
 * as GET-existing-lines → PUT-with-merged-lines, so the second PUT can overwrite
 * the first PUT's line. The customer ends up with one line missing on their
 * invoice — silent data loss.
 *
 * Fix: a cross-worker mutex per (tenant_id, rental_id, provider). The worker
 * takes the lock before calling the provider; if the lock is held, the row is
 * deferred back to `pending` and the next cron tick picks it up.
 *
 * The lock auto-expires after 5 minutes so a crashed worker never wedges a
 * rental indefinitely.
 */
CREATE TABLE IF NOT EXISTS public.rental_sync_locks (
  tenant_id      UUID    NOT NULL,
  rental_id      UUID    NOT NULL,
  provider       TEXT    NOT NULL CHECK (provider IN ('xero', 'zoho')),
  locked_by      TEXT    NOT NULL,                      -- worker invocation id (random per tick)
  locked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, rental_id, provider)
);

ALTER TABLE public.rental_sync_locks ENABLE ROW LEVEL SECURITY;

-- Service role only; no tenant access path needed.
CREATE POLICY "service_role manages rental_sync_locks"
  ON public.rental_sync_locks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

/**
 * Try to acquire the per-rental lock. Returns TRUE if acquired (caller may
 * proceed), FALSE if another worker already holds it.
 *
 * Implementation: INSERT, on conflict UPDATE only if the held lock has expired.
 * This is atomic within Postgres so two concurrent calls cannot both succeed.
 */
CREATE OR REPLACE FUNCTION public.try_acquire_rental_sync_lock(
  p_tenant_id  UUID,
  p_rental_id  UUID,
  p_provider   TEXT,
  p_worker_id  TEXT,
  p_ttl_seconds INTEGER DEFAULT 300
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_expires TIMESTAMPTZ := v_now + (p_ttl_seconds || ' seconds')::INTERVAL;
  v_inserted BOOLEAN;
BEGIN
  INSERT INTO public.rental_sync_locks (tenant_id, rental_id, provider, locked_by, locked_at, expires_at)
  VALUES (p_tenant_id, p_rental_id, p_provider, p_worker_id, v_now, v_expires)
  ON CONFLICT (tenant_id, rental_id, provider) DO UPDATE
    SET locked_by = EXCLUDED.locked_by,
        locked_at = EXCLUDED.locked_at,
        expires_at = EXCLUDED.expires_at
    WHERE public.rental_sync_locks.expires_at < v_now;

  -- Determine whether we own it now.
  SELECT TRUE INTO v_inserted
  FROM public.rental_sync_locks
  WHERE tenant_id = p_tenant_id
    AND rental_id = p_rental_id
    AND provider  = p_provider
    AND locked_by = p_worker_id;

  RETURN COALESCE(v_inserted, FALSE);
END;
$$;

/**
 * Release the lock. Only the holder can release it (workers pass their own id).
 */
CREATE OR REPLACE FUNCTION public.release_rental_sync_lock(
  p_tenant_id  UUID,
  p_rental_id  UUID,
  p_provider   TEXT,
  p_worker_id  TEXT
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM public.rental_sync_locks
  WHERE tenant_id = p_tenant_id
    AND rental_id = p_rental_id
    AND provider  = p_provider
    AND locked_by = p_worker_id;
$$;

-- Index for the (rare) cleanup query that prunes expired locks.
CREATE INDEX IF NOT EXISTS idx_rental_sync_locks_expires
  ON public.rental_sync_locks (expires_at);

GRANT EXECUTE ON FUNCTION public.try_acquire_rental_sync_lock(UUID, UUID, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_rental_sync_lock(UUID, UUID, TEXT, TEXT) TO service_role;
