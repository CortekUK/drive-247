-- Fix: live operators mislabeled "Setup Mode" in the portal sidebar.
--
-- ROOT CAUSE: the sidebar shows "Setup Mode" whenever isTrialing is true. The guard
-- meant to suppress it for already-live operators is `tenantAlreadyLive =
-- !!setup_completed_at` (use-tenant-subscription.ts:223). But setup_completed_at is
-- ONLY ever stamped by the trial->active webhook path; an operator who went live but
-- never converted a trial->active (e.g. the UK->UAE migration mints a fresh
-- deferred-billing 'trialing' sub) is left with setup_completed_at = NULL, so the
-- guard is inert and they get flipped back into "Setup Mode" despite operating.
--
-- CORRECT "went live" SIGNAL: stripe_mode='live' AND stripe_account_status='active'.
-- This mirrors the app's own Stripe-complete logic (use-setup-status.ts) and — unlike
-- stripe_onboarding_complete, which is the legacy MANAGED/Express flag and stays false
-- for own-Stripe operators — it correctly covers BOTH managed and own-Stripe tenants
-- while EXCLUDING own-Stripe tenants whose connected account is still 'pending'
-- (they are genuinely mid-setup and SHOULD keep seeing "Setup Mode").
--
-- Verified 2026-07-25: this predicate matches exactly the 17 genuinely-live operators
-- (10 own + 7 managed, all stripe_charges_enabled=true); every excluded unstamped
-- tenant has stripe_account_status='pending' and no live activity. Zero false positives.
BEGIN;

-- 1) One-time backfill for operators who already went live but were never stamped.
--    Timestamp is a real historical go-live date, capped to >2 days ago so the
--    24h "You're Live!" go-live banner (use-setup-status justWentLive) does NOT fire.
UPDATE public.tenants
SET setup_completed_at = LEAST(
      COALESCE(own_stripe_connected_at, created_at),
      now() - interval '2 days'
    )
WHERE stripe_mode = 'live'
  AND stripe_account_status = 'active'
  AND setup_completed_at IS NULL;

-- 2) Prevent recurrence: stamp setup_completed_at the instant a tenant reaches
--    live + active on ANY path (managed onboarding, own-Stripe OAuth connect, admin).
--    now() is correct here — a tenant genuinely going live SHOULD get the go-live banner.
CREATE OR REPLACE FUNCTION public.stamp_setup_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.setup_completed_at IS NULL THEN
    NEW.setup_completed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_setup_completed_at ON public.tenants;
CREATE TRIGGER trg_stamp_setup_completed_at
  BEFORE UPDATE OF stripe_account_status, stripe_mode ON public.tenants
  FOR EACH ROW
  WHEN (
    NEW.stripe_mode = 'live'
    AND NEW.stripe_account_status = 'active'
    AND NEW.setup_completed_at IS NULL
  )
  EXECUTE FUNCTION public.stamp_setup_completed_at();

COMMIT;
