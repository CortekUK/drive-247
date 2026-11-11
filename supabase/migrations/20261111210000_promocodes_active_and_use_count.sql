-- P4 Promo codes (2026-11-11). APPLIED to production 2026-11-11.
-- Additive only.
--
-- 1. promocodes.is_active: lets an operator turn a code off without deleting
--    it (the v2 portal's Turn off / Turn on). Every existing row stays on.
-- 2. promo_code_use_count(): how many paid, live rentals used a code. The v2
--    booking site checks it against promocodes.max_users. Customers cannot
--    read `rentals` (RLS), so the count is exposed on its own, as a number
--    and nothing else. Unpaid drafts (payment_status 'pending') and
--    cancelled or rejected rentals do not use up a code.

ALTER TABLE public.promocodes
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.promo_code_use_count(p_tenant_id uuid, p_code text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.rentals r
  WHERE r.tenant_id = p_tenant_id
    AND r.promo_code IS NOT NULL
    AND lower(r.promo_code) = lower(p_code)
    AND r.status NOT IN ('Cancelled', 'Rejected')
    AND r.payment_status IS DISTINCT FROM 'pending';
$$;

REVOKE ALL ON FUNCTION public.promo_code_use_count(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promo_code_use_count(uuid, text) TO anon, authenticated, service_role;
