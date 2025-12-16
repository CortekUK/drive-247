-- Create app_users table for better separation from Supabase auth
CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('head_admin','admin','ops','viewer')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on app_users
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- Create policies for app_users
CREATE POLICY "p_read_self" ON public.app_users
  FOR SELECT USING (
    auth.uid() = auth_user_id OR 
    EXISTS (
      SELECT 1 FROM public.app_users au 
      WHERE au.auth_user_id = auth.uid() 
      AND au.role IN ('admin','head_admin')
      AND au.is_active = true
    )
  );

CREATE POLICY "p_admin_manage" ON public.app_users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.app_users au 
      WHERE au.auth_user_id = auth.uid() 
      AND au.role IN ('admin','head_admin')
      AND au.is_active = true
    )
  );

-- Create audit logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.app_users(id),
  action TEXT NOT NULL,
  target_user_id UUID REFERENCES public.app_users(id),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p_audit_read" ON public.audit_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.app_users au 
      WHERE au.auth_user_id = auth.uid() 
      AND au.role IN ('admin','head_admin')
      AND au.is_active = true
    )
  );

-- Update existing users table to work with new system
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE;

-- Create function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.app_users WHERE auth_user_id = user_id AND is_active = true;
$$;

-- Create function to check if user has role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE auth_user_id = _user_id
      AND role = _role
      AND is_active = true
  )
$$;

-- Create function to check if user has any of the roles
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE auth_user_id = _user_id
      AND role = ANY(_roles)
      AND is_active = true
  )
$$;

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_app_users_updated_at
    BEFORE UPDATE ON public.app_users
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Seed initial head admin if none exists
INSERT INTO public.app_users (auth_user_id, email, name, role, is_active, must_change_password)
SELECT 
  gen_random_uuid(),
  'admin@company.com',
  'System Administrator',
  'head_admin',
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_users WHERE role = 'head_admin'
);