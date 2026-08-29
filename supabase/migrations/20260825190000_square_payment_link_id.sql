-- Square: persist the payment-link id so a link can actually be voided.
--
-- WHY THIS COLUMN IS NEEDED
--
-- `void-payment-link` promises, in its own header comment, that after voiding
-- "a still-live link can no longer be paid". For Stripe it keeps that promise by
-- calling checkout.sessions.expire with `stripe_checkout_session_id`.
--
-- The Square adapter already receives the equivalent handle — CreatePaymentLink
-- returns `payment_link.id` and the adapter surfaces it as `paymentLinkId` — but
-- its `persist` block writes only `square_order_id`, and no column existed for
-- the link id. Without it, DeletePaymentLink cannot be called, so a voided
-- Square link stays live and payable while the UI reports it dead. That is a
-- worse failure than not offering the button: the operator believes they closed
-- a payment route and collects the money another way, and then the customer
-- pays the old link too.
--
-- `square_order_id` cannot stand in for it. They are different identifiers on
-- different objects: the order is what a webhook correlates a PAYMENT by, the
-- link id is what the checkout API accepts for deletion.
--
-- ADDITIVE AND INERT
-- Nullable, no default, no constraint change, no backfill. Zero Square payment
-- links exist today, so no row needs one. It is deliberately NOT added to
-- payments_provider_handle_exclusivity_check: that CHECK governs the three MONEY
-- handles, and widening a live constraint on the payments table earns nothing
-- here.

BEGIN;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS square_payment_link_id text;

COMMENT ON COLUMN public.payments.square_payment_link_id IS
  'Square CreatePaymentLink id. Required by DeletePaymentLink when voiding an '
  'unpaid link. Distinct from square_order_id, which is the correlation handle '
  'the webhook resolves a payment by. NULL for every Stripe row.';

-- Voiding looks a link up by id on a single row, so no index is warranted; the
-- primary key already serves that access path.

COMMIT;
