-- Platform Terms of Service acceptance, recorded against the OPERATOR (tenant).
--
-- WHY NEW COLUMNS AND NOT THE EXISTING ONES.
-- tenants already carries terms_version / privacy_policy_version /
-- policies_accepted_at, and policy_acceptances exists as a table. All of that is
-- a DIFFERENT system: it is the tenant's OWN customer-facing policy, accepted by
-- the tenant's portal STAFF (policy_acceptances is keyed on app_user_id).
-- Critically, apps/portal/src/app/(dashboard)/settings/page.tsx RESETS
-- policies_accepted_at to NULL whenever a version string is edited — so anything
-- stored there would be silently wiped, and reusing it would corrupt the staff
-- gate that login/page.tsx:82 depends on.
--
-- These columns record something else entirely: the rental operator accepting
-- Drive247's platform contract at the moment they commit to paying.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS platform_tos_accepted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS platform_tos_version           TEXT,
  ADD COLUMN IF NOT EXISTS platform_tos_accepted_by       UUID,
  ADD COLUMN IF NOT EXISTS platform_tos_accepted_by_email TEXT,
  ADD COLUMN IF NOT EXISTS platform_tos_accepted_ip       TEXT;

COMMENT ON COLUMN public.tenants.platform_tos_accepted_at IS
  'When this OPERATOR accepted the Drive247 platform Terms of Service. Distinct from policies_accepted_at (the tenant''s own staff accepting the tenant''s own policy, which settings resets on every version edit). Written only by service_role. Write-once: never overwrite a non-null value.';

COMMENT ON COLUMN public.tenants.platform_tos_version IS
  'Version of the platform ToS accepted. Derived SERVER-side from supabase/functions/_shared/platform-tos.ts, never taken from the request body.';

COMMENT ON COLUMN public.tenants.platform_tos_accepted_by IS
  'app_users.id of the staff member who accepted. Deliberately NOT a foreign key so the audit record survives deletion of the user.';

COMMENT ON COLUMN public.tenants.platform_tos_accepted_by_email IS
  'Email captured at acceptance time, so the record stays readable if the app_users row is later deleted or the address changes.';

COMMENT ON COLUMN public.tenants.platform_tos_accepted_ip IS
  'Client IP at acceptance (x-forwarded-for), for the evidentiary record.';

-- NO "GRANT SELECT (...) TO anon" — deliberately.
--
-- anon holds 230 COLUMN-level grants on tenants and NO table-level grant, so a
-- column that is never granted is simply unreadable by anon. These columns are
-- read only by service_role (edge functions) and by `authenticated`, which
-- already holds a table-level SELECT.
--
-- They must NEVER be added to TENANT_CORE_COLUMNS in
-- apps/portal/src/contexts/TenantContext.tsx. That select runs on the ANON key
-- at login (there is no session yet); Postgres refuses the WHOLE ROW when one
-- selected column is ungranted, so adding an ungranted column there takes down
-- login and branding for every tenant. That has already happened once, with
-- customer_theme_mode.
