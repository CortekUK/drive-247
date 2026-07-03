-- Per-tenant billing anchor for the `upfront_monthly` subscription model.
--
-- The upfront model takes the first platform charge exactly one calendar month
-- after the tenant went live (month 1 having been paid outside the platform in
-- the sales call). Previously this was hardcoded to "one month from whenever the
-- operator happens to click Complete Setup", which is wrong when the operator
-- enters their card days/weeks after going live.
--
-- When set, checkout anchors the first charge to `subscription_billing_anchor + 1 month`.
-- When NULL, checkout falls back to the legacy "today + 1 month" behavior.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_billing_anchor date;

COMMENT ON COLUMN public.tenants.subscription_billing_anchor IS
  'Go-live date for platform subscription billing. First upfront_monthly charge is taken one calendar month after this date. NULL = anchor to checkout completion date.';
