-- Turn RLS on for `vehicles` — and make it mean something first.
--
-- ── the state this replaces ─────────────────────────────────────────────────
--
-- RLS was DISABLED, and ten policies sat inert behind it. Five were unsafe, so
-- simply enabling RLS would have changed almost nothing while creating the
-- appearance of protection:
--
--   "Allow all operations for app users"  ALL / public / USING (true)
--       — every read and write, for everyone, including anonymous callers.
--   allow_all_select / _insert / _update / _delete
--       — public, gated only on `auth.uid() IS NOT NULL`, so ANY signed-in
--         user of this project (a booking-site customer included) could read,
--         modify or DELETE any tenant's vehicles.
--
-- ── what stays ──────────────────────────────────────────────────────────────
--
-- The four `authenticated` policies and `tenant_isolation_vehicles`, all of
-- which are already scoped `tenant_id = get_user_tenant_id() OR
-- is_super_admin()`. They were written correctly and never enforced.
--
-- ── the public read, and why it is not scoped to show_on_website ────────────
--
-- The customer website reads vehicles ANONYMOUSLY, so a public SELECT policy is
-- required or every tenant's fleet page and booking widget goes blank.
--
-- It deliberately does NOT require `show_on_website`. Checkout resolves a
-- vehicle BY ID with the browser client (see booking/checkout/page.tsx), so a
-- vehicle hidden from marketing after a customer started a booking would break
-- their checkout. `show_on_website` is a marketing filter applied in the
-- queries, not a security boundary — hiding a car from the fleet page is not a
-- claim that its existence is a secret.
--
-- What it DOES exclude is disposed and sold stock, which was publicly readable
-- before and is of no use to anyone.
--
-- Service role bypasses RLS, so edge functions and the e-sign route (which uses
-- SUPABASE_SERVICE_ROLE_KEY) are unaffected.
--
-- ── tested before applying ──────────────────────────────────────────────────
--
-- Both roles were exercised against live data inside a rolled-back transaction:
--   anon:     reads 484 of 495 (the 11 disposed are gone), INSERT / UPDATE /
--             DELETE all blocked, and a hidden vehicle is still readable by id.
--   operator: reads their own 8, can update their own, and CANNOT update or
--             delete another tenant's vehicle.

drop policy if exists "Allow all operations for app users" on public.vehicles;
drop policy if exists "allow_all_select" on public.vehicles;
drop policy if exists "allow_all_insert" on public.vehicles;
drop policy if exists "allow_all_update" on public.vehicles;
drop policy if exists "allow_all_delete" on public.vehicles;

drop policy if exists "public_can_read_bookable_vehicles" on public.vehicles;
create policy "public_can_read_bookable_vehicles"
  on public.vehicles for select to anon, authenticated
  using (coalesce(status, '') not in ('Disposed', 'Sold'));

alter table public.vehicles enable row level security;
