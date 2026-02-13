-- Relax lockbox_code_length constraint to allow any positive integer (not just 4/6/8)
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_lockbox_code_length_valid;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_lockbox_code_length_valid
  CHECK (lockbox_code_length IS NULL OR (lockbox_code_length >= 1 AND lockbox_code_length <= 20));
