-- The v2 profile dialog lets a signed-in user rename themselves and change their
-- email. `authenticated` only held column UPDATE on (avatar_url,
-- must_change_password), so both failed with "permission denied for table
-- app_users". Additive only (V2_PLAN §4): one column grant, one new function.

-- NAME: a person may rename their own row. RLS already limits UPDATE to the
-- caller's own row (p_update_own_password_flag: auth_user_id = auth.uid()) or a
-- super admin.
GRANT UPDATE (name) ON public.app_users TO authenticated;

-- EMAIL: deliberately NOT granted as a column. A writable app_users.email would
-- let anyone put any address on their staff record. Instead this copies the
-- address Supabase Auth has already VERIFIED (auth.users.email) onto the
-- caller's own row, and nothing else. No argument, so it cannot be pointed at
-- anyone else or at an unverified address.
CREATE OR REPLACE FUNCTION public.sync_my_app_user_email()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  verified text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  SELECT u.email INTO verified FROM auth.users u WHERE u.id = auth.uid();
  IF verified IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.app_users
     SET email = verified
   WHERE auth_user_id = auth.uid()
     AND email IS DISTINCT FROM verified;

  RETURN verified;
END $$;

REVOKE ALL ON FUNCTION public.sync_my_app_user_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_my_app_user_email() TO authenticated;
