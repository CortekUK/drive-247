-- Multi Chat §1 (security): Twilio secrets move from plaintext tenants columns
-- into Supabase Vault.
--
-- WHY: tenants.twilio_auth_token and tenants.twilio_api_key_secret were plain
-- TEXT. 20260723090000_lock_down_tenants_rls.sql hid them from `anon` only;
-- `authenticated` still holds table-level SELECT and `tenants_public_select`
-- is USING (true), so ANY signed-in session — including a renter who registered
-- on any tenant's booking site — could read every tenant's Twilio Auth Token
-- (7 tenants) and API key secret (3). Verified in production 2026-10-19.
--
-- AFTER: tenants keeps only UUID references into vault.secrets. Plaintext is
-- reachable only through SECURITY DEFINER RPCs that are executable by
-- service_role alone (the same pattern as tesla_*_tokens and accounting
-- connections). Edge functions read through _shared/twilio-secrets.ts.
--
-- This migration is ADDITIVE: it copies the current values into Vault and
-- leaves the plaintext columns populated, so the functions that are still
-- deployed keep working until the new ones are live. The follow-up migration
-- 20261019160200_multichat_sec_twilio_plaintext_cleared.sql empties the
-- plaintext columns and forbids writing them again.
--
-- Rollback: 20261019160100_multichat_sec_twilio_secrets_vault.rollback.sql.txt
-- APPLIED to production 2026-10-19.

BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS twilio_auth_token_vault_id uuid,
  ADD COLUMN IF NOT EXISTS twilio_api_key_secret_vault_id uuid;

COMMENT ON COLUMN public.tenants.twilio_auth_token_vault_id IS
  'vault.secrets id of the tenant''s Twilio Auth Token. Read via twilio_get_secrets() (service_role only).';
COMMENT ON COLUMN public.tenants.twilio_api_key_secret_vault_id IS
  'vault.secrets id of the tenant''s Twilio API key secret (Voice SDK tokens). Read via twilio_get_secrets() (service_role only).';

-- p_kind: 'auth_token' | 'api_key_secret'. A NULL or empty p_value deletes it.
CREATE OR REPLACE FUNCTION public.twilio_set_secret(p_tenant_id uuid, p_kind text, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_existing uuid;
  v_new uuid;
BEGIN
  IF p_kind = 'auth_token' THEN
    SELECT twilio_auth_token_vault_id INTO v_existing FROM public.tenants WHERE id = p_tenant_id;
  ELSIF p_kind = 'api_key_secret' THEN
    SELECT twilio_api_key_secret_vault_id INTO v_existing FROM public.tenants WHERE id = p_tenant_id;
  ELSE
    RAISE EXCEPTION 'twilio_set_secret: unknown kind %', p_kind;
  END IF;

  IF p_value IS NULL OR p_value = '' THEN
    v_new := NULL;
    IF v_existing IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_existing; END IF;
  ELSIF v_existing IS NULL THEN
    SELECT vault.create_secret(p_value, 'twilio_' || p_kind || '_' || p_tenant_id::text || '_' || gen_random_uuid()::text)
      INTO v_new;
  ELSE
    PERFORM vault.update_secret(v_existing, p_value);
    v_new := v_existing;
  END IF;

  IF p_kind = 'auth_token' THEN
    UPDATE public.tenants SET twilio_auth_token_vault_id = v_new WHERE id = p_tenant_id;
  ELSE
    UPDATE public.tenants SET twilio_api_key_secret_vault_id = v_new WHERE id = p_tenant_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.twilio_get_secrets(p_tenant_id uuid)
RETURNS TABLE(auth_token text, api_key_secret text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_auth uuid;
  v_key uuid;
BEGIN
  SELECT twilio_auth_token_vault_id, twilio_api_key_secret_vault_id
    INTO v_auth, v_key
    FROM public.tenants WHERE id = p_tenant_id;
  RETURN QUERY SELECT
    (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = v_auth),
    (SELECT s.decrypted_secret FROM vault.decrypted_secrets s WHERE s.id = v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.twilio_set_secret(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.twilio_get_secrets(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.twilio_set_secret(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.twilio_get_secrets(uuid) TO service_role;

-- The vault-id columns are not secret, but nothing client-side needs them.
REVOKE SELECT (twilio_auth_token_vault_id, twilio_api_key_secret_vault_id) ON public.tenants FROM anon;

-- Copy what is there today.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, twilio_auth_token, twilio_api_key_secret FROM public.tenants
            WHERE twilio_auth_token IS NOT NULL OR twilio_api_key_secret IS NOT NULL LOOP
    IF r.twilio_auth_token IS NOT NULL THEN
      PERFORM public.twilio_set_secret(r.id, 'auth_token', r.twilio_auth_token);
    END IF;
    IF r.twilio_api_key_secret IS NOT NULL THEN
      PERFORM public.twilio_set_secret(r.id, 'api_key_secret', r.twilio_api_key_secret);
    END IF;
  END LOOP;
END $$;

COMMIT;
