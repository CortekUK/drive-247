-- Add 'manager' to app_users role CHECK constraint
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_role_check
  CHECK (role = ANY (ARRAY['head_admin','admin','manager','ops','viewer']));
