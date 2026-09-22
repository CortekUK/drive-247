-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ NOT APPLIED — requires approval.                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Integration subscriptions (docs/integration-billing/build-spec.md): two NEW
-- tables, nothing else. Re-running is harmless: everything is IF NOT EXISTS or
-- DROP-then-CREATE.
--
--   integration_catalog_v2               which integrations are premium, their
--                                        monthly price, first month free, and
--                                        the hide / beta / not-available flags
--                                        (D4). Global, owned by super admins.
--   tenant_integration_subscriptions_v2  one row per subscribe (D5). Written by
--                                        the integration-billing edge function
--                                        only.
--
-- ADDITIVE ONLY. No existing table, column, constraint, trigger or function is
-- changed, and nothing is added to `public.tenants` (anon holds column-level
-- grants there; a grantless new column takes every booking site down).
--
-- SHIPPING THE CODE FIRST IS SAFE. Until this runs the portal reads no catalog
-- and shows its defaults (every integration free and visible, except Inshur,
-- Turo Sync and CheckMyDriver, which wear the crown as "coming soon"), and
-- every Subscribe is refused ("coming soon" or "not set up yet") without
-- calling Stripe.
--
-- Depends on helpers that already exist in production: is_portal_staff()
-- (ops/setup_checklist_items.sql), is_super_admin() and get_user_tenant_id().

-- ONE TRANSACTION: all of it lands, or none of it does. The foreign keys below
-- briefly lock `tenants` and `app_users`; the lock timeout makes the script
-- fail fast (and it is safe to re-run) rather than queue behind a long write
-- and hold up the booking sites while it waits.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. integration_catalog_v2
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.integration_catalog_v2 (
  -- The board card's stable key (INTEGRATION_KEYS in
  -- apps/portal/src/lib/integration-billing/catalog.ts). A key the portal does
  -- not know is ignored, so a typo here hides nothing and charges nothing.
  integration_key     text PRIMARY KEY
                      CHECK (integration_key ~ '^[a-z][a-z0-9_]{1,40}$'),

  is_premium          boolean NOT NULL DEFAULT false,

  -- Minor units (cents). USD only for now: the price is added to the tenant's
  -- platform subscription, and Stripe needs every line on a subscription in
  -- that subscription's currency. 50 is Stripe's smallest USD charge.
  monthly_price_cents integer
                      CHECK (monthly_price_cents IS NULL OR monthly_price_cents BETWEEN 50 AND 1000000),
  currency            text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),

  -- The first bill the integration appears on is credited in full (D7).
  first_month_free    boolean NOT NULL DEFAULT false,

  -- Board flags (D9). Hidden removes the card; beta labels it; unavailable
  -- dims it and makes its panel read-only.
  is_hidden           boolean NOT NULL DEFAULT false,
  is_beta             boolean NOT NULL DEFAULT false,
  is_unavailable      boolean NOT NULL DEFAULT false,

  -- Premium and price are separate: a premium integration with no price yet
  -- wears the crown and reads "Price to be announced", and cannot be
  -- subscribed to until it has one (the edge function refuses it).

  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

ALTER TABLE public.integration_catalog_v2 ENABLE ROW LEVEL SECURITY;

-- Read: PORTAL STAFF and super admins. Not `TO authenticated` on its own —
-- renters sign in through the same Auth project and are `authenticated` too
-- (see the note on is_portal_staff() in ops/setup_checklist_items.sql).
DROP POLICY IF EXISTS integration_catalog_v2_read ON public.integration_catalog_v2;
CREATE POLICY integration_catalog_v2_read
  ON public.integration_catalog_v2 FOR SELECT TO authenticated
  USING (public.is_portal_staff() OR public.is_super_admin());

-- Write: SUPER ADMINS ONLY, from /admin/integrations.
DROP POLICY IF EXISTS integration_catalog_v2_admin ON public.integration_catalog_v2;
CREATE POLICY integration_catalog_v2_admin
  ON public.integration_catalog_v2 FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS integration_catalog_v2_service ON public.integration_catalog_v2;
CREATE POLICY integration_catalog_v2_service
  ON public.integration_catalog_v2 FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- The table privilege says "may attempt"; the policies above decide.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_catalog_v2 TO authenticated;
-- Supabase's default privileges add TRUNCATE, which RLS does not govern.
REVOKE TRUNCATE ON public.integration_catalog_v2 FROM authenticated;
GRANT ALL ON public.integration_catalog_v2 TO service_role;
REVOKE ALL ON public.integration_catalog_v2 FROM anon;

COMMENT ON TABLE public.integration_catalog_v2 IS
  'Integration subscriptions: which board integrations are premium, their monthly price (USD cents, NULL = to be announced), first month free, and the hide / beta / not-available flags. One row per integration_key; a missing row means the portal default (free and visible, except Inshur, Turo Sync and CheckMyDriver, premium by default). Written by super admins.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. tenant_integration_subscriptions_v2
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tenant_integration_subscriptions_v2 (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration_key              text NOT NULL
                               CHECK (integration_key ~ '^[a-z][a-z0-9_]{1,40}$'),

  -- pending: claimed, Stripe not finished yet (the unique index below is what
  --          turns a double click into one Stripe item);
  -- active:  on the tenant's platform subscription and billed every month;
  -- canceled: removed by a super admin, or its platform subscription ended;
  -- failed:   Stripe refused and the undo was confirmed, so nothing is billed.
  status                       text NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'active', 'canceled', 'failed')),

  -- The price and free month AS SUBSCRIBED, so a later catalog change never
  -- rewrites what this tenant agreed to.
  monthly_price_cents          integer NOT NULL CHECK (monthly_price_cents > 0),
  currency                     text NOT NULL,
  first_month_free             boolean NOT NULL DEFAULT false,

  -- Where the item lives: the tenant's platform subscription account and mode.
  stripe_account               text NOT NULL CHECK (stripe_account IN ('uk', 'uae')),
  stripe_mode                  text NOT NULL CHECK (stripe_mode IN ('test', 'live')),
  stripe_subscription_id       text NOT NULL,
  stripe_subscription_item_id  text,
  stripe_price_id              text,
  -- The one-off "first month free" credit (D7), while it may still be pending.
  stripe_credit_invoice_item_id text,

  -- The platform bill the integration first appears on.
  first_bill_at                timestamptz,
  error                        text,

  subscribed_by                uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  subscribed_at                timestamptz NOT NULL DEFAULT now(),
  canceled_at                  timestamptz,
  canceled_by                  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

-- One live subscription per tenant per integration. A second subscribe while
-- the first is still pending hits this and is refused before Stripe is called.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_integration_subscriptions_v2_one_live
  ON public.tenant_integration_subscriptions_v2 (tenant_id, integration_key)
  WHERE status IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS tenant_integration_subscriptions_v2_tenant
  ON public.tenant_integration_subscriptions_v2 (tenant_id, subscribed_at DESC);

ALTER TABLE public.tenant_integration_subscriptions_v2 ENABLE ROW LEVEL SECURITY;

-- Read: the tenant's own staff, and super admins (whose tenant_id is NULL). A
-- renter has no app_users row, so get_user_tenant_id() is NULL for them and
-- `tenant_id = NULL` is never true.
DROP POLICY IF EXISTS tenant_integration_subscriptions_v2_read ON public.tenant_integration_subscriptions_v2;
CREATE POLICY tenant_integration_subscriptions_v2_read
  ON public.tenant_integration_subscriptions_v2 FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Write: the edge function only. Nothing in a browser writes this table.
DROP POLICY IF EXISTS tenant_integration_subscriptions_v2_service ON public.tenant_integration_subscriptions_v2;
CREATE POLICY tenant_integration_subscriptions_v2_service
  ON public.tenant_integration_subscriptions_v2 FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Supabase's default privileges would also hand `authenticated` INSERT,
-- UPDATE and DELETE on a new table. RLS already refuses them (there is no
-- write policy for that role); the REVOKE is the second lock.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tenant_integration_subscriptions_v2 FROM authenticated;
GRANT SELECT ON public.tenant_integration_subscriptions_v2 TO authenticated;
GRANT ALL ON public.tenant_integration_subscriptions_v2 TO service_role;
REVOKE ALL ON public.tenant_integration_subscriptions_v2 FROM anon;

COMMENT ON TABLE public.tenant_integration_subscriptions_v2 IS
  'Integration subscriptions: one row per premium-integration subscribe. The Stripe item it created on the tenant platform subscription, the price and free month as subscribed, and its status. Written only by the integration-billing edge function.';

COMMIT;
