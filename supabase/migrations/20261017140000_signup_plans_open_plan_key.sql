-- Signup plans can now be created from the admin Signup Plans page (Oct 17 2026),
-- so plan_key is no longer limited to starter/growth/scale. It stays a stable
-- lowercase slug: signup, Stripe metadata and subscription rows all carry it.
ALTER TABLE public.signup_plans DROP CONSTRAINT IF EXISTS signup_plans_plan_key_check;
ALTER TABLE public.signup_plans
  ADD CONSTRAINT signup_plans_plan_key_check CHECK (plan_key ~ '^[a-z][a-z0-9_]{1,31}$');
