-- Who gets the self-serve Custom Domain flow.
--
-- One switch, set in Super Admin → Customer Management → Custom Domain:
--   off (default)  only the pilot tenant (northwind)
--   on             every v2 tenant (northwind included)
-- v1 tenants never do; they keep the manual-handoff panel.
--
-- Read by the portal (which panel to show) and by the `custom-domain` edge
-- function (which refuses anyone not allowed), through
-- custom_domain_self_serve_allowed().

CREATE TABLE IF NOT EXISTS public.custom_domain_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  all_v2_enabled boolean NOT NULL DEFAULT false,
  pilot_tenant_slug text NOT NULL DEFAULT 'northwind',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);
INSERT INTO public.custom_domain_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.custom_domain_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "super admins manage custom domain settings" ON public.custom_domain_settings;
CREATE POLICY "super admins manage custom domain settings" ON public.custom_domain_settings
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.custom_domain_self_serve_allowed(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tenants t, custom_domain_settings s
    WHERE t.id = p_tenant_id
      AND s.id = 1
      AND t.portal_experience = 'v2'
      AND (s.all_v2_enabled OR t.slug = s.pilot_tenant_slug)
  );
$$;
-- Only a yes/no per tenant; the portal needs it to pick the panel.
REVOKE ALL ON FUNCTION public.custom_domain_self_serve_allowed(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.custom_domain_self_serve_allowed(uuid) TO authenticated, service_role;
