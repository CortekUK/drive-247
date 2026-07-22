-- Operator-facing migration prompt ("blocker") for the Own Stripe rollout.
--
-- Super admin turns a prompt on per tenant. BOTH blockers are OFF by default
-- for every tenant — nothing is shown to anyone until explicitly enabled.
--   'off'  — nothing shown (default)
--   'soft' — dismissible dialog; returns 24h after each dismissal
--   'hard' — full-screen, non-dismissible until both tasks are complete
-- Only one state at a time (single column, so mutually exclusive by design).
--
-- The two operator tasks are derived from existing columns, not duplicated:
--   1. Stripe connected  → tenants.own_stripe_account_id / own_stripe_test_account_id
--   2. Payment details   → tenants.subscription_account = 'uae'
-- When both are complete the prompt auto-hides and 100 live credits are granted
-- exactly once (guarded by migration_reward_granted_at).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS migration_blocker text NOT NULL DEFAULT 'off'
    CHECK (migration_blocker IN ('off', 'soft', 'hard')),
  ADD COLUMN IF NOT EXISTS migration_blocker_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS migration_blocker_dismiss_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS migration_reward_granted_at timestamptz;

COMMENT ON COLUMN public.tenants.migration_blocker IS 'Operator migration prompt: off (default) | soft (dismissible, returns after 24h) | hard (full block until both tasks done)';
COMMENT ON COLUMN public.tenants.migration_blocker_dismissed_at IS 'When the operator last dismissed the soft prompt; it reappears 24h after this';
COMMENT ON COLUMN public.tenants.migration_blocker_dismiss_count IS 'How many times the operator has dismissed the soft prompt';
COMMENT ON COLUMN public.tenants.migration_reward_granted_at IS 'When the 100-credit completion reward was granted (idempotency guard — grant exactly once)';
