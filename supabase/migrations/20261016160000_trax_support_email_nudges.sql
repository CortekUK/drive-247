-- "Email the tenant" from the platform support inbox: a no-reply email that points
-- the requester back to the conversation in the portal. One row per email sent,
-- written by the trax-messaging edge function (service role) after the provider
-- accepted it; it drives the cooldown and the "Last emailed" line in Details.
create table if not exists public.trax_support_email_nudges (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.trax_support_tickets(id) on delete cascade,
  sent_by uuid not null,
  recipient text not null,
  provider_id text,
  simulated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists trax_support_email_nudges_ticket_idx on public.trax_support_email_nudges (ticket_id, created_at desc);
alter table public.trax_support_email_nudges enable row level security;
revoke all on public.trax_support_email_nudges from anon, authenticated;
