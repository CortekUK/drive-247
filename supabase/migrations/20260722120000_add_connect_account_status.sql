-- Mirror the live Stripe Connect account state onto the tenant row.
--
-- Why: `stripe_onboarding_complete` is a LOCAL flag written once when the operator
-- finishes onboarding and never revalidated. Stripe can later disable charges on a
-- connected account (verification lapsed, new requirements past due, risk review)
-- and nothing in the product notices — the operator only finds out when a checkout
-- call throws and the portal shows "Edge Function returned a non-2xx status code".
-- These columns are refreshed by the `sync-connect-status` edge function so an
-- unchargeable account is visible BEFORE someone tries to charge a customer.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled boolean,
  ADD COLUMN IF NOT EXISTS stripe_account_disabled_reason text,
  ADD COLUMN IF NOT EXISTS stripe_requirements_due jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stripe_status_synced_at timestamptz;

COMMENT ON COLUMN public.tenants.stripe_charges_enabled IS
  'Mirror of Stripe Connect account.charges_enabled, refreshed by sync-connect-status. NULL = never synced. Distinct from stripe_onboarding_complete, which is a local flag set once at onboarding and never revalidated.';
