-- New subscription billing model: "upfront_monthly".
--
-- Old model ('trial'): tenant starts a free trial of N days, then the first
-- charge lands. UI sells it as a "free trial".
--
-- New model ('upfront_monthly'): no free trial framing. The tenant hits a hard
-- gate, enters their card, and the FIRST payment is taken exactly one calendar
-- month after they enter the card (relative — opens 8th → charged 8th next
-- month). Mechanically this still rides Stripe's trial primitive (no charge for
-- ~1 month), but it is never presented to the customer as a free trial.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS billing_model text NOT NULL DEFAULT 'trial';

ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_billing_model_check;

ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_billing_model_check
  CHECK (billing_model IN ('trial', 'upfront_monthly'));

COMMENT ON COLUMN public.subscription_plans.billing_model IS
  'trial = free-trial flow driven by trial_days. upfront_monthly = no free trial; card entered now via a hard gate, first charge exactly 1 calendar month after card entry, then monthly.';
