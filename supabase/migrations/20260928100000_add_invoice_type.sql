-- Invoice types: an invoice is raised from a RENTAL, or STANDALONE to a
-- customer with no rental behind it (a payment link, a late fine, a one-off
-- adjustment). 'third_party' is reserved for billing someone who is not a
-- customer (a vehicle owner, an insurer) and is not used yet.
--
-- Applied through the Management API (never `supabase db push` — see
-- gotcha_never_run_db_push). Safe for v1 by construction (V2_PLAN §4):
--
--  * invoice_type is a NEW column with a constant default. Every v1 insert
--    omits it and gets 'rental', which is exactly what every v1 invoice is.
--    A constant default is metadata-only in Postgres 11+: no table rewrite.
--  * The CHECKs constrain only the new column (and rental_id against it).
--    Every existing row is a rental invoice with a rental, so all pass; every
--    v1 insert sets rental_id and takes the 'rental' default, so all pass.
--  * rental_id loses NOT NULL. That changes nothing until a row without a
--    rental exists, and only v2 (northwind) creates one. Every v1 reader was
--    checked on 2026-09-28: edge functions and DB functions look invoices up
--    by rental_id or by id (a standalone invoice never matches); the list
--    screens read the joined rental through optional chaining.

BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_type text NOT NULL DEFAULT 'rental';

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN ('rental', 'standalone', 'third_party'));

-- A rental invoice has a rental; a standalone one does not.
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_rental_check
  CHECK (
    (invoice_type = 'rental' AND rental_id IS NOT NULL)
    OR (invoice_type = 'standalone' AND rental_id IS NULL)
    OR invoice_type = 'third_party'
  );

ALTER TABLE public.invoices
  ALTER COLUMN rental_id DROP NOT NULL;

COMMENT ON COLUMN public.invoices.invoice_type IS
  'rental = raised from a rental; standalone = raised directly to a customer, no rental; third_party = billed to a non-customer (reserved).';

COMMIT;
