-- Retention step 1 — the lifecycle event layer (RETENTION_PLAN.md §2).
--
-- One append-only table of things that happened to a tenant ACCOUNT (not to a
-- renter): signed up, subscribed, paid, failed to pay, finished setup, took a
-- first booking, asked to cancel, cancelled. Every later retention piece —
-- billing emails, health score, milestones, the admin timeline and churn page —
-- reads from here instead of re-deriving the same facts its own way.
--
-- Additive only (V2_PLAN §4): a new table, two new functions and a new cron job.
-- No trigger is placed on any existing table and no v1 edge function changes.
-- Events are DERIVED by re-reading the source tables on a schedule; the
-- `dedupe_key` makes every pass idempotent, which also backfills history so
-- every tenant has a timeline on the day this lands.

CREATE TABLE IF NOT EXISTS public.tenant_lifecycle_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  occurred_at timestamptz NOT NULL,
  -- derived = read back from existing tables by lifecycle_derive_events();
  -- app = written by the product as it happens; staff = logged by a person.
  source      text NOT NULL DEFAULT 'derived'
              CHECK (source IN ('derived', 'app', 'staff')),
  dedupe_key  text NOT NULL UNIQUE,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_lifecycle_events_tenant_time_idx
  ON public.tenant_lifecycle_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS tenant_lifecycle_events_type_time_idx
  ON public.tenant_lifecycle_events (event_type, occurred_at DESC);

ALTER TABLE public.tenant_lifecycle_events ENABLE ROW LEVEL SECURITY;

-- Internal customer-success data: super admins read it, nobody writes it from a
-- client. Writes come from SECURITY DEFINER functions and service_role.
DROP POLICY IF EXISTS tenant_lifecycle_events_super_admin_read ON public.tenant_lifecycle_events;
CREATE POLICY tenant_lifecycle_events_super_admin_read
  ON public.tenant_lifecycle_events FOR SELECT TO authenticated
  USING (public.is_super_admin());

REVOKE ALL ON public.tenant_lifecycle_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.tenant_lifecycle_events FROM authenticated;

-- ---------------------------------------------------------------------------
-- lifecycle_derive_events() — re-reads the source tables, inserts what is new.
-- Each source is its own sub-block: a column renamed under one source must not
-- stop the other eleven from recording. Returns the number of rows inserted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifecycle_derive_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total integer := 0;
  n     integer;
BEGIN
  -- account.created
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT t.id, 'account.created', t.created_at, 'account.created:' || t.id,
           jsonb_build_object('tenant_type', t.tenant_type)
    FROM tenants t
    WHERE t.created_at IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle account.created: %', SQLERRM;
  END;

  -- onboarding.completed
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key)
    SELECT t.id, 'onboarding.completed', t.setup_completed_at, 'onboarding.completed:' || t.id
    FROM tenants t
    WHERE t.setup_completed_at IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle onboarding.completed: %', SQLERRM;
  END;

  -- subscription.started / trial.started — one per subscription row
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT s.tenant_id,
           CASE WHEN s.trial_end IS NOT NULL THEN 'trial.started' ELSE 'subscription.started' END,
           s.created_at,
           'subscription.started:' || s.id,
           jsonb_build_object('subscription_id', s.id, 'plan', s.plan_name, 'amount', s.amount,
                              'currency', s.currency, 'interval', s.interval, 'trial_end', s.trial_end)
    FROM tenant_subscriptions s
    WHERE s.tenant_id IS NOT NULL AND s.created_at IS NOT NULL
      AND s.status <> 'incomplete'
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle subscription.started: %', SQLERRM;
  END;

  -- cancellation.scheduled — set to end at period end
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT s.tenant_id, 'cancellation.scheduled', COALESCE(s.canceled_at, s.updated_at),
           'cancellation.scheduled:' || s.id || ':' || to_char(s.cancel_at, 'YYYY-MM-DD'),
           jsonb_build_object('subscription_id', s.id, 'plan', s.plan_name, 'cancel_at', s.cancel_at)
    FROM tenant_subscriptions s
    WHERE s.tenant_id IS NOT NULL AND s.cancel_at IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle cancellation.scheduled: %', SQLERRM;
  END;

  -- cancellation.completed
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT s.tenant_id, 'cancellation.completed',
           COALESCE(s.ended_at, s.canceled_at, s.updated_at),
           'cancellation.completed:' || s.id,
           jsonb_build_object('subscription_id', s.id, 'plan', s.plan_name, 'amount', s.amount,
                              'currency', s.currency)
    FROM tenant_subscriptions s
    WHERE s.tenant_id IS NOT NULL AND s.status = 'canceled'
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle cancellation.completed: %', SQLERRM;
  END;

  -- billing.payment_succeeded — one per paid invoice with money on it
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT i.tenant_id, 'billing.payment_succeeded', COALESCE(i.paid_at, i.updated_at),
           'billing.payment_succeeded:' || i.id,
           jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number,
                              'amount', i.amount_paid, 'currency', i.currency,
                              'period_start', i.period_start, 'period_end', i.period_end,
                              'billing_reason', i.billing_reason)
    FROM tenant_subscription_invoices i
    WHERE i.tenant_id IS NOT NULL AND i.status = 'paid' AND COALESCE(i.amount_paid, 0) > 0
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle billing.payment_succeeded: %', SQLERRM;
  END;

  -- billing.payment_failed — one per failed attempt
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT i.tenant_id, 'billing.payment_failed', i.updated_at,
           'billing.payment_failed:' || i.id || ':' || i.attempt_count,
           jsonb_build_object('invoice_id', i.id, 'invoice_number', i.invoice_number,
                              'amount', i.amount_due, 'currency', i.currency,
                              'attempt', i.attempt_count, 'next_attempt', i.next_payment_attempt)
    FROM tenant_subscription_invoices i
    WHERE i.tenant_id IS NOT NULL AND COALESCE(i.attempt_count, 0) > 0
      AND i.status IN ('open', 'uncollectible')
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle billing.payment_failed: %', SQLERRM;
  END;

  -- billing.refunded / billing.dispute_created
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT i.tenant_id, 'billing.refunded', i.refunded_at, 'billing.refunded:' || i.id,
           jsonb_build_object('invoice_id', i.id, 'amount', i.amount_refunded, 'currency', i.currency)
    FROM tenant_subscription_invoices i
    WHERE i.tenant_id IS NOT NULL AND i.refunded_at IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT i.tenant_id, 'billing.dispute_created', i.disputed_at, 'billing.dispute_created:' || i.id,
           jsonb_build_object('invoice_id', i.id, 'amount', i.amount_paid, 'currency', i.currency,
                              'dispute_status', i.dispute_status)
    FROM tenant_subscription_invoices i
    WHERE i.tenant_id IS NOT NULL AND i.disputed_at IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle billing refund/dispute: %', SQLERRM;
  END;

  -- billing.charge_upcoming — a live subscription renews within 3 days.
  -- Keyed on the period end, so each renewal is announced exactly once.
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT s.tenant_id, 'billing.charge_upcoming', now(),
           'billing.charge_upcoming:' || s.id || ':' || to_char(s.current_period_end, 'YYYY-MM-DD'),
           jsonb_build_object('subscription_id', s.id, 'plan', s.plan_name, 'amount', s.amount,
                              'currency', s.currency, 'charge_at', s.current_period_end)
    FROM tenant_subscriptions s
    WHERE s.tenant_id IS NOT NULL
      AND s.status IN ('active', 'trialing')
      AND s.cancel_at IS NULL
      AND s.current_period_end > now()
      AND s.current_period_end <= now() + interval '3 days'
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle billing.charge_upcoming: %', SQLERRM;
  END;

  -- milestone.reached — 1st, 10th, 50th, 100th, 250th, 500th booking taken
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT r.tenant_id, 'milestone.reached', r.created_at,
           'milestone.reached:bookings_' || r.nth || ':' || r.tenant_id,
           jsonb_build_object('metric', 'bookings', 'threshold', r.nth, 'rental_id', r.id)
    FROM (
      SELECT id, tenant_id, created_at,
             row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS nth
      FROM rentals
      WHERE tenant_id IS NOT NULL AND created_at IS NOT NULL
        AND status NOT IN ('Cancelled', 'Rejected')
    ) r
    WHERE r.nth IN (1, 10, 50, 100, 250, 500)
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle milestone bookings: %', SQLERRM;
  END;

  -- booking.first_completed — first rental that reached Closed
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT DISTINCT ON (r.tenant_id)
           r.tenant_id, 'booking.first_completed',
           LEAST(COALESCE(r.end_date::timestamptz, r.updated_at), r.updated_at),
           'booking.first_completed:' || r.tenant_id,
           jsonb_build_object('rental_id', r.id)
    FROM rentals r
    WHERE r.tenant_id IS NOT NULL AND r.status = 'Closed'
    ORDER BY r.tenant_id, r.updated_at, r.id
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle booking.first_completed: %', SQLERRM;
  END;

  -- golive.requested / golive.approved — Stripe, Bonzah, cancellation requests
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT g.tenant_id,
           CASE WHEN g.integration_type = 'subscription_cancellation'
                THEN 'cancellation.started' ELSE 'golive.requested' END,
           g.created_at, 'request.created:' || g.id,
           jsonb_build_object('request_id', g.id, 'kind', g.integration_type, 'note', left(g.note, 500))
    FROM go_live_requests g
    WHERE g.tenant_id IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT g.tenant_id, 'golive.approved', g.reviewed_at, 'request.approved:' || g.id,
           jsonb_build_object('request_id', g.id, 'kind', g.integration_type)
    FROM go_live_requests g
    WHERE g.tenant_id IS NOT NULL AND g.status = 'approved' AND g.reviewed_at IS NOT NULL
      AND g.integration_type <> 'subscription_cancellation'
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle go_live_requests: %', SQLERRM;
  END;

  -- feedback.submitted
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT f.tenant_id, 'feedback.submitted', f.created_at, 'feedback.submitted:' || f.id,
           jsonb_build_object('feedback_id', f.id, 'category', f.category, 'rating', f.rating,
                              'message', left(f.message, 300))
    FROM tenant_feedback f
    WHERE f.tenant_id IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle feedback.submitted: %', SQLERRM;
  END;

  -- support.ticket_opened
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, dedupe_key, payload)
    SELECT t.tenant_id, 'support.ticket_opened', t.created_at, 'support.ticket_opened:' || t.id,
           jsonb_build_object('ticket_id', t.id, 'reference', t.reference, 'summary', left(t.summary, 300))
    FROM trax_support_tickets t
    WHERE t.tenant_id IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle support.ticket_opened: %', SQLERRM;
  END;

  -- staff.contacted — onboarding follow-ups logged by the team
  BEGIN
    INSERT INTO tenant_lifecycle_events (tenant_id, event_type, occurred_at, source, dedupe_key, payload)
    SELECT o.tenant_id, 'staff.contacted', COALESCE(o.contacted_at, o.created_at), 'staff',
           'staff.contacted:' || o.id,
           jsonb_build_object('stage', o.stage, 'channel', o.channel, 'note', left(o.note, 300))
    FROM onboarding_followups o
    WHERE o.tenant_id IS NOT NULL
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'lifecycle staff.contacted: %', SQLERRM;
  END;

  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION public.lifecycle_derive_events() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- lifecycle_timeline(tenant) — what the admin Timeline tab reads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lifecycle_timeline(p_tenant_id uuid, p_limit integer DEFAULT 300)
RETURNS SETOF public.tenant_lifecycle_events
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM tenant_lifecycle_events
  WHERE tenant_id = p_tenant_id
  ORDER BY occurred_at DESC, created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 1000);
$$;

-- Every 15 minutes. Unschedule first so re-running this file is safe.
DO $$
BEGIN
  PERFORM cron.unschedule('lifecycle-derive-events')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lifecycle-derive-events');
  PERFORM cron.schedule('lifecycle-derive-events', '*/15 * * * *',
                        'SELECT public.lifecycle_derive_events();');
END $$;

-- Backfill now.
SELECT public.lifecycle_derive_events();
