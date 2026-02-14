-- Create manager_permissions table for granular per-tab access control
CREATE TABLE public.manager_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  tab_key TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'viewer' CHECK (access_level IN ('viewer', 'editor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(app_user_id, tab_key)
);

CREATE INDEX idx_manager_permissions_app_user ON public.manager_permissions(app_user_id);

-- Enable RLS
ALTER TABLE public.manager_permissions ENABLE ROW LEVEL SECURITY;

-- Users can read their own permissions
CREATE POLICY "Users can read own permissions"
  ON public.manager_permissions FOR SELECT
  USING (
    app_user_id IN (
      SELECT id FROM public.app_users WHERE auth_user_id = auth.uid()
    )
  );

-- Head admins can read permissions for their tenant's users
CREATE POLICY "Head admins can read tenant permissions"
  ON public.manager_permissions FOR SELECT
  USING (
    app_user_id IN (
      SELECT au.id FROM public.app_users au
      WHERE au.tenant_id = (
        SELECT tenant_id FROM public.app_users WHERE auth_user_id = auth.uid() AND role = 'head_admin'
      )
    )
  );

-- Super admins can read all permissions
CREATE POLICY "Super admins can read all permissions"
  ON public.manager_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE auth_user_id = auth.uid() AND is_super_admin = true
    )
  );

-- Only service_role can INSERT/UPDATE/DELETE (edge functions handle mutations)
CREATE POLICY "Service role full access"
  ON public.manager_permissions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
