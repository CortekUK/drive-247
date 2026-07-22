-- Credits are always billed on the UAE account, for every tenant, regardless of
-- where their SUBSCRIPTION still bills (tenants.subscription_account).
--
-- Stripe customers are account-scoped, so a tenant whose subscription is still
-- on the legacy account needs a SEPARATE customer on the UAE account for credit
-- purchases. Writing that into stripe_subscription_customer_id (as the credit
-- checkout used to) would clobber the id the subscription webhook uses to
-- resolve their legacy invoices — so it gets its own column.
--
-- Tenants already migrated (subscription_account = 'uae') keep reusing
-- stripe_subscription_customer_id; it already points at the right account.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS uae_customer_id text;

COMMENT ON COLUMN public.tenants.uae_customer_id IS 'Stripe customer on the UAE account used for credit purchases by tenants whose subscription still bills on the legacy account. Never overwrites stripe_subscription_customer_id.';
