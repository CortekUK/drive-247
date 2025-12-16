-- Function to update invoice status based on rental and payments
CREATE OR REPLACE FUNCTION update_invoice_status()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_id UUID;
  v_invoice_total NUMERIC;
  v_total_payments NUMERIC;
BEGIN
  -- If rental status changed to Cancelled, update invoice to cancelled
  IF TG_OP = 'UPDATE' AND NEW.status = 'Cancelled' AND OLD.status != 'Cancelled' THEN
    UPDATE invoices
    SET status = 'cancelled',
        updated_at = now()
    WHERE rental_id = NEW.id
      AND status != 'cancelled';
    RETURN NEW;
  END IF;

  -- Check if this is a payment trigger
  IF TG_TABLE_NAME = 'payments' THEN
    -- Get the invoice for this rental
    SELECT id, total_amount INTO v_invoice_id, v_invoice_total
    FROM invoices
    WHERE rental_id = NEW.rental_id
      AND status = 'pending'
    LIMIT 1;

    IF v_invoice_id IS NOT NULL THEN
      -- Calculate total payments for this rental
      SELECT COALESCE(SUM(amount), 0) INTO v_total_payments
      FROM payments
      WHERE rental_id = NEW.rental_id
        AND status = 'Cleared';

      -- If total payments >= invoice amount, mark as paid
      IF v_total_payments >= v_invoice_total THEN
        UPDATE invoices
        SET status = 'paid',
            updated_at = now()
        WHERE id = v_invoice_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on rentals table for status changes
DROP TRIGGER IF EXISTS trigger_update_invoice_on_rental_status ON rentals;
CREATE TRIGGER trigger_update_invoice_on_rental_status
  AFTER UPDATE OF status ON rentals
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_status();

-- Trigger on payments table for payment changes
DROP TRIGGER IF EXISTS trigger_update_invoice_on_payment ON payments;
CREATE TRIGGER trigger_update_invoice_on_payment
  AFTER INSERT OR UPDATE OF status ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_invoice_status();

COMMENT ON FUNCTION update_invoice_status() IS 'Automatically updates invoice status based on rental status and payments';
