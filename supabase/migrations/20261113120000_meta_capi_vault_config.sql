-- Meta Conversions API config for the StartTrial signup event
-- (supabase/functions/_shared/meta-capi.ts, called by signup-provision).
--
-- The project is at Supabase's 100-secret limit, so the token lives in Vault,
-- created separately (never in the repo):
--
--   select vault.create_secret('<token>', 'meta_capi_token', 'Meta CAPI token ...');
--   -- optional, only while testing; delete it to go live:
--   select vault.create_secret('<TESTxxxx>', 'meta_capi_test_event_code', 'Meta test events code');
--
-- Only the service role (the edge functions) can read it.

CREATE OR REPLACE FUNCTION public.meta_capi_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'meta_capi_token' LIMIT 1),
    'test_event_code', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'meta_capi_test_event_code' LIMIT 1)
  );
$$;
REVOKE ALL ON FUNCTION public.meta_capi_config() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_capi_config() TO service_role;
