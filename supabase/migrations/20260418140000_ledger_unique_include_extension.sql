-- Relax ledger_entries uniqueness so each rental_extension can own its own
-- charge/refund row per (due_date, type, category). Without this, a second
-- extension with charges (or a refund) falling on the same due_date as an
-- earlier one silently fails the insert, leaving the UI in a stale state.
--
-- Non-extension rows (extension_id IS NULL) still dedupe correctly because
-- COALESCE pins them to a shared sentinel.

DROP INDEX IF EXISTS ux_rental_charge_unique;

CREATE UNIQUE INDEX ux_rental_charge_unique
  ON public.ledger_entries (
    rental_id,
    due_date,
    type,
    category,
    COALESCE(extension_id::text, '')
  );
