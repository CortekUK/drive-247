-- Finance Sync — Sprint 2: accounting_connections.
-- One row per tenant per provider (Xero or Zoho). Stores OAuth state — tokens
-- live in Supabase Vault (mirror of the Tesla pattern from
-- 20260520160000_tesla_tokens_to_vault.sql per Deviation #1 of the master plan).
--
-- The accounting_connections_public view (next migration) projects every
-- column EXCEPT the secret IDs, so RLS-allowed client SELECTs can never
-- exfiltrate vault references. All token reads happen via the
-- accounting_get_tokens() RPC running as service_role.

CREATE TYPE public.accounting_connection_status AS ENUM (
  'active',         -- normal state, sync proceeds
  'expired',        -- refresh failed 3x consecutive — operator must reconnect
  'revoked',        -- operator explicitly disconnected
  'error'           -- generic terminal failure (e.g. provider revoked our app)
);

CREATE TABLE IF NOT EXISTS public.accounting_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider public.accounting_provider NOT NULL,
  status public.accounting_connection_status NOT NULL DEFAULT 'active',

  -- Vault references — NEVER store raw tokens here.
  -- See accounting_store_tokens() RPC below.
  access_token_secret_id UUID,
  refresh_token_secret_id UUID,
  token_expires_at TIMESTAMPTZ,

  -- Provider-specific identifiers.
  external_org_id TEXT NOT NULL,           -- Xero tenantId or Zoho organization_id
  external_org_name TEXT,
  external_region TEXT,                    -- Zoho DC ('com'|'eu'|'in'|'com.au'|'jp'|'sa'); NULL for Xero

  -- Telemetry.
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  connected_by UUID REFERENCES public.app_users(id),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one ACTIVE connection per (tenant, provider). Revoked/expired rows
-- can coexist as audit history.
CREATE UNIQUE INDEX accounting_connections_active_uniq
  ON public.accounting_connections (tenant_id, provider)
  WHERE status = 'active';

CREATE INDEX accounting_connections_tenant_idx
  ON public.accounting_connections (tenant_id);

-- Hot path for the refresh-accounting-tokens cron — find active rows whose
-- access token is about to expire.
CREATE INDEX accounting_connections_refresh_idx
  ON public.accounting_connections (token_expires_at)
  WHERE status = 'active';

CREATE TRIGGER set_accounting_connections_updated_at
  BEFORE UPDATE ON public.accounting_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accounting_connections ENABLE ROW LEVEL SECURITY;

-- DELIBERATELY no client-facing SELECT policy on this table. All client reads
-- go through the accounting_connections_public view (next migration) which
-- excludes the secret_id columns.
CREATE POLICY "service_role_full_access_accounting_connections"
  ON public.accounting_connections
  FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Token RPCs — mirror of Tesla's three-RPC vault pattern.
-- All run SECURITY DEFINER and are GRANTed only to service_role.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.accounting_store_tokens(
  p_tenant_id UUID,
  p_provider public.accounting_provider,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_expires_at TIMESTAMPTZ,
  p_external_org_id TEXT,
  p_external_org_name TEXT DEFAULT NULL,
  p_external_region TEXT DEFAULT NULL,
  p_connected_by UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_existing_id UUID;
  v_existing_access  UUID;
  v_existing_refresh UUID;
  v_access_sid  UUID;
  v_refresh_sid UUID;
  v_secret_label_access  TEXT := p_provider::text || '_access_' || p_tenant_id::text || '_' || extract(epoch from now())::text;
  v_secret_label_refresh TEXT := p_provider::text || '_refresh_' || p_tenant_id::text || '_' || extract(epoch from now())::text;
BEGIN
  -- Look up the active connection if one already exists for (tenant, provider).
  SELECT id, access_token_secret_id, refresh_token_secret_id
    INTO v_existing_id, v_existing_access, v_existing_refresh
    FROM public.accounting_connections
   WHERE tenant_id = p_tenant_id AND provider = p_provider AND status = 'active'
   LIMIT 1;

  -- Access token — always present on store.
  IF v_existing_access IS NULL THEN
    SELECT vault.create_secret(p_access_token, v_secret_label_access) INTO v_access_sid;
  ELSE
    PERFORM vault.update_secret(v_existing_access, p_access_token);
    v_access_sid := v_existing_access;
  END IF;

  -- Refresh token — may be NULL on subsequent refresh calls if provider
  -- doesn't rotate (Zoho). Keep the existing one in that case.
  IF p_refresh_token IS NULL THEN
    v_refresh_sid := v_existing_refresh;
  ELSIF v_existing_refresh IS NULL THEN
    SELECT vault.create_secret(p_refresh_token, v_secret_label_refresh) INTO v_refresh_sid;
  ELSE
    PERFORM vault.update_secret(v_existing_refresh, p_refresh_token);
    v_refresh_sid := v_existing_refresh;
  END IF;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.accounting_connections (
      tenant_id, provider, status,
      access_token_secret_id, refresh_token_secret_id, token_expires_at,
      external_org_id, external_org_name, external_region,
      connected_by
    )
    VALUES (
      p_tenant_id, p_provider, 'active',
      v_access_sid, v_refresh_sid, p_expires_at,
      p_external_org_id, p_external_org_name, p_external_region,
      p_connected_by
    )
    RETURNING id INTO v_existing_id;
  ELSE
    UPDATE public.accounting_connections
       SET status = 'active',
           access_token_secret_id = v_access_sid,
           refresh_token_secret_id = v_refresh_sid,
           token_expires_at = p_expires_at,
           external_org_id = p_external_org_id,
           external_org_name = COALESCE(p_external_org_name, external_org_name),
           external_region = COALESCE(p_external_region, external_region),
           last_error = NULL
     WHERE id = v_existing_id;
  END IF;

  RETURN v_existing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_get_tokens(
  p_tenant_id UUID,
  p_provider public.accounting_provider
) RETURNS TABLE(
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  external_org_id TEXT,
  external_region TEXT,
  connection_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_access_sid  UUID;
  v_refresh_sid UUID;
  v_expires_at  TIMESTAMPTZ;
  v_org_id      TEXT;
  v_region      TEXT;
  v_conn_id     UUID;
BEGIN
  SELECT id, access_token_secret_id, refresh_token_secret_id, token_expires_at,
         external_org_id, external_region
    INTO v_conn_id, v_access_sid, v_refresh_sid, v_expires_at, v_org_id, v_region
    FROM public.accounting_connections
   WHERE tenant_id = p_tenant_id AND provider = p_provider AND status = 'active'
   LIMIT 1;

  IF v_access_sid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = v_access_sid),
    CASE WHEN v_refresh_sid IS NOT NULL THEN
      (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = v_refresh_sid)
    END,
    v_expires_at, v_org_id, v_region, v_conn_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accounting_clear_tokens(
  p_tenant_id UUID,
  p_provider public.accounting_provider,
  p_new_status public.accounting_connection_status DEFAULT 'revoked'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_access_sid  UUID;
  v_refresh_sid UUID;
BEGIN
  SELECT access_token_secret_id, refresh_token_secret_id
    INTO v_access_sid, v_refresh_sid
    FROM public.accounting_connections
   WHERE tenant_id = p_tenant_id AND provider = p_provider AND status = 'active';

  UPDATE public.accounting_connections
     SET status = p_new_status,
         access_token_secret_id = NULL,
         refresh_token_secret_id = NULL,
         token_expires_at = NULL,
         disconnected_at = now()
   WHERE tenant_id = p_tenant_id AND provider = p_provider AND status = 'active';

  IF v_access_sid  IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_access_sid;  END IF;
  IF v_refresh_sid IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_refresh_sid; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accounting_store_tokens(UUID, public.accounting_provider, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_get_tokens(UUID, public.accounting_provider) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accounting_clear_tokens(UUID, public.accounting_provider, public.accounting_connection_status) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_store_tokens(UUID, public.accounting_provider, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_get_tokens(UUID, public.accounting_provider) TO service_role;
GRANT EXECUTE ON FUNCTION public.accounting_clear_tokens(UUID, public.accounting_provider, public.accounting_connection_status) TO service_role;

COMMENT ON TABLE public.accounting_connections IS
  'One row per tenant per provider. OAuth tokens live in vault; this table only holds vault references. Spec §5.1 + master plan Deviation #1.';
