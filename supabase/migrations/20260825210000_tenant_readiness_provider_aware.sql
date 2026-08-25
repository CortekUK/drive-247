-- R-22 — a Square tenant must not be permanently "not ready".
--
-- WHAT WAS WRONG
--
-- `v_tenant_readiness` computed:
--
--     overall_ready = stripe_ready AND boldsign_ready AND bonzah_ready AND subscription_ready
--     issue_count   = (NOT stripe_ready) + (NOT boldsign_ready) + ...
--
-- and `stripe_ready` requires `stripe_mode='live'` AND `stripe_onboarding_complete`
-- AND an active `stripe_account_status`. A Square tenant has none of those and
-- never will, so it would sit at `overall_ready = false` with a standing
-- `issue_count >= 1` FOREVER, with a "Stripe Connect" item on a checklist it
-- cannot satisfy. That is not a cosmetic problem: the same readiness signal
-- gates go-live, and 8 of 52 tenants already carry `migration_blocker='hard'`,
-- so one super-admin click would lock a Square operator out of their dashboard
-- with an instruction they physically cannot follow.
--
-- WHAT THIS DOES
--
-- `stripe_ready` is preserved BYTE-IDENTICALLY. Nothing about how an existing
-- Stripe tenant is judged changes, which is the property that matters for the 52
-- live tenants.
--
-- Added alongside it:
--   * `payment_provider`  — so consumers can branch instead of inferring
--   * `square_ready`      — the Square equivalent: an ACTIVE connection with a
--                           location, in live mode
--   * `payments_ready`    — the PROVIDER-NEUTRAL answer. This is what
--                           `overall_ready` now consumes.
--
-- `issue_count` and `overall_ready` change MEANING for Square tenants — stated
-- plainly here because CREATE OR REPLACE cannot signal that, and a reader of the
-- view will otherwise assume `stripe_ready` is still the payments term.
-- For a Stripe tenant `payments_ready` IS `stripe_ready`, so their numbers are
-- unchanged; verified below.
--
-- Note the view already excludes `tenant_type = 'test'`; that filter is kept.

BEGIN;

CREATE OR REPLACE VIEW public.v_tenant_readiness AS
 SELECT tenant_id,
    company_name,
    slug,
    tenant_type,
    status,
    stripe_mode,
    stripe_onboarding_complete,
    stripe_account_status,
    stripe_ready,
    boldsign_mode,
    boldsign_has_live_brand,
    boldsign_ready,
    bonzah_enabled,
    bonzah_mode,
    bonzah_ready,
    subscription_status,
    subscription_stripe_mode,
    subscription_plan,
    subscription_ready,
    -- Counts the provider-neutral term, so a Square tenant is not charged an
    -- issue for lacking Stripe.
    (((
        CASE
            WHEN (NOT payments_ready) THEN 1
            ELSE 0
        END +
        CASE
            WHEN (NOT boldsign_ready) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN (NOT bonzah_ready) THEN 1
            ELSE 0
        END) +
        CASE
            WHEN (NOT subscription_ready) THEN 1
            ELSE 0
        END) AS issue_count,
    (payments_ready AND boldsign_ready AND bonzah_ready AND subscription_ready) AS overall_ready,
    -- APPENDED, not inserted. CREATE OR REPLACE VIEW can only add columns at the
    -- END: reordering or renaming an existing position fails with 42P16
    -- ("cannot change name of view column"). Learned the direct way.
    payment_provider,
    square_ready,
    payments_ready
   FROM ( SELECT t.id AS tenant_id,
            t.company_name,
            t.slug,
            t.tenant_type,
            t.status,
            t.payment_provider,
            t.stripe_mode,
            t.stripe_onboarding_complete,
            t.stripe_account_status,
            -- BYTE-IDENTICAL to the original expression. Do not "tidy" it.
            t.stripe_mode = 'live'::text AND COALESCE(t.stripe_onboarding_complete, false) AND (COALESCE(t.stripe_account_status, ''::text) = ANY (ARRAY['active'::text, 'enabled'::text])) AS stripe_ready,
            -- A Square tenant is ready when the merchant is connected, in live
            -- mode, and carries a location: without a location_id no payment
            -- link can be created, so a connection alone is not readiness.
            (EXISTS ( SELECT 1
                   FROM square_connections sc
                  WHERE sc.tenant_id = t.id
                    AND sc.square_mode = 'live'::text
                    AND sc.status = 'active'::text
                    AND COALESCE(sc.location_id, ''::text) <> ''::text)) AS square_ready,
            -- The provider-neutral term. Adding a third processor means one more
            -- branch HERE and no change to any consumer.
            CASE t.payment_provider
                WHEN 'square'::text THEN (EXISTS ( SELECT 1
                       FROM square_connections sc
                      WHERE sc.tenant_id = t.id
                        AND sc.square_mode = 'live'::text
                        AND sc.status = 'active'::text
                        AND COALESCE(sc.location_id, ''::text) <> ''::text))
                ELSE t.stripe_mode = 'live'::text AND COALESCE(t.stripe_onboarding_complete, false) AND (COALESCE(t.stripe_account_status, ''::text) = ANY (ARRAY['active'::text, 'enabled'::text]))
            END AS payments_ready,
            t.boldsign_mode,
            COALESCE(t.boldsign_live_brand_id, ''::text) <> ''::text AS boldsign_has_live_brand,
            t.boldsign_mode = 'live'::text AND COALESCE(t.boldsign_live_brand_id, ''::text) <> ''::text AS boldsign_ready,
            COALESCE(t.integration_bonzah, false) AS bonzah_enabled,
            t.bonzah_mode,
            NOT COALESCE(t.integration_bonzah, false) OR t.bonzah_mode = 'live'::text AS bonzah_ready,
            sub.status AS subscription_status,
            t.subscription_stripe_mode,
            t.subscription_plan,
            (sub.status = ANY (ARRAY['active'::text, 'trialing'::text])) AND COALESCE(t.subscription_stripe_mode, ''::text) = 'live'::text AS subscription_ready
           FROM tenants t
             LEFT JOIN LATERAL ( SELECT s.status
                   FROM tenant_subscriptions s
                  WHERE s.tenant_id = t.id
                  ORDER BY s.created_at DESC
                 LIMIT 1) sub ON true
          WHERE t.tenant_type IS DISTINCT FROM 'test'::text) r;

COMMIT;

-- Verification — for every EXISTING tenant (all Stripe), payments_ready must
-- equal stripe_ready, so issue_count and overall_ready are unchanged:
--
--   SELECT count(*) FROM v_tenant_readiness WHERE payments_ready IS DISTINCT FROM stripe_ready;
--   -- expect 0 while no Square tenant exists
