-- Square integration — migration 01: provider columns.
--
-- ADDITIVE ONLY. No existing column is renamed, dropped, retyped or reindexed.
-- Verified against production (project hviqoaokxvlancmftwuo) before writing:
--   tenants  = 52 rows, 262 columns, anon holds 236 COLUMN-level SELECT grants
--   payments = 1,026 rows, anon holds TABLE-level grants
--   PostgreSQL 17.6  -> ADD COLUMN with a non-volatile DEFAULT is metadata-only,
--                       no table rewrite (payments.platform_account already
--                       demonstrates this: atthasmissing=true).
--
-- CORRECTION vs the analysis output: the original DDL referenced
-- payments.square_order_id / square_payment_id / square_refund_id in a CHECK
-- constraint and built two indexes on them, but never ADDed the columns. As
-- written it fails with 42703 (undefined_column). Section 2a below adds them.

-- ============================================================================
-- 1. tenants
-- ============================================================================
ALTER TABLE public.tenants
  ADD COLUMN payment_provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN square_mode      text NOT NULL DEFAULT 'test',
  ADD COLUMN country          text;                  -- ISO-3166-1 alpha-2, nullable

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_payment_provider_check
    CHECK (payment_provider IN ('stripe','square')),
  ADD CONSTRAINT tenants_square_mode_check
    CHECK (square_mode IN ('test','live')),
  ADD CONSTRAINT tenants_country_iso3166_check
    CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  -- Strict form. The naive `country NOT IN (...)` passes NULL silently, which is
  -- exactly the row this constraint exists to block.
  ADD CONSTRAINT tenants_square_country_supported_check
    CHECK (
      payment_provider = 'stripe'
      OR (country IS NOT NULL
          AND country IN ('AU','CA','FR','IE','JP','ES','GB','US'))
    );

COMMENT ON COLUMN public.tenants.payment_provider IS
 'Processor governing this tenant''s CUSTOMER money flow. Set at INSERT, immutable thereafter (trg_tenants_payment_provider_immutable). NOT the platform-subscription processor, which is always Stripe. Distinct from payment_model (managed|own), payment_mode (automated|manual), stripe_mode (test|live).';
COMMENT ON COLUMN public.tenants.country IS
 'ISO-3166-1 alpha-2. The United Kingdom is GB, never UK. Unrelated to payments.platform_account (''uk''|''uae''), which names a Stripe platform account, not a country.';

CREATE OR REPLACE FUNCTION public.tenants_payment_provider_immutable()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.payment_provider IS DISTINCT FROM OLD.payment_provider THEN
    RAISE EXCEPTION 'tenants.payment_provider is immutable (% -> %); the provider is chosen once, at tenant creation',
      OLD.payment_provider, NEW.payment_provider USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_tenants_payment_provider_immutable ON public.tenants;
CREATE TRIGGER trg_tenants_payment_provider_immutable
  BEFORE UPDATE OF payment_provider ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_payment_provider_immutable();

-- MANDATORY, same migration, non-negotiable.
-- anon holds COLUMN-level (not table-level) grants on tenants: 236 of 262. A new
-- column it is NOT granted causes the whole ~134-column TenantContext select to
-- 403, which blanks branding on EVERY booking site simultaneously. This platform
-- has already been bitten by exactly this, via customer_theme_mode.
GRANT SELECT (payment_provider, square_mode, country) ON public.tenants TO anon;

-- ============================================================================
-- 2a. payments — the Square handle columns (MISSING from the original DDL)
-- ============================================================================
ALTER TABLE public.payments
  ADD COLUMN square_order_id   text,
  ADD COLUMN square_payment_id text,
  ADD COLUMN square_refund_id  text;

COMMENT ON COLUMN public.payments.square_order_id IS
 'Square Order id. Sibling to stripe_checkout_session_id — never a replacement. The stripe_* columns are read at 348 sites and must never be renamed or generalised.';

-- ============================================================================
-- 2b. payments — provider column and exclusivity
-- ============================================================================
ALTER TABLE public.payments
  ADD COLUMN payment_provider text NOT NULL DEFAULT 'stripe';

ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_provider_check
    CHECK (payment_provider IN ('stripe','square')),
  -- Converts "a Square tenant can never reach the Stripe-only call sites" from a
  -- belief into a DB-enforced fact: a Square payment physically cannot carry a
  -- stripe_* handle, and vice versa.
  ADD CONSTRAINT payments_provider_handle_exclusivity_check
    CHECK (
      (payment_provider <> 'square'
        OR (stripe_checkout_session_id IS NULL
            AND stripe_payment_intent_id IS NULL
            AND stripe_refund_id IS NULL))
      AND
      (payment_provider <> 'stripe'
        OR (square_order_id IS NULL
            AND square_payment_id IS NULL
            AND square_refund_id IS NULL))
    );

CREATE OR REPLACE FUNCTION public.payments_payment_provider_immutable()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.payment_provider IS DISTINCT FROM OLD.payment_provider THEN
    RAISE EXCEPTION 'payments.payment_provider is immutable (% -> %)',
      OLD.payment_provider, NEW.payment_provider USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_payments_payment_provider_immutable ON public.payments;
CREATE TRIGGER trg_payments_payment_provider_immutable
  BEFORE UPDATE OF payment_provider ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_payment_provider_immutable();

-- ============================================================================
-- 3. indexes
-- ============================================================================
-- ZERO new indexes on any pre-existing payments column. At 1,026 rows an index is
-- decorative, and any index that could change the plan of the every-minute Stripe
-- recovery cron (pg_cron jobid 34) is precisely the risk the prime directive
-- forbids. Both indexes below are on brand-new, all-NULL columns that no existing
-- Stripe query references, so no existing plan can move.
-- No CONCURRENTLY: apply_migration runs inside a transaction, where it is illegal.
CREATE INDEX idx_payments_square_order_id
  ON public.payments (square_order_id)   WHERE square_order_id   IS NOT NULL;
CREATE INDEX idx_payments_square_payment_id
  ON public.payments (square_payment_id) WHERE square_payment_id IS NOT NULL;
