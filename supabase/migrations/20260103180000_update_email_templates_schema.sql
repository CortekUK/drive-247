-- Update email_templates table schema to match expected columns
-- Existing table has: body, name, category
-- We need: template_content, template_name, template_key

-- Add template_key column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'email_templates'
        AND column_name = 'template_key'
    ) THEN
        ALTER TABLE public.email_templates ADD COLUMN template_key text;

        -- Copy data from category column if it exists
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'email_templates'
            AND column_name = 'category'
        ) THEN
            UPDATE public.email_templates SET template_key = category WHERE template_key IS NULL;
        END IF;
    END IF;
END $$;

-- Add template_name column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'email_templates'
        AND column_name = 'template_name'
    ) THEN
        ALTER TABLE public.email_templates ADD COLUMN template_name text;

        -- Copy data from name column if it exists
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'email_templates'
            AND column_name = 'name'
        ) THEN
            UPDATE public.email_templates SET template_name = name WHERE template_name IS NULL;
        END IF;
    END IF;
END $$;

-- Add template_content column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'email_templates'
        AND column_name = 'template_content'
    ) THEN
        ALTER TABLE public.email_templates ADD COLUMN template_content text;

        -- Copy data from body column if it exists
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'email_templates'
            AND column_name = 'body'
        ) THEN
            UPDATE public.email_templates SET template_content = body WHERE template_content IS NULL;
        END IF;
    END IF;
END $$;

-- Now set default values for any NULL values in new columns
UPDATE public.email_templates SET template_key = 'custom' WHERE template_key IS NULL;
UPDATE public.email_templates SET template_name = 'Custom Template' WHERE template_name IS NULL;
UPDATE public.email_templates SET template_content = '' WHERE template_content IS NULL;

-- Add NOT NULL constraints (only if the columns now exist)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'email_templates'
        AND column_name = 'template_key'
        AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE public.email_templates ALTER COLUMN template_key SET NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'email_templates'
        AND column_name = 'template_name'
        AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE public.email_templates ALTER COLUMN template_name SET NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'email_templates'
        AND column_name = 'template_content'
        AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE public.email_templates ALTER COLUMN template_content SET NOT NULL;
    END IF;
END $$;

-- Add unique constraint for tenant_id + template_key if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'email_templates_tenant_id_template_key_key'
    ) THEN
        -- First check if there are duplicates
        DELETE FROM public.email_templates a
        USING public.email_templates b
        WHERE a.id > b.id
        AND a.tenant_id = b.tenant_id
        AND a.template_key = b.template_key;

        ALTER TABLE public.email_templates
        ADD CONSTRAINT email_templates_tenant_id_template_key_key
        UNIQUE (tenant_id, template_key);
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
