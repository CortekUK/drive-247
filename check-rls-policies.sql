-- Check current RLS policies on org_settings table
SELECT 
  tablename, 
  policyname, 
  cmd, 
  qual, 
  with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'org_settings'
ORDER BY policyname;
