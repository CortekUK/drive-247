-- Fix infinite recursion in app_users RLS policies

-- First, drop the existing problematic policies
DROP POLICY IF EXISTS "p_read_self" ON public.app_users;
DROP POLICY IF EXISTS "p_admin_manage" ON public.app_users;

-- Create a security definer function to check user roles safely
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT AS $$
BEGIN
  RETURN (
    SELECT role 
    FROM public.app_users 
    WHERE auth_user_id = auth.uid() 
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Create a security definer function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.app_users 
    WHERE auth_user_id = auth.uid() 
    AND role IN ('admin', 'head_admin') 
    AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Recreate policies using the security definer functions
CREATE POLICY "p_read_self" ON public.app_users
FOR SELECT 
USING (
  auth_user_id = auth.uid() OR public.is_current_user_admin()
);

CREATE POLICY "p_admin_manage" ON public.app_users
FOR ALL 
USING (public.is_current_user_admin())
WITH CHECK (public.is_current_user_admin());