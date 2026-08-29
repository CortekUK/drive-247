-- Applied to PRODUCTION (hviqoaokxvlancmftwuo). Recovered and md5-verified against
-- supabase_migrations.schema_migrations so this file and the live schema cannot drift.
-- The version prefix matches what prod recorded, so the CLI treats prod as up to date.
-- STILL TO APPLY TO STAGING (ksmreaadhbirzakkxqrq), which is behind.

-- Square integration — migration 01: provider columns. ADDITIVE ONLY.
-- Verified pre-flight: tenants=52, payments=1026, PG 17.6, none of these columns exist.

-- ========== 1. tenants ==========
ALTER TABLE public.tenants
  ADD COLUMN payment_provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN square_mode      text NOT NULL DEFAULT 'test',
  ADD COLUMN country          text;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_payment_provider_check
    CHECK (payment_provider IN ('stripe','square')),
  ADD CONSTRAINT tenants_square_mode_check
    CHECK (square_mode IN ('test','live')),
  ADD CONSTRAINT tenants_country_iso3166_check
    CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
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

-- MANDATORY: anon holds COLUMN-level grants on tenants (236/262). A new ungranted
-- column 403s the whole ~134-column TenantContext select and blanks EVERY booking site.
GRANT SELECT (payment_provider, square_mode, country) ON public.tenants TO anon;

-- ========== 2a. payments — Square handle columns ==========
ALTER TABLE public.payments
  ADD COLUMN square_order_id   text,
  ADD COLUMN square_payment_id text,
  ADD COLUMN square_refund_id  text;

COMMENT ON COLUMN public.payments.square_order_id IS
 'Square Order id. SIBLING to stripe_checkout_session_id, never a replacement. The stripe_* columns are read at 348 sites and must never be renamed or generalised.';

-- ========== 2b. payments — provider column and handle exclusivity ==========
ALTER TABLE public.payments
  ADD COLUMN payment_provider text NOT NULL DEFAULT 'stripe';

ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_provider_check
    CHECK (payment_provider IN ('stripe','square')),
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

-- ========== 3. indexes (brand-new all-NULL columns only) ==========
CREATE INDEX idx_payments_square_order_id
  ON public.payments (square_order_id)   WHERE square_order_id   IS NOT NULL;
CREATE INDEX idx_payments_square_payment_id
  ON public.payments (square_payment_id) WHERE square_payment_id IS NOT NULL;
