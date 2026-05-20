-- Move Tesla Fleet tokens from plaintext columns into Supabase Vault.
--
-- Before: tesla_fleet_api_token and tesla_fleet_refresh_token lived as plain
-- TEXT on the tenants table. Service-role read of `tenants` exposed every
-- connected tenant's Tesla credentials in cleartext.
--
-- After: the tenants table stores only UUID references to vault.secrets rows.
-- Plaintext is only retrievable via three RPCs that are GRANTed exclusively to
-- service_role and run SECURITY DEFINER so the edge function never touches the
-- vault schema directly.
--
-- Currently-connected tenants are forcibly disconnected by this migration —
-- their old tokens are already expired and have no refresh token (the offline_access
-- scope bug from Round 1), so there is nothing to migrate. They need to reconnect.

-- 1. Add vault-reference columns
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tesla_fleet_api_token_secret_id UUID,
  ADD COLUMN IF NOT EXISTS tesla_fleet_refresh_token_secret_id UUID;

-- 2. Drop the old plaintext columns (their contents are dead anyway)
ALTER TABLE public.tenants
  DROP COLUMN IF EXISTS tesla_fleet_api_token,
  DROP COLUMN IF EXISTS tesla_fleet_refresh_token;

-- 3. Mark currently-connected tenants as disconnected so they reconnect cleanly
UPDATE public.tenants
   SET integration_tesla_fleet     = false,
       tesla_fleet_token_expires_at = NULL
 WHERE integration_tesla_fleet = true;

-- 4. RPCs — service_role only

CREATE OR REPLACE FUNCTION public.tesla_store_tokens(
  p_tenant_id     UUID,
  p_access_token  TEXT,
  p_refresh_token TEXT,
  p_expires_at    TIMESTAMPTZ
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_access_sid  UUID;
  v_refresh_sid UUID;
  v_existing_access  UUID;
  v_existing_refresh UUID;
BEGIN
  SELECT tesla_fleet_api_token_secret_id, tesla_fleet_refresh_token_secret_id
    INTO v_existing_access, v_existing_refresh
    FROM public.tenants WHERE id = p_tenant_id;

  IF v_existing_access IS NULL THEN
    SELECT vault.create_secret(p_access_token, 'tesla_access_' || p_tenant_id::text)
      INTO v_access_sid;
  ELSE
    PERFORM vault.update_secret(v_existing_access, p_access_token);
    v_access_sid := v_existing_access;
  END IF;

  IF p_refresh_token IS NULL THEN
    v_refresh_sid := v_existing_refresh;  -- keep whatever was there
  ELSIF v_existing_refresh IS NULL THEN
    SELECT vault.create_secret(p_refresh_token, 'tesla_refresh_' || p_tenant_id::text)
      INTO v_refresh_sid;
  ELSE
    PERFORM vault.update_secret(v_existing_refresh, p_refresh_token);
    v_refresh_sid := v_existing_refresh;
  END IF;

  UPDATE public.tenants
     SET integration_tesla_fleet              = true,
         tesla_fleet_api_token_secret_id      = v_access_sid,
         tesla_fleet_refresh_token_secret_id  = v_refresh_sid,
         tesla_fleet_token_expires_at         = p_expires_at
   WHERE id = p_tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tesla_get_tokens(p_tenant_id UUID)
RETURNS TABLE(access_token TEXT, refresh_token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_access_sid  UUID;
  v_refresh_sid UUID;
  v_expires_at  TIMESTAMPTZ;
BEGIN
  SELECT tesla_fleet_api_token_secret_id, tesla_fleet_refresh_token_secret_id, tesla_fleet_token_expires_at
    INTO v_access_sid, v_refresh_sid, v_expires_at
    FROM public.tenants WHERE id = p_tenant_id;

  IF v_access_sid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = v_access_sid),
    CASE WHEN v_refresh_sid IS NOT NULL THEN
      (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = v_refresh_sid)
    END,
    v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.tesla_clear_tokens(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_access_sid  UUID;
  v_refresh_sid UUID;
BEGIN
  SELECT tesla_fleet_api_token_secret_id, tesla_fleet_refresh_token_secret_id
    INTO v_access_sid, v_refresh_sid
    FROM public.tenants WHERE id = p_tenant_id;

  UPDATE public.tenants
     SET integration_tesla_fleet              = false,
         tesla_fleet_api_token_secret_id      = NULL,
         tesla_fleet_refresh_token_secret_id  = NULL,
         tesla_fleet_token_expires_at         = NULL
   WHERE id = p_tenant_id;

  IF v_access_sid  IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_access_sid;  END IF;
  IF v_refresh_sid IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_refresh_sid; END IF;
END;
$$;

-- 5. Lock down execute privileges — only service_role may call these.
REVOKE ALL ON FUNCTION public.tesla_store_tokens(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tesla_get_tokens(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tesla_clear_tokens(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tesla_store_tokens(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.tesla_get_tokens(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.tesla_clear_tokens(UUID) TO service_role;
