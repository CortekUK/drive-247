-- Add trial_days to subscription_plans (0 = no trial)
ALTER TABLE subscription_plans
  ADD COLUMN trial_days INTEGER NOT NULL DEFAULT 0;

-- Add trial_end to tenant_subscriptions (populated from Stripe)
ALTER TABLE tenant_subscriptions
  ADD COLUMN trial_end TIMESTAMPTZ;
