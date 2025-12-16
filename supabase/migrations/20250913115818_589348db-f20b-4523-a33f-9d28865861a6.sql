-- Create trigger to auto-apply credit when new charges are created
CREATE OR REPLACE FUNCTION auto_apply_customer_credit()
RETURNS TRIGGER AS $$
DECLARE
  credit_payment RECORD;
BEGIN
  -- Only process rental charges
  IF NEW.type = 'Charge' AND NEW.category = 'Rental' AND NEW.remaining_amount > 0 THEN
    -- Find payments with remaining credit for this customer
    FOR credit_payment IN
      SELECT id FROM payments 
      WHERE customer_id = NEW.customer_id 
        AND status IN ('Credit', 'Partial')
        AND remaining_amount > 0
      ORDER BY payment_date ASC, created_at ASC
    LOOP
      -- Apply the payment using our FIFO function
      PERFORM payment_apply_fifo(credit_payment.id);
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on ledger_entries for new charges
DROP TRIGGER IF EXISTS trigger_auto_apply_credit ON ledger_entries;
CREATE TRIGGER trigger_auto_apply_credit
  AFTER INSERT OR UPDATE ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION auto_apply_customer_credit();