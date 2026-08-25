-- Square checkout idempotency — make the payments row as unique as the Square link.
--
-- THE BUG THIS CLOSES
--
-- createSquareCheckout derives a DETERMINISTIC Square idempotency key from
-- (reference, scope, currency, amount), and pre-inserts a payments row before
-- calling Square. Those two facts disagreed: a customer who clicked "Pay" twice
-- got ONE link back from Square (idempotency working as intended) but TWO
-- payments rows, both later stamped with the SAME square_order_id.
--
-- square-webhook resolves by `order by created_at desc limit 1`, so it completed
-- the newer row and left the older one Pending forever. Worse,
-- recover-pending-square-payments sweeps exactly that shape — Pending with an
-- order_id — finds the order genuinely PAID at Square, marks it Completed and
-- calls payment_apply_fifo_v2. One collection, allocated twice.
--
-- The fix is to give the row the same identity Square gives the link. If the
-- idempotency key matches, Square returns the same link and the same order, so
-- there must be exactly one payments row. The adapter now inserts with this key
-- and, on a unique violation, REUSES the existing row instead of adding another.
--
-- Additive and reversible: a nullable column plus a partial unique index. Every
-- existing row (all 52 tenants are Stripe, and there are zero Square payments)
-- has NULL here and is untouched — NULLs are not equal to one another in a
-- unique index, so Stripe rows can never collide.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS square_idempotency_key text;

COMMENT ON COLUMN public.payments.square_idempotency_key IS
  'Deterministic Square checkout idempotency key. One row per Square payment link - a retried checkout reuses the row rather than creating a duplicate that would later be allocated twice by recover-pending-square-payments.';

-- Partial: only Square rows participate. A Stripe row (NULL) is excluded, so this
-- index cannot affect any existing payment.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_square_idempotency_key
  ON public.payments (square_idempotency_key)
  WHERE square_idempotency_key IS NOT NULL;
