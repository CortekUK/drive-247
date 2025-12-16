-- Test if org_settings table has all required columns
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'org_settings'
ORDER BY ordinal_position;
