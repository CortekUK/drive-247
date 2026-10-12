-- APPLIED to production 2026-10-12 via the Management API; cron `tenure-rewards-run` (daily 06:15 UTC) scheduled.
--
-- Tenure Loyalty Rewards (v2 tenants only).
--
-- Super Admin → Customer management → Tenure Rewards defines milestones
-- ("12 months with us → 1 free month") and the `tenure-rewards-run` edge
-- function, once a day, gives each v2 tenant every switched-on milestone it has
-- reached, exactly once.
--
--   tenure_reward_settings   one row: master switch, how tenure is counted
--   tenure_milestones        months threshold + the perk
--   tenure_reward_grants     one row per (milestone, tenant) — the history,
--                            and the claim that makes a perk once-only
--
-- PERKS
--   free_period        N months at 100% off (Stripe coupon, repeating N months)
--   percent_discount   X% off for N months, or forever when duration is empty.
--                      A newer tenure discount REPLACES an earlier one rather
--                      than stacking (10% at 12 months then 15% at 24 = 15%).
--   credits            N platform credits into the tenant's credit wallet
--   manual             anything we fulfil by hand (priority support, a
--                      marketing credit, swag): logged as a to-do for the team
-- Stripe perks are attached by editing the subscription's `discounts` array,
-- like apply-subscription-discount-v2, so referral / promo discounts are kept.
--
-- SAFE BY DEFAULT
--   * the programme ships switched OFF; the cron does nothing until a super
--     admin turns it on
--   * a milestone a tenant had ALREADY passed when the milestone was switched
--     on is logged as "skipped", not granted, unless the milestone says
--     "apply to tenants already past it" — so switching on a 6-month reward
--     doesn't hand one to every older tenant at once. A super admin can still
--     grant a skipped one by hand.
--   * by default only tenants with a live subscription are rewarded; others
--     are simply re-checked on the next run.

-- ── settings ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenure_reward_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  -- account_created: tenants.created_at
  -- first_subscription: the first subscription that got past checkout
  tenure_start text NOT NULL DEFAULT 'account_created' CHECK (tenure_start IN ('account_created','first_subscription')),
  require_active_subscription boolean NOT NULL DEFAULT true,
  notify_tenants boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_summary jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

INSERT INTO public.tenure_reward_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tenure_reward_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "super admins manage tenure reward settings" ON public.tenure_reward_settings;
CREATE POLICY "super admins manage tenure reward settings" ON public.tenure_reward_settings
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
GRANT SELECT, UPDATE ON public.tenure_reward_settings TO authenticated;

-- ── milestones ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenure_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  months integer NOT NULL CHECK (months BETWEEN 1 AND 600),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  perk_type text NOT NULL CHECK (perk_type IN ('free_period','percent_discount','credits','manual')),
  free_months integer CHECK (free_months IS NULL OR free_months BETWEEN 1 AND 36),
  percent integer CHECK (percent IS NULL OR percent BETWEEN 1 AND 100),
  duration_months integer CHECK (duration_months IS NULL OR duration_months BETWEEN 1 AND 120),
  credits integer CHECK (credits IS NULL OR credits BETWEEN 1 AND 1000000),
  perk_description text CHECK (perk_description IS NULL OR char_length(perk_description) <= 500),
  enabled boolean NOT NULL DEFAULT true,
  apply_to_existing boolean NOT NULL DEFAULT false,
  -- When the milestone was (last) switched on; "already past it" is measured
  -- against this. Maintained by the trigger below.
  active_since timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenure_milestones_perk_fields CHECK (
    (perk_type = 'free_period' AND free_months IS NOT NULL) OR
    (perk_type = 'percent_discount' AND percent IS NOT NULL) OR
    (perk_type = 'credits' AND credits IS NOT NULL) OR
    (perk_type = 'manual' AND perk_description IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tenure_milestones_months_uniq ON public.tenure_milestones (months);

CREATE OR REPLACE FUNCTION public.tenure_milestones_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.enabled AND (TG_OP = 'INSERT' OR NOT OLD.enabled OR NEW.active_since IS NULL) THEN
    NEW.active_since := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenure_milestones_touch ON public.tenure_milestones;
CREATE TRIGGER tenure_milestones_touch
  BEFORE INSERT OR UPDATE ON public.tenure_milestones
  FOR EACH ROW EXECUTE FUNCTION public.tenure_milestones_touch();

ALTER TABLE public.tenure_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "super admins manage tenure milestones" ON public.tenure_milestones;
CREATE POLICY "super admins manage tenure milestones" ON public.tenure_milestones
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenure_milestones TO authenticated;

-- Starting set. The programme itself is off, so these do nothing until a super
-- admin switches it on.
INSERT INTO public.tenure_milestones (months, label, perk_type, perk_description, free_months, percent, duration_months)
SELECT * FROM (VALUES
  (6,  '6 months with Drive247',  'manual',           'Priority support for 3 months', NULL::int, NULL::int, NULL::int),
  (12, '1 year with Drive247',    'free_period',      NULL, 1, NULL, NULL),
  (24, '2 years with Drive247',   'percent_discount', NULL, NULL, 10, NULL)
) AS seed(months, label, perk_type, perk_description, free_months, percent, duration_months)
WHERE NOT EXISTS (SELECT 1 FROM public.tenure_milestones);

-- ── grants ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenure_reward_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid REFERENCES public.tenure_milestones(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Snapshot of the milestone at grant time, so history survives edits/deletes.
  months integer NOT NULL,
  label text NOT NULL,
  perk_type text NOT NULL,
  free_months integer,
  percent integer,
  duration_months integer,
  credits integer,
  perk_description text,
  -- processing: claimed by a run; applied: done; pending: waiting for an
  -- active subscription; failed: see detail; skipped: already past it when the
  -- milestone was switched on; manual_todo / fulfilled: hand-delivered perks.
  status text NOT NULL CHECK (status IN ('processing','applied','pending','failed','skipped','manual_todo','fulfilled')),
  detail text,
  stripe_coupon_id text,
  reached_at timestamptz,
  granted_at timestamptz,
  granted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenure_reward_grants_once
  ON public.tenure_reward_grants (milestone_id, tenant_id);
CREATE INDEX IF NOT EXISTS tenure_reward_grants_tenant_idx
  ON public.tenure_reward_grants (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS tenure_reward_grants_touch ON public.tenure_reward_grants;
CREATE TRIGGER tenure_reward_grants_touch
  BEFORE UPDATE ON public.tenure_reward_grants
  FOR EACH ROW EXECUTE FUNCTION public.operator_testimonials_touch();

ALTER TABLE public.tenure_reward_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "super admins manage tenure grants" ON public.tenure_reward_grants;
CREATE POLICY "super admins manage tenure grants" ON public.tenure_reward_grants
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS "tenants read own tenure grants" ON public.tenure_reward_grants;
CREATE POLICY "tenants read own tenure grants" ON public.tenure_reward_grants
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id() AND status <> 'skipped');
GRANT SELECT, UPDATE, DELETE ON public.tenure_reward_grants TO authenticated;

-- ── tenure ──────────────────────────────────────────────────────────────────

-- Every v2 tenant with its tenure, counted the way the settings say. The ONE
-- definition, read by both the admin tab and the runner, so the number on
-- screen is the number the reward is decided on.
CREATE OR REPLACE FUNCTION public.tenure_reward_tenants()
RETURNS TABLE (
  tenant_id uuid,
  slug text,
  company_name text,
  tenant_type text,
  created_at timestamptz,
  first_subscription_at timestamptz,
  started_at timestamptz,
  tenure_months integer,
  tenure_days integer,
  subscription_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mode text;
BEGIN
  IF NOT (public.is_super_admin() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'Only super admins can read tenure' USING ERRCODE = '42501';
  END IF;
  SELECT s.tenure_start INTO v_mode FROM public.tenure_reward_settings s WHERE s.id = 1;

  RETURN QUERY
  WITH base AS (
    SELECT
      t.id, t.slug, t.company_name, t.tenant_type::text AS tenant_type, t.created_at,
      (SELECT min(s.created_at) FROM public.tenant_subscriptions s
        WHERE s.tenant_id = t.id AND s.status::text NOT IN ('incomplete','incomplete_expired')) AS first_sub,
      (SELECT s.status::text FROM public.tenant_subscriptions s
        WHERE s.tenant_id = t.id AND s.status::text IN ('active','trialing','past_due')
        ORDER BY s.created_at DESC LIMIT 1) AS live_status
    FROM public.tenants t
    WHERE t.portal_experience = 'v2' OR t.slug = 'northwind'
  ), started AS (
    SELECT b.*, CASE WHEN v_mode = 'first_subscription' THEN b.first_sub ELSE b.created_at END AS st
    FROM base b
  )
  SELECT
    s.id, s.slug, s.company_name, s.tenant_type, s.created_at, s.first_sub, s.st,
    CASE WHEN s.st IS NULL THEN NULL
      ELSE (extract(year FROM age(now(), s.st)) * 12 + extract(month FROM age(now(), s.st)))::int END,
    CASE WHEN s.st IS NULL THEN NULL ELSE (now()::date - s.st::date) END,
    s.live_status
  FROM started s
  ORDER BY s.st NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.tenure_reward_tenants() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.tenure_reward_tenants() TO authenticated, service_role;
