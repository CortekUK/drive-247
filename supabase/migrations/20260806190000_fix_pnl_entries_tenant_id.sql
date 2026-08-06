-- Fix: several vehicle-lifecycle functions insert into pnl_entries without setting
-- tenant_id. Because the pnl_entries -> vehicles FK has no ON DELETE action, an
-- orphaned (tenant_id IS NULL) row silently blocks vehicle deletion: the portal's
-- client-side cleanup delete is scoped by RLS (tenant_id = get_user_tenant_id()),
-- so it matches zero rows against a NULL tenant_id and the leftover row then makes
-- the final `DELETE FROM vehicles` fail on the FK. payment_apply_fifo_v2 already
-- guards against this for payment-driven P&L rows; extending the same tenant_id
-- backfill to acquisition, disposal, service, plate, and fine cost entries.

CREATE OR REPLACE FUNCTION public.pnl_post_acquisition(v_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v record;
  contract_total numeric;
  entry_date_to_use date;
  reference_key text;
BEGIN
  SELECT id, tenant_id, acquisition_date, purchase_price, acquisition_type,
         monthly_payment, initial_payment, term_months, balloon, finance_start_date
  INTO v
  FROM vehicles
  WHERE id = v_id;

  -- Handle Purchase acquisition (existing logic)
  IF v.acquisition_type = 'Purchase' AND v.purchase_price IS NOT NULL AND v.acquisition_date IS NOT NULL THEN
    INSERT INTO pnl_entries (vehicle_id, tenant_id, entry_date, side, category, amount, source_ref)
    VALUES (v.id, v.tenant_id, v.acquisition_date, 'Cost', 'Acquisition', v.purchase_price, v.id::text)
    ON CONFLICT ON CONSTRAINT ux_pnl_vehicle_category_source
    DO UPDATE SET
      entry_date = EXCLUDED.entry_date,
      amount     = EXCLUDED.amount,
      tenant_id  = EXCLUDED.tenant_id;
    RETURN;
  END IF;

  -- Handle Finance acquisition (new upfront logic)
  IF v.acquisition_type = 'Finance' THEN
    -- Calculate contract total: initial + (monthly * term) + balloon
    contract_total := COALESCE(v.initial_payment, 0) +
                     (COALESCE(v.monthly_payment, 0) * COALESCE(v.term_months, 0)) +
                     COALESCE(v.balloon, 0);

    -- Use finance_start_date if available, otherwise acquisition_date, otherwise today
    entry_date_to_use := COALESCE(v.finance_start_date, v.acquisition_date, CURRENT_DATE);

    -- Create stable reference for upfront finance P&L entry
    reference_key := 'FIN-UPFRONT:' || v.id::text;

    -- Insert/update upfront finance acquisition cost
    INSERT INTO pnl_entries (vehicle_id, tenant_id, entry_date, side, category, amount, source_ref)
    VALUES (v.id, v.tenant_id, entry_date_to_use, 'Cost', 'Acquisition', contract_total, reference_key)
    ON CONFLICT (vehicle_id, category, source_ref)
    DO UPDATE SET
      entry_date = EXCLUDED.entry_date,
      amount     = EXCLUDED.amount,
      tenant_id  = EXCLUDED.tenant_id;

    RETURN;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dispose_vehicle(p_vehicle_id uuid, p_disposal_date date, p_sale_proceeds numeric, p_buyer text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_book_cost numeric;
  v_result numeric;
  v_side text;
  v_amount numeric;
  v_reference text;
  v_tenant_id uuid;
BEGIN
  -- Calculate book cost
  v_book_cost := calculate_vehicle_book_cost(p_vehicle_id);

  -- Calculate gain/loss
  v_result := p_sale_proceeds - v_book_cost;
  v_reference := 'dispose:' || p_vehicle_id::text;

  SELECT tenant_id INTO v_tenant_id FROM vehicles WHERE id = p_vehicle_id;

  -- Update vehicle with disposal info
  UPDATE vehicles
  SET is_disposed = true,
      disposal_date = p_disposal_date,
      sale_proceeds = p_sale_proceeds,
      disposal_buyer = p_buyer,
      disposal_notes = p_notes,
      status = 'Disposed'
  WHERE id = p_vehicle_id;

  -- Insert P&L entry only if there's a gain or loss
  IF v_result != 0 THEN
    IF v_result > 0 THEN
      v_side := 'Revenue';
      v_amount := v_result;
    ELSE
      v_side := 'Cost';
      v_amount := ABS(v_result);
    END IF;

    INSERT INTO pnl_entries (
      vehicle_id, tenant_id, entry_date, side, category, amount, reference
    ) VALUES (
      p_vehicle_id, v_tenant_id, p_disposal_date, v_side, 'Disposal', v_amount, v_reference
    )
    ON CONFLICT (reference) DO UPDATE SET
      entry_date = EXCLUDED.entry_date,
      side = EXCLUDED.side,
      amount = EXCLUDED.amount,
      tenant_id = EXCLUDED.tenant_id;
  END IF;

  -- Add vehicle event
  INSERT INTO vehicle_events (
    vehicle_id, event_type, summary, event_date
  ) VALUES (
    p_vehicle_id,
    'disposal',
    'Vehicle disposed for £' || p_sale_proceeds ||
    CASE WHEN v_result > 0 THEN ' (Gain: £' || v_result || ')'
         WHEN v_result < 0 THEN ' (Loss: £' || ABS(v_result) || ')'
         ELSE ' (Break-even)'
    END,
    p_disposal_date
  );

  RETURN jsonb_build_object(
    'success', true,
    'book_cost', v_book_cost,
    'sale_proceeds', p_sale_proceeds,
    'gain_loss', v_result
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_service_pnl_entry(p_service_record_id uuid, p_cost numeric, p_service_date date, p_vehicle_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reference text;
  v_tenant_id uuid;
BEGIN
  v_reference := 'service:' || p_service_record_id::text;

  IF p_cost > 0 THEN
    SELECT tenant_id INTO v_tenant_id FROM vehicles WHERE id = p_vehicle_id;

    -- Insert or update P&L entry for service cost
    INSERT INTO pnl_entries (
      vehicle_id, tenant_id, entry_date, side, category, amount, reference
    )
    VALUES (
      p_vehicle_id, v_tenant_id, p_service_date, 'Cost', 'Service', p_cost, v_reference
    )
    ON CONFLICT (reference)
    DO UPDATE SET
      amount = EXCLUDED.amount,
      entry_date = EXCLUDED.entry_date,
      vehicle_id = EXCLUDED.vehicle_id,
      tenant_id = EXCLUDED.tenant_id;
  ELSE
    -- Remove P&L entry if cost is 0 or negative
    DELETE FROM pnl_entries WHERE reference = v_reference;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_plate_pnl_entry(p_plate_id uuid, p_cost numeric, p_order_date date, p_vehicle_id uuid, p_created_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reference text;
  v_entry_date date;
  v_tenant_id uuid;
BEGIN
  v_reference := 'plate:' || p_plate_id::text;
  v_entry_date := COALESCE(p_order_date, p_created_at::date);

  IF p_cost > 0 THEN
    SELECT tenant_id INTO v_tenant_id FROM vehicles WHERE id = p_vehicle_id;

    -- Insert or update P&L entry for plate cost
    INSERT INTO pnl_entries (
      vehicle_id, tenant_id, entry_date, side, category, amount, reference
    )
    VALUES (
      p_vehicle_id, v_tenant_id, v_entry_date, 'Cost', 'Plates', p_cost, v_reference
    )
    ON CONFLICT (reference)
    DO UPDATE SET
      amount = EXCLUDED.amount,
      entry_date = EXCLUDED.entry_date,
      vehicle_id = EXCLUDED.vehicle_id,
      tenant_id = EXCLUDED.tenant_id;
  ELSE
    -- Remove P&L entry if cost is 0 or negative
    DELETE FROM pnl_entries WHERE reference = v_reference;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_create_fine_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only create ledger charge if liability is Business (immediate business cost)
  -- Customer liability fines are now recorded but not charged until admin action
  IF NEW.liability = 'Business' THEN
    -- Create P&L cost entry for business liability fines
    INSERT INTO pnl_entries(
      vehicle_id,
      tenant_id,
      entry_date,
      side,
      category,
      amount,
      source_ref,
      customer_id
    )
    VALUES (
      NEW.vehicle_id,
      NEW.tenant_id,
      NEW.issue_date,
      'Cost',
      'Fines',
      NEW.amount,
      NEW.id::text,
      NEW.customer_id
    )
    ON CONFLICT (vehicle_id, category, source_ref) DO UPDATE SET
      amount = EXCLUDED.amount,
      entry_date = EXCLUDED.entry_date,
      tenant_id = EXCLUDED.tenant_id;
  END IF;

  -- Customer liability fines are just recorded, no automatic charging
  -- They will be charged later via the apply-fine edge function

  RETURN NEW;
END $function$;

-- Backfill existing orphaned rows that are currently blocking vehicle deletion
UPDATE pnl_entries p
SET tenant_id = v.tenant_id
FROM vehicles v
WHERE p.vehicle_id = v.id
  AND p.tenant_id IS NULL;
