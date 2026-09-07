-- Receipts, which are not invoices.
--
-- The Billing page offers "Invoice" and "Receipt" as two separate actions,
-- because they are two different documents:
--
--   INVOICE — the bill. Exists as soon as Stripe raises it, paid or not.
--             stripe_hosted_invoice_url (view) / stripe_invoice_pdf (download).
--   RECEIPT — proof it was paid. Exists ONLY once a charge has succeeded.
--
-- Stripe puts `receipt_url` on the CHARGE, not on the invoice, so there was
-- nothing on this table that could back a receipt action and the UI would have
-- had to fabricate one from the invoice — i.e. show "proof of payment" for
-- money that may never have arrived.
--
-- subscription-webhook now retrieves the charge on invoice.paid and stores its
-- receipt URL here. Best-effort: a receipt that cannot be fetched must never
-- fail the invoice write, so this stays NULL and the UI simply offers no
-- receipt. NULL is the honest answer, not a missing feature.
alter table public.tenant_subscription_invoices
  add column if not exists stripe_receipt_url text,
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_payment_intent_id text;

comment on column public.tenant_subscription_invoices.stripe_receipt_url is
  'Stripe-hosted RECEIPT for the successful charge — proof of payment, a different document from stripe_hosted_invoice_url (the bill). Written by subscription-webhook on invoice.paid. NULL means no successful payment is on record, and the UI must not offer a receipt.';
