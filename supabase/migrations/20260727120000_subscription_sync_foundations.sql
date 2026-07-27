-- Subscription sync foundations (Tranche 1)
--
-- Context: platform-subscription webhooks were failing in production and the
-- DB silently froze, forcing the team to track subscriptions by hand in the
-- Stripe dashboard. Two independent defects were confirmed against prod:
--
--   1. handleSubscriptionUpdated wrote current_period_start/end unguarded from
--      the raw event payload. Stripe moved those fields onto subscription ITEMS
--      in API version 2025-03-31 (basil), so they arrive undefined on newer
--      endpoint versions -> new Date(NaN).toISOString() -> RangeError -> HTTP
--      500 on every customer.subscription.updated. (Fixed in code, not here.)
--
--   2. THIS FILE: the status CHECK constraint omits 'incomplete_expired', which
--      Stripe genuinely sends. Any such event fails the write, the handler
--      throws, Stripe retries for ~3 days and can then AUTO-DISABLE the
--      endpoint -- which kills delivery of every other subscription event too.
--
-- Widening a CHECK can never reject data that currently passes, so M1 is safe
-- on a live table and needs no backfill. M2 is additive + nullable only.

-- ---------------------------------------------------------------------------
-- M1. Allow the complete set of Stripe subscription statuses.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_subscriptions
  DROP CONSTRAINT IF EXISTS tenant_subscriptions_status_check;

ALTER TABLE public.tenant_subscriptions
  ADD CONSTRAINT tenant_subscriptions_status_check
  CHECK (status = ANY (ARRAY[
    'incomplete',
    'incomplete_expired',  -- added: Stripe sends this; the old constraint rejected it
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused'
  ]));

-- ---------------------------------------------------------------------------
-- M2. Sync-provenance metadata (additive, nullable).
--
-- Lets the admin dashboard show "last synced" and a drift badge, and lets the
-- reconciler avoid clobbering fresher webhook data with a stale Stripe read.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS last_stripe_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_source     text;

COMMENT ON COLUMN public.tenant_subscriptions.last_stripe_event_at IS
  'Stripe-side timestamp of the most recent event applied to this row. Used for out-of-order protection: an older event must not overwrite newer state.';
COMMENT ON COLUMN public.tenant_subscriptions.last_synced_at IS
  'When this row was last confirmed against Stripe (webhook or reconciler).';
COMMENT ON COLUMN public.tenant_subscriptions.last_sync_source IS
  'Which path last wrote this row: webhook | reconcile | backfill | manual.';

-- ---------------------------------------------------------------------------
-- M3. Invoice fields needed for the grace clock and "next invoice due".
--
-- NOTE (verified against prod): due_date is NULL on all 51 existing invoice
-- rows because every subscription is charge_automatically. The grace clock and
-- the admin "next invoice due" column therefore derive from
-- current_period_end / next_payment_attempt, NOT from due_date.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_subscription_invoices
  ADD COLUMN IF NOT EXISTS next_payment_attempt timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count        integer,
  ADD COLUMN IF NOT EXISTS billing_reason       text;

COMMENT ON COLUMN public.tenant_subscription_invoices.next_payment_attempt IS
  'Stripe next_payment_attempt: when Stripe dunning will retry a failed charge.';
