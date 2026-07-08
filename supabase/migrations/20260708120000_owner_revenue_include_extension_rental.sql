-- ============================================================================
-- Owner payouts: recognise ongoing (extension) rental revenue
-- ----------------------------------------------------------------------------
-- view_owner_revenue only counted payments applied to the FIRST invoice's
-- 'Rental'/'InitialFee' charges. On long-running / manually-extended rentals,
-- every subsequent weekly payment is applied to an 'Extension Rental' charge —
-- a category the view excluded entirely — so owners of extended vehicles saw
-- $0 revenue and "No revenue data for this period" (GMT / Christopher Georgia,
-- Jul 2026: $600 of real Extension Rental revenue in the window was invisible).
--
-- Fix: include 'Extension Rental' alongside 'Rental'/'InitialFee'. Tax, service
-- fees, and insurance stay excluded for extensions exactly as they are for the
-- initial invoice (only the rental slice is owner-attributable revenue).
-- ============================================================================
CREATE OR REPLACE VIEW public.view_owner_revenue AS
SELECT
  v.tenant_id,
  v.owner_id,
  v.id              AS vehicle_id,
  v.reg             AS vehicle_reg,
  le.rental_id,
  p.id              AS payment_id,
  p.payment_date::date AS revenue_date,
  pa.amount_applied AS paid_amount
FROM public.payment_applications pa
JOIN public.payments p          ON p.id = pa.payment_id
JOIN public.ledger_entries le   ON le.id = pa.charge_entry_id
JOIN public.vehicles v          ON v.id = le.vehicle_id
WHERE le.type = 'Charge'
  AND le.category IN ('Rental', 'InitialFee', 'Extension Rental')
  AND v.owner_id IS NOT NULL
  AND COALESCE(p.verification_status, '') IN ('approved', 'auto_approved')
  AND (
    v.ownership_assigned_at IS NULL
    OR p.payment_date >= v.ownership_assigned_at::date
  );

COMMENT ON VIEW public.view_owner_revenue IS
  'Per-payment owner-attributable rental revenue (base Rental/InitialFee + Extension Rental), verified payments only, dated on or after ownership assignment. Excludes tax/service-fee/insurance categories.';
