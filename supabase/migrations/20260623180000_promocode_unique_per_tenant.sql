-- Promo codes are multi-tenant, but `code` had a GLOBAL unique constraint
-- (promocodes_code_key UNIQUE (code)), so one tenant using a code (e.g. OFF20)
-- blocked every other tenant from creating the same code — surfacing as
-- "duplicate key value violates unique constraint promocodes_code_key" even
-- though the operator's tenant had no such code. Scope uniqueness to the tenant.
ALTER TABLE public.promocodes DROP CONSTRAINT IF EXISTS promocodes_code_key;
ALTER TABLE public.promocodes ADD CONSTRAINT promocodes_code_tenant_key UNIQUE (tenant_id, code);
