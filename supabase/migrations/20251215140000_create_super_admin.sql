-- Create default super admin user
-- This migration creates a super admin account for accessing the SAAS platform

-- Note: This uses a default password that should be changed after first login
-- Email: admin@cortek.io
-- Password: Admin@Cortek2024

DO $$
DECLARE
  new_user_id uuid;
BEGIN
  -- Create auth user using admin API
  -- Password hash for 'Admin@Cortek2024'
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    role,
    aud
  ) VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    'admin@cortek.io',
    crypt('Admin@Cortek2024', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    'authenticated',
    'authenticated'
  )
  RETURNING id INTO new_user_id;

  -- Create corresponding app_users record with super admin privileges
  INSERT INTO public.app_users (
    auth_user_id,
    email,
    name,
    role,
    is_super_admin,
    is_primary_super_admin,
    created_at,
    updated_at
  ) VALUES (
    new_user_id,
    'admin@cortek.io',
    'Super Admin',
    'head_admin',
    true,
    true,
    now(),
    now()
  );

  -- Log the creation
  RAISE NOTICE 'Super admin created successfully with email: admin@cortek.io';
  RAISE NOTICE 'Default password: Admin@Cortek2024';
  RAISE NOTICE 'IMPORTANT: Change this password after first login!';

END $$;

-- Create identity for the auth user
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  id,
  jsonb_build_object('sub', id::text, 'email', email),
  'email',
  now(),
  now(),
  now()
FROM auth.users
WHERE email = 'admin@cortek.io'
ON CONFLICT DO NOTHING;
