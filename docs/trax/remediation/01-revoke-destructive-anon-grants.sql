-- Stage 0 — remove the destructive half of the public exposure.
-- NOT APPLIED. Review, run in staging, run the regression list in
-- docs/trax/db-isolation-remediation.md, then apply in a small window.
--
-- No browser path deletes or truncates these tables: the booking site inserts,
-- the customer portal reads, and staff deletions go through the portal's
-- authenticated paths, which keep their grants. Reads and inserts are untouched
-- here, so checkout and public browsing cannot be affected by this stage.

begin;

revoke delete, truncate on
  public.customers,
  public.rentals,
  public.payments,
  public.invoices,
  public.ledger_entries,
  public.payment_applications,
  public.payg_accruals,
  public.rental_extensions,
  public.vehicles
from anon;

-- `authenticated` keeps DELETE (staff use it) but never needs TRUNCATE.
revoke truncate on
  public.customers,
  public.rentals,
  public.payments,
  public.invoices,
  public.ledger_entries,
  public.payment_applications,
  public.payg_accruals,
  public.rental_extensions,
  public.vehicles
from authenticated;

-- Verification: expect no DELETE or TRUNCATE rows for anon.
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--  where table_schema='public' and grantee in ('anon','authenticated')
--    and privilege_type in ('DELETE','TRUNCATE')
--    and table_name in ('customers','rentals','payments','invoices','ledger_entries',
--                       'payment_applications','payg_accruals','rental_extensions','vehicles');

commit;
