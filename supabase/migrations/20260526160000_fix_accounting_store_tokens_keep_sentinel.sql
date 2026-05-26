/**
 * Fix: accounting_store_tokens() now respects the `__keep__` sentinel.
 *
 * The refresh-accounting-tokens edge function passes `__keep__` for the
 * external_org_id when it's only refreshing tokens (not the org metadata).
 * The original SQL function ignored the sentinel and wrote `__keep__`
 * literally into the column, breaking every subsequent provider call
 * (Xero-tenant-id: __keep__ → 403 AuthenticationUnsuccessful).
 *
 * Fix: when the caller passes `__keep__` for external_org_id, fall back
 * to the column's existing value via COALESCE — matching the existing
 * NULL-passthrough behaviour for external_org_name and external_region.
 */
CREATE OR REPLACE FUNCTION public.accounting_store_tokens(
  p_tenant_id uuid,
  p_provider accounting_provider,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamp with time zone,
  p_external_org_id text,
  p_external_org_name text DEFAULT NULL::text,
  p_external_region text DEFAULT NULL::text,
  p_connected_by uuid DEFAULT NULL::uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'extensions'
AS $function$
DECLARE
  v_existing_id UUID;
  v_existing_access  UUID;
  v_existing_refresh UUID;
  v_access_sid  UUID;
  v_refresh_sid UUID;
  v_secret_label_access  TEXT := p_provider::text || '_access_' || p_tenant_id::text || '_' || extract(epoch from now())::text;
  v_secret_label_refresh TEXT := p_provider::text || '_refresh_' || p_tenant_id::text || '_' || extract(epoch from now())::text;
BEGIN
  SELECT id, access_token_secret_id, refresh_token_secret_id
    INTO v_existing_id, v_existing_access, v_existing_refresh
    FROM public.accounting_connections
   WHERE tenant_id = p_tenant_id AND provider = p_provider AND status = 'active'
   LIMIT 1;

  IF v_existing_access IS NULL THEN
    SELECT vault.create_secret(p_access_token, v_secret_label_access) INTO v_access_sid;
  ELSE
    PERFORM vault.update_secret(v_existing_access, p_access_token);
    v_access_sid := v_existing_access;
  END IF;

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
           -- Respect the `__keep__` sentinel — refresh-accounting-tokens
           -- uses it to mean "don't change the org metadata, just rotate
           -- the secret". Previously this was written literally.
           external_org_id = CASE
             WHEN p_external_org_id = '__keep__' THEN external_org_id
             ELSE p_external_org_id
           END,
           external_org_name = COALESCE(p_external_org_name, external_org_name),
           external_region = COALESCE(p_external_region, external_region),
           last_error = NULL
     WHERE id = v_existing_id;
  END IF;

  RETURN v_existing_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.accounting_store_tokens(UUID, public.accounting_provider, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, UUID) TO service_role;
