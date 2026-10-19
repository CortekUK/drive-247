-- Multi Chat §1 (security): empty the plaintext Twilio secret columns and
-- forbid writing them again.
--
-- Precondition: 20261019160100_multichat_sec_twilio_secrets_vault.sql applied,
-- and every edge function that reads Twilio credentials redeployed to read
-- through _shared/twilio-secrets.ts (Vault). Done 2026-10-19 before this ran.
--
-- The columns are kept (empty) rather than dropped so this stays reversible and
-- so `select('*')` on tenants in older clients keeps working. The CHECK means a
-- stale function, script or SQL session that tries to write a token back into
-- plaintext fails loudly instead of silently re-opening the leak.
--
-- Rollback: 20261019160200_multichat_sec_twilio_plaintext_cleared.rollback.sql.txt
-- APPLIED to production 2026-10-19.

BEGIN;

-- Re-sync first: anything written to plaintext between the Vault copy and the
-- function redeploy (a reconnect in that window) must not be lost.
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

UPDATE public.tenants
   SET twilio_auth_token = NULL, twilio_api_key_secret = NULL
 WHERE twilio_auth_token IS NOT NULL OR twilio_api_key_secret IS NOT NULL;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_twilio_secrets_not_plaintext
  CHECK (twilio_auth_token IS NULL AND twilio_api_key_secret IS NULL);

COMMENT ON COLUMN public.tenants.twilio_auth_token IS
  'DEPRECATED, always NULL (CHECK tenants_twilio_secrets_not_plaintext). The token is in Vault: twilio_auth_token_vault_id.';
COMMENT ON COLUMN public.tenants.twilio_api_key_secret IS
  'DEPRECATED, always NULL (CHECK tenants_twilio_secrets_not_plaintext). The secret is in Vault: twilio_api_key_secret_vault_id.';

COMMIT;
