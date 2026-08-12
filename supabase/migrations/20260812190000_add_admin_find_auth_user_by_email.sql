-- Look up a single auth user by email, for edge functions running as service_role.
--
-- Replaces the auth.admin.listUsers() scan that admin-create-user relied on to
-- decide whether an email already had a login. That endpoint reads every auth
-- user on the project, so one malformed row anywhere in auth.users (GoTrue
-- scans its token columns into non-nullable Go strings, and a NULL there makes
-- the whole listing 500) took down user creation, password reset, OTP verify
-- and customer signup at once.
--
-- This reads only the row being asked about, so it is unaffected by unrelated
-- rows and does not scale with project size.

create or replace function public.admin_find_auth_user_by_email(p_email text)
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  order by u.created_at
  limit 1;
$$;

-- security definer reads auth.users, so it must never be callable from a browser.
-- EXECUTE is granted to PUBLIC by default — revoke before granting.
revoke all on function public.admin_find_auth_user_by_email(text) from public;
revoke all on function public.admin_find_auth_user_by_email(text) from anon;
revoke all on function public.admin_find_auth_user_by_email(text) from authenticated;
grant execute on function public.admin_find_auth_user_by_email(text) to service_role;

-- One-off repair: normalise the NULLs that caused the outage. GoTrue defaults
-- these to '' but a direct SQL update had set one row's email_change to NULL.
update auth.users
set confirmation_token          = coalesce(confirmation_token, ''),
    email_change                = coalesce(email_change, ''),
    email_change_token_new      = coalesce(email_change_token_new, ''),
    email_change_token_current  = coalesce(email_change_token_current, ''),
    recovery_token              = coalesce(recovery_token, ''),
    phone_change                = coalesce(phone_change, ''),
    phone_change_token          = coalesce(phone_change_token, ''),
    reauthentication_token      = coalesce(reauthentication_token, '')
where confirmation_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or recovery_token is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;
