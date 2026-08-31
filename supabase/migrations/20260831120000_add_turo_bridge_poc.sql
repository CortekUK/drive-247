-- Drive247 Turo Bridge (PoC) — landing tables for the Chrome extension in
-- turo-bridge-poc/extension.
--
-- WHY A TOKEN TABLE AND NOT A SUPABASE SESSION
-- The operator running the extension is signed into turo.com, not into Drive247.
-- There is no Supabase JWT in that browser context to present, so
-- `turo-bridge-ingest` runs with verify_jwt = false and the pairing token in the
-- request body is the entire credential. The client never names a tenant — the
-- edge function resolves tenant_id from the token — so a forged tenant is not
-- expressible in the wire format.
--
-- MINT A PAIRING TOKEN (run once per demo machine, as service_role / SQL editor):
--
--   insert into public.turo_bridge_tokens (tenant_id, label, token)
--   select id, 'demo laptop', 'd247_turo_' || encode(gen_random_bytes(32), 'hex')
--     from public.tenants where slug = 'test'
--   returning token;
--
-- The returned value is 74 characters ('d247_turo_' + 64 hex) and is what gets
-- pasted into the extension popup.

-- ---------------------------------------------------------------- tokens ----

create table if not exists public.turo_bridge_tokens (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  token       text not null unique,
  label       text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at  timestamptz
);

create index if not exists idx_turo_bridge_tokens_tenant
  on public.turo_bridge_tokens (tenant_id);

alter table public.turo_bridge_tokens enable row level security;

-- Deliberately NO policies. RLS with zero policies denies every role subject to
-- it; service_role bypasses RLS, so the edge function is the only reader. The
-- explicit REVOKE is belt-and-braces against Supabase's default grants, which
-- would otherwise hand anon/authenticated table privileges on a brand new table.
revoke all on public.turo_bridge_tokens from anon, authenticated;

-- ---------------------------------------------------------- reservations ----

create table if not exists public.turo_bridge_reservations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,

  -- Turo's own id for the trip. Text, not bigint: Turo has used both numeric
  -- ids and uuid-ish strings across its APIs and we do not control which one
  -- the feed hands back.
  reservation_id text not null,

  -- 'fixture' rows come from the extension's bundled sample. Keeping them
  -- permanently distinguishable in the database is the point of the CHECK — a
  -- demo that cannot tell you which of the two it just did is worth little.
  source         text not null default 'turo' check (source in ('turo', 'fixture')),

  guest_name     text,
  vehicle_label  text,
  starts_at      timestamptz,
  ends_at        timestamptz,

  -- OUR sync state, not Turo's trip state. Turo's own status is preserved on
  -- raw->>'__turo_status'.
  status         text not null default 'synced' check (status in ('synced', 'imported', 'failed')),

  total_amount   numeric(12,2),
  currency       text,

  -- The untouched Turo trip. The feed is undocumented and its shape is a
  -- documented guess, so the whole object always travels along: guessing a
  -- column wrong costs one NULL, not the reservation.
  raw            jsonb not null default '{}'::jsonb,

  synced_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Idempotency. This is what makes "just click Sync again" the correct
  -- recovery when the MV3 service worker is killed mid-flight.
  constraint turo_bridge_reservations_tenant_reservation_key
    unique (tenant_id, reservation_id)
);

create index if not exists idx_turo_bridge_reservations_tenant_synced
  on public.turo_bridge_reservations (tenant_id, synced_at desc);

alter table public.turo_bridge_reservations enable row level security;

drop policy if exists "turo_bridge_reservations_select_own_tenant"
  on public.turo_bridge_reservations;
create policy "turo_bridge_reservations_select_own_tenant"
  on public.turo_bridge_reservations
  for select
  to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());

-- Writes come only from the edge function (service_role, which bypasses RLS).
-- The portal page is read-only by design.
revoke all on public.turo_bridge_reservations from anon;
