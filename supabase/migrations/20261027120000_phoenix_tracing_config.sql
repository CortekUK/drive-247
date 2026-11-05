-- Arize Phoenix tracing for the TRAX edge functions (_shared/phoenix.ts).
--
-- The project is at Supabase's 100-secret limit, so the collector settings
-- live in Vault instead of Edge Function secrets: one Vault secret,
-- `phoenix_tracing`, holding JSON {endpoint, api_key, project?, hide_content?}.
-- It is created separately (never in the repo):
--
--   select vault.create_secret('<json>', 'phoenix_tracing', 'Phoenix tracing for TRAX');
--
-- No secret = tracing off. Only the service role (the edge functions) can read it.

CREATE OR REPLACE FUNCTION public.phoenix_tracing_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT decrypted_secret::jsonb
  FROM vault.decrypted_secrets
  WHERE name = 'phoenix_tracing'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.phoenix_tracing_config() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phoenix_tracing_config() TO service_role;
