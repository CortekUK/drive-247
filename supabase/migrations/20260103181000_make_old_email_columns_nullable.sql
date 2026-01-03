-- Make old email_templates columns nullable so new code doesn't need them
-- The new columns (template_key, template_name, template_content) are used instead

-- Make old columns nullable
ALTER TABLE public.email_templates ALTER COLUMN body DROP NOT NULL;
ALTER TABLE public.email_templates ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.email_templates ALTER COLUMN category DROP NOT NULL;
