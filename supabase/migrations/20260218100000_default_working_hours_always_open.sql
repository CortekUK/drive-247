-- Change default for working_hours_always_open to true for new tenants
ALTER TABLE public.tenants
  ALTER COLUMN working_hours_always_open SET DEFAULT true;
