-- Point 4: optional additive surcharge stacking.
-- When true for a tenant, all applicable weekend/holiday surcharges apply
-- additively per day instead of only the highest/priority one.
-- Default false preserves the existing highest-wins behavior.
-- (Already applied live via the Management API this session — this file
--  captures it idempotently for repo parity / from-scratch rebuilds.)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stack_surcharges boolean NOT NULL DEFAULT false;
