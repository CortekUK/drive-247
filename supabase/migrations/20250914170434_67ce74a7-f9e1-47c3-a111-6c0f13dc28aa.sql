-- Create org_settings table for centralized configuration
CREATE TABLE IF NOT EXISTS public.org_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  company_name text NOT NULL DEFAULT 'Fleet Management System',
  timezone text NOT NULL DEFAULT 'Europe/London',
  currency_code text NOT NULL DEFAULT 'GBP',
  date_format text NOT NULL DEFAULT 'DD/MM/YYYY',
  logo_url text,
  reminder_due_today boolean NOT NULL DEFAULT true,
  reminder_overdue_1d boolean NOT NULL DEFAULT true,
  reminder_overdue_multi boolean NOT NULL DEFAULT true,
  reminder_due_soon_2d boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on org_settings
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for org_settings
CREATE POLICY "Allow all operations for app users" ON public.org_settings
FOR ALL USING (true) WITH CHECK (true);

-- Create maintenance_runs table for tracking maintenance operations
CREATE TABLE IF NOT EXISTS public.maintenance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type text NOT NULL,
  status text NOT NULL DEFAULT 'running', -- running, completed, failed
  payments_processed integer DEFAULT 0,
  customers_affected integer DEFAULT 0,
  revenue_recalculated numeric DEFAULT 0,
  error_message text,
  duration_seconds integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  started_by text
);

-- Enable RLS on maintenance_runs
ALTER TABLE public.maintenance_runs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for maintenance_runs
CREATE POLICY "Allow all operations for app users" ON public.maintenance_runs
FOR ALL USING (true) WITH CHECK (true);

-- Create settings_audit table for change tracking
CREATE TABLE IF NOT EXISTS public.settings_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  operation text NOT NULL, -- insert, update, delete
  old_values jsonb,
  new_values jsonb,
  changed_fields text[],
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on settings_audit
ALTER TABLE public.settings_audit ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for settings_audit
CREATE POLICY "Allow all operations for app users" ON public.settings_audit
FOR ALL USING (true) WITH CHECK (true);

-- Create trigger for org_settings updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_org_settings_updated_at
BEFORE UPDATE ON public.org_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Create audit trigger function
CREATE OR REPLACE FUNCTION public.audit_settings_changes()
RETURNS TRIGGER AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  changed_fields text[] := '{}';
  field_name text;
BEGIN
  -- Convert OLD and NEW to jsonb
  IF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
    
    -- Find changed fields
    FOR field_name IN SELECT jsonb_object_keys(new_data) LOOP
      IF old_data->field_name IS DISTINCT FROM new_data->field_name THEN
        changed_fields := array_append(changed_fields, field_name);
      END IF;
    END LOOP;
  ELSIF TG_OP = 'INSERT' THEN
    new_data := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    old_data := to_jsonb(OLD);
  END IF;

  -- Insert audit record
  INSERT INTO public.settings_audit (
    table_name, operation, old_values, new_values, changed_fields, changed_by
  ) VALUES (
    TG_TABLE_NAME, 
    LOWER(TG_OP), 
    old_data, 
    new_data, 
    CASE WHEN array_length(changed_fields, 1) > 0 THEN changed_fields ELSE NULL END,
    current_setting('app.current_user', true)
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create audit trigger for org_settings
CREATE TRIGGER trg_org_settings_audit
AFTER INSERT OR UPDATE OR DELETE ON public.org_settings
FOR EACH ROW EXECUTE FUNCTION public.audit_settings_changes();

-- Insert default org settings if none exist
INSERT INTO public.org_settings (org_id, company_name, timezone, currency_code, date_format)
SELECT gen_random_uuid(), 'Fleet Management System', 'Europe/London', 'GBP', 'DD/MM/YYYY'
WHERE NOT EXISTS (SELECT 1 FROM public.org_settings);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_org_settings_org_id ON public.org_settings(org_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_runs_status ON public.maintenance_runs(status);
CREATE INDEX IF NOT EXISTS idx_settings_audit_table_name ON public.settings_audit(table_name);
CREATE INDEX IF NOT EXISTS idx_settings_audit_changed_at ON public.settings_audit(changed_at);