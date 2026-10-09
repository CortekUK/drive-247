-- APPLIED to production 2026-10-09
--
-- Subscription pausing (v2 tenants). A tenant pauses their Drive247
-- subscription for 1 or 2 whole months from Billing → Pause; Super Admin →
-- Customer management → Pausing Accounts decides who may.
--
--   subscription_pause_settings   one row: is pausing open to every v2 tenant,
--                                  or only to the pilot tenant (ali-rentals)?
--   tenant_subscription_pauses    one row per pause, scheduled → active → ended
--                                  (or cancelled before it starts).
--
-- WHAT "PAUSED" MEANS. A tenant is paused while it has an open pause whose
-- [starts_at, ends_at) contains now(). Worked out from the dates every time,
-- never from `status`, so a pause starts and ends on the minute even if the
-- runner (subscription-pause-run) is late — and after ends_at the account is
-- simply active again: the 2-month limit cannot be outstayed.
--
-- While paused:
--   - billing: Stripe `pause_collection` (behavior void, resumes_at = ends_at),
--     set by the edge functions. The billing anchor is untouched, so a tenant
--     billed on the 20th is still billed on the 20th afterwards.
--   - nothing is deleted.
--   - new rentals, vehicles and customers are refused here, by trigger, so the
--     portal, the booking site and every edge function are covered alike.
--   - the booking site reads get_tenant_booking_pause() and shows
--     "Booking on hold".

-- ── Settings ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subscription_pause_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Off: only the pilot tenant may pause. On: every v2 tenant.
  all_v2_enabled boolean NOT NULL DEFAULT false,
  pilot_tenant_slug text NOT NULL DEFAULT 'ali-rentals',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);
INSERT INTO public.subscription_pause_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Pauses ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_subscription_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- The calendar days the tenant picked; end_date is the day they are back.
  start_date date NOT NULL,
  end_date date NOT NULL,
  months smallint NOT NULL CHECK (months IN (1, 2)),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  -- What Stripe was told: pending (not yet), applied (collection paused),
  -- failed (see stripe_error), resumed (collection back on), not_needed (no
  -- live Stripe subscription, or the pause never started).
  stripe_status text NOT NULL DEFAULT 'pending'
    CHECK (stripe_status IN ('pending', 'applied', 'failed', 'resumed', 'not_needed')),
  stripe_error text,
  stripe_attempts integer NOT NULL DEFAULT 0,
  stripe_subscription_id text,
  requested_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ended_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT tenant_subscription_pauses_order CHECK (ends_at > starts_at AND end_date > start_date),
  -- Two calendar months is at most 62 days; the edge function checks the exact
  -- month arithmetic, this is the backstop.
  CONSTRAINT tenant_subscription_pauses_max CHECK (end_date - start_date <= 62)
);

-- One open pause per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_subscription_pauses_one_open
  ON public.tenant_subscription_pauses (tenant_id)
  WHERE status IN ('scheduled', 'active');
CREATE INDEX IF NOT EXISTS idx_tenant_subscription_pauses_tenant
  ON public.tenant_subscription_pauses (tenant_id, created_at DESC);

ALTER TABLE public.subscription_pause_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscription_pauses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage pause settings" ON public.subscription_pause_settings;
CREATE POLICY "super admins manage pause settings" ON public.subscription_pause_settings
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Super admins read every pause. Tenants read theirs through
-- get_my_subscription_pause(); every write goes through the edge functions.
DROP POLICY IF EXISTS "super admins read pauses" ON public.tenant_subscription_pauses;
CREATE POLICY "super admins read pauses" ON public.tenant_subscription_pauses
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- ── Who may pause ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.subscription_pause_allowed(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tenants t, subscription_pause_settings s
    WHERE t.id = p_tenant_id
      AND s.id = 1
      AND t.portal_experience = 'v2'
      AND (s.all_v2_enabled OR t.slug = s.pilot_tenant_slug)
  );
$$;
REVOKE ALL ON FUNCTION public.subscription_pause_allowed(uuid) FROM public, anon, authenticated;

-- ── Is this tenant paused right now ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tenant_pause_ends_at(p_tenant_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.ends_at
  FROM tenant_subscription_pauses p
  WHERE p.tenant_id = p_tenant_id
    AND p.status IN ('scheduled', 'active')
    AND p.starts_at <= now()
    AND p.ends_at > now()
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.tenant_pause_ends_at(uuid) FROM public, anon, authenticated;

-- ── Portal: the caller's tenant ─────────────────────────────────────────────
-- { eligible, paused_now, pause } for a member of the tenant (or a super
-- admin viewing it); null for anyone else.

CREATE OR REPLACE FUNCTION public.get_my_subscription_pause(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row tenant_subscription_pauses;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_users u
    WHERE u.auth_user_id = auth.uid()
      AND coalesce(u.is_active, true)
      AND (u.tenant_id = p_tenant_id OR coalesce(u.is_super_admin, false))
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row
  FROM tenant_subscription_pauses p
  WHERE p.tenant_id = p_tenant_id
    AND p.status IN ('scheduled', 'active')
    AND p.ends_at > now()
  ORDER BY p.starts_at
  LIMIT 1;

  RETURN jsonb_build_object(
    'eligible', subscription_pause_allowed(p_tenant_id),
    'paused_now', tenant_pause_ends_at(p_tenant_id) IS NOT NULL,
    'pause', CASE WHEN v_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_row.id,
      'start_date', v_row.start_date,
      'end_date', v_row.end_date,
      'months', v_row.months,
      'starts_at', v_row.starts_at,
      'ends_at', v_row.ends_at,
      'status', v_row.status,
      'stripe_status', v_row.stripe_status
    ) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_subscription_pause(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_subscription_pause(uuid) TO authenticated;

-- ── Booking site: public notice ─────────────────────────────────────────────
-- Only whether bookings are on hold and until when — nothing else about the
-- tenant's billing.

CREATE OR REPLACE FUNCTION public.get_tenant_booking_pause(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN e IS NULL THEN NULL
              ELSE jsonb_build_object('paused', true, 'resumes_at', e) END
  FROM (SELECT tenant_pause_ends_at(p_tenant_id) AS e) x;
$$;
REVOKE ALL ON FUNCTION public.get_tenant_booking_pause(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_tenant_booking_pause(uuid) TO anon, authenticated;

-- ── No new rentals, vehicles or customers while paused ──────────────────────

CREATE OR REPLACE FUNCTION public.block_insert_while_paused()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ends timestamptz;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_ends := tenant_pause_ends_at(NEW.tenant_id);
  IF v_ends IS NOT NULL THEN
    RAISE EXCEPTION 'This account is paused until %. New % can be added again once the pause ends.',
      to_char(v_ends AT TIME ZONE 'UTC', 'FMDD Mon YYYY'), TG_ARGV[0]
      USING ERRCODE = 'P0001', HINT = 'account_paused';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_insert_while_paused ON public.rentals;
CREATE TRIGGER block_insert_while_paused BEFORE INSERT ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION public.block_insert_while_paused('rentals');
DROP TRIGGER IF EXISTS block_insert_while_paused ON public.vehicles;
CREATE TRIGGER block_insert_while_paused BEFORE INSERT ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.block_insert_while_paused('vehicles');
DROP TRIGGER IF EXISTS block_insert_while_paused ON public.customers;
CREATE TRIGGER block_insert_while_paused BEFORE INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.block_insert_while_paused('customers');

-- ── Runner ──────────────────────────────────────────────────────────────────
-- subscription-pause-run every 5 minutes: tells Stripe when a scheduled pause
-- starts, and closes pauses that have ended (Stripe resumes by itself at
-- resumes_at; the runner makes sure and records it). The command is built from
-- the existing customer-management-run job so the key never sits in the repo.

DO $$
DECLARE
  v_cmd text;
BEGIN
  SELECT replace(command, 'customer-management-run', 'subscription-pause-run')
    INTO v_cmd FROM cron.job WHERE jobname = 'customer-management-run';
  IF v_cmd IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'subscription-pause-run';
    PERFORM cron.schedule('subscription-pause-run', '*/5 * * * *', v_cmd);
  END IF;
END $$;
