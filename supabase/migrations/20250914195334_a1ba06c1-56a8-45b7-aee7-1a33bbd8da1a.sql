-- Reset admin user password using Supabase Admin API
-- This migration will reset the password for the admin user to a temporary password

DO $$
BEGIN
  -- Call Supabase Admin API to reset password
  -- Note: This requires service role access which migrations have
  PERFORM net.http_request(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/auth/v1/admin/users/1b2abd63-86da-4f46-8d5d-27305f727a3e',
    method := 'PUT',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json',
      'apikey', current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'password', 'TempAdmin123!'
    )::text
  );
  
  -- Set must_change_password back to true
  UPDATE app_users 
  SET must_change_password = true 
  WHERE auth_user_id = '1b2abd63-86da-4f46-8d5d-27305f727a3e';
  
END $$;