-- Feedback campaign exclusions (Ghulam, Oct 19 2026): leave chosen companies
-- out of a campaign.
--
-- Still no portal change. The portal's force prompt asks a user when
-- app_users.feedback_last_prompted_at < tenant_feedback_settings.
-- force_login_triggered_at, so excluding a company stamps its users as already
-- asked for this campaign. Their previous stamps are kept on the exclusion row
-- and put back if the company is included again. Users added to an excluded
-- company while the campaign is live are stamped by a trigger.

create table if not exists public.feedback_campaign_exclusions (
  campaign_id uuid not null references public.feedback_campaigns(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- { app_user_id: previous feedback_last_prompted_at (or null) }
  previous_stamps jsonb not null default '{}'::jsonb,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, tenant_id)
);

alter table public.feedback_campaign_exclusions enable row level security;

drop policy if exists "Super admins read feedback campaign exclusions" on public.feedback_campaign_exclusions;
create policy "Super admins read feedback campaign exclusions" on public.feedback_campaign_exclusions
  for select to authenticated using (public.is_super_admin());

-- Writes go through this function only, so the stamps and the row move together.
create or replace function public.feedback_campaign_set_excluded(p_campaign uuid, p_tenant uuid, p_excluded boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.feedback_campaigns;
  ex public.feedback_campaign_exclusions;
  me uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can change who a campaign asks' using errcode = '42501';
  end if;

  select * into c from public.feedback_campaigns where id = p_campaign;
  if c.id is null then
    raise exception 'Campaign not found' using errcode = 'P0002';
  end if;
  if c.ended_at is not null then
    raise exception 'This campaign has ended' using errcode = '22023';
  end if;

  select id into me from public.app_users where auth_user_id = auth.uid() limit 1;
  select * into ex from public.feedback_campaign_exclusions where campaign_id = p_campaign and tenant_id = p_tenant for update;

  if p_excluded then
    if ex.campaign_id is not null then return; end if;
    insert into public.feedback_campaign_exclusions (campaign_id, tenant_id, previous_stamps, created_by)
    select p_campaign, p_tenant,
           coalesce(jsonb_object_agg(u.id, u.feedback_last_prompted_at), '{}'::jsonb),
           me
    from public.app_users u
    where u.tenant_id = p_tenant
      and (u.feedback_last_prompted_at is null or u.feedback_last_prompted_at < c.started_at);

    update public.app_users u
    set feedback_last_prompted_at = c.started_at
    where u.tenant_id = p_tenant
      and (u.feedback_last_prompted_at is null or u.feedback_last_prompted_at < c.started_at);
  else
    if ex.campaign_id is null then return; end if;
    -- Put back only the stamps we moved and nobody has touched since.
    update public.app_users u
    set feedback_last_prompted_at = (s.value #>> '{}')::timestamptz
    from jsonb_each(ex.previous_stamps) s
    where u.id = s.key::uuid
      and u.feedback_last_prompted_at = c.started_at;

    update public.app_users u
    set feedback_last_prompted_at = null
    where u.tenant_id = p_tenant
      and u.feedback_last_prompted_at = c.started_at
      and not (ex.previous_stamps ? u.id::text);

    delete from public.feedback_campaign_exclusions where campaign_id = p_campaign and tenant_id = p_tenant;
  end if;
end
$$;

revoke all on function public.feedback_campaign_set_excluded(uuid, uuid, boolean) from public, anon;
grant execute on function public.feedback_campaign_set_excluded(uuid, uuid, boolean) to authenticated;

-- New team members of an excluded company are not asked either.
create or replace function public.stamp_excluded_feedback_campaign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  started timestamptz;
begin
  if new.tenant_id is null then return new; end if;
  select c.started_at into started
  from public.feedback_campaign_exclusions e
  join public.feedback_campaigns c on c.id = e.campaign_id
  where e.tenant_id = new.tenant_id and c.ended_at is null
  limit 1;
  if started is not null and (new.feedback_last_prompted_at is null or new.feedback_last_prompted_at < started) then
    new.feedback_last_prompted_at := started;
  end if;
  return new;
end
$$;

drop trigger if exists trg_stamp_excluded_feedback_campaign on public.app_users;
create trigger trg_stamp_excluded_feedback_campaign
  before insert on public.app_users
  for each row execute function public.stamp_excluded_feedback_campaign();
