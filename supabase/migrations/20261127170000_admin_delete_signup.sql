-- APPLIED to staging 2026-11-27 (csjouxrkblpsoihyejel). Production: at the relay.
-- Super admin → Retention → Signups: a Delete button on each row (Haris,
-- 2026-11-27). Test signups and dead leads piled up in the list with no way to
-- clear them short of SQL.
--
-- One call removes one row of admin_signups():
--
--   * a lead (no account yet, p_lead_id): every signup_leads row for that
--     email, so a person who restarted the form does not reappear;
--   * an account with no company (p_auth_user_id): its lead rows, signup
--     attempts and the login itself; signup_attribution, finish-later tokens
--     and chat rows go with the login (ON DELETE CASCADE).
--
-- What it refuses, so the button cannot do more than it says:
--
--   * a signup whose company exists: deleting a company has to cancel its
--     Stripe subscription first, which only admin-delete-tenant does. The page
--     opens that tool for those rows instead;
--   * a login that is also a portal user or a customer login somewhere: that
--     person uses it for more than this signup;
--   * a login that did not come from the drive-247.com signup.
--
-- SECURITY DEFINER, super admins only, like admin_signups().

create or replace function public.admin_delete_signup(
  p_auth_user_id uuid default null,
  p_lead_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_email text;
  v_meta jsonb;
  v_tenant uuid;
  v_leads integer := 0;
  v_attempts integer := 0;
  v_users integer := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Super admin access required' using errcode = '42501';
  end if;

  if (p_auth_user_id is null) = (p_lead_id is null) then
    raise exception 'Pass exactly one of p_auth_user_id or p_lead_id' using errcode = '22023';
  end if;

  -- ── A lead: no account exists ──────────────────────────────────────────
  if p_lead_id is not null then
    select email into v_email from signup_leads where id = p_lead_id and auth_user_id is null;
    if not found then
      raise exception 'This signup is already gone' using errcode = 'P0002';
    end if;

    if v_email is null then
      delete from signup_leads where id = p_lead_id;
    else
      delete from signup_leads where auth_user_id is null and lower(email) = lower(v_email);
    end if;
    get diagnostics v_leads = row_count;

    return jsonb_build_object('leads', v_leads, 'attempts', 0, 'logins', 0);
  end if;

  -- ── An account ─────────────────────────────────────────────────────────
  select u.email::text, u.raw_app_meta_data->'d247_signup'
    into v_email, v_meta
    from auth.users u
   where u.id = p_auth_user_id;

  if not found then
    raise exception 'This signup is already gone' using errcode = 'P0002';
  end if;

  if v_meta is null or jsonb_typeof(v_meta) <> 'object' then
    raise exception 'This login did not come from the drive-247.com signup' using errcode = '42501';
  end if;

  v_tenant := nullif(v_meta->>'tenantId', '')::uuid;
  if v_tenant is not null and exists (select 1 from tenants where id = v_tenant) then
    raise exception 'This signup has a company. Delete the company instead, so its Stripe subscription is cancelled first'
      using errcode = '42501';
  end if;

  if exists (select 1 from app_users where auth_user_id = p_auth_user_id) then
    raise exception 'This login is also a portal user, so it was not deleted' using errcode = '42501';
  end if;

  if exists (select 1 from customer_users where auth_user_id = p_auth_user_id) then
    raise exception 'This login is also a customer login, so it was not deleted' using errcode = '42501';
  end if;

  delete from signup_leads
   where auth_user_id = p_auth_user_id
      or (v_email is not null and lower(email) = lower(v_email));
  get diagnostics v_leads = row_count;

  delete from signup_attempts where auth_user_id = p_auth_user_id;
  get diagnostics v_attempts = row_count;

  delete from auth.users where id = p_auth_user_id;
  get diagnostics v_users = row_count;

  return jsonb_build_object('leads', v_leads, 'attempts', v_attempts, 'logins', v_users);
end;
$function$;

revoke all on function public.admin_delete_signup(uuid, uuid) from public, anon;
grant execute on function public.admin_delete_signup(uuid, uuid) to authenticated;

comment on function public.admin_delete_signup(uuid, uuid) is
  'Super admin: delete one Signups row (a lead, or a signup login with no company). Refuses companies, portal users and customer logins.';
