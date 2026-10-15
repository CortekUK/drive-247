-- Vercel credentials for the custom-domain edge functions.
--
-- The project is at Supabase's 100-secret limit, so these live in Vault
-- instead of Edge Function secrets: one Vault secret, `vercel_custom_domains`,
-- holding JSON {token, team_id, booking_project, portal_project}. It is
-- created separately (never in the repo):
--
--   select vault.create_secret('<json>', 'vercel_custom_domains', 'Custom domain automation');
--
-- Only the service role (the edge functions) can read it.

CREATE OR REPLACE FUNCTION public.custom_domain_vercel_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT decrypted_secret::jsonb
  FROM vault.decrypted_secrets
  WHERE name = 'vercel_custom_domains'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.custom_domain_vercel_config() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_domain_vercel_config() TO service_role;
