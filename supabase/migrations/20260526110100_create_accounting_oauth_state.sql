-- Finance Sync — Sprint 2: short-lived OAuth state nonces.
-- We never trust the OAuth `state` query param to carry `tenant_id` directly;
-- instead the start function writes a row keyed by a fresh UUID nonce, and
-- the callback looks the nonce up + validates the expires_at TTL. Prevents
-- both CSRF and tenant-confusion attacks (spec §6.2).

CREATE TABLE IF NOT EXISTS public.accounting_oauth_state (
  nonce UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider public.accounting_provider NOT NULL,
  /** Optional provider-specific extras — for Zoho, the region the user picked. */
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** Where to send the operator after the callback completes successfully. */
  redirect_back TEXT,
  /** Issued by xero-oauth-start / zoho-oauth-start; valid for 10 min. */
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes',
  /** Who initiated the OAuth flow — for audit only. */
  initiated_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sweep out expired nonces aggressively so the table stays tiny.
CREATE INDEX accounting_oauth_state_expires_idx
  ON public.accounting_oauth_state (expires_at);

ALTER TABLE public.accounting_oauth_state ENABLE ROW LEVEL SECURITY;

-- service_role only — clients never touch this table; the start fn writes,
-- the callback fn reads + deletes.
CREATE POLICY "service_role_full_access_accounting_oauth_state"
  ON public.accounting_oauth_state
  FOR ALL USING (auth.role() = 'service_role');

-- Reaper function — called from cron or on every callback to keep the table small.
CREATE OR REPLACE FUNCTION public.accounting_oauth_state_reap()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  WITH d AS (
    DELETE FROM public.accounting_oauth_state
     WHERE expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM d;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_oauth_state_reap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_oauth_state_reap() TO service_role;

COMMENT ON TABLE public.accounting_oauth_state IS
  'Short-lived nonces backing the OAuth `state` query param. 10-min TTL. Spec §6.2.';
