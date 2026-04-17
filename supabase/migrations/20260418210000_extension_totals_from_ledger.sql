-- rental_extension_totals was reading paid_amount/refunded_amount/total_amount
-- off the rental_extensions snapshot columns. Those columns are only set when
-- the extension is created — they never update as ledger activity lands, so
-- balance-due and display status drift out of sync after any payment or
-- refund. Switch the view to derive these numbers from ledger_entries scoped
-- to the extension. rental_amount/tax_amount/service_fee_amount/insurance_amount
-- stay as stored on the row (those are the planned breakdown, not the state).

CREATE OR REPLACE VIEW public.rental_extension_totals AS
SELECT
  re.id,
  re.rental_id,
  re.tenant_id,
  re.sequence_number,
  re.status,
  re.previous_end_date,
  re.new_end_date,
  re.extension_days,
  re.rental_amount,
  re.tax_amount,
  re.service_fee_amount,
  re.insurance_amount,
  COALESCE(ledger.total_amount, re.total_amount)::numeric(12,2) AS total_amount,
  COALESCE(ledger.paid_amount, 0)::numeric(12,2) AS paid_amount,
  COALESCE(ledger.refunded_amount, 0)::numeric(12,2) AS refunded_amount,
  COALESCE(ledger.outstanding_amount, 0)::numeric(12,2) AS outstanding_amount,
  CASE
    WHEN re.status = 'cancelled' THEN 'cancelled'
    WHEN re.status = 'pending' THEN 'pending_approval'
    WHEN COALESCE(ledger.total_amount, 0) > 0
         AND COALESCE(ledger.refunded_amount, 0) >= COALESCE(ledger.total_amount, 0) THEN 'refunded'
    WHEN re.status = 'refunded' THEN 'refunded'
    WHEN COALESCE(ledger.total_amount, 0) > 0
         AND COALESCE(ledger.paid_amount, 0) >= COALESCE(ledger.total_amount, 0) THEN 'paid'
    WHEN COALESCE(ledger.paid_amount, 0) > 0 THEN 'partial'
    WHEN re.status = 'approved' THEN 'awaiting_payment'
    ELSE re.status
  END AS display_status,
  re.bonzah_policy_id,
  re.bonzah_confirmed_at,
  bip.status AS bonzah_policy_status,
  bip.policy_no AS bonzah_policy_no,
  bip.premium_amount AS bonzah_premium_amount,
  re.checkout_url,
  re.stripe_checkout_session_id,
  re.stripe_payment_intent_id,
  re.requested_at,
  re.approved_at,
  re.paid_at,
  re.cancelled_at,
  re.created_at,
  re.updated_at
FROM public.rental_extensions re
LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN le.type = 'Charge' THEN le.amount ELSE 0 END) AS total_amount,
    SUM(CASE WHEN le.type = 'Charge' THEN (le.amount - le.remaining_amount) ELSE 0 END) AS paid_amount,
    SUM(CASE WHEN le.type = 'Refund' THEN ABS(le.amount) ELSE 0 END) AS refunded_amount,
    SUM(CASE WHEN le.type = 'Charge' THEN le.remaining_amount ELSE 0 END) AS outstanding_amount
  FROM public.ledger_entries le
  WHERE le.extension_id = re.id
) ledger ON TRUE
LEFT JOIN public.bonzah_insurance_policies bip ON bip.id = re.bonzah_policy_id;
