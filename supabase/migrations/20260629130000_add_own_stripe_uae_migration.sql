-- Own Stripe (Standard/OAuth) + UAE platform migration support
-- payment_model: which Connect model the tenant uses for booking payments
--   'managed' = legacy platform-created Express account (old UK/US platform)
--   'own'     = operator-owned Standard account connected via OAuth (UAE platform)
-- subscription_account: which platform Stripe account bills the tenant's SaaS subscription
--   'uk'  = legacy account, 'uae' = new self-owned account
-- platform_account on payments/rentals: which platform account a money object was
--   created under, so captures/refunds/deposit ops on in-flight records keep using
--   the keys they were created with even after the tenant is flipped.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS payment_model text NOT NULL DEFAULT 'managed'
    CHECK (payment_model IN ('managed', 'own')),
  ADD COLUMN IF NOT EXISTS subscription_account text NOT NULL DEFAULT 'uk'
    CHECK (subscription_account IN ('uk', 'uae')),
  ADD COLUMN IF NOT EXISTS own_stripe_account_id text,
  ADD COLUMN IF NOT EXISTS own_stripe_test_account_id text,
  ADD COLUMN IF NOT EXISTS own_stripe_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS own_stripe_test_connected_at timestamptz;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS platform_account text NOT NULL DEFAULT 'uk'
    CHECK (platform_account IN ('uk', 'uae'));

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS platform_account text NOT NULL DEFAULT 'uk'
    CHECK (platform_account IN ('uk', 'uae'));

COMMENT ON COLUMN public.tenants.payment_model IS 'managed = platform-created Express (legacy), own = operator-owned Standard via OAuth (UAE platform)';
COMMENT ON COLUMN public.tenants.subscription_account IS 'Platform Stripe account billing this tenant''s SaaS subscription: uk (legacy) or uae (new)';
COMMENT ON COLUMN public.payments.platform_account IS 'Platform account the Stripe objects of this payment live under; captures/refunds must use matching keys';
COMMENT ON COLUMN public.rentals.platform_account IS 'Platform account the rental''s deposit-hold PaymentIntents live under';

-- Subscription objects are account-specific: record which platform account
-- each plan's Stripe price and each subscription live on.
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_account text NOT NULL DEFAULT 'uk'
    CHECK (stripe_account IN ('uk', 'uae'));

ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_account text NOT NULL DEFAULT 'uk'
    CHECK (stripe_account IN ('uk', 'uae'));
