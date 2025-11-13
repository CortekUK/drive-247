-- Run this query to check the current schema of pricing_extras table
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pricing_extras'
ORDER BY ordinal_position;
