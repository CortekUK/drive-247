-- APPLIED to production 2026-11-19.
--
-- New rentals on the portal (v1 and v2) were being saved with no invoice and no
-- rental, tax or fee charges, so Balance Due showed too little or nothing.
--
-- The portal picks the next INV-YYYYMM-NNNN by reading the highest number it can
-- see. Staff can only see their own company's invoices, but the number has to be
-- unique across every company, so it picked a number another company already had.
-- The insert was refused, and the retry picked the same number again.
--
-- The database now settles it: if the number asked for is taken, the invoice gets
-- the next free one. This covers both rental screens, every other caller of
-- createInvoice, and browser tabs already open on the old code. Staff still see
-- only their own invoices, and the unique index stays as the final guard.

CREATE OR REPLACE FUNCTION public.invoices_assign_free_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prefix text;
  v_next   bigint;
BEGIN
  -- Only the monthly running numbers. Booking-site and other styles are random.
  IF NEW.invoice_number IS NULL OR NEW.invoice_number !~ '^INV-[0-9]{6}-[0-9]{4,}$' THEN
    RETURN NEW;
  END IF;

  v_prefix := left(NEW.invoice_number, 11);

  -- Held until commit, so two rentals saved at the same moment take turns.
  PERFORM pg_advisory_xact_lock(hashtextextended('invoices.invoice_number:' || v_prefix, 0));

  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.invoice_number = NEW.invoice_number) THEN
    SELECT COALESCE(MAX(substring(i.invoice_number FROM 12)::bigint), 0) + 1
      INTO v_next
      FROM public.invoices i
     WHERE i.invoice_number ~ ('^' || v_prefix || '[0-9]{4,}$');

    NEW.invoice_number := v_prefix || lpad(v_next::text, 4, '0');
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.invoices_assign_free_number() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS invoices_assign_free_number ON public.invoices;
CREATE TRIGGER invoices_assign_free_number
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.invoices_assign_free_number();
