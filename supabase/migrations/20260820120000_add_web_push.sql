-- ---------------------------------------------------------------------------
-- Web Push (PWA) notifications
--
-- Push is delivered over the standard Web Push protocol (RFC 8030/8291) using
-- a single VAPID keypair — no Firebase, no APNs certificate, no app store.
-- Chrome/Android, Safari/iOS (home-screen PWA only, iOS 16.4+) and Firefox all
-- speak it, so ONE `send-push` edge function reaches every platform.
--
-- The subscription belongs to a DEVICE, not to an account. That is deliberate:
-- a visitor who has never logged in can still be reached (abandoned booking,
-- fleet availability), and the row is back-linked to a customer the moment they
-- authenticate on that device. `customer_id` / `app_user_id` are therefore both
-- nullable, and `device_id` (a client-generated stable id) is what survives a
-- logout.
-- ---------------------------------------------------------------------------

-- Who the subscription belongs to. Staff (portal) and customers (booking) live
-- on different ORIGINS, so their subscriptions are never interchangeable — a
-- send targeting customers must never reach an operator's phone.
DO $$ BEGIN
  CREATE TYPE public.push_audience AS ENUM ('customer', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.push_platform AS ENUM ('ios', 'android', 'desktop', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.push_delivery_status AS ENUM ('sent', 'failed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  audience        public.push_audience NOT NULL,

  -- The push service endpoint IS the identity of the subscription. Unique so a
  -- re-subscribe on the same device updates in place instead of fanning out
  -- duplicate rows that would deliver the same notification N times.
  endpoint        text NOT NULL,
  p256dh          text NOT NULL,
  auth            text NOT NULL,

  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  app_user_id     uuid REFERENCES public.app_users(id) ON DELETE SET NULL,

  device_id       text NOT NULL,
  user_agent      text,
  platform        public.push_platform NOT NULL DEFAULT 'unknown',
  -- iOS only delivers push to a home-screen install. Recorded so the portal can
  -- explain a silent device instead of looking broken.
  is_standalone   boolean NOT NULL DEFAULT false,

  is_active       boolean NOT NULL DEFAULT true,
  failure_count   integer NOT NULL DEFAULT 0,
  last_error      text,
  last_success_at timestamptz,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
  CONSTRAINT push_subscriptions_endpoint_len CHECK (char_length(endpoint) BETWEEN 20 AND 2048),
  CONSTRAINT push_subscriptions_keys_present CHECK (char_length(p256dh) > 0 AND char_length(auth) > 0)
);

-- The only hot query: "every live device for this tenant + audience".
CREATE INDEX IF NOT EXISTS push_subscriptions_tenant_audience_idx
  ON public.push_subscriptions (tenant_id, audience) WHERE is_active;
CREATE INDEX IF NOT EXISTS push_subscriptions_customer_idx
  ON public.push_subscriptions (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_subscriptions_app_user_idx
  ON public.push_subscriptions (app_user_id) WHERE app_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_subscriptions_device_idx
  ON public.push_subscriptions (tenant_id, device_id);

DROP TRIGGER IF EXISTS set_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER set_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Delivery log. Push gives no read receipt on iOS, so the HTTP result from the
-- push service is the only evidence a send ever happened — without this row a
-- "nothing arrived" report is unfalsifiable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_notification_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.push_subscriptions(id) ON DELETE SET NULL,
  endpoint        text NOT NULL,
  audience        public.push_audience NOT NULL,
  title           text NOT NULL,
  body            text,
  url             text,
  status          public.push_delivery_status NOT NULL,
  http_status     integer,
  error           text,
  sent_by         uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  source          text NOT NULL DEFAULT 'manual_test',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_notification_log_tenant_created_idx
  ON public.push_notification_log (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Per-tenant feature flag. Off everywhere by default; flipped on for `test`
-- below. Rollout to a real operator is a flag flip, never a code change.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS push_notifications_enabled boolean NOT NULL DEFAULT false;

-- `anon` holds COLUMN-LEVEL select grants on tenants, not a table-wide one. A
-- new column is therefore invisible to it by default, and Postgres refuses the
-- WHOLE row rather than just that column — so a missing grant here does not
-- degrade push, it takes every logged-out booking site's branding down with it.
GRANT SELECT (push_notifications_enabled) ON public.tenants TO anon;

-- ---------------------------------------------------------------------------
-- RLS. Writes are service_role only: subscriptions are created by the
-- `save-push-subscription` edge function (which must accept ANONYMOUS callers,
-- so it cannot rely on a user JWT), and sends are written by `send-push`.
-- Portal staff get read access to their own tenant so the settings screen can
-- show device counts and delivery history.
-- ---------------------------------------------------------------------------
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select_own_tenant ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own_tenant ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS push_subscriptions_service_role_all ON public.push_subscriptions;
CREATE POLICY push_subscriptions_service_role_all ON public.push_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS push_notification_log_select_own_tenant ON public.push_notification_log;
CREATE POLICY push_notification_log_select_own_tenant ON public.push_notification_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS push_notification_log_service_role_all ON public.push_notification_log;
CREATE POLICY push_notification_log_service_role_all ON public.push_notification_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Scoped ON for the `test` tenant only, per the initial rollout.
UPDATE public.tenants SET push_notifications_enabled = true WHERE slug = 'test';
