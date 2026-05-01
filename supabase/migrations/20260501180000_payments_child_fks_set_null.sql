-- Two child FKs pointing at payments(id) were left at NO ACTION, which
-- blocks any deletion of a payments row that's referenced — including the
-- cascade triggered by rental deletion (rentals → payments via CASCADE).
-- Change both to SET NULL so the child row stays (its other columns are
-- still meaningful) but loses its pointer to the deleted payment, matching
-- the pattern already used for scheduled_installments.payment_id and
-- scheduled_installments.settling_payment_id.

ALTER TABLE public.installment_plans
  DROP CONSTRAINT IF EXISTS installment_plans_upfront_payment_id_fkey;

ALTER TABLE public.installment_plans
  ADD CONSTRAINT installment_plans_upfront_payment_id_fkey
  FOREIGN KEY (upfront_payment_id)
  REFERENCES public.payments(id)
  ON DELETE SET NULL;

ALTER TABLE public.ledger_entries
  DROP CONSTRAINT IF EXISTS fk_ledger_entries_payment_id;

ALTER TABLE public.ledger_entries
  ADD CONSTRAINT fk_ledger_entries_payment_id
  FOREIGN KEY (payment_id)
  REFERENCES public.payments(id)
  ON DELETE SET NULL;
