/**
 * Fix: accounting_get_tokens() had ambiguous column reference.
 *
 * The function declared RETURNS TABLE(... external_org_id TEXT ...) which
 * created an OUT parameter of that name. The inline SELECT then referenced
 * `external_org_id` without qualification, and PostgreSQL couldn't tell
 * whether we meant the OUT parameter or the column on
 * accounting_connections — it errored with:
 *
 *   42702: column reference "external_org_id" is ambiguous
 *
 * The list-accounting-accounts / list-accounting-tax-rates / sync worker
 * edge functions all fall through this RPC, so every read of Xero/Zoho
 * data was failing with "Couldn't reach Xero" in the portal.
 *
 * Fix: qualify all column references inside the SELECT with the table
 * alias `c` so the OUT parameter never collides.
 */
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
  SELECT c.id, c.access_token_secret_id, c.refresh_token_secret_id, c.token_expires_at,
         c.external_org_id, c.external_region
    INTO v_conn_id, v_access_sid, v_refresh_sid, v_expires_at, v_org_id, v_region
    FROM public.accounting_connections AS c
   WHERE c.tenant_id = p_tenant_id AND c.provider = p_provider AND c.status = 'active'
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

REVOKE ALL ON FUNCTION public.accounting_get_tokens(UUID, public.accounting_provider) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_get_tokens(UUID, public.accounting_provider) TO service_role;
