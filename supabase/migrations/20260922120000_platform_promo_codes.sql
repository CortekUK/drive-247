-- ============================================================================
-- Drive247 platform promo codes + operator referral programme — schema.
--
-- Money off what DRIVE247 charges operators (their platform subscription).
-- Nothing here touches renter bookings, Stripe Connect, or the renter-side
-- `promocodes` / `promotions` tables, which are a different feature that
-- happens to share a word. Every new object is prefixed `platform_` /
-- `referral_` / `promo_code_` so the two can never be confused.
--
--   campaign code   Drive247's own, no owner          e.g. LAUNCH50
--   referral code   owned by an operator, auto-made   e.g. SUNSET-4821
--
-- ADDITIVE ONLY (V2_PLAN §4): new types, new tables, new indexes, new
-- policies. No existing table or function changes here, and nothing is added
-- to `tenants` (anon column-grant trap, "flag #74").
--
-- WRITES are service_role only: every mutation goes through an edge function
-- (admin-promo-codes, referral-engine, the checkout functions). Authenticated
-- users may READ their own tenant's rows; anon reads nothing — the public
-- code lookup is the `promo-code-lookup` function, which returns display text
-- only.
--
-- Apply with the Supabase MCP / Management API after review.
-- NEVER `supabase db push`: migration history has diverged and a replay
-- drops live operators' data.
-- ============================================================================

-- ---------------------------------------------------------------- enums ----
CREATE TYPE public.promo_code_kind       AS ENUM ('campaign', 'referral');
CREATE TYPE public.promo_discount_type   AS ENUM ('percent', 'fixed');
CREATE TYPE public.promo_duration        AS ENUM ('once', 'repeating', 'forever');
CREATE TYPE public.promo_code_status     AS ENUM ('active', 'inactive', 'superseded');
CREATE TYPE public.referral_source       AS ENUM ('self_serve_checkout', 'payment_link', 'manual');
CREATE TYPE public.referral_status       AS ENUM ('active', 'void');
-- No enum for these exists yet: tenant_subscriptions.stripe_account and
-- tenants.subscription_stripe_mode are plain text ('uk' | 'uae', 'test' | 'live').
CREATE TYPE public.stripe_platform_acct  AS ENUM ('uk', 'uae');
CREATE TYPE public.stripe_mode_t         AS ENUM ('test', 'live');
CREATE TYPE public.referral_claim_status AS ENUM ('pending', 'approved', 'rejected');

-- ------------------------------------------------ programme settings (1 row) --
CREATE TABLE public.referral_program_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  default_referee_discount_type public.promo_discount_type NOT NULL DEFAULT 'percent',
  default_referee_discount_value numeric(10,2) NOT NULL DEFAULT 20
    CHECK (default_referee_discount_value > 0),
  default_referee_duration public.promo_duration NOT NULL DEFAULT 'repeating',
  default_referee_duration_months int DEFAULT 3
    CHECK (default_referee_duration_months IS NULL OR default_referee_duration_months >= 1),
  code_suffix_length int NOT NULL DEFAULT 4 CHECK (code_suffix_length IN (3, 4, 6)),
  link_cookie_days int NOT NULL DEFAULT 90 CHECK (link_cookie_days >= 1),
  -- The referral engine's run lease: a full run claims it for a few minutes
  -- so two scheduled runs never overlap. NULL or in the past = free.
  engine_lease_until timestamptz,
  updated_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (default_referee_discount_type <> 'percent' OR default_referee_discount_value <= 100),
  CHECK ((default_referee_duration = 'repeating') = (default_referee_duration_months IS NOT NULL))
);

-- ------------------------------------------------------------- tier table ----
-- Platform default rows have tenant_id NULL; an operator's override rows carry
-- their tenant_id. If an operator has ANY rows, only theirs apply; otherwise the
-- defaults do. "Reset to default" = delete that operator's rows.
-- Tiers are LEVELS, never summed: the single highest tier whose minimum is met.
CREATE TABLE public.referral_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  min_active_referrals int NOT NULL CHECK (min_active_referrals >= 1),
  discount_type public.promo_discount_type NOT NULL,
  discount_value numeric(10,2) NOT NULL CHECK (discount_value > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_type <> 'percent' OR discount_value <= 100)
);
-- One row per threshold, per owner. Two partial indexes rather than NULLS NOT
-- DISTINCT, so this does not depend on the Postgres major version.
CREATE UNIQUE INDEX referral_tiers_default_min_uq
  ON public.referral_tiers (min_active_referrals) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX referral_tiers_tenant_min_uq
  ON public.referral_tiers (tenant_id, min_active_referrals) WHERE tenant_id IS NOT NULL;

-- ------------------------------------------- per-operator referral settings --
CREATE TABLE public.tenant_referral_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  referrals_enabled boolean NOT NULL DEFAULT true,
  brand_prefix text CHECK (brand_prefix IS NULL OR brand_prefix ~ '^[A-Z0-9]+$'),
  -- True: this operator's code gives the platform default discount, and a
  -- change to the default rotates their code onto the new terms.
  uses_default_referee_discount boolean NOT NULL DEFAULT true,
  show_name_on_invite boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------- promo codes (one per version)
-- Stripe coupons and promotion codes are immutable, so editing a code's terms
-- ROTATES it: a new row with the same code string, the old one `superseded`.
-- Operators who already redeemed keep the terms they redeemed.
CREATE TABLE public.platform_promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  kind public.promo_code_kind NOT NULL,
  owner_tenant_id uuid REFERENCES public.tenants(id),
  discount_type public.promo_discount_type NOT NULL,
  discount_value numeric(10,2) NOT NULL CHECK (discount_value > 0),
  currency text NOT NULL DEFAULT 'usd',
  duration public.promo_duration NOT NULL,
  duration_months int CHECK (duration_months IS NULL OR duration_months >= 1),
  max_redemptions int CHECK (max_redemptions IS NULL OR max_redemptions >= 1),
  expires_at timestamptz,
  restrict_signup_plan_keys text[],
  status public.promo_code_status NOT NULL DEFAULT 'active',
  superseded_by uuid REFERENCES public.platform_promo_codes(id),
  note text,
  created_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'referral') = (owner_tenant_id IS NOT NULL)),
  CHECK ((duration = 'repeating') = (duration_months IS NOT NULL)),
  CHECK (discount_type <> 'percent' OR discount_value <= 100),
  -- Not constrained: superseded_by. A rotation marks the old row superseded
  -- before the new row exists (the active-code index allows only one live
  -- version), then points it at the new row.
  CHECK (kind = 'campaign' OR restrict_signup_plan_keys IS NULL)
);
-- A code string is unique among ACTIVE codes (Stripe's own rule per account).
CREATE UNIQUE INDEX platform_promo_codes_active_code_uq
  ON public.platform_promo_codes (upper(code)) WHERE status = 'active';
-- At most one active referral code per operator.
CREATE UNIQUE INDEX platform_promo_codes_active_owner_uq
  ON public.platform_promo_codes (owner_tenant_id) WHERE kind = 'referral' AND status = 'active';
CREATE INDEX platform_promo_codes_kind_status_idx ON public.platform_promo_codes (kind, status);
CREATE INDEX platform_promo_codes_owner_idx ON public.platform_promo_codes (owner_tenant_id);

-- -------------------- Stripe mirror, per account / mode / variant / product ---
-- Created lazily the first time a code is used on an account+mode.
--   variant   `deferred_{k}m` stretches a repeating coupon over a trial so
--             "3 months" is 3 real bills.
--   product   the Stripe product of the plan being billed. Coupons carry
--             applies_to = [that product] so they never discount the $1 card
--             verification line or metered e-sign usage (brief R2). Plans do not
--             share one product — sales onboarding mints a product per plan — so
--             a single account-wide coupon could not be restricted correctly.
--             We apply codes ourselves (never Stripe's promo box), so the right
--             coupon is attached directly and no Stripe promotion code is needed.
CREATE TABLE public.platform_promo_code_stripe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES public.platform_promo_codes(id),
  stripe_account public.stripe_platform_acct NOT NULL,
  stripe_mode public.stripe_mode_t NOT NULL,
  variant text NOT NULL DEFAULT 'standard' CHECK (variant ~ '^(standard|deferred_[0-9]+m)$'),
  stripe_product_id text NOT NULL,
  stripe_coupon_id text NOT NULL,
  -- Reserved: a customer-facing Stripe promotion code, if one is ever minted.
  stripe_promotion_code_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promo_code_id, stripe_account, stripe_mode, variant, stripe_product_id)
);
CREATE INDEX platform_promo_code_stripe_coupon_idx ON public.platform_promo_code_stripe (stripe_coupon_id);
CREATE INDEX platform_promo_code_stripe_promo_idx ON public.platform_promo_code_stripe (stripe_promotion_code_id);

-- ------------------------------------------------------------- redemptions ---
CREATE TABLE public.promo_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES public.platform_promo_codes(id),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  stripe_subscription_id text NOT NULL,
  stripe_account public.stripe_platform_acct NOT NULL,
  stripe_mode public.stripe_mode_t NOT NULL,
  -- The terms as redeemed: type, value, duration, months.
  discount_snapshot jsonb NOT NULL,
  -- Stripe's discount.end; drives "2 bills left".
  discount_ends_at timestamptz,
  redeemed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promo_code_id, tenant_id),
  UNIQUE (stripe_subscription_id, promo_code_id)
);
CREATE INDEX promo_code_redemptions_tenant_idx ON public.promo_code_redemptions (tenant_id);

-- --------------------------------------------------------------- referrals ---
-- Whether a referral COUNTS toward the referrer's tier is not stored: it is
-- computed from the referee's live subscription status every engine run.
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  referred_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  -- The portal cannot read another tenant's row, so names are kept here.
  referrer_name_snapshot text NOT NULL,
  referred_name_snapshot text NOT NULL,
  promo_code_id uuid REFERENCES public.platform_promo_codes(id),
  redemption_id uuid REFERENCES public.promo_code_redemptions(id),
  source public.referral_source NOT NULL,
  status public.referral_status NOT NULL DEFAULT 'active',
  referee_discount_applied boolean NOT NULL DEFAULT false,
  attributed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id),
  note text,
  voided_at timestamptz,
  voided_by uuid REFERENCES public.app_users(id),
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_tenant_id <> referred_tenant_id),
  CHECK ((status = 'void') = (voided_at IS NOT NULL))
);
-- One live referral per referred operator.
CREATE UNIQUE INDEX referrals_one_active_per_referee_uq
  ON public.referrals (referred_tenant_id) WHERE status = 'active';
CREATE INDEX referrals_referrer_idx ON public.referrals (referrer_tenant_id, status);

-- ------------------------------------------ the engine's view of a referrer ---
CREATE TABLE public.referral_tier_state (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  active_referrals int NOT NULL DEFAULT 0 CHECK (active_referrals >= 0),
  total_referrals int NOT NULL DEFAULT 0 CHECK (total_referrals >= 0),
  current_tier_id uuid REFERENCES public.referral_tiers(id) ON DELETE SET NULL,
  current_discount_type public.promo_discount_type,
  current_discount_value numeric(10,2),
  applied_stripe_coupon_id text,
  applied_on_subscription_id text,
  stripe_account public.stripe_platform_acct,
  stripe_mode public.stripe_mode_t,
  last_evaluated_at timestamptz,
  last_changed_at timestamptz,
  last_error text
);

-- ----------------------------------------------------- "you have saved $X" ---
CREATE TABLE public.referral_savings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  stripe_invoice_id text NOT NULL UNIQUE,
  stripe_account public.stripe_platform_acct NOT NULL,
  amount_off_cents int NOT NULL CHECK (amount_off_cents >= 0),
  invoice_paid_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_savings_tenant_idx ON public.referral_savings (tenant_id);

-- ------------------------------------ "already looked at this subscription" ---
CREATE TABLE public.referral_subscription_scans (
  stripe_subscription_id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  scanned_at timestamptz NOT NULL,
  found_promo_code_id uuid REFERENCES public.platform_promo_codes(id)
);

-- ------------------------------------------- audit trail + notification dedupe
-- Deliberately NOT audit_logs: its trigger pushes super-admin phone alerts.
CREATE TABLE public.referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  referral_id uuid REFERENCES public.referrals(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_app_user_id uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_events_tenant_idx ON public.referral_events (tenant_id, created_at DESC);
CREATE INDEX referral_events_type_idx ON public.referral_events (event_type, created_at DESC);

-- ------------------------------------ "someone joined because of me" (R6) ---
CREATE TABLE public.referral_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  claimed_business_name text NOT NULL,
  claimed_contact text,
  note text,
  status public.referral_claim_status NOT NULL DEFAULT 'pending',
  resolved_referral_id uuid REFERENCES public.referrals(id),
  resolved_by uuid REFERENCES public.app_users(id),
  resolved_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referral_claims_referrer_idx ON public.referral_claims (referrer_tenant_id, status);

-- ------------------------------- public lookup throttle (promo-code-lookup) --
-- The lookup is anonymous, so it is rate-limited per caller. Only a hash of
-- the IP is kept; rows older than a day are deleted by the referral engine.
CREATE TABLE public.promo_code_lookup_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promo_code_lookup_attempts_ip_idx ON public.promo_code_lookup_attempts (ip_hash, created_at DESC);

-- --------------------------------------------------------- updated_at -------
CREATE TRIGGER referral_program_settings_set_updated_at BEFORE UPDATE ON public.referral_program_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER referral_tiers_set_updated_at BEFORE UPDATE ON public.referral_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tenant_referral_settings_set_updated_at BEFORE UPDATE ON public.tenant_referral_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER platform_promo_codes_set_updated_at BEFORE UPDATE ON public.platform_promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER referrals_set_updated_at BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER referral_claims_set_updated_at BEFORE UPDATE ON public.referral_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------ RLS -----
-- On for every new table from day one. There are no INSERT/UPDATE/DELETE
-- policies anywhere below: only service_role (which bypasses RLS) writes.
ALTER TABLE public.referral_program_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_tiers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_referral_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_promo_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_promo_code_stripe  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_code_redemptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_tier_state         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_savings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_subscription_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_claims             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_code_lookup_attempts  ENABLE ROW LEVEL SECURITY;

-- Belt and braces on top of RLS: anon holds nothing, and authenticated can
-- only ever read.
REVOKE ALL ON public.referral_program_settings, public.referral_tiers, public.tenant_referral_settings,
  public.platform_promo_codes, public.platform_promo_code_stripe, public.promo_code_redemptions,
  public.referrals, public.referral_tier_state, public.referral_savings,
  public.referral_subscription_scans, public.referral_events, public.referral_claims,
  public.promo_code_lookup_attempts
  FROM anon;
-- The throttle ledger is the service role's alone: no policy, no grant.
REVOKE ALL ON public.promo_code_lookup_attempts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.referral_program_settings, public.referral_tiers,
  public.tenant_referral_settings, public.platform_promo_codes, public.platform_promo_code_stripe,
  public.promo_code_redemptions, public.referrals, public.referral_tier_state, public.referral_savings,
  public.referral_subscription_scans, public.referral_events, public.referral_claims
  FROM authenticated;

-- Non-sensitive programme terms: any signed-in user.
CREATE POLICY referral_program_settings_read ON public.referral_program_settings
  FOR SELECT TO authenticated USING (true);

-- The platform default tiers plus the reader's own overrides.
CREATE POLICY referral_tiers_read ON public.referral_tiers
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY tenant_referral_settings_read ON public.tenant_referral_settings
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- An operator sees their own referral code; campaign codes are super admin only.
CREATE POLICY platform_promo_codes_read ON public.platform_promo_codes
  FOR SELECT TO authenticated
  USING (owner_tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY promo_code_redemptions_read ON public.promo_code_redemptions
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Both sides of a referral may see it.
CREATE POLICY referrals_read ON public.referrals
  FOR SELECT TO authenticated
  USING (
    referrer_tenant_id = public.get_user_tenant_id()
    OR referred_tenant_id = public.get_user_tenant_id()
    OR public.is_super_admin()
  );

CREATE POLICY referral_tier_state_read ON public.referral_tier_state
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY referral_savings_read ON public.referral_savings
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

CREATE POLICY referral_claims_read ON public.referral_claims
  FOR SELECT TO authenticated
  USING (referrer_tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Stripe ids, scan markers and the audit trail: super admin (and service role).
CREATE POLICY platform_promo_code_stripe_read ON public.platform_promo_code_stripe
  FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY referral_subscription_scans_read ON public.referral_subscription_scans
  FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY referral_events_read ON public.referral_events
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- ------------------------------------------------------------------ seed ----
INSERT INTO public.referral_program_settings (id) VALUES (true);

-- Platform default referrer tiers (brief §3.1): levels, never summed.
--   1–2 subscribed referrals -> 10%   3–4 -> 20%   5+ -> 30%
INSERT INTO public.referral_tiers (tenant_id, min_active_referrals, discount_type, discount_value) VALUES
  (NULL, 1, 'percent', 10),
  (NULL, 3, 'percent', 20),
  (NULL, 5, 'percent', 30);

NOTIFY pgrst, 'reload schema';
