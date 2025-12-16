-- Fix the must_change_password flag for the current admin user
UPDATE app_users 
SET must_change_password = false 
WHERE auth_user_id = '1b2abd63-86da-4f46-8d5d-27305f727a3e';