-- APPLIED to production 2026-10-07 via the Management API.
--
-- Webinars (v2 only) — super admin schedules a webinar (title, description,
-- date/time, Google Meet link) under Customer management → Webinars; v2
-- operators see it as a popup on their portal home and register with one
-- click; `webinar-register` records it and emails the confirmation.
--
--   webinars                audience 'all' (minus excluded_tenant_ids) or
--                           'selected' (only target_tenant_ids)
--   webinar_registrations   ONE per tenant per webinar (unique key)
--
-- The portal reads through get_my_webinars(), which applies v2, audience,
-- status and timing for the caller's own tenant. Registration (and the email)
-- goes through the edge function, never a direct insert.

CREATE TABLE IF NOT EXISTS public.webinars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR char_length(description) <= 5000),
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 600),
  timezone text NOT NULL DEFAULT 'UTC',
  meet_url text NOT NULL CHECK (meet_url ~* '^https?://'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'selected')),
  target_tenant_ids uuid[] NOT NULL DEFAULT '{}',
  excluded_tenant_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.webinar_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webinar_id uuid NOT NULL REFERENCES public.webinars(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  email text,
  email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed')),
  email_detail text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webinar_registrations_once UNIQUE (webinar_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_webinar_registrations_webinar ON public.webinar_registrations (webinar_id);

ALTER TABLE public.webinars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webinar_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super admins manage webinars" ON public.webinars;
CREATE POLICY "super admins manage webinars" ON public.webinars
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP POLICY IF EXISTS "super admins read webinar registrations" ON public.webinar_registrations;
CREATE POLICY "super admins read webinar registrations" ON public.webinar_registrations
  FOR SELECT TO authenticated USING (public.is_super_admin());
DROP POLICY IF EXISTS "super admins delete webinar registrations" ON public.webinar_registrations;
CREATE POLICY "super admins delete webinar registrations" ON public.webinar_registrations
  FOR DELETE TO authenticated USING (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.webinars_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_webinars_touch ON public.webinars;
CREATE TRIGGER trg_webinars_touch BEFORE UPDATE ON public.webinars
  FOR EACH ROW EXECUTE FUNCTION public.webinars_touch();

-- Live registration tracking in the admin tab (RLS keeps it to super admins).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.webinar_registrations;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Is this tenant in this webinar's audience? v2 only (the per-tenant switch or
-- the northwind canary), then 'all' minus exclusions, or 'selected' only.
CREATE OR REPLACE FUNCTION public.webinar_tenant_eligible(w public.webinars, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenants t
    WHERE t.id = p_tenant_id
      AND (t.portal_experience = 'v2' OR t.slug = 'northwind')
  )
  AND CASE w.audience
        WHEN 'selected' THEN p_tenant_id = ANY (w.target_tenant_ids)
        ELSE NOT (p_tenant_id = ANY (w.excluded_tenant_ids))
      END;
$$;
REVOKE ALL ON FUNCTION public.webinar_tenant_eligible(public.webinars, uuid) FROM public, anon, authenticated;

-- Published webinars for the caller's tenant that have not ended yet, soonest
-- first, with whether the tenant has registered.
CREATE OR REPLACE FUNCTION public.get_my_webinars()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', w.id,
      'title', w.title,
      'description', w.description,
      'starts_at', w.starts_at,
      'duration_minutes', w.duration_minutes,
      'timezone', w.timezone,
      'meet_url', CASE WHEN r.id IS NULL THEN NULL ELSE w.meet_url END,
      'registered', r.id IS NOT NULL,
      'registered_at', r.registered_at
    ) ORDER BY w.starts_at)
    FROM webinars w
    LEFT JOIN webinar_registrations r ON r.webinar_id = w.id AND r.tenant_id = v_tenant
    WHERE w.status = 'published'
      AND w.starts_at + make_interval(mins => w.duration_minutes) > now()
      AND public.webinar_tenant_eligible(w, v_tenant)
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_webinars() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_webinars() TO authenticated;
