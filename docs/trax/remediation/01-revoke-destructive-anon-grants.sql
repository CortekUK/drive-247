-- Stage 0b — remove the destructive table privileges the anonymous key holds.
--
-- NOT APPLIED. Review, run in staging, run the regression list in
-- docs/trax/db-isolation-remediation.md, then apply in a small window.
--
-- CORRECTION (2026-09-18). An earlier version of this file claimed "no browser
-- path deletes or truncates these tables". That was wrong, and the code says so:
--
--   apps/booking/src/app/booking-cancelled/page.tsx:39  deletes from `rentals`
--     with the anon key when a checkout payment fails, to clean the abandoned
--     booking up (and then sets the vehicle back to Available).
--   apps/booking/src/components/BookingCheckoutStep.tsx:1365  deletes the
--     placeholder row from `customers` (`email like 'pending-%@temp.booking'`)
--     once a real customer row exists.
--
-- Both run in the browser as `anon`. So this stage is split: the seven tables
-- with no browser delete are revoked now, and `customers` and `rentals` wait for
-- the server-side cleanup path (stage 2), because revoking them first would
-- leave abandoned rentals holding vehicle availability.
--
-- What this stage does NOT do: it does not enable row-level security and does
-- not remove any read, insert or update privilege. Every anonymous read and
-- write path described in the finding stays open until stages 1, 3 and 4.
--
-- Not affected: the portal and admin apps. Staff delete in a signed-in session
-- as `authenticated`, whose DELETE grant is untouched below.

begin;

-- ── Group A: no browser path deletes these ──────────────────────────────────
-- Verified by listing every `.delete()` in apps/booking/src: the only ones that
-- touch these seven tables do not exist. The customer portal's deletes are on
-- customer_documents, customer_notifications and gig_driver_images, which are
-- not in this list and are handled in stage 3.
revoke delete on
  public.payments,
  public.invoices,
  public.ledger_entries,
  public.payment_applications,
  public.payg_accruals,
  public.rental_extensions,
  public.vehicles
from anon;

-- TRUNCATE goes from both roles on all nine, with no exception: the checkout
-- cleanup uses DELETE on single rows, and nothing in any app truncates a table.
-- A browser holding TRUNCATE can empty a table in one statement.
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
from anon;

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

commit;

-- ── Group B: customers and rentals — after the cleanup moves server-side ────
--
-- The two browser deletes above are legitimate cleanup, but they are also part
-- of the exposure: with the published key, anyone can delete any rental by id,
-- and the `tenant_id` filter those pages apply is supplied by the browser, so it
-- is not a boundary. The fix is not to keep the privilege; it is to move the
-- cleanup into the checkout endpoint built in stage 2, which knows the booking
-- it is cancelling.
--
-- Apply this block once that endpoint is live and both call sites use it:
--
--   begin;
--   revoke delete on public.customers, public.rentals from anon;
--   commit;
--
-- Until then, note honestly: the destructive exposure is only partly closed.

-- ── Verification ────────────────────────────────────────────────────────────
-- After group A, expect DELETE for anon on `customers` and `rentals` only, and
-- no TRUNCATE for either role:
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema='public' and grantee in ('anon','authenticated')
--      and privilege_type in ('DELETE','TRUNCATE')
--      and table_name in ('customers','rentals','payments','invoices','ledger_entries',
--                         'payment_applications','payg_accruals','rental_extensions','vehicles')
--    order by table_name, grantee;
--
-- DELETE and TRUNCATE cannot be granted per column, so the table-level revoke is
-- complete for them. That is NOT true of INSERT, UPDATE, SELECT and REFERENCES:
-- those are also held at column level on these tables (44 columns on customers,
-- 22 on invoices, 16 on ledger_entries, …), so when stage 2 revokes the write
-- privileges it must revoke the column grants too, or they will keep working:
--   select table_name, privilege_type, count(*) from information_schema.column_privileges
--    where table_schema='public' and grantee='anon' group by 1,2 order by 1,2;
