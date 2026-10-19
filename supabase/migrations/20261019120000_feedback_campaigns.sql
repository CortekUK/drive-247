-- Feedback campaigns (Ghulam, Oct 19 2026): each campaign is one round of the
-- portal's "ask every operator on their next login" prompt, with its own
-- feedback and its own list of who answered.
--
-- No portal change: starting a campaign sets tenant_feedback_settings.
-- force_login_triggered_at (the prompt's existing trigger), ending it clears
-- that, and a trigger tags feedback filed from the prompt (source = 'forced')
-- with the live campaign.

create table if not exists public.feedback_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_campaigns_dates check (ended_at is null or ended_at >= started_at)
);

-- One live campaign at a time: the prompt has a single trigger timestamp.
create unique index if not exists feedback_campaigns_one_live
  on public.feedback_campaigns ((true)) where ended_at is null;

alter table public.feedback_campaigns enable row level security;

drop policy if exists "Super admins manage feedback campaigns" on public.feedback_campaigns;
create policy "Super admins manage feedback campaigns" on public.feedback_campaigns
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

alter table public.tenant_feedback
  add column if not exists campaign_id uuid references public.feedback_campaigns(id) on delete set null;
create index if not exists tenant_feedback_campaign_id_idx on public.tenant_feedback (campaign_id);

-- Security definer: operators filing feedback cannot read the campaigns table.
create or replace function public.tag_feedback_campaign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'forced' and new.campaign_id is null then
    select c.id into new.campaign_id
    from public.feedback_campaigns c
    where c.ended_at is null
    order by c.started_at desc
    limit 1;
  end if;
  return new;
end
$$;

drop trigger if exists trg_tag_feedback_campaign on public.tenant_feedback;
create trigger trg_tag_feedback_campaign
  before insert on public.tenant_feedback
  for each row execute function public.tag_feedback_campaign();

-- The round already running (triggered 2026-08-11) becomes the first campaign,
-- still live, so nothing changes for operators; its one forced reply is tagged.
insert into public.feedback_campaigns (name, started_at)
select 'August feedback round', s.force_login_triggered_at
from public.tenant_feedback_settings s
where s.force_login_triggered_at is not null
  and not exists (select 1 from public.feedback_campaigns)
limit 1;

update public.tenant_feedback f
set campaign_id = c.id
from public.feedback_campaigns c
where f.source = 'forced' and f.campaign_id is null
  and f.created_at >= c.started_at and (c.ended_at is null or f.created_at <= c.ended_at);
