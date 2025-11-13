-- Rename 'name' column back to 'extra_name' to match PostgREST schema cache
ALTER TABLE public.pricing_extras RENAME COLUMN name TO extra_name;

-- Verify the change
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pricing_extras'
ORDER BY ordinal_position;
