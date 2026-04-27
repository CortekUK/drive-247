-- Allow 'semiweekly' (and any future cadence) on the legacy plan_type column.
-- The new (unit, payments_per_unit) pair is the source of truth; plan_type is
-- kept only as a denormalised label for the few places that still read it.

ALTER TABLE public.installment_plans
  DROP CONSTRAINT IF EXISTS installment_plans_plan_type_check;

ALTER TABLE public.installment_plans
  ADD CONSTRAINT installment_plans_plan_type_check
  CHECK (plan_type = ANY (ARRAY['full','weekly','semiweekly','monthly']::text[]));
