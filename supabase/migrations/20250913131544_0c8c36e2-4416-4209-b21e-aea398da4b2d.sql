-- Fix duplicate Initial Fees P&L entries and make posting idempotent

-- 1. Add payment_id column to pnl_entries if it doesn't exist
ALTER TABLE public.pnl_entries 
ADD COLUMN IF NOT EXISTS payment_id uuid;

-- 2. Create unique partial index to prevent duplicate Initial Fees per payment
CREATE UNIQUE INDEX IF NOT EXISTS ux_pnl_initial_fee_once
  ON public.pnl_entries (payment_id)
  WHERE category IN ('Initial Fees', 'InitialFees') AND payment_id IS NOT NULL;

-- 3. Try to backfill payment_id for existing Initial Fees entries
-- Match by source_ref which should contain the payment_id as text
UPDATE public.pnl_entries 
SET payment_id = source_ref::uuid
WHERE category IN ('Initial Fees', 'InitialFees') 
  AND payment_id IS NULL 
  AND source_ref IS NOT NULL 
  AND source_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 4. Delete duplicate Initial Fees entries that have the same payment_id
DELETE FROM public.pnl_entries p1
USING public.pnl_entries p2
WHERE p1.id > p2.id
  AND p1.category IN ('Initial Fees', 'InitialFees')
  AND p2.category IN ('Initial Fees', 'InitialFees')
  AND p1.payment_id IS NOT NULL
  AND p1.payment_id = p2.payment_id;

-- 5. Fallback deduplication for entries without payment_id
-- Delete duplicates by vehicle_id, category, amount, and entry_date
DELETE FROM public.pnl_entries p1
USING public.pnl_entries p2
WHERE p1.id > p2.id
  AND p1.category IN ('Initial Fees', 'InitialFees')
  AND p2.category IN ('Initial Fees', 'InitialFees')
  AND p1.vehicle_id = p2.vehicle_id
  AND p1.amount = p2.amount
  AND DATE(p1.entry_date) = DATE(p2.entry_date);

-- 6. Standardize all remaining Initial Fees entries to use "InitialFees" category
UPDATE public.pnl_entries 
SET category = 'InitialFees'
WHERE category = 'Initial Fees';

-- 7. Update apply_payment_fully function to use payment_id for idempotency
CREATE OR REPLACE FUNCTION public.apply_payment_fully(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_payment record;
  v_active_count int;
  v_charge record;
  v_to_apply numeric(12,2);
BEGIN
  SELECT p.*
    INTO v_payment
    FROM public.payments p
    WHERE p.id = p_payment_id;

  IF v_payment IS NULL THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  -- Resolve rental if missing
  IF v_payment.rental_id IS NULL AND v_payment.payment_type = 'Rental' THEN
    SELECT count(*) INTO v_active_count
    FROM rentals r
    WHERE r.customer_id = v_payment.customer_id
      AND r.status = 'Active';

    IF v_active_count = 1 THEN
      UPDATE public.payments
         SET rental_id = (
           SELECT r.id
           FROM rentals r
           WHERE r.customer_id = v_payment.customer_id
             AND r.status = 'Active'
           LIMIT 1)
       WHERE id = v_payment.id;

      SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;

    ELSIF v_active_count > 1 THEN
      RAISE EXCEPTION 'Select rental to apply this payment (customer has multiple active rentals)';
    ELSE
      RAISE EXCEPTION 'No active rental found for this customer';
    END IF;
  END IF;

  -- Initial fee: immediate revenue + mark applied (IDEMPOTENT)
  IF v_payment.payment_type = 'InitialFee' THEN
    -- Mark payment as applied
    UPDATE public.payments
       SET remaining_amount = 0,
           status = 'Applied'
     WHERE id = v_payment.id;

    -- P&L initial fees entry (idempotent with unique constraint)
    INSERT INTO public.pnl_entries(
      vehicle_id, entry_date, side, category, amount, source_ref, payment_id
    )
    VALUES (
      v_payment.vehicle_id, v_payment.payment_date, 'Revenue', 'InitialFees', 
      v_payment.amount, v_payment.id::text, v_payment.id
    )
    ON CONFLICT ON CONSTRAINT ux_pnl_initial_fee_once DO NOTHING;

    RETURN;
  END IF;

  -- Rental payment: apply FIFO to open charges; if none, create next charge and retry
  <<apply_loop>>
  LOOP
    FOR v_charge IN
      SELECT id, remaining_amount, due_date
      FROM public.ledger_entries
      WHERE rental_id = v_payment.rental_id
        AND type = 'Charge'
        AND category = 'Rental'
        AND remaining_amount > 0
      ORDER BY due_date ASC
    LOOP
      EXIT WHEN COALESCE(v_payment.remaining_amount, v_payment.amount) <= 0;

      v_to_apply := LEAST(COALESCE(v_payment.remaining_amount, v_payment.amount), v_charge.remaining_amount);

      -- create application row
      INSERT INTO public.payment_applications(payment_id, charge_entry_id, amount_applied)
      VALUES (v_payment.id, v_charge.id, v_to_apply);

      -- reduce charge and payment
      UPDATE public.ledger_entries
         SET remaining_amount = remaining_amount - v_to_apply
       WHERE id = v_charge.id;

      UPDATE public.payments
         SET remaining_amount = COALESCE(remaining_amount, amount) - v_to_apply
       WHERE id = v_payment.id;

      -- create revenue P&L entry
      INSERT INTO public.pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
      VALUES (v_payment.vehicle_id, v_payment.payment_date, 'Revenue', 'Rental', v_to_apply, v_payment.id::text);

      -- refresh payment record
      SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    END LOOP;

    -- If still has remaining and no open charges, try creating the next upcoming charge once
    IF COALESCE(v_payment.remaining_amount, 0) > 0 THEN
      PERFORM public.generate_next_rental_charge(v_payment.rental_id);
      -- Then loop again to apply it
      -- Prevent infinite loop: only try once
      IF NOT EXISTS (
        SELECT 1 FROM public.ledger_entries
         WHERE rental_id = v_payment.rental_id
           AND type = 'Charge'
           AND category = 'Rental'
           AND remaining_amount > 0
      ) THEN
        EXIT apply_loop;
      END IF;
    ELSE
      EXIT apply_loop;
    END IF;
  END LOOP;

  -- Finalize payment status
  UPDATE public.payments
     SET remaining_amount = GREATEST(0, COALESCE(remaining_amount, 0)),
         status = CASE WHEN GREATEST(0, COALESCE(remaining_amount, 0)) = 0
                       THEN 'Applied' ELSE 'Partially Applied' END
   WHERE id = v_payment.id;
END;
$function$;

-- 8. Verify the cleanup worked
DO $$
DECLARE
    duplicate_count integer;
    total_initial_fees integer;
BEGIN
    -- Check for remaining duplicates
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT payment_id, COUNT(*) as cnt
        FROM public.pnl_entries 
        WHERE category = 'InitialFees' AND payment_id IS NOT NULL
        GROUP BY payment_id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    SELECT COUNT(*) INTO total_initial_fees
    FROM public.pnl_entries 
    WHERE category = 'InitialFees';
    
    RAISE NOTICE 'Initial Fees cleanup complete:';
    RAISE NOTICE '  - Total InitialFees entries: %', total_initial_fees;
    RAISE NOTICE '  - Remaining duplicates: %', duplicate_count;
    
    IF duplicate_count > 0 THEN
        RAISE WARNING 'Still have % duplicate InitialFees entries!', duplicate_count;
    END IF;
END $$;