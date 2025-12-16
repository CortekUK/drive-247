-- Add policy to allow users to update their own password change flag
CREATE POLICY "p_update_own_password_flag" ON public.app_users
FOR UPDATE 
TO authenticated
USING (auth_user_id = auth.uid())
WITH CHECK (auth_user_id = auth.uid());