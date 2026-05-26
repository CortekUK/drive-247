/**
 * Finance Sync — auto-enqueue trigger.
 *
 * The Drive247 ledger is populated via two DB triggers in production:
 *   - rental_charges_trigger   (fires on rentals INSERT, creates Rental/Tax/Service Fee charges)
 *   - auto_fifo_on_payment_*   (fires on payments INSERT/UPDATE, creates Payment ledger entries)
 *
 * The original Finance Sync plan deviated AWAY from triggers in favour of
 * app-level RPC calls, but in practice the legacy charge-creation already
 * happens at the trigger layer — so wiring enqueue at the edge function
 * layer misses them entirely. This trigger catches EVERY ledger insert
 * (regardless of code path) and fans out the matching financial_event.
 *
 * Mapping:
 *   ledger_entries.type='Charge', category='Rental'        → rental_charge
 *   ledger_entries.type='Charge', category='Tax'           → rental_charge   (rolled into the rental's invoice)
 *   ledger_entries.type='Charge', category='Service Fee'   → rental_charge
 *   ledger_entries.type='Charge', category='Late Fee'      → late_fee
 *   ledger_entries.type='Charge', category='Damage'        → damage_charge
 *   ledger_entries.type='Charge', category='Mileage'       → mileage_charge
 *   ledger_entries.type='Charge', category='Charging'      → charging_cost
 *   ledger_entries.type='Charge', category='Initial Fees'  → rental_charge
 *   ledger_entries.type='Charge', category='Unlimited Mileage' → mileage_charge
 *   ledger_entries.type='Payment'                          → payment_receipt
 *
 * Non-mapped categories are silently ignored (no event fires).
 * Anything that already has a financial_event row (via app-level call)
 * is skipped via the UNIQUE constraint on (source_table, source_id) —
 * which is enforced inside enqueue_financial_event.
 */
CREATE OR REPLACE FUNCTION public.enqueue_financial_event_for_ledger_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
  v_amount_cents integer;
  v_currency text;
  v_description text;
BEGIN
  -- Skip rows without a tenant_id (legacy / malformed entries).
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Map ledger row → financial_event_type.
  IF NEW.type = 'Payment' THEN
    v_event_type := 'payment_receipt';
  ELSIF NEW.type = 'Charge' THEN
    v_event_type := CASE LOWER(COALESCE(NEW.category, ''))
      WHEN 'rental'              THEN 'rental_charge'
      WHEN 'tax'                 THEN 'rental_charge'
      WHEN 'service fee'         THEN 'rental_charge'
      WHEN 'initial fees'        THEN 'rental_charge'
      WHEN 'unlimited mileage'   THEN 'mileage_charge'
      WHEN 'late fee'            THEN 'late_fee'
      WHEN 'damage'              THEN 'damage_charge'
      WHEN 'mileage'             THEN 'mileage_charge'
      WHEN 'charging'            THEN 'charging_cost'
      WHEN 'insurance'           THEN 'insurance_charge'
      WHEN 'fines'               THEN 'late_fee'
      ELSE NULL
    END;
  ELSE
    RETURN NEW;
  END IF;

  -- Unmapped category — skip silently.
  IF v_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve currency from tenant (default USD).
  SELECT COALESCE(currency_code, 'USD') INTO v_currency
    FROM public.tenants WHERE id = NEW.tenant_id;

  -- amount_cents: ledger payment amounts are stored negative (-540.00) → flip sign.
  v_amount_cents := ROUND(ABS(COALESCE(NEW.amount, 0))::numeric * 100)::integer;
  IF v_amount_cents = 0 THEN
    RETURN NEW;
  END IF;

  -- Friendly description for the sync log.
  v_description := CASE
    WHEN NEW.type = 'Payment' THEN 'Payment received'
    ELSE COALESCE(NEW.category, 'Charge') || ' charge'
  END;

  -- Fire and forget. enqueue_financial_event handles the per-provider
  -- sync_state row fan-out. Wrapped in a sub-block so a failure here
  -- never bubbles up and aborts the parent rental/payment transaction.
  BEGIN
    PERFORM public.enqueue_financial_event(
      p_tenant_id    := NEW.tenant_id,
      p_event_type   := v_event_type::public.financial_event_type,
      p_amount_cents := v_amount_cents,
      p_currency     := v_currency,
      p_rental_id    := NEW.rental_id,
      p_customer_id  := NEW.customer_id,
      p_vehicle_id   := NEW.vehicle_id,
      p_source_table := 'ledger_entries',
      p_source_id    := NEW.id,
      p_description  := v_description,
      p_tax_cents    := 0,
      p_metadata     := jsonb_build_object(
        'ledger_type',     NEW.type,
        'ledger_category', NEW.category,
        'entry_date',      NEW.entry_date
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Best-effort. Don't crash the parent transaction over a sync hiccup.
    RAISE WARNING 'enqueue_financial_event_for_ledger_entry failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_financial_event_on_ledger_insert ON public.ledger_entries;
CREATE TRIGGER enqueue_financial_event_on_ledger_insert
  AFTER INSERT ON public.ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_financial_event_for_ledger_entry();

GRANT EXECUTE ON FUNCTION public.enqueue_financial_event_for_ledger_entry() TO service_role;
