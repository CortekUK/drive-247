-- =============================================================================
-- dev_signup_test_emails — the developer hub's list of TEST signup addresses.
--
-- apps/developer (the future developer.drive247.com) keeps this list on its
-- Onboarding tab. A signup that STARTS with an address on this list, switched
-- on, locks the TEST Stripe account (signup-begin / signup-begin-oauth, through
-- supabase/functions/_shared/signup-rehearsal.ts). Every other address, i.e.
-- every real customer, is untouched and pays on live as before.
--
-- Only the service role writes it (the `dev-signup-rehearsal` edge function,
-- which checks for a super admin first). Super admins may read it.
--
-- Applied through the Management API, never `supabase db push`.
-- =============================================================================

create table if not exists public.dev_signup_test_emails (
  id                uuid        primary key default gen_random_uuid(),
  email             text        not null,
  enabled           boolean     not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid        references public.app_users(id) on delete set null,
  updated_at        timestamptz not null default now(),
  last_reset_at     timestamptz,
  last_reset_result jsonb,
  constraint dev_signup_test_emails_email_key unique (email),
  constraint dev_signup_test_emails_email_normalised check (email = lower(btrim(email))),
  constraint dev_signup_test_emails_email_shape check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

comment on table public.dev_signup_test_emails is
  'Developer hub: addresses whose self-serve signup runs on TEST Stripe. Written only by dev-signup-rehearsal.';
comment on column public.dev_signup_test_emails.enabled is
  'Read once, when a signup starts. Off = the address signs up like a real customer (live Stripe).';

create index if not exists dev_signup_test_emails_created_by_idx on public.dev_signup_test_emails (created_by);

drop trigger if exists dev_signup_test_emails_set_updated_at on public.dev_signup_test_emails;
create trigger dev_signup_test_emails_set_updated_at
  before update on public.dev_signup_test_emails
  for each row execute function public.set_updated_at();

alter table public.dev_signup_test_emails enable row level security;

revoke all on public.dev_signup_test_emails from anon, authenticated;
grant select on public.dev_signup_test_emails to authenticated;
grant all on public.dev_signup_test_emails to service_role;

drop policy if exists dev_signup_test_emails_read on public.dev_signup_test_emails;
create policy dev_signup_test_emails_read on public.dev_signup_test_emails
  for select to authenticated
  using (public.is_super_admin());
