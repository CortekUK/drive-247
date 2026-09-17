-- Stage 4 — the views, which row-level security does not reach on its own.
--
-- NOT APPLIED. Read docs/trax/db-isolation-remediation.md §2 first.
--
-- A view runs with the rights of its OWNER unless `security_invoker` is set. All
-- 24 views in `public` are owned by `postgres`, and 18 of them have no
-- `security_invoker` option, so they read their base tables as a superuser and
-- ignore whatever policies stages 1–3 put on those tables. Sixteen of those are
-- also selectable by `anon`.
--
-- Verified on 2026-09-18 (catalogue read, no rows):
--   anon-selectable, owner rights, tenant-scoped:
--     rental_extension_totals, v_tenant_readiness, view_aging_receivables,
--     view_customer_statements, view_fines_export, view_owner_revenue,
--     view_payments_export, view_pl_by_vehicle, view_pl_consolidated,
--     view_rentals_export
--   anon-selectable, owner rights, no tenant column but reading tenant tables:
--     feature_announcement_stats, v_customer_credit, v_global_blacklist_details,
--     v_payment_remaining, v_rental_credit, vehicle_pnl_rollup
--
-- Two changes per view:
--   1. `security_invoker = on` so the caller's policies apply to the base tables.
--   2. revoke SELECT from `anon`, because no public page reads any of them; the
--      consumers are the portal (a signed-in staff session) and the customer
--      portal (a signed-in customer session).
--
-- Requires PostgreSQL 15 or later. Check first:
--   show server_version;
--
-- ORDER MATTERS: apply stages 1–3 before this one. With `security_invoker = on`
-- and no policy on a base table, the view returns nothing for everyone except the
-- service role.

begin;

-- ── 1. Make views respect the caller's policies ─────────────────────────────
alter view public.rental_extension_totals        set (security_invoker = on);
alter view public.v_customer_credit              set (security_invoker = on);
alter view public.v_global_blacklist_details     set (security_invoker = on);
alter view public.v_payment_remaining            set (security_invoker = on);
alter view public.v_rental_credit                set (security_invoker = on);
alter view public.v_tenant_readiness             set (security_invoker = on);
alter view public.vehicle_pnl_rollup             set (security_invoker = on);
alter view public.view_aging_receivables         set (security_invoker = on);
alter view public.view_customer_statements       set (security_invoker = on);
alter view public.view_fines_export              set (security_invoker = on);
alter view public.view_owner_revenue             set (security_invoker = on);
alter view public.view_payments_export           set (security_invoker = on);
alter view public.view_pl_by_vehicle             set (security_invoker = on);
alter view public.view_pl_consolidated           set (security_invoker = on);
alter view public.view_rentals_export            set (security_invoker = on);
alter view public.feature_announcement_stats     set (security_invoker = on);

-- ── 2. Take the anonymous key off them ──────────────────────────────────────
-- None of these is read by a public page. Verified by scanning apps/booking/src:
-- the only view it reads is rental_extension_totals, from the signed-in customer
-- portal (app/(customer-portal)/portal/bookings/[id]/page.tsx and
-- hooks/use-customer-auto-extension.ts), which keeps SELECT as `authenticated`.
revoke select on public.rental_extension_totals    from anon;
revoke select on public.v_customer_credit          from anon;
revoke select on public.v_global_blacklist_details from anon;
revoke select on public.v_payment_remaining        from anon;
revoke select on public.v_rental_credit            from anon;
revoke select on public.v_tenant_readiness         from anon;
revoke select on public.vehicle_pnl_rollup         from anon;
revoke select on public.view_aging_receivables     from anon;
revoke select on public.view_customer_statements   from anon;
revoke select on public.view_fines_export          from anon;
revoke select on public.view_owner_revenue         from anon;
revoke select on public.view_payments_export       from anon;
revoke select on public.view_pl_by_vehicle         from anon;
revoke select on public.view_pl_consolidated       from anon;
revoke select on public.view_rentals_export        from anon;
revoke select on public.feature_announcement_stats from anon;

commit;

-- ── What to re-test after applying ──────────────────────────────────────────
-- Portal, signed in as staff of one account:
--   /insights            view_pl_consolidated, view_pl_by_vehicle, view_aging_receivables
--   /reports             view_payments_export, view_rentals_export, view_fines_export,
--                        view_customer_statements
--   owner revenue page   view_owner_revenue
--   settings/blacklist   v_global_blacklist_details
-- Customer portal, signed in as a customer:
--   /portal/bookings/[id]  rental_extension_totals (auto-extension totals)
-- Each must show that account's figures and nothing else. A view that returns
-- zero rows after this stage means a base table is missing a policy for that
-- caller — fix the base table, do not turn security_invoker back off.
--
-- ── Verification ────────────────────────────────────────────────────────────
-- select c.relname,
--        coalesce((select option_value from pg_options_to_table(c.reloptions)
--                  where option_name='security_invoker'), 'not set') as security_invoker,
--        has_table_privilege('anon', c.oid, 'SELECT') as anon_select
--   from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and c.relkind in ('v','m') order by c.relname;
