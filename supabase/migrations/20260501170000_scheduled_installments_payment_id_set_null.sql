-- The scheduled_installments.payment_id FK was created with the default NO
-- ACTION rule, which blocks deletion of any payments row referenced by a
-- scheduled installment. Its sibling column scheduled_installments.settling_payment_id
-- (added in the installment redesign) was correctly set to ON DELETE SET NULL.
-- Both columns are written together by installment_settle_invoice, so they
-- should behave the same when their parent payment is removed: drop the
-- pointer, keep the installment row. This unblocks rental delete (which
-- cascades to payments), and matches what 'settling_payment_id' already does.
ALTER TABLE public.scheduled_installments
  DROP CONSTRAINT IF EXISTS scheduled_installments_payment_id_fkey;

ALTER TABLE public.scheduled_installments
  ADD CONSTRAINT scheduled_installments_payment_id_fkey
  FOREIGN KEY (payment_id)
  REFERENCES public.payments(id)
  ON DELETE SET NULL;
