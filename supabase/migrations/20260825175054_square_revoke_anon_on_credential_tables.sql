-- Applied to PRODUCTION (hviqoaokxvlancmftwuo). Recovered and md5-verified against
-- supabase_migrations.schema_migrations so this file and the live schema cannot drift.
-- The version prefix matches what prod recorded, so the CLI treats prod as up to date.
-- STILL TO APPLY TO STAGING (ksmreaadhbirzakkxqrq), which is behind.

-- Defence in depth. RLS already blocks anon (no anon policy exists), but a
-- default table grant means one careless future policy is all that stands
-- between the public anon key and Vault secret ids. Remove the grant entirely so
-- the credential tables are unreachable by construction, not by policy.
--
-- Deliberately NOT applied to public.payments: anon holds a TABLE-level grant
-- there, and PostgreSQL documents that revoking a COLUMN privilege from a
-- table-level holder has no effect — that mitigation would be a silent no-op.
-- The rule that protects payments is different: never store a Square payment-link
-- URL (a bearer link) in a payments column.

REVOKE ALL ON public.square_connections    FROM anon;
REVOKE ALL ON public.square_oauth_state    FROM anon, authenticated;
REVOKE ALL ON public.square_webhook_events FROM anon, authenticated;

-- authenticated keeps SELECT on square_connections only via the RLS policy +
-- the secret-free view; it never needs write access from the client.
REVOKE INSERT, UPDATE, DELETE ON public.square_connections FROM authenticated;
