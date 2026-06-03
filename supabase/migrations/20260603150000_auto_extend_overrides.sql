-- Per-occurrence config overrides for auto-extension renewals. Keyed by the grid
-- date (YYYY-MM-DD). Lets an operator tailor a single upcoming renewal:
--   { "2026-06-04": { "sendAgreement": true, "buyInsurance": false,
--                     "sendEmail": true, "emailSubject": "...", "emailBody": "..." } }
-- Absent keys / fields fall back to the rental/tenant defaults.
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS auto_extend_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
