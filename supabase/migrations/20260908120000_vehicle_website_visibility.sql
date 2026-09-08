-- Which of a tenant's vehicles appear on their CUSTOMER WEBSITE.
--
-- ── why a new column, and not `is_featured` ─────────────────────────────────
--
-- The audit assumed `is_featured` existed on `vehicles`. It does not — that
-- column is on `blog_posts`. `vehicles` had no visibility concept at all:
-- `status` is operational (Available / Rented / Disposed) and `is_paused`
-- means off the road, so overloading either would make "hidden from marketing"
-- indistinguishable from "not rentable".
--
-- One boolean is therefore the whole feature. No join table, no CMS copy of
-- vehicle data: the website already reads names, photos and prices from this
-- table, and duplicating them into a CMS record would create a second copy to
-- keep in sync.
--
-- ── the default is the backward-compatibility guarantee ─────────────────────
--
-- `not null default true`. Tenants already have vehicles on their websites, so
-- a default of false would have emptied every fleet page on deploy. All 495
-- existing rows keep exactly the visibility they had.
--
-- ── what it does NOT affect ─────────────────────────────────────────────────
--
-- Customer-facing browse surfaces only. The operator Portal, internal booking,
-- availability, existing rentals and signed agreements never consult it — a
-- hidden vehicle is hidden from marketing, not taken off the road.
alter table public.vehicles
  add column if not exists show_on_website boolean not null default true;

comment on column public.vehicles.show_on_website is
  'Does this vehicle appear on the tenant CUSTOMER WEBSITE? Configuration only: it never affects the operator Portal, internal booking, availability or an in-flight reservation. Defaults TRUE so every existing vehicle keeps the visibility it had before the column existed.';

-- Partial: every read is "the visible ones for this tenant", so the hidden
-- rows do not need to be in the index.
create index if not exists vehicles_website_visible_idx
  on public.vehicles (tenant_id, show_on_website)
  where show_on_website;
