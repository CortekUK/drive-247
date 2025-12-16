-- Remove password change requirement for admin user
UPDATE app_users 
SET must_change_password = false 
WHERE email = 'admin@company.com';