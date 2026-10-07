-- APPLIED to production 2026-10-07 via the Management API.
--
-- Tiered retention offers — the "The price is too high for us" discount in the
-- v2 cancel flow, set by a super admin instead of hard-coded.
--
--   retention_offer_settings   one row: the default offer (10% for 1 month)
--   tenant_retention_offers    per-tenant override of percent / months
--   tenant_retention_redemptions
--                              ONE row per tenant, ever. The primary key on
--                              tenant_id is the one-time rule: a tenant who has
--                              accepted an offer can never accept another, even
--                              after it runs out or they ask again.
--
-- Tenants never read these tables directly; the portal asks
-- get_my_retention_offer() and accepts through the accept-retention-offer edge
-- function (service role), which also attaches the Stripe coupon.

CREATE TABLE IF NOT EXISTS public.retention_offer_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  default_percent integer NOT NULL DEFAULT 10 CHECK (default_percent BETWEEN 1 AND 100),
  default_months integer NOT NULL DEFAULT 1 CHECK (default_months BETWEEN 1 AND 36),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);
INSERT INTO public.retention_offer_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tenant_retention_offers (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  percent integer NOT NULL CHECK (percent BETWEEN 1 AND 100),
  months integer NOT NULL CHECK (months BETWEEN 1 AND 36),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.tenant_retention_redemptions (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  percent integer NOT NULL CHECK (percent BETWEEN 1 AND 100),
  months integer NOT NULL CHECK (months BETWEEN 1 AND 36),
  source text NOT NULL CHECK (source IN ('default', 'tenant')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  accepted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ends_at timestamptz,
  stripe_coupon_id text,
  stripe_status text NOT NULL DEFAULT 'pending' CHECK (stripe_status IN ('pending', 'applied', 'failed', 'no_subscription')),
  stripe_error text,
  request_id uuid
);

ALTER TABLE public.retention_offer_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_retention_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_retention_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage retention settings" ON public.retention_offer_settings;
CREATE POLICY "super admins manage retention settings" ON public.retention_offer_settings
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "super admins manage tenant retention offers" ON public.tenant_retention_offers;
CREATE POLICY "super admins manage tenant retention offers" ON public.tenant_retention_offers
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Read only: redemptions are written by the edge function (service role). A
-- super admin may delete one to deliberately give a tenant a second chance.
DROP POLICY IF EXISTS "super admins read retention redemptions" ON public.tenant_retention_redemptions;
CREATE POLICY "super admins read retention redemptions" ON public.tenant_retention_redemptions
  FOR SELECT TO authenticated USING (public.is_super_admin());
DROP POLICY IF EXISTS "super admins delete retention redemptions" ON public.tenant_retention_redemptions;
CREATE POLICY "super admins delete retention redemptions" ON public.tenant_retention_redemptions
  FOR DELETE TO authenticated USING (public.is_super_admin());

-- What the signed-in portal user's tenant would be offered right now.
--   available = false once the tenant has redeemed (or offers are switched off);
--   redemption carries what they accepted, for the "already used" wording.
CREATE OR REPLACE FUNCTION public.get_my_retention_offer()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  s public.retention_offer_settings;
  o public.tenant_retention_offers;
  r public.tenant_retention_redemptions;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('available', false);
  END IF;
  SELECT * INTO s FROM public.retention_offer_settings WHERE id;
  SELECT * INTO o FROM public.tenant_retention_offers WHERE tenant_id = v_tenant;
  SELECT * INTO r FROM public.tenant_retention_redemptions WHERE tenant_id = v_tenant;
  RETURN jsonb_build_object(
    'available', r.tenant_id IS NULL AND coalesce(s.enabled, true),
    'percent', coalesce(o.percent, s.default_percent, 10),
    'months', coalesce(o.months, s.default_months, 1),
    'redemption', CASE WHEN r.tenant_id IS NULL THEN NULL ELSE jsonb_build_object(
      'percent', r.percent, 'months', r.months, 'accepted_at', r.accepted_at, 'ends_at', r.ends_at
    ) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_retention_offer() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_retention_offer() TO authenticated;
