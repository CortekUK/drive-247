-- Add policy to allow users to update their own password change flag
CREATE POLICY "p_update_own_password_flag" ON public.app_users
FOR UPDATE 
USING (auth_user_id = auth.uid())
WITH CHECK (
  auth_user_id = auth.uid() 
  AND OLD.must_change_password = true 
  AND NEW.must_change_password = false
);