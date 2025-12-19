


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."acquisition_type" AS ENUM (
    'purchase',
    'finance',
    'lease'
);


ALTER TYPE "public"."acquisition_type" OWNER TO "postgres";


CREATE TYPE "public"."customer_status" AS ENUM (
    'active',
    'inactive'
);


ALTER TYPE "public"."customer_status" OWNER TO "postgres";


CREATE TYPE "public"."customer_type" AS ENUM (
    'individual',
    'company'
);


ALTER TYPE "public"."customer_type" OWNER TO "postgres";


CREATE TYPE "public"."entry_type" AS ENUM (
    'charge',
    'payment',
    'adjustment'
);


ALTER TYPE "public"."entry_type" OWNER TO "postgres";


CREATE TYPE "public"."expense_category" AS ENUM (
    'Repair',
    'Service',
    'Tyres',
    'Valet',
    'Accessory',
    'Other'
);


ALTER TYPE "public"."expense_category" OWNER TO "postgres";


CREATE TYPE "public"."key_handover_type" AS ENUM (
    'giving',
    'receiving'
);


ALTER TYPE "public"."key_handover_type" OWNER TO "postgres";


CREATE TYPE "public"."ledger_status" AS ENUM (
    'pending',
    'applied'
);


ALTER TYPE "public"."ledger_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'paid',
    'due',
    'overdue',
    'void'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_type" AS ENUM (
    'initial_fee',
    'monthly',
    'fine',
    'service',
    'other'
);


ALTER TYPE "public"."payment_type" OWNER TO "postgres";


CREATE TYPE "public"."rental_status" AS ENUM (
    'active',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."rental_status" OWNER TO "postgres";


CREATE TYPE "public"."vehicle_event_type" AS ENUM (
    'acquisition_created',
    'acquisition_updated',
    'rental_started',
    'rental_ended',
    'expense_added',
    'expense_removed',
    'fine_assigned',
    'fine_closed',
    'file_uploaded',
    'file_deleted',
    'disposal',
    'service_added',
    'service_updated',
    'service_removed'
);


ALTER TYPE "public"."vehicle_event_type" OWNER TO "postgres";


CREATE TYPE "public"."vehicle_status" AS ENUM (
    'available',
    'rented',
    'sold'
);


ALTER TYPE "public"."vehicle_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_login"("p_username" "text", "p_password" "text") RETURNS TABLE("id" "uuid", "username" "text", "role" "text", "require_password_change" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v users%rowtype;
begin
  -- explicitly alias the users table as u
  select * into v
  from users u
  where lower(u.username) = lower(p_username)
    and u.status = 'active'
  limit 1;

  if not found then
    return; -- no rows
  end if;

  -- verify bcrypt password
  if crypt(p_password, v.password_hash) = v.password_hash then
    update users set last_login = now() where id = v.id;

    return query
      select v.id, v.username, v.role, coalesce(v.require_password_change, false);
  end if;

  return; -- password mismatch
end;
$$;


ALTER FUNCTION "public"."app_login"("p_username" "text", "p_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_payment"("payment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    payment_record RECORD;
    remaining_amount NUMERIC;
    due_payment RECORD;
BEGIN
    -- Get payment details
    SELECT * INTO payment_record FROM public.payments WHERE id = payment_id;
    remaining_amount := payment_record.amount;
    
    -- Apply payment to oldest due charges first (FIFO)
    FOR due_payment IN 
        SELECT * FROM public.payments 
        WHERE customer_id = payment_record.customer_id 
        AND status IN ('due', 'overdue')
        AND type = 'monthly'
        ORDER BY due_date ASC
    LOOP
        IF remaining_amount <= 0 THEN
            EXIT;
        END IF;
        
        IF remaining_amount >= due_payment.amount THEN
            -- Full payment of this due amount
            UPDATE public.payments 
            SET status = 'paid', paid_date = now()
            WHERE id = due_payment.id;
            
            remaining_amount := remaining_amount - due_payment.amount;
        END IF;
    END LOOP;
    
    -- Update payment status
    UPDATE public.payments 
    SET status = 'paid', paid_date = now()
    WHERE id = payment_id;
    
    -- Update customer balance and vehicle P&L
    PERFORM public.update_customer_balance(payment_record.customer_id);
    PERFORM public.recalculate_vehicle_pl(payment_record.vehicle_id);
END;
$$;


ALTER FUNCTION "public"."apply_payment"("payment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_payment_fully"("p_payment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_payment record;
  v_active_count int;
  v_charge record;
  v_to_apply numeric(12,2);
  v_payment_category text;
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

  -- Determine payment category for ledger entries
  v_payment_category := CASE 
    WHEN v_payment.payment_type = 'InitialFee' THEN 'Initial Fees'
    ELSE 'Rental'
  END;

  -- InitialFee: immediate revenue + mark applied (IDEMPOTENT)
  IF v_payment.payment_type = 'InitialFee' THEN
    -- Mark payment as applied
    UPDATE public.payments
       SET remaining_amount = 0,
           status = 'Applied'
     WHERE id = v_payment.id;

    -- Create ledger entry for the payment (idempotent)
    INSERT INTO public.ledger_entries(
      id, customer_id, rental_id, vehicle_id, entry_date,
      type, category, amount, remaining_amount, payment_id
    )
    VALUES (
      gen_random_uuid(),
      v_payment.customer_id, v_payment.rental_id, v_payment.vehicle_id, v_payment.payment_date,
      'Payment', 'Initial Fees', -v_payment.amount, 0, v_payment.id
    )
    ON CONFLICT DO NOTHING;

    -- P&L Initial Fees entry (idempotent with proper unique constraint)
    INSERT INTO public.pnl_entries(
      id, vehicle_id, rental_id, customer_id, entry_date, 
      side, category, amount, source_ref, payment_id
    )
    VALUES (
      gen_random_uuid(),
      v_payment.vehicle_id, v_payment.rental_id, v_payment.customer_id, v_payment.payment_date,
      'Revenue', 'Initial Fees', v_payment.amount, v_payment.id::text, v_payment.id
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

      -- Create ledger entry for this payment application
      INSERT INTO public.ledger_entries(
        id, customer_id, rental_id, vehicle_id, entry_date,
        type, category, amount, remaining_amount, payment_id
      )
      VALUES (
        gen_random_uuid(),
        v_payment.customer_id, v_payment.rental_id, v_payment.vehicle_id, v_payment.payment_date,
        'Payment', 'Rental', -v_to_apply, 0, v_payment.id
      );

      -- create revenue P&L entry (for Rental payments)
      INSERT INTO public.pnl_entries(
        vehicle_id, rental_id, customer_id, entry_date, 
        side, category, amount, source_ref
      )
      VALUES (
        v_payment.vehicle_id, v_payment.rental_id, v_payment.customer_id, v_payment.payment_date,
        'Revenue', 'Rental', v_to_apply, v_payment.id::text
      );

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
$$;


ALTER FUNCTION "public"."apply_payment_fully"("p_payment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_payments_to_charges"("p_rental_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  p RECORD;
  c RECORD;
  v_left NUMERIC;
  to_apply NUMERIC;
BEGIN
  -- Apply all unapplied rental payments for the specified rental (or all if NULL)
  FOR p IN
    SELECT id, amount, rental_id, customer_id, vehicle_id, payment_date
    FROM payments 
    WHERE payment_type = 'Rental'
      AND status IN ('Applied', 'Credit', 'Partial')
      AND (p_rental_id IS NULL OR rental_id = p_rental_id)
    ORDER BY payment_date ASC, id ASC
  LOOP
    -- Calculate remaining amount for this payment
    SELECT COALESCE(p.amount - SUM(pa.amount_applied), p.amount) INTO v_left
    FROM payment_applications pa
    WHERE pa.payment_id = p.id;
    
    -- Skip if payment is fully applied
    CONTINUE WHEN v_left <= 0;
    
    -- Apply to charges FIFO (due date, then entry date)
    FOR c IN
      SELECT id, remaining_amount, due_date
      FROM ledger_entries
      WHERE customer_id = p.customer_id
        AND type = 'Charge' 
        AND category = 'Rental'
        AND remaining_amount > 0
        AND (p_rental_id IS NULL OR rental_id = p_rental_id)
        AND due_date <= CURRENT_DATE -- Only apply to charges that are due
      ORDER BY due_date ASC, entry_date ASC, id ASC
    LOOP
      EXIT WHEN v_left <= 0;
      
      to_apply := LEAST(c.remaining_amount, v_left);
      
      -- Insert payment application
      INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
      VALUES (p.id, c.id, to_apply)
      ON CONFLICT ON CONSTRAINT ux_payment_app_unique DO NOTHING;
      
      -- Update ledger entry remaining amount
      UPDATE ledger_entries
      SET remaining_amount = remaining_amount - to_apply
      WHERE id = c.id;
      
      -- Book revenue on the charge due date
      INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
      VALUES (p.vehicle_id, c.due_date, 'Revenue', 'Rental', to_apply, p.id::text)
      ON CONFLICT ON CONSTRAINT ux_pnl_vehicle_category_source DO NOTHING;
      
      v_left := v_left - to_apply;
    END LOOP;
    
    -- Update payment status
    IF v_left = 0 THEN
      UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p.id;
    ELSIF v_left = p.amount THEN
      UPDATE payments SET status = 'Credit', remaining_amount = v_left WHERE id = p.id;
    ELSE
      UPDATE payments SET status = 'Partial', remaining_amount = v_left WHERE id = p.id;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."apply_payments_to_charges"("p_rental_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_booking_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_payment RECORD;
  v_rental RECORD;
BEGIN
  -- Get payment details
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  IF v_payment.capture_status != 'requires_capture' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment is not awaiting capture');
  END IF;

  -- Note: Actual Stripe capture must be done via edge function before calling this

  -- Update payment status
  UPDATE payments
  SET capture_status = 'captured',
      verification_status = 'approved',
      verified_by = p_approved_by,
      verified_at = now(),
      updated_at = now()
  WHERE id = p_payment_id;

  -- Activate the rental
  IF v_payment.rental_id IS NOT NULL THEN
    UPDATE rentals
    SET status = 'Active',
        updated_at = now()
    WHERE id = v_payment.rental_id;

    -- Mark vehicle as Rented
    SELECT * INTO v_rental FROM rentals WHERE id = v_payment.rental_id;
    IF v_rental.vehicle_id IS NOT NULL THEN
      UPDATE vehicles
      SET status = 'Rented',
          updated_at = now()
      WHERE id = v_rental.vehicle_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'rental_id', v_payment.rental_id,
    'stripe_payment_intent_id', v_payment.stripe_payment_intent_id,
    'approved_at', now()
  );
END;
$$;


ALTER FUNCTION "public"."approve_booking_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."approve_booking_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") IS 'Approve a pending booking payment (call Stripe capture first)';



CREATE OR REPLACE FUNCTION "public"."approve_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_payment RECORD;
BEGIN
  -- Get payment details
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  IF v_payment.verification_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment is not pending verification');
  END IF;

  -- Update payment status
  UPDATE payments
  SET verification_status = 'approved',
      verified_by = p_approved_by,
      verified_at = now(),
      updated_at = now()
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'approved_at', now()
  );
END;
$$;


ALTER FUNCTION "public"."approve_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."approve_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") IS 'Approve a pending payment and allow rental to proceed';



CREATE OR REPLACE FUNCTION "public"."attach_payments_to_rentals"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE payments p
     SET rental_id = r.id
    FROM rentals r
   WHERE p.rental_id IS NULL
     AND p.customer_id = r.customer_id
     AND p.vehicle_id  = r.vehicle_id
     AND p.payment_date >= r.start_date
     AND p.payment_date <= COALESCE(r.end_date, p.payment_date);
END;
$$;


ALTER FUNCTION "public"."attach_payments_to_rentals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_settings_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  changed_fields text[] := '{}';
  field_name text;
BEGIN
  -- Convert OLD and NEW to jsonb
  IF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
    
    -- Find changed fields
    FOR field_name IN SELECT jsonb_object_keys(new_data) LOOP
      IF old_data->field_name IS DISTINCT FROM new_data->field_name THEN
        changed_fields := array_append(changed_fields, field_name);
      END IF;
    END LOOP;
  ELSIF TG_OP = 'INSERT' THEN
    new_data := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    old_data := to_jsonb(OLD);
  END IF;

  -- Insert audit record
  INSERT INTO public.settings_audit (
    table_name, operation, old_values, new_values, changed_fields, changed_by
  ) VALUES (
    TG_TABLE_NAME, 
    LOWER(TG_OP), 
    old_data, 
    new_data, 
    CASE WHEN array_length(changed_fields, 1) > 0 THEN changed_fields ELSE NULL END,
    current_setting('app.current_user', true)
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;


ALTER FUNCTION "public"."audit_settings_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_apply_customer_credit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  credit_payment RECORD;
BEGIN
  -- Only process rental charges
  IF NEW.type = 'Charge' AND NEW.category = 'Rental' AND NEW.remaining_amount > 0 THEN
    -- Find payments with remaining credit for this customer, ordered by payment_date
    FOR credit_payment IN
      SELECT id FROM payments 
      WHERE customer_id = NEW.customer_id 
        AND status IN ('Credit', 'Partial')
        AND remaining_amount > 0
      ORDER BY payment_date ASC, id ASC
    LOOP
      -- Apply the payment using our FIFO function
      PERFORM payment_apply_fifo(credit_payment.id);
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_apply_customer_credit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backfill_payment_rental_ids"() RETURNS TABLE("payments_updated" integer, "payments_skipped" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  updated_count INTEGER := 0;
  skipped_count INTEGER := 0;
  payment_record RECORD;
  found_rental_id UUID;
BEGIN
  -- Process payments that have customer_id and vehicle_id but no rental_id
  FOR payment_record IN
    SELECT id, customer_id, vehicle_id, payment_date
    FROM payments
    WHERE customer_id IS NOT NULL 
      AND vehicle_id IS NOT NULL 
      AND rental_id IS NULL
  LOOP
    -- Find the active rental for this customer+vehicle combination
    SELECT r.id INTO found_rental_id
    FROM rentals r
    WHERE r.customer_id = payment_record.customer_id
      AND r.vehicle_id = payment_record.vehicle_id
      AND r.status = 'Active'
      AND r.start_date <= payment_record.payment_date
      AND (r.end_date IS NULL OR r.end_date >= payment_record.payment_date)
    ORDER BY r.created_at DESC
    LIMIT 1;
    
    IF found_rental_id IS NOT NULL THEN
      -- Update the payment with the found rental_id
      UPDATE payments 
      SET rental_id = found_rental_id 
      WHERE id = payment_record.id;
      
      updated_count := updated_count + 1;
    ELSE
      skipped_count := skipped_count + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT updated_count, skipped_count;
END;
$$;


ALTER FUNCTION "public"."backfill_payment_rental_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backfill_rental_charges_first_month_only"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_rental record;
  v_interval interval;
BEGIN
  -- Loop through all active rentals
  FOR v_rental IN
    SELECT id, customer_id, vehicle_id, start_date, rental_period_type, monthly_amount
    FROM rentals
    WHERE status = 'Active'
  LOOP
    -- Check if this rental already has a first charge
    IF NOT EXISTS (
      SELECT 1 FROM ledger_entries
      WHERE rental_id = v_rental.id
        AND type = 'Charge'
        AND category = 'Rental'
        AND due_date = v_rental.start_date
    ) THEN
      -- Create the first charge for the rental start date
      PERFORM rental_create_charge(
        v_rental.id,
        v_rental.start_date,
        v_rental.monthly_amount
      );
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."backfill_rental_charges_first_month_only"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backfill_rental_charges_full"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  r RECORD;
  d DATE;
  stop_date DATE;
BEGIN
  FOR r IN
    SELECT id, customer_id, vehicle_id, start_date, COALESCE(end_date, CURRENT_DATE) as end_at, monthly_amount
    FROM rentals
  LOOP
    d := r.start_date;
    stop_date := r.end_at;
    WHILE d <= stop_date LOOP
      INSERT INTO ledger_entries(
        customer_id, rental_id, vehicle_id, type, category,
        entry_date, due_date, amount, remaining_amount
      )
      VALUES (
        r.customer_id, r.id, r.vehicle_id, 'Charge', 'Rental',
        d, d, r.monthly_amount, r.monthly_amount
      );
      d := (d + INTERVAL '1 month')::DATE;
    END LOOP;
  END LOOP;
EXCEPTION
  WHEN unique_violation THEN
    -- Skip duplicate entries
    NULL;
END;
$$;


ALTER FUNCTION "public"."backfill_rental_charges_full"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."block_customer"("p_customer_id" "uuid", "p_reason" "text", "p_blocked_by" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_customer RECORD;
  v_result JSONB;
BEGIN
  -- Get customer details
  SELECT c.*, iv.document_number, iv.document_type
  INTO v_customer
  FROM customers c
  LEFT JOIN identity_verifications iv ON iv.customer_id = c.id
  WHERE c.id = p_customer_id
  ORDER BY iv.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  -- Check if customer has a license number (required for blocking)
  IF (v_customer.license_number IS NULL OR v_customer.license_number = '')
     AND (v_customer.document_number IS NULL OR v_customer.document_number = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot block customer without a license number');
  END IF;

  -- Update customer as blocked
  UPDATE customers
  SET is_blocked = true,
      blocked_at = now(),
      blocked_reason = p_reason
  WHERE id = p_customer_id;

  -- Add license number to blocked list if available
  IF v_customer.license_number IS NOT NULL AND v_customer.license_number != '' THEN
    INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes)
    VALUES ('license', v_customer.license_number, p_reason, p_blocked_by, 'Blocked via customer: ' || v_customer.name)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Add ID number to blocked list if available
  IF v_customer.id_number IS NOT NULL AND v_customer.id_number != '' THEN
    INSERT INTO blocked_identities (identity_type, identity_number, reason, blocked_by, notes)
    VALUES ('id_card', v_customer.id_number, p_reason, p_blocked_by, 'Blocked via customer: ' || v_customer.name)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Add document number from Veriff verification if available
  IF v_customer.document_number IS NOT NULL AND v_customer.document_number != '' THEN
    INSERT INTO blocked_identities (
      identity_type,
      identity_number,
      reason,
      blocked_by,
      notes
    )
    VALUES (
      CASE
        WHEN LOWER(v_customer.document_type) = 'drivers_license' THEN 'license'
        WHEN LOWER(v_customer.document_type) = 'id_card' THEN 'id_card'
        WHEN LOWER(v_customer.document_type) = 'passport' THEN 'passport'
        ELSE 'license'
      END,
      v_customer.document_number,
      p_reason,
      p_blocked_by,
      'Blocked via customer: ' || v_customer.name || ' (from Veriff)'
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- NOTE: We intentionally do NOT block by email anymore

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'blocked_at', now()
  );
END;
$$;


ALTER FUNCTION "public"."block_customer"("p_customer_id" "uuid", "p_reason" "text", "p_blocked_by" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."block_customer"("p_customer_id" "uuid", "p_reason" "text", "p_blocked_by" "uuid") IS 'Block a customer and add their identifiers to the blocked list';



CREATE OR REPLACE FUNCTION "public"."calculate_vehicle_book_cost"("p_vehicle_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_vehicle RECORD;
  v_book_cost numeric := 0;
BEGIN
  SELECT acquisition_type, purchase_price, initial_payment, monthly_payment, term_months, balloon
  INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  
  CASE v_vehicle.acquisition_type
    WHEN 'Purchase' THEN
      v_book_cost := COALESCE(v_vehicle.purchase_price, 0);
    WHEN 'Finance' THEN
      v_book_cost := COALESCE(v_vehicle.initial_payment, 0) + 
                    (COALESCE(v_vehicle.monthly_payment, 0) * COALESCE(v_vehicle.term_months, 0)) + 
                    COALESCE(v_vehicle.balloon, 0);
    ELSE
      v_book_cost := COALESCE(v_vehicle.purchase_price, 0);
  END CASE;
  
  RETURN v_book_cost;
END;
$$;


ALTER FUNCTION "public"."calculate_vehicle_book_cost"("p_vehicle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_policy_overlap"("p_customer_id" "uuid", "p_vehicle_id" "uuid", "p_start_date" "date", "p_expiry_date" "date", "p_policy_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("overlapping_policy_id" "uuid", "overlapping_policy_number" "text", "overlapping_start_date" "date", "overlapping_expiry_date" "date")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ip.id,
    ip.policy_number,
    ip.start_date,
    ip.expiry_date
  FROM insurance_policies ip
  WHERE ip.customer_id = p_customer_id
    AND (ip.vehicle_id = p_vehicle_id OR (ip.vehicle_id IS NULL AND p_vehicle_id IS NULL))
    AND ip.status = 'Active'
    AND (p_policy_id IS NULL OR ip.id != p_policy_id)
    AND (
      (ip.start_date <= p_start_date AND ip.expiry_date >= p_start_date) OR
      (ip.start_date <= p_expiry_date AND ip.expiry_date >= p_expiry_date) OR
      (p_start_date <= ip.start_date AND p_expiry_date >= ip.expiry_date)
    );
END;
$$;


ALTER FUNCTION "public"."check_policy_overlap"("p_customer_id" "uuid", "p_vehicle_id" "uuid", "p_start_date" "date", "p_expiry_date" "date", "p_policy_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_rental_charges"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Add initial fee to ledger as revenue
    INSERT INTO public.ledger (
        customer_id, rental_id, vehicle_id, entry_type, description, amount, status
    ) VALUES (
        NEW.customer_id, NEW.id, NEW.vehicle_id,
        'charge', 'Initial rental fee', NEW.initial_payment, 'applied'
    );
    
    -- Generate monthly charges
    PERFORM public.generate_monthly_charges(NEW.id);
    
    -- Update vehicle P&L
    PERFORM public.recalculate_vehicle_pl(NEW.vehicle_id);
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_rental_charges"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_vehicle_pl"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    INSERT INTO public.p_l (vehicle_id, total_revenue, total_costs)
    VALUES (NEW.id, 0, NEW.acquisition_price);
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_vehicle_pl"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_rental_cascade"("rental_uuid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  v_vehicle_id UUID;
  v_status TEXT;
  v_table_name TEXT;
  v_column_name TEXT;
  v_sql TEXT;
BEGIN
  -- Get the vehicle_id and status before deleting
  SELECT vehicle_id, status INTO v_vehicle_id, v_status
  FROM rentals
  WHERE id = rental_uuid;

  -- If rental doesn't exist, just return
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Dynamically find and delete from ALL tables that have FK pointing to rentals.id
  FOR v_table_name, v_column_name IN
    SELECT
      tc.table_name::TEXT,
      kcu.column_name::TEXT
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'rentals'
      AND ccu.column_name = 'id'
      AND tc.table_schema = 'public'
  LOOP
    v_sql := format('DELETE FROM %I WHERE %I = $1', v_table_name, v_column_name);
    EXECUTE v_sql USING rental_uuid;
  END LOOP;

  -- Finally, delete the rental itself
  DELETE FROM rentals WHERE id = rental_uuid;

  -- Update vehicle status to Available if the rental was Active
  IF v_status = 'Active' AND v_vehicle_id IS NOT NULL THEN
    UPDATE vehicles SET status = 'Available' WHERE id = v_vehicle_id;
  END IF;
END;
$_$;


ALTER FUNCTION "public"."delete_rental_cascade"("rental_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dispose_vehicle"("p_vehicle_id" "uuid", "p_disposal_date" "date", "p_sale_proceeds" numeric, "p_buyer" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_book_cost numeric;
  v_result numeric;
  v_side text;
  v_amount numeric;
  v_reference text;
BEGIN
  -- Calculate book cost
  v_book_cost := calculate_vehicle_book_cost(p_vehicle_id);
  
  -- Calculate gain/loss
  v_result := p_sale_proceeds - v_book_cost;
  v_reference := 'dispose:' || p_vehicle_id::text;
  
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
      vehicle_id, entry_date, side, category, amount, reference
    ) VALUES (
      p_vehicle_id, p_disposal_date, v_side, 'Disposal', v_amount, v_reference
    )
    ON CONFLICT (reference) DO UPDATE SET
      entry_date = EXCLUDED.entry_date,
      side = EXCLUDED.side,
      amount = EXCLUDED.amount;
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
$$;


ALTER FUNCTION "public"."dispose_vehicle"("p_vehicle_id" "uuid", "p_disposal_date" "date", "p_sale_proceeds" numeric, "p_buyer" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fine_void_charge"("f_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  fc RECORD;
  remaining_amt NUMERIC;
BEGIN
  SELECT * INTO fc FROM fines WHERE id = f_id;
  
  -- Get remaining amount from ledger for this fine's customer
  SELECT SUM(remaining_amount) INTO remaining_amt
  FROM ledger_entries 
  WHERE customer_id = fc.customer_id 
    AND type = 'Charge' 
    AND category = 'Fine'
    AND remaining_amount > 0;
  
  -- Void remaining charges for this customer's fines
  UPDATE ledger_entries 
  SET remaining_amount = 0 
  WHERE customer_id = fc.customer_id 
    AND type = 'Charge' 
    AND category = 'Fine'
    AND remaining_amount > 0;
  
  -- Create adjustment if there was remaining amount
  IF remaining_amt > 0 THEN
    INSERT INTO ledger_entries(
      customer_id, 
      vehicle_id, 
      entry_date, 
      type, 
      category, 
      amount, 
      remaining_amount
    )
    VALUES(
      fc.customer_id, 
      fc.vehicle_id, 
      CURRENT_DATE, 
      'Adjustment', 
      'Fine', 
      -remaining_amt, 
      0
    );
  END IF;
END $$;


ALTER FUNCTION "public"."fine_void_charge"("f_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_daily_reminders"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  charge_rec RECORD;
  customer_credit NUMERIC;
  message_text TEXT;
  reminder_type TEXT;
  due_date_diff INTEGER;
BEGIN
  -- Get all unpaid charges with remaining amounts
  FOR charge_rec IN
    SELECT 
      le.id as charge_id,
      le.customer_id,
      le.rental_id,
      le.vehicle_id,
      le.due_date,
      le.remaining_amount,
      le.category,
      c.name as customer_name,
      v.reg as vehicle_reg,
      (le.due_date - CURRENT_DATE)::integer as days_until_due
    FROM ledger_entries le
    JOIN customers c ON c.id = le.customer_id
    JOIN vehicles v ON v.id = le.vehicle_id
    WHERE le.type = 'Charge' 
      AND le.remaining_amount > 0
      AND le.due_date IS NOT NULL
      AND le.due_date >= CURRENT_DATE - INTERVAL '28 days' -- Don't process very old charges
  LOOP
    -- Calculate customer available credit
    SELECT COALESCE(
      -1 * SUM(CASE WHEN type = 'Payment' THEN amount ELSE -amount END), 0
    ) INTO customer_credit
    FROM ledger_entries 
    WHERE customer_id = charge_rec.customer_id 
      AND remaining_amount = 0; -- Only fully applied credits
    
    -- Skip if customer has enough credit to cover this charge
    IF customer_credit >= charge_rec.remaining_amount THEN
      CONTINUE;
    END IF;
    
    due_date_diff := charge_rec.days_until_due;
    
    -- Determine reminder type and generate message
    IF due_date_diff = 2 THEN
      reminder_type := 'Upcoming';
      message_text := 'Payment due in 2 days: £' || charge_rec.remaining_amount || ' for ' || charge_rec.vehicle_reg;
    ELSIF due_date_diff = 0 THEN
      reminder_type := 'Due';
      message_text := 'Payment due today: £' || charge_rec.remaining_amount || ' for ' || charge_rec.vehicle_reg;
    ELSIF due_date_diff = -1 THEN
      reminder_type := 'Overdue1';
      message_text := 'Payment overdue by 1 day: £' || charge_rec.remaining_amount || ' for ' || charge_rec.vehicle_reg;
    ELSIF due_date_diff IN (-7, -14, -21, -28) THEN
      reminder_type := 'OverdueN';
      message_text := 'Payment overdue by ' || ABS(due_date_diff) || ' days: £' || charge_rec.remaining_amount || ' for ' || charge_rec.vehicle_reg;
    ELSE
      CONTINUE; -- Skip dates that don't match our reminder schedule
    END IF;
    
    -- Insert reminder (idempotent - will skip if already exists)
    INSERT INTO reminder_events (
      charge_id,
      customer_id,
      rental_id,
      vehicle_id,
      reminder_type,
      message_preview,
      status
    ) VALUES (
      charge_rec.charge_id,
      charge_rec.customer_id,
      charge_rec.rental_id,
      charge_rec.vehicle_id,
      reminder_type,
      message_text,
      'Queued'
    ) ON CONFLICT (charge_id, reminder_type) DO NOTHING;
    
  END LOOP;
  
  -- Mark all queued reminders as delivered
  UPDATE reminder_events 
  SET status = 'Delivered', delivered_at = now()
  WHERE status = 'Queued';
  
END;
$$;


ALTER FUNCTION "public"."generate_daily_reminders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_first_charge_for_rental"("rental_id_param" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rental record;
BEGIN
  -- Get rental details
  SELECT id, customer_id, vehicle_id, start_date, monthly_amount, status
  INTO v_rental
  FROM rentals
  WHERE id = rental_id_param;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental % not found', rental_id_param;
  END IF;

  -- Check if this rental already has a first charge
  IF EXISTS (
    SELECT 1 FROM ledger_entries
    WHERE rental_id = v_rental.id
      AND type = 'Charge'
      AND category = 'Rental'
      AND due_date = v_rental.start_date
  ) THEN
    -- Charge already exists, skip
    RETURN;
  END IF;

  -- Create the first charge for the rental start date
  -- Uses rental_create_charge which directly inserts into ledger_entries
  PERFORM rental_create_charge(
    v_rental.id,
    v_rental.start_date,
    v_rental.monthly_amount
  );

  RAISE NOTICE 'Created first charge for rental % with status %', v_rental.id, v_rental.status;
END;
$$;


ALTER FUNCTION "public"."generate_first_charge_for_rental"("rental_id_param" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."generate_first_charge_for_rental"("rental_id_param" "uuid") IS 'Generates the first charge (ledger entry) for a specific rental, regardless of its status. Used by client-side booking flow where rentals are created as Pending before payment.';



CREATE OR REPLACE FUNCTION "public"."generate_monthly_charges"("rental_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    rental_record RECORD;
    current_month INTEGER := 0;
    due_date DATE;
BEGIN
    -- Get rental details
    SELECT * INTO rental_record FROM public.rentals WHERE id = rental_id;
    
    -- Generate charges for each month
    WHILE current_month < rental_record.duration_months LOOP
        due_date := rental_record.start_date + INTERVAL '1 month' * current_month;
        
        -- Insert monthly payment due
        INSERT INTO public.payments (
            rental_id, customer_id, vehicle_id, amount, type, status, due_date
        ) VALUES (
            rental_id, rental_record.customer_id, rental_record.vehicle_id,
            rental_record.monthly_payment, 'monthly', 'due', due_date
        );
        
        -- Insert ledger entry
        INSERT INTO public.ledger (
            customer_id, rental_id, vehicle_id, entry_type, description, amount, status
        ) VALUES (
            rental_record.customer_id, rental_id, rental_record.vehicle_id,
            'charge', 'Monthly rental charge for ' || to_char(due_date, 'Month YYYY'),
            rental_record.monthly_payment, 'applied'
        );
        
        current_month := current_month + 1;
    END LOOP;
END;
$$;


ALTER FUNCTION "public"."generate_monthly_charges"("rental_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_next_rental_charge"("r_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_rental record;
  v_next_due_date date;
  v_last_charge_date date;
  v_interval interval;
BEGIN
  -- Get rental details including rental_period_type
  SELECT * INTO v_rental FROM rentals WHERE id = r_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rental % not found', r_id;
  END IF;

  -- Find the last charge date for this rental
  SELECT MAX(due_date) INTO v_last_charge_date
  FROM ledger_entries
  WHERE rental_id = r_id
    AND type = 'Charge'
    AND category = 'Rental';

  -- Calculate next due date based on rental_period_type
  IF v_last_charge_date IS NULL THEN
    -- No charges yet, start from rental start date
    v_next_due_date := v_rental.start_date;
  ELSE
    -- Determine interval based on rental_period_type
    CASE v_rental.rental_period_type
      WHEN 'Daily' THEN
        v_interval := INTERVAL '1 day';
      WHEN 'Weekly' THEN
        v_interval := INTERVAL '1 week';
      ELSE -- 'Monthly' or NULL (default)
        v_interval := INTERVAL '1 month';
    END CASE;

    v_next_due_date := v_last_charge_date + v_interval;
  END IF;

  -- Don't generate charges beyond end date if rental has ended
  IF v_rental.end_date IS NOT NULL AND v_next_due_date > v_rental.end_date THEN
    RETURN; -- No more charges to generate
  END IF;

  -- Use rental_create_charge which handles conflicts properly
  PERFORM rental_create_charge(v_rental.id, v_next_due_date, v_rental.monthly_amount);
END;
$$;


ALTER FUNCTION "public"."generate_next_rental_charge"("r_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_rental_charges"("r_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  rental_rec record;
  current_month integer := 0;
  charge_date date;
  duration_months integer;
BEGIN
  SELECT * INTO rental_rec FROM rentals WHERE id = r_id;
  
  -- Calculate duration in months
  duration_months := EXTRACT(YEAR FROM AGE(rental_rec.end_date, rental_rec.start_date)) * 12 + 
                     EXTRACT(MONTH FROM AGE(rental_rec.end_date, rental_rec.start_date));
  
  -- Generate monthly charges
  WHILE current_month < duration_months LOOP
    charge_date := rental_rec.start_date + INTERVAL '1 month' * current_month;
    
    PERFORM rental_create_charge(r_id, charge_date, rental_rec.monthly_amount);
    
    current_month := current_month + 1;
  END LOOP;
END $$;


ALTER FUNCTION "public"."generate_rental_charges"("r_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_rental_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.rental_number IS NULL THEN
    NEW.rental_number := 'R-' || SUBSTRING(REPLACE(NEW.id::text, '-', '') FROM 1 FOR 6);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_rental_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_user_role"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN (
    SELECT role 
    FROM public.app_users 
    WHERE auth_user_id = auth.uid() 
    AND is_active = true
  );
END;
$$;


ALTER FUNCTION "public"."get_current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_customer_balance_with_status"("customer_id_param" "uuid") RETURNS TABLE("balance" numeric, "status" "text", "total_charges" numeric, "total_payments" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_balance numeric := 0;
  v_total_charges_due numeric := 0;
  v_total_payments numeric := 0;
  v_status text;
BEGIN
  -- Get total charges that are currently due (due_date <= CURRENT_DATE)
  SELECT COALESCE(SUM(remaining_amount), 0) INTO v_total_charges_due
  FROM ledger_entries
  WHERE customer_id = customer_id_param
    AND type = 'Charge'
    AND remaining_amount > 0
    AND due_date <= CURRENT_DATE; -- Only currently due charges
  
  -- Get total payments made by customer (excluding InitialFee which is company revenue)
  SELECT COALESCE(SUM(amount), 0) INTO v_total_payments
  FROM payments
  WHERE customer_id = customer_id_param
    AND payment_type IN ('Payment', 'Rental', 'Fine'); -- Exclude InitialFee from customer debt calculation
  
  -- Calculate net position: remaining charges due - applicable payments
  v_balance := v_total_charges_due - v_total_payments;
  
  -- Determine status based on net position
  IF v_balance = 0 THEN
    v_status := 'Settled';
  ELSIF v_balance > 0 THEN
    v_status := 'In Debt';
  ELSE
    v_status := 'In Credit';
    -- Return positive credit amount
    v_balance := ABS(v_balance);
  END IF;
  
  RETURN QUERY SELECT v_balance, v_status, v_total_charges_due, v_total_payments;
END;
$$;


ALTER FUNCTION "public"."get_customer_balance_with_status"("customer_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_customer_credit"("customer_id_param" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  total_credit numeric := 0;
BEGIN
  -- Calculate total unapplied credit for customer
  SELECT COALESCE(
    SUM(p.amount) - COALESCE(SUM(pa.amount_applied), 0), 0
  ) INTO total_credit
  FROM payments p
  LEFT JOIN payment_applications pa ON pa.payment_id = p.id
  WHERE p.customer_id = customer_id_param;
  
  RETURN GREATEST(total_credit, 0);
END;
$$;


ALTER FUNCTION "public"."get_customer_credit"("customer_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_customer_net_position"("customer_id_param" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  total_charges NUMERIC := 0;
  total_applied NUMERIC := 0;
  net_position NUMERIC;
BEGIN
  -- Get total charges for customer's rentals
  SELECT COALESCE(SUM(le.amount), 0) INTO total_charges
  FROM ledger_entries le
  JOIN rentals r ON r.id = le.rental_id
  WHERE r.customer_id = customer_id_param
    AND le.type = 'Charge'
    AND le.category = 'Rental';
  
  -- Get total applied payments to those charges
  SELECT COALESCE(SUM(pa.amount_applied), 0) INTO total_applied
  FROM payment_applications pa
  JOIN ledger_entries le ON le.id = pa.charge_entry_id
  JOIN rentals r ON r.id = le.rental_id
  WHERE r.customer_id = customer_id_param
    AND le.type = 'Charge'
    AND le.category = 'Rental';
  
  net_position := total_charges - total_applied;
  RETURN net_position;
END;
$$;


ALTER FUNCTION "public"."get_customer_net_position"("customer_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_customer_statement"("p_customer_id" "uuid", "p_from_date" "date", "p_to_date" "date") RETURNS TABLE("transaction_date" "date", "type" "text", "description" "text", "debit" numeric, "credit" numeric, "running_balance" numeric, "rental_id" "uuid", "vehicle_reg" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  opening_balance NUMERIC := 0;
BEGIN
  -- Calculate opening balance
  SELECT COALESCE(
    (SELECT SUM(pa.amount_applied) 
     FROM payment_applications pa
     JOIN ledger_entries le ON le.id = pa.charge_entry_id
     JOIN payments p ON p.id = pa.payment_id
     WHERE le.customer_id = p_customer_id AND p.payment_date < p_from_date)
    -
    (SELECT SUM(le.amount)
     FROM ledger_entries le
     WHERE le.customer_id = p_customer_id 
       AND le.type = 'Charge' 
       AND le.due_date < p_from_date), 0
  ) INTO opening_balance;
  
  -- Return transactions in date order
  RETURN QUERY
  WITH statement_transactions AS (
    -- Charges
    SELECT 
      le.due_date as transaction_date,
      'Charge'::TEXT as type,
      CONCAT('Rental charge - ', v.reg) as description,
      le.amount as debit,
      0::NUMERIC as credit,
      le.rental_id,
      v.reg as vehicle_reg,
      le.due_date as sort_date,
      le.id::TEXT as sort_id
    FROM ledger_entries le
    JOIN vehicles v ON v.id = le.vehicle_id
    WHERE le.customer_id = p_customer_id
      AND le.type = 'Charge'
      AND le.due_date BETWEEN p_from_date AND p_to_date
    
    UNION ALL
    
    -- Payments
    SELECT 
      p.payment_date as transaction_date,
      'Payment'::TEXT as type,
      CONCAT('Payment - ', p.method) as description,
      0::NUMERIC as debit,
      p.amount as credit,
      p.rental_id,
      v.reg as vehicle_reg,
      p.payment_date as sort_date,
      p.id::TEXT as sort_id
    FROM payments p
    LEFT JOIN vehicles v ON v.id = p.vehicle_id
    WHERE p.customer_id = p_customer_id
      AND p.payment_date BETWEEN p_from_date AND p_to_date
  )
  SELECT 
    st.transaction_date,
    st.type,
    st.description,
    st.debit,
    st.credit,
    opening_balance + SUM(st.credit - st.debit) OVER (ORDER BY st.sort_date, st.sort_id) as running_balance,
    st.rental_id,
    st.vehicle_reg
  FROM statement_transactions st
  ORDER BY st.sort_date, st.sort_id;
END;
$$;


ALTER FUNCTION "public"."get_customer_statement"("p_customer_id" "uuid", "p_from_date" "date", "p_to_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_effective_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT tenant_id
  FROM app_users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_effective_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_expiring_bookings"() RETURNS TABLE("rental_id" "uuid", "payment_id" "uuid", "customer_name" "text", "vehicle_reg" "text", "amount" numeric, "days_remaining" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id as rental_id,
    p.id as payment_id,
    c.name as customer_name,
    v.reg as vehicle_reg,
    p.amount,
    EXTRACT(DAY FROM (p.preauth_expires_at - now()))::INTEGER as days_remaining
  FROM rentals r
  JOIN payments p ON p.rental_id = r.id
  JOIN customers c ON c.id = r.customer_id
  JOIN vehicles v ON v.id = r.vehicle_id
  WHERE r.status = 'Pending'
    AND p.capture_status = 'requires_capture'
    AND p.preauth_expires_at IS NOT NULL
    AND p.preauth_expires_at < (now() + INTERVAL '2 days')
    AND p.preauth_expires_at > now()
  ORDER BY p.preauth_expires_at ASC;
END;
$$;


ALTER FUNCTION "public"."get_expiring_bookings"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_expiring_bookings"() IS 'Returns bookings with pre-auth expiring within 2 days';



CREATE OR REPLACE FUNCTION "public"."get_payment_remaining"("payment_id_param" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  payment_amount numeric;
  applied_amount numeric := 0;
BEGIN
  -- Get payment amount
  SELECT amount INTO payment_amount
  FROM payments
  WHERE id = payment_id_param;
  
  -- Get total applied amount
  SELECT COALESCE(SUM(amount_applied), 0) INTO applied_amount
  FROM payment_applications
  WHERE payment_id = payment_id_param;
  
  RETURN GREATEST(payment_amount - applied_amount, 0);
END;
$$;


ALTER FUNCTION "public"."get_payment_remaining"("payment_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_pending_bookings_count"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM rentals r
    JOIN payments p ON p.rental_id = r.id
    WHERE r.status = 'Pending'
      AND p.booking_source = 'website'
      AND p.capture_status = 'requires_capture'
  );
END;
$$;


ALTER FUNCTION "public"."get_pending_bookings_count"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_pending_bookings_count"() IS 'Returns count of pending customer bookings awaiting admin approval';



CREATE OR REPLACE FUNCTION "public"."get_pending_charges_for_reminders"() RETURNS TABLE("charge_id" "uuid", "customer_id" "uuid", "customer_name" "text", "customer_email" "text", "customer_phone" "text", "whatsapp_opt_in" boolean, "rental_id" "uuid", "vehicle_id" "uuid", "vehicle_reg" "text", "due_date" "date", "amount" numeric, "remaining_amount" numeric, "customer_balance" numeric, "days_until_due" integer, "days_overdue" integer, "charge_type" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT 
    le.id as charge_id,
    le.customer_id,
    c.name as customer_name,
    c.email as customer_email,
    c.phone as customer_phone,
    c.whatsapp_opt_in,
    le.rental_id,
    le.vehicle_id,
    v.reg as vehicle_reg,
    le.due_date,
    le.amount,
    le.remaining_amount,
    -- Calculate customer balance (total credits - total charges)
    COALESCE((
      SELECT SUM(CASE WHEN type = 'Payment' THEN amount ELSE -amount END)
      FROM ledger_entries le2
      WHERE le2.customer_id = le.customer_id
    ), 0) as customer_balance,
    (le.due_date - CURRENT_DATE)::integer as days_until_due,
    (CURRENT_DATE - le.due_date)::integer as days_overdue,
    le.category as charge_type
  FROM ledger_entries le
  JOIN customers c ON c.id = le.customer_id
  JOIN vehicles v ON v.id = le.vehicle_id
  WHERE le.type = 'Charge' 
    AND le.remaining_amount > 0
    AND le.due_date IS NOT NULL
    AND le.category IN ('Rental', 'Fine', 'InitialFee');
$$;


ALTER FUNCTION "public"."get_pending_charges_for_reminders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_pending_payments_count"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM payments
    WHERE verification_status = 'pending'
  );
END;
$$;


ALTER FUNCTION "public"."get_pending_payments_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_refunds_due_today"() RETURNS TABLE("payment_id" "uuid", "stripe_payment_intent_id" "text", "payment_amount" numeric, "refund_amount" numeric, "refund_reason" "text", "customer_id" "uuid", "customer_name" "text", "customer_email" "text", "rental_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS payment_id,
    p.stripe_payment_intent_id,
    p.amount AS payment_amount,
    p.refund_amount,
    p.refund_reason,
    c.id AS customer_id,
    c.name AS customer_name,
    c.email AS customer_email,
    r.id AS rental_id
  FROM payments p
  INNER JOIN rentals r ON p.rental_id = r.id
  INNER JOIN customers c ON r.customer_id = c.id
  WHERE p.refund_status = 'scheduled'
    AND DATE(p.refund_scheduled_date) <= CURRENT_DATE
    AND p.stripe_payment_intent_id IS NOT NULL
  ORDER BY p.refund_scheduled_date ASC;
END;
$$;


ALTER FUNCTION "public"."get_refunds_due_today"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_rental_credit"("rental_id_param" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  total_credit numeric := 0;
BEGIN
  -- Calculate total unapplied credit for rental
  SELECT COALESCE(
    SUM(p.amount) - COALESCE(SUM(pa.amount_applied), 0), 0
  ) INTO total_credit
  FROM payments p
  LEFT JOIN payment_applications pa ON pa.payment_id = p.id
  WHERE p.rental_id = rental_id_param;
  
  RETURN GREATEST(total_credit, 0);
END;
$$;


ALTER FUNCTION "public"."get_rental_credit"("rental_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_rental_insurance_documents"("p_rental_id" "uuid") RETURNS TABLE("id" "uuid", "document_name" "text", "file_url" "text", "ai_scan_status" "text", "ai_extracted_data" "jsonb", "ai_confidence_score" numeric, "ai_validation_score" numeric, "uploaded_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    cd.id,
    cd.document_name,
    cd.file_url,
    cd.ai_scan_status,
    cd.ai_extracted_data,
    cd.ai_confidence_score,
    cd.ai_validation_score,
    cd.uploaded_at
  FROM customer_documents cd
  WHERE cd.rental_id = p_rental_id
    AND cd.document_type = 'Insurance Certificate'
  ORDER BY cd.uploaded_at DESC;
END;
$$;


ALTER FUNCTION "public"."get_rental_insurance_documents"("p_rental_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role"("user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role FROM public.app_users WHERE auth_user_id = user_id AND is_active = true;
$$;


ALTER FUNCTION "public"."get_user_role"("user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$ SELECT COALESCE((auth.jwt() -> 'user_metadata' ->> 'impersonated_tenant_id')::UUID, (SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1)); $$;


ALTER FUNCTION "public"."get_user_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_vehicle_expense_pnl"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    pnl_category TEXT;
BEGIN
    -- Map expense categories to P&L categories
    CASE NEW.category
        WHEN 'Service' THEN
            pnl_category := 'Service';
        WHEN 'Repair', 'Tyres', 'Valet', 'Accessory', 'Other' THEN
            pnl_category := 'Expenses';
        ELSE
            pnl_category := 'Expenses';
    END CASE;

    IF TG_OP = 'INSERT' THEN
        -- Add P&L cost entry for new expense with proper reference format
        INSERT INTO public.pnl_entries (
            vehicle_id, entry_date, side, category, amount, reference
        ) VALUES (
            NEW.vehicle_id, NEW.expense_date, 'Cost', pnl_category, NEW.amount, 'vexp:' || NEW.id::text
        );
        
        -- Log event
        INSERT INTO public.vehicle_events (
            vehicle_id, event_type, summary, reference_id, reference_table
        ) VALUES (
            NEW.vehicle_id, 'expense_added', 
            'Added ' || NEW.category || ' expense: £' || NEW.amount::text,
            NEW.id, 'vehicle_expenses'
        );
        
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Update P&L entry with new category mapping
        CASE NEW.category
            WHEN 'Service' THEN
                pnl_category := 'Service';
            WHEN 'Repair', 'Tyres', 'Valet', 'Accessory', 'Other' THEN
                pnl_category := 'Expenses';
            ELSE
                pnl_category := 'Expenses';
        END CASE;
        
        UPDATE public.pnl_entries 
        SET amount = NEW.amount, 
            entry_date = NEW.expense_date,
            category = pnl_category
        WHERE reference = 'vexp:' || NEW.id::text;
        
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Remove P&L entry
        DELETE FROM public.pnl_entries WHERE reference = 'vexp:' || OLD.id::text;
        
        -- Log event
        INSERT INTO public.vehicle_events (
            vehicle_id, event_type, summary, reference_id, reference_table
        ) VALUES (
            OLD.vehicle_id, 'expense_removed', 
            'Removed ' || OLD.category || ' expense: £' || OLD.amount::text,
            OLD.id, 'vehicle_expenses'
        );
        
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."handle_vehicle_expense_pnl"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_any_role"("_user_id" "uuid", "_roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE auth_user_id = _user_id
      AND role = ANY(_roles)
      AND is_active = true
  )
$$;


ALTER FUNCTION "public"."has_any_role"("_user_id" "uuid", "_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE auth_user_id = _user_id
      AND role = _role
      AND is_active = true
  )
$$;


ALTER FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_upfront_finance_entry"("v_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM pnl_entries 
    WHERE vehicle_id = v_id 
    AND category = 'Acquisition' 
    AND source_ref = 'FIN-UPFRONT:' || v_id::text
  );
END;
$$;


ALTER FUNCTION "public"."has_upfront_finance_entry"("v_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hash_password"("password" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN crypt(password, gen_salt('bf'));
END;
$$;


ALTER FUNCTION "public"."hash_password"("password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_current_user_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.app_users 
    WHERE auth_user_id = auth.uid() 
    AND role IN ('admin', 'head_admin') 
    AND is_active = true
  );
END;
$$;


ALTER FUNCTION "public"."is_current_user_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_global_master_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$ SELECT EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND is_primary_super_admin = true); $$;


ALTER FUNCTION "public"."is_global_master_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_identity_blocked"("p_identity_number" "text") RETURNS TABLE("is_blocked" boolean, "block_reason" "text", "identity_type" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    true AS is_blocked,
    bi.reason AS block_reason,
    bi.identity_type
  FROM blocked_identities bi
  WHERE bi.identity_number = p_identity_number
    AND bi.is_active = true
  LIMIT 1;

  -- If no rows returned, return not blocked
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::TEXT;
  END IF;
END;
$$;


ALTER FUNCTION "public"."is_identity_blocked"("p_identity_number" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_identity_blocked"("p_identity_number" "text") IS 'Check if an identity number is in the blocked list';



CREATE OR REPLACE FUNCTION "public"."is_primary_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT COALESCE(
    (SELECT is_primary_super_admin FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1),
    false
  );
$$;


ALTER FUNCTION "public"."is_primary_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM app_users WHERE auth_user_id = auth.uid() LIMIT 1),
    false
  );
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_vehicle_file_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.vehicle_events (
            vehicle_id, event_type, summary, reference_id, reference_table
        ) VALUES (
            NEW.vehicle_id, 'file_uploaded', 
            'Uploaded file: ' || NEW.file_name,
            NEW.id, 'vehicle_files'
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.vehicle_events (
            vehicle_id, event_type, summary, reference_id, reference_table
        ) VALUES (
            OLD.vehicle_id, 'file_deleted', 
            'Deleted file: ' || OLD.file_name,
            OLD.id, 'vehicle_files'
        );
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."log_vehicle_file_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."payment_apply_fifo"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  PERFORM payment_apply_fifo_v2(p_id);
END;
$$;


ALTER FUNCTION "public"."payment_apply_fifo"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."payment_apply_fifo_v2"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_amt NUMERIC;
  v_left NUMERIC;
  v_rental UUID;
  v_customer UUID;
  v_vehicle UUID;
  v_pay_date DATE;
  v_is_early BOOLEAN;
  c RECORD;
  to_apply NUMERIC;
  next_due_date DATE;
BEGIN
  SELECT amount, rental_id, customer_id, vehicle_id, payment_date, is_early
    INTO v_amt, v_rental, v_customer, v_vehicle, v_pay_date, v_is_early
  FROM payments WHERE id = p_id;

  -- Skip if no customer
  IF v_customer IS NULL THEN
    RETURN;
  END IF;

  v_left := v_amt;

  -- Auto-detect early payment if not explicitly set
  IF NOT v_is_early THEN
    SELECT MIN(due_date) INTO next_due_date
    FROM ledger_entries
    WHERE customer_id = v_customer
      AND type = 'Charge' 
      AND category = 'Rental'
      AND remaining_amount > 0;
    
    IF next_due_date IS NOT NULL AND v_pay_date < next_due_date THEN
      v_is_early := TRUE;
      UPDATE payments SET is_early = TRUE WHERE id = p_id;
    END IF;
  END IF;

  -- Allocate to ALL charges (due and future) for this customer in FIFO order by due_date, then entry_date
  FOR c IN
    SELECT id, remaining_amount, due_date
      FROM ledger_entries
     WHERE customer_id = v_customer
       AND type='Charge' AND category='Rental'
       AND remaining_amount > 0
       AND (v_rental IS NULL OR rental_id = v_rental)
     ORDER BY due_date ASC, entry_date ASC, id ASC
  LOOP
    EXIT WHEN v_left <= 0;

    to_apply := LEAST(c.remaining_amount, v_left);

    INSERT INTO payment_applications(payment_id, charge_entry_id, amount_applied)
    VALUES (p_id, c.id, to_apply)
    ON CONFLICT ON CONSTRAINT ux_payment_app_unique DO NOTHING;

    UPDATE ledger_entries
       SET remaining_amount = remaining_amount - to_apply
     WHERE id = c.id;

    -- Book revenue on the charge due date (even if future) with conflict handling
    INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v_vehicle, c.due_date, 'Revenue', 'Rental', to_apply, p_id::text)
    ON CONFLICT (vehicle_id, category, source_ref) 
    DO UPDATE SET amount = pnl_entries.amount + EXCLUDED.amount;

    v_left := v_left - to_apply;
  END LOOP;

  -- Update payment status based on remaining amount
  IF v_left = 0 THEN
    UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p_id;
  ELSIF v_left = v_amt THEN
    UPDATE payments SET status = 'Credit', remaining_amount = v_left WHERE id = p_id;
  ELSE
    UPDATE payments SET status = 'Partial', remaining_amount = v_left WHERE id = p_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."payment_apply_fifo_v2"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."payment_auto_apply_due_credit"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare
  p record;
begin
  for p in
    select p.id
    from payments p
    where
      -- has unapplied balance
      (select coalesce(p.amount - sum(pa.amount_applied), p.amount)
         from payment_applications pa
        where pa.payment_id = p.id) > 0
      -- payment date is not in the future
      and p.payment_date <= current_date
  loop
    perform payment_apply_fifo(p.id);
  end loop;
end;
$$;


ALTER FUNCTION "public"."payment_auto_apply_due_credit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pnl_post_acquisition"("v_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v record;
  contract_total numeric;
  entry_date_to_use date;
  reference_key text;
BEGIN
  SELECT id, acquisition_date, purchase_price, acquisition_type, 
         monthly_payment, initial_payment, term_months, balloon, finance_start_date
  INTO v
  FROM vehicles
  WHERE id = v_id;

  -- Handle Purchase acquisition (existing logic)
  IF v.acquisition_type = 'Purchase' AND v.purchase_price IS NOT NULL AND v.acquisition_date IS NOT NULL THEN
    INSERT INTO pnl_entries (vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v.id, v.acquisition_date, 'Cost', 'Acquisition', v.purchase_price, v.id::text)
    ON CONFLICT ON CONSTRAINT ux_pnl_vehicle_category_source
    DO UPDATE SET
      entry_date = EXCLUDED.entry_date,
      amount     = EXCLUDED.amount;
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
    INSERT INTO pnl_entries (vehicle_id, entry_date, side, category, amount, source_ref)
    VALUES (v.id, entry_date_to_use, 'Cost', 'Acquisition', contract_total, reference_key)
    ON CONFLICT (vehicle_id, category, source_ref)
    DO UPDATE SET
      entry_date = EXCLUDED.entry_date,
      amount     = EXCLUDED.amount;
      
    RETURN;
  END IF;
END;
$$;


ALTER FUNCTION "public"."pnl_post_acquisition"("v_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_payment_transaction"("p_payment_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  p record;
  cat text;
  d date;
  err text;
begin
  -- Load payment
  select * into p from public.payments where id = p_payment_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Payment not found', 'payment_id', p_payment_id);
  end if;

  d := coalesce(p.payment_date::date, now()::date);

  -- Handle InitialFee payments - ONLY create P&L revenue, NO customer ledger entry
  if lower(coalesce(p.payment_type, '')) in ('initial fee','initial fees','initialfee') then
    -- P&L: Company revenue only (no customer debt)
    INSERT INTO public.pnl_entries(
      vehicle_id, entry_date, side, category, amount, reference, customer_id
    )
    VALUES (
      p.vehicle_id, d, 'Revenue', 'Initial Fees', p.amount, p.id::text, p.customer_id
    )
    ON CONFLICT (reference) DO NOTHING;
    
    -- Mark payment as applied (it's just company profit)
    UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p.id;
    
    return jsonb_build_object('ok', true, 'payment_id', p.id, 'category', 'Initial Fees', 'type', 'company_revenue_only');
  end if;

  -- Handle regular payments (Rental, Fine, etc.)
  if lower(coalesce(p.payment_type, '')) = 'rental' then
    cat := 'Rental';
  elsif lower(coalesce(p.payment_type, '')) = 'fine' then
    cat := 'Fines';
  else
    cat := 'Other';
  end if;

  -- Create ledger payment entry (negative amount)
  insert into public.ledger_entries
    (customer_id, rental_id, vehicle_id, entry_date, type, category, amount, due_date, remaining_amount, payment_id)
  values
    (p.customer_id, p.rental_id, p.vehicle_id, d, 'Payment', cat, -p.amount, d, 0, p.id)
  on conflict (payment_id) where (payment_id is not null) do nothing;

  -- P&L revenue entry
  insert into public.pnl_entries
    (vehicle_id, entry_date, side, category, amount, reference, customer_id)
  values
    (p.vehicle_id, d, 'Revenue', cat, p.amount, p.id::text, p.customer_id)
  on conflict (reference) do nothing;

  -- Try FIFO allocation
  begin
    perform public.payment_apply_fifo_v2(p.id);
  exception when others then
    -- ignore allocation errors
  end;

  return jsonb_build_object('ok', true, 'payment_id', p.id, 'category', cat, 'date', d);
exception
  when others then
    err := sqlerrm;
    return jsonb_build_object('ok', false, 'error', err, 'payment_id', p_payment_id);
end;
$$;


ALTER FUNCTION "public"."process_payment_transaction"("p_payment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_payment_transaction"("p_payment_id" "uuid", "p_customer_id" "uuid", "p_rental_id" "uuid", "p_vehicle_id" "uuid", "p_amount" numeric, "p_payment_type" "text", "p_payment_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_category TEXT;
  v_allocated NUMERIC := 0;
  v_payment_remaining NUMERIC;
  v_status TEXT;
  v_charge RECORD;
  v_to_apply NUMERIC;
  v_has_side_column BOOLEAN;
BEGIN
  BEGIN
    -- Category mapping
    v_category := CASE 
      WHEN LOWER(p_payment_type) IN ('initial fee', 'initial fees', 'initialfee') THEN 'Initial Fees'
      WHEN LOWER(p_payment_type) = 'rental' THEN 'Rental'
      WHEN LOWER(p_payment_type) = 'fine' THEN 'Fines'
      ELSE 'Other'
    END;
    
    -- Check if pnl_entries has 'side' column
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'pnl_entries' 
      AND column_name = 'side'
    ) INTO v_has_side_column;
    
    -- Insert ledger payment entry (idempotent - skip if already exists)
    -- Use correct syntax for partial unique index
    INSERT INTO public.ledger_entries (
      customer_id, rental_id, vehicle_id, entry_date, 
      type, category, amount, due_date, remaining_amount, payment_id
    )
    VALUES (
      p_customer_id, p_rental_id, p_vehicle_id, p_payment_date,
      'Payment', v_category, -p_amount, p_payment_date, 0, p_payment_id
    )
    ON CONFLICT (payment_id) WHERE (payment_id IS NOT NULL) DO NOTHING;
    
    -- Insert P&L revenue entry (idempotent - skip if already exists)
    INSERT INTO public.pnl_entries (
      vehicle_id, entry_date, side, category, amount, reference, customer_id
    )
    VALUES (
      p_vehicle_id, p_payment_date, 'Revenue', v_category, p_amount, p_payment_id::TEXT, p_customer_id
    )
    ON CONFLICT (reference) DO NOTHING;
    
    v_payment_remaining := p_amount;
    
    -- FIFO allocation for rental payments only
    IF p_rental_id IS NOT NULL AND v_category = 'Rental' THEN
      FOR v_charge IN
        SELECT id, remaining_amount, due_date, entry_date
        FROM ledger_entries
        WHERE rental_id = p_rental_id
          AND type = 'Charge'
          AND category = 'Rental'
          AND remaining_amount > 0
        ORDER BY due_date ASC, entry_date ASC, id ASC
      LOOP
        EXIT WHEN v_payment_remaining <= 0;
        
        v_to_apply := LEAST(v_charge.remaining_amount, v_payment_remaining);
        
        -- Create payment application (idempotent)
        INSERT INTO payment_applications (payment_id, charge_entry_id, amount_applied)
        VALUES (p_payment_id, v_charge.id, v_to_apply)
        ON CONFLICT (payment_id, charge_entry_id) DO NOTHING;
        
        -- Update charge remaining amount
        UPDATE ledger_entries
        SET remaining_amount = remaining_amount - v_to_apply
        WHERE id = v_charge.id;
        
        v_allocated := v_allocated + v_to_apply;
        v_payment_remaining := v_payment_remaining - v_to_apply;
      END LOOP;
    END IF;
    
    -- Determine payment status
    IF v_payment_remaining = 0 THEN
      v_status := 'Applied';
    ELSIF v_payment_remaining = p_amount THEN
      v_status := 'Credit';
    ELSE
      v_status := 'Partial';
    END IF;
    
    -- Update payment status
    UPDATE payments
    SET status = v_status, remaining_amount = v_payment_remaining
    WHERE id = p_payment_id;
    
    -- Return success result
    RETURN jsonb_build_object(
      'success', true,
      'ok', true,
      'payment_id', p_payment_id,
      'category', v_category,
      'allocated', v_allocated,
      'remaining', v_payment_remaining,
      'status', v_status
    );
    
  EXCEPTION
    WHEN OTHERS THEN
      -- Return detailed error
      RETURN jsonb_build_object(
        'success', false,
        'ok', false,
        'error', SQLERRM,
        'detail', SQLSTATE || ': ' || SQLERRM
      );
  END;
END;
$$;


ALTER FUNCTION "public"."process_payment_transaction"("p_payment_id" "uuid", "p_customer_id" "uuid", "p_rental_id" "uuid", "p_vehicle_id" "uuid", "p_amount" numeric, "p_payment_type" "text", "p_payment_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reapply_all_payments"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  p RECORD;
BEGIN
  -- Reset only computed pieces safely
  DELETE FROM pnl_entries WHERE category='Rental' AND source_ref IS NOT NULL;
  UPDATE ledger_entries
    SET remaining_amount = amount
   WHERE type='Charge' AND category='Rental';

  DELETE FROM payment_applications;

  FOR p IN
    SELECT id FROM payments WHERE rental_id IS NOT NULL ORDER BY payment_date ASC
  LOOP
    PERFORM payment_apply_fifo(p.id);
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."reapply_all_payments"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reapply_all_payments_v2"() RETURNS TABLE("payments_processed" integer, "customers_affected" integer, "total_credit_applied" numeric)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  p RECORD;
  payment_count INTEGER := 0;
  customer_count INTEGER := 0;
  credit_applied NUMERIC := 0;
  customers_set UUID[] := '{}';
BEGIN
  -- Reset computed data safely
  DELETE FROM pnl_entries WHERE category='Rental' AND source_ref IS NOT NULL;
  UPDATE ledger_entries
    SET remaining_amount = amount
   WHERE type='Charge' AND category='Rental';
  DELETE FROM payment_applications;
  UPDATE payments SET status = 'Applied', remaining_amount = 0;

  -- Reapply all payments in payment_date order (business chronological order)
  FOR p IN
    SELECT id, customer_id FROM payments ORDER BY payment_date ASC, id ASC
  LOOP
    PERFORM payment_apply_fifo_v2(p.id);
    payment_count := payment_count + 1;
    
    -- Track unique customers
    IF NOT (p.customer_id = ANY(customers_set)) THEN
      customers_set := customers_set || p.customer_id;
      customer_count := customer_count + 1;
    END IF;
  END LOOP;

  -- Calculate total credit held
  SELECT COALESCE(SUM(remaining_amount), 0) INTO credit_applied
  FROM payments WHERE status IN ('Credit', 'Partial');

  RETURN QUERY SELECT payment_count, customer_count, credit_applied;
END;
$$;


ALTER FUNCTION "public"."reapply_all_payments_v2"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_insurance_status"() RETURNS TABLE("updated_policies" integer, "expired_policies" integer, "expiring_soon_policies" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated INTEGER := 0;
  v_expired INTEGER := 0;
  v_expiring_soon INTEGER := 0;
  policy_record RECORD;
  new_status TEXT;
BEGIN
  -- Process all non-Inactive policies
  FOR policy_record IN 
    SELECT id, status, expiry_date, start_date
    FROM insurance_policies 
    WHERE status != 'Inactive'
  LOOP
    -- Calculate new status based on dates
    IF policy_record.expiry_date < CURRENT_DATE THEN
      new_status := 'Expired';
      v_expired := v_expired + 1;
    ELSIF policy_record.expiry_date <= CURRENT_DATE + INTERVAL '30 days' 
          AND policy_record.expiry_date >= CURRENT_DATE THEN
      new_status := 'ExpiringSoon';
      v_expiring_soon := v_expiring_soon + 1;
    ELSIF policy_record.start_date <= CURRENT_DATE 
          AND policy_record.expiry_date >= CURRENT_DATE THEN
      new_status := 'Active';
    ELSE
      -- Future policy
      new_status := 'Active';
    END IF;
    
    -- Update if status changed
    IF policy_record.status != new_status THEN
      UPDATE insurance_policies 
      SET status = new_status, updated_at = NOW()
      WHERE id = policy_record.id;
      
      v_updated := v_updated + 1;
      
      -- Log the status change (simple audit trail)
      INSERT INTO vehicle_events (
        vehicle_id, 
        event_type, 
        summary, 
        reference_id, 
        reference_table
      ) VALUES (
        (SELECT vehicle_id FROM insurance_policies WHERE id = policy_record.id),
        'insurance_status_change',
        'Insurance policy status changed from ' || policy_record.status || ' to ' || new_status,
        policy_record.id,
        'insurance_policies'
      );
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_updated, v_expired, v_expiring_soon;
END;
$$;


ALTER FUNCTION "public"."recalculate_insurance_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_vehicle_pl"("p_vehicle_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    vehicle_record RECORD;
    total_rev NUMERIC := 0;
    total_cost NUMERIC := 0;
    ledger_revenue NUMERIC := 0;
    rental_revenue NUMERIC := 0;
BEGIN
    -- Get vehicle acquisition cost
    SELECT * INTO vehicle_record FROM public.vehicles WHERE id = p_vehicle_id;
    total_cost := vehicle_record.acquisition_price;
    
    -- Calculate total revenue from ledger entries
    SELECT COALESCE(SUM(amount), 0) INTO ledger_revenue
    FROM public.ledger 
    WHERE ledger.vehicle_id = p_vehicle_id AND entry_type = 'charge' AND status = 'applied';
    
    -- Add initial fees from rentals
    SELECT COALESCE(SUM(initial_payment), 0) INTO rental_revenue
    FROM public.rentals 
    WHERE rentals.vehicle_id = p_vehicle_id;
    
    total_rev := ledger_revenue + rental_revenue;
    
    -- Upsert P&L record
    INSERT INTO public.p_l (vehicle_id, total_revenue, total_costs, updated_at)
    VALUES (p_vehicle_id, total_rev, total_cost, now())
    ON CONFLICT (vehicle_id) 
    DO UPDATE SET 
        total_revenue = EXCLUDED.total_revenue,
        total_costs = EXCLUDED.total_costs,
        updated_at = now();
END;
$$;


ALTER FUNCTION "public"."recalculate_vehicle_pl"("p_vehicle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_payment"("p_customer" "uuid", "p_vehicle" "uuid", "p_rental" "uuid", "p_amount" numeric, "p_type" "text", "p_method" "text", "p_payment_date" "date") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
declare
  pid uuid;
begin
  insert into payments (
    customer_id, vehicle_id, rental_id,
    amount, type, method, payment_date
  )
  values (
    p_customer, p_vehicle, p_rental,
    p_amount, p_type, p_method, coalesce(p_payment_date, now()::date)
  )
  returning id into pid;

  -- Apply payment to charges (FIFO logic)
  perform apply_payment_to_charges(pid);

  return pid;
end;
$$;


ALTER FUNCTION "public"."record_payment"("p_customer" "uuid", "p_vehicle" "uuid", "p_rental" "uuid", "p_amount" numeric, "p_type" "text", "p_method" "text", "p_payment_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_booking_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_payment RECORD;
  v_rental RECORD;
BEGIN
  -- Get payment details
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;

  IF v_payment.capture_status NOT IN ('requires_capture', NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment cannot be cancelled');
  END IF;

  -- Note: Actual Stripe cancellation must be done via edge function before calling this

  -- Update payment status
  UPDATE payments
  SET capture_status = 'cancelled',
      verification_status = 'rejected',
      verified_by = p_rejected_by,
      verified_at = now(),
      rejection_reason = p_reason,
      updated_at = now()
  WHERE id = p_payment_id;

  -- Cancel the rental
  IF v_payment.rental_id IS NOT NULL THEN
    UPDATE rentals
    SET status = 'Cancelled',
        updated_at = now()
    WHERE id = v_payment.rental_id;

    -- Keep vehicle as Available (it was never marked as Rented for pending bookings)
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'rental_id', v_payment.rental_id,
    'stripe_payment_intent_id', v_payment.stripe_payment_intent_id,
    'rejected_at', now()
  );
END;
$$;


ALTER FUNCTION "public"."reject_booking_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reject_booking_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") IS 'Reject a pending booking payment (call Stripe cancel first)';



CREATE OR REPLACE FUNCTION "public"."reject_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
  DECLARE
    v_payment RECORD;
    v_rental RECORD;
    v_vehicle_id UUID;
  BEGIN
    -- Get payment details
    SELECT * INTO v_payment FROM payments WHERE id = p_payment_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
    END IF;

    IF v_payment.verification_status != 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Payment is not pending verification');
    END IF;

    -- Update payment status
    UPDATE payments
    SET verification_status = 'rejected',
        verified_by = p_rejected_by,
        verified_at = now(),
        rejection_reason = p_reason,
        updated_at = now()
    WHERE id = p_payment_id;

    -- If payment has associated rental, close it completely
    IF v_payment.rental_id IS NOT NULL THEN
      -- Get rental details including vehicle_id
      SELECT * INTO v_rental FROM rentals WHERE id = v_payment.rental_id;

      IF FOUND THEN
        v_vehicle_id := v_rental.vehicle_id;

        -- Close the rental (set status to Closed and end_date to today)
        UPDATE rentals
        SET status = 'Closed',
            end_date = CURRENT_DATE,
            updated_at = now()
        WHERE id = v_payment.rental_id;

        -- Release the vehicle (make it available again by setting status to 'Available')
        IF v_vehicle_id IS NOT NULL THEN
          UPDATE vehicles
          SET status = 'Available',
              updated_at = now()
          WHERE id = v_vehicle_id;
        END IF;

        -- Also mark any unpaid charges for this rental as written off/cancelled
        UPDATE ledger_entries
        SET remaining_amount = 0,
            updated_at = now()
        WHERE rental_id = v_payment.rental_id
          AND type = 'Charge'
          AND remaining_amount > 0;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'payment_id', p_payment_id,
      'rental_id', v_payment.rental_id,
      'vehicle_released', v_vehicle_id IS NOT NULL,
      'rejected_at', now()
    );
  END;
  $$;


ALTER FUNCTION "public"."reject_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reject_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") IS 'Reject a pending payment and mark associated rental as rejected';



CREATE OR REPLACE FUNCTION "public"."rental_create_charge"("r_id" "uuid", "due" "date", "amt" numeric) RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
declare
  rc record;
  cid uuid;
begin
  select * into rc from rentals where id=r_id;

  -- Upsert against the unique index (one charge per rental+due_date)
  insert into ledger_entries(
    customer_id, rental_id, vehicle_id, entry_date,
    type, category, amount, due_date, remaining_amount
  )
  values(
    rc.customer_id, rc.id, rc.vehicle_id, due,
    'Charge', 'Rental', amt, due, amt
  )
  on conflict on constraint ux_rental_charge_unique
  do update set
    amount = excluded.amount,
    remaining_amount = excluded.amount;

  -- return the existing/new id
  select id into cid
  from ledger_entries
  where rental_id = rc.id
    and type='Charge'
    and category='Rental'
    and due_date = due;

  return cid;
end;
$$;


ALTER FUNCTION "public"."rental_create_charge"("r_id" "uuid", "due" "date", "amt" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_apply_payment_on_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Call apply_payment_fully for all payment types
  PERFORM apply_payment_fully(NEW.id);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_apply_payment_on_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_apply_payments_on_charge"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Only trigger on rental charges
  IF NEW.type = 'Charge' AND NEW.category = 'Rental' THEN
    PERFORM apply_payments_to_charges(NEW.rental_id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_apply_payments_on_charge"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_apply_payments_on_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Only apply rental payments automatically
  IF NEW.payment_type = 'Rental' THEN
    PERFORM apply_payments_to_charges(NEW.rental_id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_apply_payments_on_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_auto_allocate_payments"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Only trigger on rental charges
  IF NEW.type = 'Charge' AND NEW.category = 'Rental' AND NEW.remaining_amount > 0 THEN
    -- Find payments with remaining credit for this customer, ordered by payment_date
    DECLARE
      credit_payment RECORD;
    BEGIN
      FOR credit_payment IN
        SELECT p.id 
        FROM payments p
        WHERE p.customer_id = NEW.customer_id 
          AND p.status IN ('Credit', 'Partial')
          AND p.remaining_amount > 0
        ORDER BY p.payment_date ASC, p.id ASC
      LOOP
        -- Apply the payment using our FIFO function
        PERFORM payment_apply_fifo_v2(credit_payment.id);
        
        -- Check if charge is fully allocated
        SELECT remaining_amount INTO NEW.remaining_amount 
        FROM ledger_entries 
        WHERE id = NEW.id;
        
        EXIT WHEN NEW.remaining_amount <= 0;
      END LOOP;
    END;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_auto_allocate_payments"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_create_fine_charge"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Only create ledger charge if liability is Business (immediate business cost)
  -- Customer liability fines are now recorded but not charged until admin action
  IF NEW.liability = 'Business' THEN
    -- Create P&L cost entry for business liability fines
    INSERT INTO pnl_entries(
      vehicle_id, 
      entry_date, 
      side, 
      category, 
      amount, 
      source_ref,
      customer_id
    )
    VALUES (
      NEW.vehicle_id, 
      NEW.issue_date, 
      'Cost', 
      'Fines', 
      NEW.amount, 
      NEW.id::text,
      NEW.customer_id
    )
    ON CONFLICT (vehicle_id, category, source_ref) DO UPDATE SET
      amount = EXCLUDED.amount,
      entry_date = EXCLUDED.entry_date;
  END IF;
  
  -- Customer liability fines are just recorded, no automatic charging
  -- They will be charged later via the apply-fine edge function
  
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."trigger_create_fine_charge"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_generate_rental_charges"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM generate_rental_charges(NEW.id);
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."trigger_generate_rental_charges"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_post_acquisition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- For INSERT: call if acquisition requirements met
  IF TG_OP = 'INSERT' THEN
    IF (NEW.acquisition_type = 'Purchase' AND NEW.purchase_price IS NOT NULL AND NEW.acquisition_date IS NOT NULL) OR
       (NEW.acquisition_type = 'Finance' AND NEW.monthly_payment IS NOT NULL) THEN
      PERFORM pnl_post_acquisition(NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  
  -- For UPDATE: call if relevant fields changed
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.acquisition_type IS DISTINCT FROM NEW.acquisition_type OR
        OLD.purchase_price IS DISTINCT FROM NEW.purchase_price OR 
        OLD.acquisition_date IS DISTINCT FROM NEW.acquisition_date OR
        OLD.monthly_payment IS DISTINCT FROM NEW.monthly_payment OR
        OLD.initial_payment IS DISTINCT FROM NEW.initial_payment OR
        OLD.term_months IS DISTINCT FROM NEW.term_months OR
        OLD.balloon IS DISTINCT FROM NEW.balloon OR
        OLD.finance_start_date IS DISTINCT FROM NEW.finance_start_date) THEN
      
      -- If acquisition type changed, clean up old P&L entry first
      IF OLD.acquisition_type IS DISTINCT FROM NEW.acquisition_type THEN
        -- Remove old acquisition P&L entry
        IF OLD.acquisition_type = 'Purchase' THEN
          DELETE FROM pnl_entries WHERE vehicle_id = NEW.id AND category = 'Acquisition' AND source_ref = OLD.id::text;
        ELSIF OLD.acquisition_type = 'Finance' THEN
          DELETE FROM pnl_entries WHERE vehicle_id = NEW.id AND category = 'Acquisition' AND source_ref = 'FIN-UPFRONT:' || OLD.id::text;
        END IF;
      END IF;
      
      PERFORM pnl_post_acquisition(NEW.id);
    END IF;
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trigger_post_acquisition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_update_plate_pnl"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Handle INSERT and UPDATE
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    -- Only process if we have a vehicle_id and cost
    IF NEW.vehicle_id IS NOT NULL THEN
      PERFORM upsert_plate_pnl_entry(
        NEW.id, NEW.cost, NEW.order_date, NEW.vehicle_id, NEW.created_at
      );
    END IF;
    
    RETURN NEW;
  END IF;
  
  -- Handle DELETE
  IF TG_OP = 'DELETE' THEN
    -- Remove P&L entry
    DELETE FROM pnl_entries 
    WHERE reference = 'plate:' || OLD.id::text;
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."trigger_update_plate_pnl"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_update_vehicle_last_service"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Handle INSERT and UPDATE
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM update_vehicle_last_service(NEW.vehicle_id);
    
    -- Handle P&L entry for service cost
    PERFORM upsert_service_pnl_entry(
      NEW.id, NEW.cost, NEW.service_date, NEW.vehicle_id
    );
    
    RETURN NEW;
  END IF;
  
  -- Handle DELETE
  IF TG_OP = 'DELETE' THEN
    PERFORM update_vehicle_last_service(OLD.vehicle_id);
    
    -- Remove P&L entry
    DELETE FROM pnl_entries 
    WHERE reference = 'service:' || OLD.id::text;
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."trigger_update_vehicle_last_service"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unblock_customer"("p_customer_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_customer RECORD;
BEGIN
  -- Get customer details
  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Customer not found');
  END IF;

  -- Update customer as unblocked
  UPDATE customers
  SET is_blocked = false,
      blocked_at = NULL,
      blocked_reason = NULL
  WHERE id = p_customer_id;

  -- Deactivate blocked identity entries for this customer's identifiers (only license/ID, not email)
  UPDATE blocked_identities
  SET is_active = false, updated_at = now()
  WHERE identity_number IN (v_customer.license_number, v_customer.id_number)
    AND identity_type IN ('license', 'id_card', 'passport');

  RETURN jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'unblocked_at', now()
  );
END;
$$;


ALTER FUNCTION "public"."unblock_customer"("p_customer_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."unblock_customer"("p_customer_id" "uuid") IS 'Unblock a customer and deactivate their blocked identity entries';



CREATE OR REPLACE FUNCTION "public"."undo_vehicle_disposal"("p_vehicle_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_reference text;
BEGIN
  v_reference := 'dispose:' || p_vehicle_id::text;
  
  -- Remove disposal info from vehicle
  UPDATE vehicles 
  SET is_disposed = false,
      disposal_date = NULL,
      sale_proceeds = NULL,
      disposal_buyer = NULL,
      disposal_notes = NULL,
      status = 'Available'
  WHERE id = p_vehicle_id;
  
  -- Remove P&L disposal entry
  DELETE FROM pnl_entries WHERE reference = v_reference;
  
  -- Add reversal event
  INSERT INTO vehicle_events (
    vehicle_id, event_type, summary
  ) VALUES (
    p_vehicle_id, 'disposal', 'Disposal reversed - vehicle returned to available'
  );
  
  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."undo_vehicle_disposal"("p_vehicle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_agreement_templates_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_agreement_templates_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_cms_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_cms_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_customer_balance"("customer_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    total_due NUMERIC := 0;
    total_paid NUMERIC := 0;
    new_balance NUMERIC;
BEGIN
    -- Calculate total due (due + overdue)
    SELECT COALESCE(SUM(amount), 0) INTO total_due
    FROM public.payments 
    WHERE customer_id = customer_id 
    AND status IN ('due', 'overdue')
    AND due_date <= CURRENT_DATE;
    
    -- Calculate total paid
    SELECT COALESCE(SUM(amount), 0) INTO total_paid
    FROM public.payments 
    WHERE customer_id = customer_id 
    AND status = 'paid';
    
    -- Update customer balance
    new_balance := total_due - total_paid;
    
    UPDATE public.customers 
    SET balance = new_balance 
    WHERE id = customer_id;
END;
$$;


ALTER FUNCTION "public"."update_customer_balance"("customer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_customer_documents_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_customer_documents_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_email_template_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_email_template_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_identity_verifications_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_identity_verifications_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_insurance_docs_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE insurance_policies 
    SET docs_count = docs_count + 1 
    WHERE id = NEW.policy_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE insurance_policies 
    SET docs_count = docs_count - 1 
    WHERE id = OLD.policy_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_insurance_docs_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_insurance_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_insurance_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_leads_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_leads_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_plates_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_plates_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_protection_plans_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_protection_plans_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_refund_status"("p_payment_id" "uuid", "p_new_status" "text", "p_stripe_refund_id" "text" DEFAULT NULL::"text", "p_error_message" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE payments
  SET
    refund_status = p_new_status,
    stripe_refund_id = COALESCE(p_stripe_refund_id, stripe_refund_id),
    refund_processed_at = CASE WHEN p_new_status = 'completed' THEN now() ELSE refund_processed_at END,
    refund_reason = CASE WHEN p_error_message IS NOT NULL THEN refund_reason || E'\n\n' || p_error_message ELSE refund_reason END
  WHERE id = p_payment_id;
END;
$$;


ALTER FUNCTION "public"."update_refund_status"("p_payment_id" "uuid", "p_new_status" "text", "p_stripe_refund_id" "text", "p_error_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_reminders_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_reminders_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_rental_insurance_verifications_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_rental_insurance_verifications_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_rental_key_handovers_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $$;


ALTER FUNCTION "public"."update_rental_key_handovers_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_vehicle_last_service"("p_vehicle_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  latest_service RECORD;
BEGIN
  -- Get the most recent service record for this vehicle
  SELECT service_date, mileage 
  INTO latest_service
  FROM service_records 
  WHERE vehicle_id = p_vehicle_id 
  ORDER BY service_date DESC, created_at DESC 
  LIMIT 1;
  
  IF FOUND THEN
    -- Update vehicle with latest service info
    UPDATE vehicles 
    SET last_service_date = latest_service.service_date,
        last_service_mileage = latest_service.mileage
    WHERE id = p_vehicle_id;
  ELSE
    -- No service records, clear the fields
    UPDATE vehicles 
    SET last_service_date = NULL,
        last_service_mileage = NULL
    WHERE id = p_vehicle_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."update_vehicle_last_service"("p_vehicle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_vehicle_status_on_rental_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Handle INSERT (new rental created)
  IF TG_OP = 'INSERT' THEN
    -- If new rental is Active, set vehicle to Rented
    IF NEW.status = 'Active' THEN
      UPDATE vehicles
      SET status = 'Rented'
      WHERE id = NEW.vehicle_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Handle UPDATE (rental status changed)
  IF TG_OP = 'UPDATE' THEN
    -- If rental became Active, set vehicle to Rented
    IF NEW.status = 'Active' AND OLD.status != 'Active' THEN
      UPDATE vehicles
      SET status = 'Rented'
      WHERE id = NEW.vehicle_id;

    -- If rental became Completed or Cancelled, set vehicle to Available
    ELSIF (NEW.status = 'Completed' OR NEW.status = 'Cancelled')
       AND OLD.status = 'Active' THEN
      UPDATE vehicles
      SET status = 'Available'
      WHERE id = NEW.vehicle_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Handle DELETE (rental deleted)
  IF TG_OP = 'DELETE' THEN
    -- If deleted rental was Active, set vehicle back to Available
    IF OLD.status = 'Active' THEN
      UPDATE vehicles
      SET status = 'Available'
      WHERE id = OLD.vehicle_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_vehicle_status_on_rental_change"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_vehicle_status_on_rental_change"() IS 'Automatically updates vehicle status to Rented when rental is Active, and to Available when rental is Completed or Cancelled';



CREATE OR REPLACE FUNCTION "public"."upsert_plate_pnl_entry"("p_plate_id" "uuid", "p_cost" numeric, "p_order_date" "date", "p_vehicle_id" "uuid", "p_created_at" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_reference text;
  v_entry_date date;
BEGIN
  v_reference := 'plate:' || p_plate_id::text;
  v_entry_date := COALESCE(p_order_date, p_created_at::date);
  
  IF p_cost > 0 THEN
    -- Insert or update P&L entry for plate cost
    INSERT INTO pnl_entries (
      vehicle_id, entry_date, side, category, amount, reference
    )
    VALUES (
      p_vehicle_id, v_entry_date, 'Cost', 'Plates', p_cost, v_reference
    )
    ON CONFLICT (reference) 
    DO UPDATE SET 
      amount = EXCLUDED.amount,
      entry_date = EXCLUDED.entry_date,
      vehicle_id = EXCLUDED.vehicle_id;
  ELSE
    -- Remove P&L entry if cost is 0 or negative
    DELETE FROM pnl_entries WHERE reference = v_reference;
  END IF;
END;
$$;


ALTER FUNCTION "public"."upsert_plate_pnl_entry"("p_plate_id" "uuid", "p_cost" numeric, "p_order_date" "date", "p_vehicle_id" "uuid", "p_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_service_pnl_entry"("p_service_record_id" "uuid", "p_cost" numeric, "p_service_date" "date", "p_vehicle_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_reference text;
BEGIN
  v_reference := 'service:' || p_service_record_id::text;
  
  IF p_cost > 0 THEN
    -- Insert or update P&L entry for service cost
    INSERT INTO pnl_entries (
      vehicle_id, entry_date, side, category, amount, reference
    )
    VALUES (
      p_vehicle_id, p_service_date, 'Cost', 'Service', p_cost, v_reference
    )
    ON CONFLICT (reference) 
    DO UPDATE SET 
      amount = EXCLUDED.amount,
      entry_date = EXCLUDED.entry_date,
      vehicle_id = EXCLUDED.vehicle_id;
  ELSE
    -- Remove P&L entry if cost is 0 or negative
    DELETE FROM pnl_entries WHERE reference = v_reference;
  END IF;
END;
$$;


ALTER FUNCTION "public"."upsert_service_pnl_entry"("p_service_record_id" "uuid", "p_cost" numeric, "p_service_date" "date", "p_vehicle_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_global_master_password"("p_email" "text", "p_password" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ DECLARE v_hash TEXT; BEGIN SELECT master_password_hash INTO v_hash FROM global_admin_config WHERE master_email = p_email; IF v_hash IS NULL THEN RETURN FALSE; END IF; RETURN v_hash = crypt(p_password, v_hash); END; $$;


ALTER FUNCTION "public"."verify_global_master_password"("p_email" "text", "p_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_password"("stored_hash" "text", "provided_password" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN stored_hash = crypt(provided_password, stored_hash);
END;
$$;


ALTER FUNCTION "public"."verify_password"("stored_hash" "text", "provided_password" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."agreement_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "template_name" "text" NOT NULL,
    "template_content" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agreement_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text",
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "must_change_password" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid",
    "is_super_admin" boolean DEFAULT false,
    "is_primary_super_admin" boolean DEFAULT false,
    CONSTRAINT "app_users_role_check" CHECK (("role" = ANY (ARRAY['head_admin'::"text", 'admin'::"text", 'ops'::"text", 'viewer'::"text"]))),
    CONSTRAINT "check_tenant_id" CHECK (((("is_super_admin" = true) AND ("tenant_id" IS NULL)) OR (("is_super_admin" = false) AND ("tenant_id" IS NOT NULL))))
);


ALTER TABLE "public"."app_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "target_user_id" "uuid",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "tenant_id" "uuid",
    "is_super_admin_action" boolean DEFAULT false
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."authority_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fine_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "payment_date" "date" NOT NULL,
    "payment_method" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    CONSTRAINT "authority_payments_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."authority_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blocked_dates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "vehicle_id" "uuid",
    "tenant_id" "uuid",
    CONSTRAINT "valid_date_range" CHECK (("end_date" >= "start_date"))
);


ALTER TABLE "public"."blocked_dates" OWNER TO "postgres";


COMMENT ON TABLE "public"."blocked_dates" IS 'Stores date ranges that are blocked globally (vehicle_id=NULL) or for specific vehicles';



COMMENT ON COLUMN "public"."blocked_dates"."start_date" IS 'Start date of the blocked period';



COMMENT ON COLUMN "public"."blocked_dates"."end_date" IS 'End date of the blocked period';



COMMENT ON COLUMN "public"."blocked_dates"."reason" IS 'Optional reason for blocking these dates';



COMMENT ON COLUMN "public"."blocked_dates"."created_by" IS 'Admin user who created this blocked date range';



COMMENT ON COLUMN "public"."blocked_dates"."vehicle_id" IS 'Optional vehicle ID for vehicle-specific blocks. NULL means blocked for all vehicles';



CREATE TABLE IF NOT EXISTS "public"."blocked_identities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "identity_type" "text" NOT NULL,
    "identity_number" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "blocked_by" "uuid",
    "notes" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    CONSTRAINT "blocked_identities_identity_type_check" CHECK (("identity_type" = ANY (ARRAY['license'::"text", 'id_card'::"text", 'passport'::"text", 'email'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."blocked_identities" OWNER TO "postgres";


COMMENT ON TABLE "public"."blocked_identities" IS 'Blacklist of blocked identity documents (license, ID, passport numbers)';



CREATE TABLE IF NOT EXISTS "public"."cms_media" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_name" character varying(255) NOT NULL,
    "file_url" "text" NOT NULL,
    "file_size" integer,
    "mime_type" character varying(100),
    "alt_text" character varying(255),
    "folder" character varying(100) DEFAULT 'general'::character varying,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."cms_media" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cms_page_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" "uuid",
    "section_key" character varying(100) NOT NULL,
    "content" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "display_order" integer DEFAULT 0,
    "is_visible" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."cms_page_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cms_page_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" "uuid",
    "version_number" integer NOT NULL,
    "content" "jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."cms_page_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cms_pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" character varying(100) NOT NULL,
    "name" character varying(255) NOT NULL,
    "description" "text",
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "published_at" timestamp with time zone,
    "published_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    CONSTRAINT "cms_pages_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'published'::character varying])::"text"[])))
);


ALTER TABLE "public"."cms_pages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_name" "text" NOT NULL,
    "contact_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "message" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    "tenant_id" "uuid",
    CONSTRAINT "valid_email" CHECK (("email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::"text")),
    CONSTRAINT "valid_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'contacted'::"text", 'converted'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."contact_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "document_name" "text" NOT NULL,
    "file_url" "text",
    "file_name" "text",
    "insurance_provider" "text",
    "policy_number" "text",
    "policy_start_date" "date",
    "policy_end_date" "date",
    "notes" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "vehicle_id" "uuid",
    "file_size" bigint,
    "mime_type" "text",
    "start_date" "date",
    "end_date" "date",
    "status" "text",
    "verified" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ai_scan_status" "text" DEFAULT 'pending'::"text",
    "ai_extracted_data" "jsonb",
    "ai_confidence_score" numeric(3,2),
    "ai_validation_score" numeric(3,2),
    "ai_scan_errors" "text"[],
    "scanned_at" timestamp with time zone,
    "rental_id" "uuid",
    "tenant_id" "uuid",
    CONSTRAINT "customer_documents_ai_confidence_score_check" CHECK ((("ai_confidence_score" >= (0)::numeric) AND ("ai_confidence_score" <= (1)::numeric))),
    CONSTRAINT "customer_documents_ai_scan_status_check" CHECK (("ai_scan_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "customer_documents_ai_validation_score_check" CHECK ((("ai_validation_score" >= (0)::numeric) AND ("ai_validation_score" <= (1)::numeric))),
    CONSTRAINT "customer_documents_document_type_check" CHECK (("document_type" = ANY (ARRAY['Insurance Certificate'::"text", 'Driving Licence'::"text", 'National Insurance'::"text", 'Address Proof'::"text", 'ID Card/Passport'::"text", 'Other'::"text"]))),
    CONSTRAINT "customer_documents_status_check" CHECK (("status" = ANY (ARRAY['Active'::"text", 'Expired'::"text", 'Pending'::"text", 'Unknown'::"text"])))
);


ALTER TABLE "public"."customer_documents" OWNER TO "postgres";


COMMENT ON COLUMN "public"."customer_documents"."ai_scan_status" IS 'Status of AI document scanning: pending, processing, completed, or failed';



COMMENT ON COLUMN "public"."customer_documents"."ai_extracted_data" IS 'JSON object containing extracted data from AI scan (e.g., policy number, dates, coverage amount)';



COMMENT ON COLUMN "public"."customer_documents"."ai_confidence_score" IS 'AI confidence score for data extraction (0-1 scale)';



COMMENT ON COLUMN "public"."customer_documents"."ai_validation_score" IS 'Validation score for document validity (0-1 scale, admin only)';



COMMENT ON COLUMN "public"."customer_documents"."ai_scan_errors" IS 'Array of error messages if scan failed';



COMMENT ON COLUMN "public"."customer_documents"."scanned_at" IS 'Timestamp when AI scan was completed';



COMMENT ON COLUMN "public"."customer_documents"."rental_id" IS 'Optional link to rental if document is associated with a specific booking';



CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "whatsapp_opt_in" boolean DEFAULT false,
    "status" "text" DEFAULT 'Active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "customer_type" "text" DEFAULT 'Individual'::"text",
    "high_switcher" boolean DEFAULT false,
    "nok_full_name" "text",
    "nok_relationship" "text",
    "nok_phone" "text",
    "nok_email" "text",
    "nok_address" "text",
    "identity_verification_status" "text" DEFAULT 'unverified'::"text",
    "license_number" "text",
    "id_number" "text",
    "is_blocked" boolean DEFAULT false,
    "blocked_at" timestamp with time zone,
    "blocked_reason" "text",
    "rejection_reason" "text",
    "rejected_at" timestamp with time zone,
    "rejected_by" "uuid",
    "tenant_id" "uuid",
    CONSTRAINT "customers_customer_type_check" CHECK (("customer_type" = ANY (ARRAY['Individual'::"text", 'Company'::"text"]))),
    CONSTRAINT "customers_identity_verification_status_check" CHECK (("identity_verification_status" = ANY (ARRAY['unverified'::"text", 'pending'::"text", 'verified'::"text", 'rejected'::"text"]))),
    CONSTRAINT "customers_type_check" CHECK (("type" = ANY (ARRAY['Individual'::"text", 'Company'::"text"])))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."customers"."license_number" IS 'Customer driver license number';



COMMENT ON COLUMN "public"."customers"."id_number" IS 'Customer national ID or passport number';



COMMENT ON COLUMN "public"."customers"."is_blocked" IS 'Whether the customer is blocked from rentals';



CREATE TABLE IF NOT EXISTS "public"."email_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_email" "text" NOT NULL,
    "recipient_name" "text",
    "subject" "text" NOT NULL,
    "template" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sent_at" timestamp with time zone,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."email_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "body" "text" NOT NULL,
    "variables" "jsonb" DEFAULT '[]'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    CONSTRAINT "email_templates_category_check" CHECK (("category" = ANY (ARRAY['rejection'::"text", 'approval'::"text", 'reminder'::"text", 'general'::"text"])))
);


ALTER TABLE "public"."email_templates" OWNER TO "postgres";


COMMENT ON TABLE "public"."email_templates" IS 'Email templates for automated notifications with variable support';



COMMENT ON COLUMN "public"."email_templates"."name" IS 'Unique identifier for the template (e.g., booking_rejection_with_refund)';



COMMENT ON COLUMN "public"."email_templates"."category" IS 'Template category for organization and filtering';



COMMENT ON COLUMN "public"."email_templates"."subject" IS 'Email subject line (supports {{variable}} placeholders)';



COMMENT ON COLUMN "public"."email_templates"."body" IS 'HTML email body (supports {{variable}} placeholders and Handlebars conditionals)';



COMMENT ON COLUMN "public"."email_templates"."variables" IS 'JSON array of variable names used in this template';



COMMENT ON COLUMN "public"."email_templates"."is_active" IS 'Whether this template is active and available for use';



CREATE TABLE IF NOT EXISTS "public"."faqs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question" "text" NOT NULL,
    "answer" "text" NOT NULL,
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."faqs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fine_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fine_id" "uuid",
    "file_url" "text" NOT NULL,
    "file_name" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."fine_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "reference_no" "text",
    "issue_date" "date" NOT NULL,
    "due_date" "date" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "liability" "text" DEFAULT 'Customer'::"text",
    "status" "text" DEFAULT 'Open'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "charged_at" timestamp with time zone,
    "waived_at" timestamp with time zone,
    "appealed_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "tenant_id" "uuid",
    CONSTRAINT "fines_liability_check" CHECK (("liability" = ANY (ARRAY['Customer'::"text", 'Business'::"text"]))),
    CONSTRAINT "fines_status_check" CHECK (("status" = ANY (ARRAY['Open'::"text", 'Appealed'::"text", 'Waived'::"text", 'Charged'::"text", 'Paid'::"text", 'Appeal Successful'::"text", 'Appeal Rejected'::"text", 'Appeal Submitted'::"text", 'Partially Paid'::"text"]))),
    CONSTRAINT "fines_type_check" CHECK (("type" = ANY (ARRAY['PCN'::"text", 'Speeding'::"text", 'Other'::"text"])))
);


ALTER TABLE "public"."fines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."global_admin_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "master_email" "text" DEFAULT 'admin@cortek.io'::"text" NOT NULL,
    "master_password_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."global_admin_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."identity_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "provider" "text" DEFAULT 'veriff'::"text" NOT NULL,
    "session_id" "text",
    "verification_token" "text",
    "external_user_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "review_status" "text",
    "review_result" "text",
    "document_type" "text",
    "document_number" "text",
    "document_country" "text",
    "document_issuing_date" "date",
    "document_expiry_date" "date",
    "first_name" "text",
    "last_name" "text",
    "date_of_birth" "date",
    "address" "text",
    "verification_url" "text",
    "verification_completed_at" timestamp with time zone,
    "verified_by" "uuid",
    "rejection_reason" "text",
    "rejection_labels" "text"[],
    "client_comment" "text",
    "moderator_comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."identity_verifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."insurance_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "policy_id" "uuid" NOT NULL,
    "doc_type" "text" NOT NULL,
    "file_url" "text" NOT NULL,
    "file_name" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."insurance_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."insurance_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "vehicle_id" "uuid",
    "policy_number" "text" NOT NULL,
    "provider" "text",
    "start_date" "date" NOT NULL,
    "expiry_date" "date" NOT NULL,
    "status" "text" DEFAULT 'Active'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "docs_count" integer DEFAULT 0,
    "tenant_id" "uuid",
    CONSTRAINT "insurance_policies_status_check" CHECK (("status" = ANY (ARRAY['Active'::"text", 'Expired'::"text", 'Suspended'::"text", 'Cancelled'::"text"])))
);


ALTER TABLE "public"."insurance_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rental_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "vehicle_id" "uuid",
    "invoice_number" "text" NOT NULL,
    "invoice_date" "date" NOT NULL,
    "due_date" "date",
    "subtotal" numeric(10,2) NOT NULL,
    "tax_amount" numeric(10,2) DEFAULT 0,
    "total_amount" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "rental_fee" numeric(10,2),
    "protection_fee" numeric(10,2),
    "tenant_id" "uuid",
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


COMMENT ON TABLE "public"."invoices" IS 'Stores rental invoices. Authenticated users can manage all invoices, public can view and create invoices during booking.';



COMMENT ON COLUMN "public"."invoices"."invoice_number" IS 'Unique invoice identifier';



COMMENT ON COLUMN "public"."invoices"."invoice_date" IS 'Date when invoice was generated';



COMMENT ON COLUMN "public"."invoices"."due_date" IS 'Payment due date';



COMMENT ON COLUMN "public"."invoices"."subtotal" IS 'Subtotal before tax';



COMMENT ON COLUMN "public"."invoices"."tax_amount" IS 'Tax amount';



COMMENT ON COLUMN "public"."invoices"."total_amount" IS 'Total amount including tax';



COMMENT ON COLUMN "public"."invoices"."status" IS 'Invoice payment status';



COMMENT ON COLUMN "public"."invoices"."rental_fee" IS 'Vehicle rental cost only (excluding protection)';



COMMENT ON COLUMN "public"."invoices"."protection_fee" IS 'Protection plan cost (if selected)';



CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "company" "text",
    "status" "text" DEFAULT 'New'::"text" NOT NULL,
    "source" "text",
    "notes" "text",
    "expected_value" numeric(12,2),
    "follow_up_date" "date",
    "assigned_to" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "converted_to_customer_id" "uuid",
    "converted_at" timestamp with time zone,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


COMMENT ON TABLE "public"."leads" IS 'Pipeline/leads tracking for potential customers';



COMMENT ON COLUMN "public"."leads"."status" IS 'Lead status: New, Contacted, Qualified, Proposal, Negotiation, Completed, Lost';



COMMENT ON COLUMN "public"."leads"."source" IS 'How the lead was acquired: Referral, Website, Cold Call, etc.';



COMMENT ON COLUMN "public"."leads"."converted_to_customer_id" IS 'Customer ID if lead was converted';



CREATE TABLE IF NOT EXISTS "public"."ledger_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "rental_id" "uuid",
    "vehicle_id" "uuid",
    "entry_date" "date" NOT NULL,
    "type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "due_date" "date",
    "remaining_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_id" "uuid",
    "reference" "text",
    "tenant_id" "uuid",
    CONSTRAINT "ledger_entries_category_check" CHECK (("category" = ANY (ARRAY['Rental'::"text", 'InitialFee'::"text", 'Initial Fees'::"text", 'Fine'::"text", 'Adjustment'::"text"]))),
    CONSTRAINT "ledger_entries_type_check" CHECK (("type" = ANY (ARRAY['Charge'::"text", 'Payment'::"text", 'Refund'::"text"])))
);


ALTER TABLE "public"."ledger_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."login_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "username" "text" NOT NULL,
    "attempted_at" timestamp with time zone DEFAULT "now"(),
    "success" boolean DEFAULT false NOT NULL,
    "ip_address" "text",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."login_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operation_type" "text" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "payments_processed" integer DEFAULT 0,
    "customers_affected" integer DEFAULT 0,
    "revenue_recalculated" numeric DEFAULT 0,
    "error_message" "text",
    "duration_seconds" integer,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "started_by" "text",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."maintenance_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "type" "text" DEFAULT 'general'::"text",
    "is_read" boolean DEFAULT false,
    "link" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_name" "text" DEFAULT 'Fleet Management System'::"text" NOT NULL,
    "timezone" "text" DEFAULT 'Europe/London'::"text" NOT NULL,
    "currency_code" "text" DEFAULT 'GBP'::"text" NOT NULL,
    "date_format" "text" DEFAULT 'DD/MM/YYYY'::"text" NOT NULL,
    "logo_url" "text",
    "reminder_due_today" boolean DEFAULT true NOT NULL,
    "reminder_overdue_1d" boolean DEFAULT true NOT NULL,
    "reminder_overdue_multi" boolean DEFAULT true NOT NULL,
    "reminder_due_soon_2d" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tests_last_run_dashboard" timestamp with time zone,
    "tests_last_result_dashboard" "jsonb" DEFAULT '{}'::"jsonb",
    "tests_last_run_rental" timestamp with time zone,
    "tests_last_result_rental" "jsonb" DEFAULT '{}'::"jsonb",
    "tests_last_run_finance" timestamp with time zone,
    "tests_last_result_finance" "jsonb" DEFAULT '{}'::"jsonb",
    "payment_mode" "text" DEFAULT 'automated'::"text",
    "app_name" "text" DEFAULT 'Drive 917'::"text",
    "primary_color" "text" DEFAULT '#C6A256'::"text",
    "secondary_color" "text" DEFAULT '#C6A256'::"text",
    "accent_color" "text" DEFAULT '#C6A256'::"text",
    "meta_title" "text" DEFAULT 'Drive 917 - Portal'::"text",
    "meta_description" "text" DEFAULT 'Fleet management portal'::"text",
    "og_image_url" "text",
    "favicon_url" "text",
    "light_background_color" "text",
    "dark_background_color" "text",
    "light_primary_color" "text",
    "light_secondary_color" "text",
    "light_accent_color" "text",
    "dark_primary_color" "text",
    "dark_secondary_color" "text",
    "dark_accent_color" "text",
    "light_header_footer_color" "text",
    "dark_header_footer_color" "text",
    "booking_payment_mode" "text" DEFAULT 'manual'::"text",
    "tenant_id" "uuid",
    "email_from_name" "text" DEFAULT 'Rental Company'::"text",
    "email_from_address" "text",
    "email_reply_to" "text",
    "sms_sender_name" "text" DEFAULT 'Rental Co'::"text",
    CONSTRAINT "org_settings_booking_payment_mode_check" CHECK (("booking_payment_mode" = ANY (ARRAY['manual'::"text", 'auto'::"text"]))),
    CONSTRAINT "org_settings_payment_mode_check" CHECK (("payment_mode" = ANY (ARRAY['automated'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."org_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."org_settings"."payment_mode" IS 'Payment verification mode: automated (no approval needed) or manual (requires admin approval)';



COMMENT ON COLUMN "public"."org_settings"."app_name" IS 'Custom application name displayed in sidebar and browser';



COMMENT ON COLUMN "public"."org_settings"."primary_color" IS 'Primary brand color in hex format';



COMMENT ON COLUMN "public"."org_settings"."secondary_color" IS 'Secondary brand color in hex format';



COMMENT ON COLUMN "public"."org_settings"."accent_color" IS 'Accent color in hex format';



COMMENT ON COLUMN "public"."org_settings"."meta_title" IS 'SEO meta title for the application';



COMMENT ON COLUMN "public"."org_settings"."meta_description" IS 'SEO meta description for the application';



COMMENT ON COLUMN "public"."org_settings"."og_image_url" IS 'Open Graph image URL for social sharing';



COMMENT ON COLUMN "public"."org_settings"."favicon_url" IS 'Custom favicon URL';



COMMENT ON COLUMN "public"."org_settings"."light_background_color" IS 'Background color for light theme';



COMMENT ON COLUMN "public"."org_settings"."dark_background_color" IS 'Background color for dark theme';



COMMENT ON COLUMN "public"."org_settings"."light_primary_color" IS 'Primary brand color for light theme mode';



COMMENT ON COLUMN "public"."org_settings"."light_secondary_color" IS 'Secondary color for light theme mode';



COMMENT ON COLUMN "public"."org_settings"."light_accent_color" IS 'Accent color for light theme mode';



COMMENT ON COLUMN "public"."org_settings"."dark_primary_color" IS 'Primary brand color for dark theme mode';



COMMENT ON COLUMN "public"."org_settings"."dark_secondary_color" IS 'Secondary color for dark theme mode';



COMMENT ON COLUMN "public"."org_settings"."dark_accent_color" IS 'Accent color for dark theme mode';



COMMENT ON COLUMN "public"."org_settings"."light_header_footer_color" IS 'Header and footer background color for light theme (default: #1A2B25)';



COMMENT ON COLUMN "public"."org_settings"."dark_header_footer_color" IS 'Header and footer background color for dark theme (default: #1A2B25)';



COMMENT ON COLUMN "public"."org_settings"."booking_payment_mode" IS 'Customer website booking mode: manual (pre-auth with admin review) or auto (immediate capture)';



CREATE TABLE IF NOT EXISTS "public"."payment_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid",
    "charge_entry_id" "uuid",
    "amount_applied" numeric(12,2) NOT NULL,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."payment_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "rental_id" "uuid",
    "vehicle_id" "uuid",
    "amount" numeric(12,2) NOT NULL,
    "payment_date" "date" DEFAULT ("now"())::"date" NOT NULL,
    "method" "text",
    "payment_type" "text" DEFAULT 'Payment'::"text" NOT NULL,
    "is_early" boolean DEFAULT false NOT NULL,
    "apply_from_date" "date",
    "status" "text" DEFAULT 'Applied'::"text",
    "remaining_amount" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "verification_status" "text" DEFAULT 'auto_approved'::"text",
    "verified_by" "uuid",
    "verified_at" timestamp with time zone,
    "rejection_reason" "text",
    "is_manual_mode" boolean DEFAULT false,
    "stripe_payment_intent_id" "text",
    "stripe_checkout_session_id" "text",
    "capture_status" "text",
    "preauth_expires_at" timestamp with time zone,
    "booking_source" "text" DEFAULT 'admin'::"text",
    "refund_status" "text" DEFAULT 'none'::"text",
    "refund_scheduled_date" timestamp with time zone,
    "refund_amount" numeric(10,2),
    "refund_reason" "text",
    "refund_processed_at" timestamp with time zone,
    "stripe_refund_id" "text",
    "refund_scheduled_by" "uuid",
    "tenant_id" "uuid",
    CONSTRAINT "payments_booking_source_check" CHECK (("booking_source" = ANY (ARRAY['admin'::"text", 'website'::"text"]))),
    CONSTRAINT "payments_capture_status_check" CHECK ((("capture_status" IS NULL) OR ("capture_status" = ANY (ARRAY['requires_capture'::"text", 'captured'::"text", 'cancelled'::"text", 'expired'::"text"])))),
    CONSTRAINT "payments_payment_type_check" CHECK (("payment_type" = ANY (ARRAY['Payment'::"text", 'InitialFee'::"text"]))),
    CONSTRAINT "payments_refund_amount_check" CHECK (("refund_amount" >= (0)::numeric)),
    CONSTRAINT "payments_refund_status_check" CHECK (("refund_status" = ANY (ARRAY['none'::"text", 'scheduled'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['Applied'::"text", 'Credit'::"text", 'Partial'::"text"]))),
    CONSTRAINT "payments_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'auto_approved'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."payments"."payment_type" IS 'Customer payments use generic "Payment" type. System uses "InitialFee" for auto-generated initial fees.';



COMMENT ON COLUMN "public"."payments"."verification_status" IS 'Payment verification status: pending, approved, rejected, or auto_approved';



COMMENT ON COLUMN "public"."payments"."is_manual_mode" IS 'Whether this payment was created when manual mode was enabled';



COMMENT ON COLUMN "public"."payments"."stripe_payment_intent_id" IS 'Stripe PaymentIntent ID for pre-authorized payments';



COMMENT ON COLUMN "public"."payments"."capture_status" IS 'Pre-auth status: requires_capture (held), captured (charged), cancelled (released), expired';



COMMENT ON COLUMN "public"."payments"."preauth_expires_at" IS 'When the pre-authorization will expire (7 days from creation)';



COMMENT ON COLUMN "public"."payments"."booking_source" IS 'Where the booking originated: admin (portal) or website (customer)';



COMMENT ON COLUMN "public"."payments"."refund_status" IS 'Status of refund processing: none, scheduled, processing, completed, or failed';



COMMENT ON COLUMN "public"."payments"."refund_scheduled_date" IS 'Date when the refund should be processed (NULL for immediate refunds)';



COMMENT ON COLUMN "public"."payments"."refund_amount" IS 'Amount to be refunded (can be partial)';



COMMENT ON COLUMN "public"."payments"."refund_reason" IS 'Reason for the refund';



COMMENT ON COLUMN "public"."payments"."refund_processed_at" IS 'Timestamp when refund was actually processed';



COMMENT ON COLUMN "public"."payments"."stripe_refund_id" IS 'Stripe refund ID for tracking';



COMMENT ON COLUMN "public"."payments"."refund_scheduled_by" IS 'Admin user who scheduled the refund';



CREATE TABLE IF NOT EXISTS "public"."plates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plate_number" "text" NOT NULL,
    "retention_doc_reference" "text",
    "assigned_vehicle_id" "uuid",
    "notes" "text",
    "document_url" "text",
    "document_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "supplier" "text",
    "order_date" "date",
    "cost" numeric(12,2) DEFAULT 0,
    "status" "text" DEFAULT 'ordered'::"text",
    "vehicle_id" "uuid",
    "tenant_id" "uuid",
    CONSTRAINT "plates_status_check" CHECK (("status" = ANY (ARRAY['ordered'::"text", 'received'::"text", 'fitted'::"text"])))
);

ALTER TABLE ONLY "public"."plates" REPLICA IDENTITY FULL;


ALTER TABLE "public"."plates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pnl_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid",
    "entry_date" "date" NOT NULL,
    "side" "text" NOT NULL,
    "category" "text",
    "amount" numeric(12,2) NOT NULL,
    "source_ref" "text",
    "payment_id" "uuid",
    "rental_id" "uuid",
    "customer_id" "uuid",
    "reference" "text",
    "tenant_id" "uuid",
    CONSTRAINT "chk_pnl_category_valid" CHECK (("category" = ANY (ARRAY['Initial Fees'::"text", 'Rental'::"text", 'Acquisition'::"text", 'Finance'::"text", 'Service'::"text", 'Fines'::"text", 'Other'::"text", 'Disposal'::"text", 'Plates'::"text"]))),
    CONSTRAINT "pnl_entries_side_check" CHECK (("side" = ANY (ARRAY['Revenue'::"text", 'Cost'::"text"])))
);


ALTER TABLE "public"."pnl_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promotions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "discount_type" "text" NOT NULL,
    "discount_value" numeric NOT NULL,
    "start_date" timestamp with time zone NOT NULL,
    "end_date" timestamp with time zone NOT NULL,
    "promo_code" "text",
    "image_url" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    CONSTRAINT "promotions_discount_type_check" CHECK (("discount_type" = ANY (ARRAY['percentage'::"text", 'fixed'::"text"])))
);


ALTER TABLE "public"."promotions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reminder_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "actor_id" "uuid",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."reminder_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "config_key" "text" NOT NULL,
    "config_value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."reminder_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "to_address" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "body_text" "text",
    "body_html" "text",
    "meta" "jsonb",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."reminder_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "charge_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "rental_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "reminder_type" "text" NOT NULL,
    "status" "text" DEFAULT 'Queued'::"text" NOT NULL,
    "message_preview" "text" NOT NULL,
    "delivered_to" "text" DEFAULT 'in_app'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delivered_at" timestamp with time zone,
    "snoozed_until" timestamp with time zone,
    "unique_key" "text",
    "tenant_id" "uuid",
    CONSTRAINT "reminder_events_reminder_type_check" CHECK (("reminder_type" = ANY (ARRAY['Upcoming'::"text", 'Due'::"text", 'Overdue1'::"text", 'Overdue2'::"text", 'Overdue3'::"text", 'Overdue4'::"text", 'Overdue5'::"text"]))),
    CONSTRAINT "reminder_events_status_check" CHECK (("status" = ANY (ARRAY['Queued'::"text", 'Delivered'::"text", 'Snoozed'::"text", 'Dismissed'::"text", 'Done'::"text"])))
);


ALTER TABLE "public"."reminder_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "charge_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "rental_id" "uuid" NOT NULL,
    "reminder_type" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "amount" numeric NOT NULL,
    "due_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."reminder_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "lead_days" integer NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "rule_code" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_recurring" boolean DEFAULT false,
    "interval_type" "text" DEFAULT 'once'::"text",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."reminder_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_key" "text" NOT NULL,
    "setting_value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."reminder_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_code" "text" NOT NULL,
    "object_type" "text" NOT NULL,
    "object_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "due_on" "date" NOT NULL,
    "remind_on" "date" NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "snooze_until" "date",
    "last_sent_at" timestamp with time zone,
    "context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rental_handover_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "handover_id" "uuid" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_url" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "caption" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "uploaded_by" "uuid",
    "tenant_id" "uuid"
);


ALTER TABLE "public"."rental_handover_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rental_insurance_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rental_id" "uuid",
    "customer_id" "uuid",
    "verification_type" "text" DEFAULT 'own_insurance'::"text" NOT NULL,
    "axle_account_id" "text",
    "axle_policy_id" "text",
    "carrier_name" "text",
    "policy_number" "text",
    "coverage_verified" boolean DEFAULT false,
    "verification_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "policy_details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."rental_insurance_verifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."rental_insurance_verifications" IS 'Stores insurance verification data when customers use their own auto insurance via Axle';



CREATE TABLE IF NOT EXISTS "public"."rental_key_handovers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rental_id" "uuid" NOT NULL,
    "handover_type" "public"."key_handover_type" NOT NULL,
    "notes" "text",
    "handed_at" timestamp with time zone,
    "handed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."rental_key_handovers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rentals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "vehicle_id" "uuid",
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "monthly_amount" numeric(12,2) NOT NULL,
    "schedule" "text" DEFAULT 'Monthly'::"text",
    "status" "text" DEFAULT 'Active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rental_number" "text",
    "docusign_envelope_id" "text",
    "document_status" "text" DEFAULT 'pending'::"text",
    "signed_document_id" "uuid",
    "envelope_created_at" timestamp with time zone,
    "envelope_sent_at" timestamp with time zone,
    "envelope_completed_at" timestamp with time zone,
    "rental_period_type" "text" DEFAULT 'Monthly'::"text",
    "tenant_id" "uuid",
    CONSTRAINT "rentals_document_status_check" CHECK (("document_status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'delivered'::"text", 'signed'::"text", 'completed'::"text", 'declined'::"text", 'voided'::"text"]))),
    CONSTRAINT "rentals_rental_period_type_check" CHECK (("rental_period_type" = ANY (ARRAY['Daily'::"text", 'Weekly'::"text", 'Monthly'::"text"]))),
    CONSTRAINT "rentals_schedule_check" CHECK (("schedule" = ANY (ARRAY['Monthly'::"text", 'BiMonthly'::"text", 'Custom'::"text"]))),
    CONSTRAINT "rentals_status_check" CHECK (("status" = ANY (ARRAY['Pending'::"text", 'Active'::"text", 'Closed'::"text", 'Rejected'::"text", 'Cancelled'::"text"])))
);


ALTER TABLE "public"."rentals" OWNER TO "postgres";


COMMENT ON COLUMN "public"."rentals"."docusign_envelope_id" IS 'DocuSign envelope ID for the rental agreement';



COMMENT ON COLUMN "public"."rentals"."document_status" IS 'Status of the DocuSign envelope: pending, sent, delivered, signed, completed, declined, voided';



COMMENT ON COLUMN "public"."rentals"."signed_document_id" IS 'Reference to the signed document in customer_documents table';



COMMENT ON COLUMN "public"."rentals"."rental_period_type" IS 'Type of rental period: Daily, Weekly, or Monthly';



CREATE TABLE IF NOT EXISTS "public"."service_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "service_date" "date" NOT NULL,
    "mileage" integer,
    "description" "text",
    "cost" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."service_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settings_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_name" "text" NOT NULL,
    "operation" "text" NOT NULL,
    "old_values" "jsonb",
    "new_values" "jsonb",
    "changed_fields" "text"[],
    "changed_by" "text",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."settings_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "company_name" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "master_password_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "contact_email" "text",
    "contact_phone" "text",
    "subscription_plan" "text" DEFAULT 'basic'::"text",
    "trial_ends_at" timestamp with time zone,
    "app_name" "text" DEFAULT 'Drive 917'::"text",
    "primary_color" "text" DEFAULT '#223331'::"text",
    "secondary_color" "text" DEFAULT '#223331'::"text",
    "accent_color" "text" DEFAULT '#E9B63E'::"text",
    "light_primary_color" "text",
    "light_secondary_color" "text",
    "light_accent_color" "text",
    "light_background_color" "text",
    "dark_primary_color" "text",
    "dark_secondary_color" "text",
    "dark_accent_color" "text",
    "dark_background_color" "text",
    "light_header_footer_color" "text",
    "dark_header_footer_color" "text",
    "logo_url" "text",
    "favicon_url" "text",
    "meta_title" "text",
    "meta_description" "text",
    "og_image_url" "text",
    "hero_background_url" "text",
    "phone" "text",
    "address" "text",
    "business_hours" "text",
    "google_maps_url" "text",
    "facebook_url" "text",
    "instagram_url" "text",
    "twitter_url" "text",
    "linkedin_url" "text",
    "currency_code" "text" DEFAULT 'USD'::"text",
    "timezone" "text" DEFAULT 'America/New_York'::"text",
    "date_format" "text" DEFAULT 'MM/DD/YYYY'::"text",
    "min_rental_days" integer DEFAULT 1,
    "max_rental_days" integer DEFAULT 90,
    "booking_lead_time_hours" integer DEFAULT 24,
    "require_identity_verification" boolean DEFAULT true,
    "require_insurance_upload" boolean DEFAULT false,
    "payment_mode" "text" DEFAULT 'automated'::"text",
    CONSTRAINT "slug_length" CHECK ((("char_length"("slug") >= 3) AND ("char_length"("slug") <= 50))),
    CONSTRAINT "valid_slug" CHECK (("slug" ~ '^[a-z0-9-]+$'::"text")),
    CONSTRAINT "valid_status" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'trial'::"text"])))
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."testimonials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author" "text" NOT NULL,
    "company_name" "text" NOT NULL,
    "stars" integer NOT NULL,
    "review" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    CONSTRAINT "testimonials_stars_check" CHECK ((("stars" >= 1) AND ("stars" <= 5)))
);


ALTER TABLE "public"."testimonials" OWNER TO "postgres";


COMMENT ON TABLE "public"."testimonials" IS 'Stores customer testimonials for display on public-facing pages';



COMMENT ON COLUMN "public"."testimonials"."author" IS 'Name of the person providing the testimonial';



COMMENT ON COLUMN "public"."testimonials"."company_name" IS 'Company name of the testimonial author';



COMMENT ON COLUMN "public"."testimonials"."stars" IS 'Rating from 1 to 5 stars';



COMMENT ON COLUMN "public"."testimonials"."review" IS 'The testimonial review text';



COMMENT ON COLUMN "public"."testimonials"."created_by" IS 'Admin user who created this testimonial';



CREATE OR REPLACE VIEW "public"."v_customer_credit" AS
 SELECT "id" AS "customer_id",
    (COALESCE(( SELECT "sum"("p"."amount") AS "sum"
           FROM "public"."payments" "p"
          WHERE ("p"."customer_id" = "c"."id")), (0)::numeric) - COALESCE(( SELECT "sum"("pa"."amount_applied") AS "sum"
           FROM ("public"."payments" "p"
             JOIN "public"."payment_applications" "pa" ON (("pa"."payment_id" = "p"."id")))
          WHERE ("p"."customer_id" = "c"."id")), (0)::numeric)) AS "credit_available"
   FROM "public"."customers" "c";


ALTER VIEW "public"."v_customer_credit" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_payment_remaining" AS
 SELECT "id" AS "payment_id",
    "customer_id",
    "rental_id",
    ("amount" - COALESCE(( SELECT "sum"("pa"."amount_applied") AS "sum"
           FROM "public"."payment_applications" "pa"
          WHERE ("pa"."payment_id" = "p"."id")), (0)::numeric)) AS "remaining"
   FROM "public"."payments" "p";


ALTER VIEW "public"."v_payment_remaining" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_rental_credit" AS
 SELECT "id" AS "rental_id",
    (COALESCE(( SELECT "sum"("p"."amount") AS "sum"
           FROM "public"."payments" "p"
          WHERE ("p"."rental_id" = "r"."id")), (0)::numeric) - COALESCE(( SELECT "sum"("pa"."amount_applied") AS "sum"
           FROM ("public"."payments" "p"
             JOIN "public"."payment_applications" "pa" ON (("pa"."payment_id" = "p"."id")))
          WHERE ("p"."rental_id" = "r"."id")), (0)::numeric)) AS "credit_available"
   FROM "public"."rentals" "r";


ALTER VIEW "public"."v_rental_credit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "event_type" "public"."vehicle_event_type" NOT NULL,
    "event_date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "summary" "text" NOT NULL,
    "reference_id" "uuid",
    "reference_table" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."vehicle_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "expense_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "category" "public"."expense_category" DEFAULT 'Other'::"public"."expense_category" NOT NULL,
    "amount" numeric NOT NULL,
    "notes" "text",
    "reference" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid",
    CONSTRAINT "vehicle_expenses_amount_check" CHECK (("amount" >= (0)::numeric))
);


ALTER TABLE "public"."vehicle_expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "content_type" "text",
    "size_bytes" bigint,
    "uploaded_by" "uuid",
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tenant_id" "uuid"
);


ALTER TABLE "public"."vehicle_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "photo_url" "text" NOT NULL,
    "display_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "tenant_id" "uuid"
);


ALTER TABLE "public"."vehicle_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reg" "text" NOT NULL,
    "make" "text",
    "model" "text",
    "colour" "text",
    "acquisition_type" "text",
    "purchase_price" numeric(12,2),
    "acquisition_date" "date",
    "status" "text" DEFAULT 'Available'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "color" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "monthly_payment" numeric,
    "initial_payment" numeric DEFAULT 0,
    "term_months" integer,
    "balloon" numeric,
    "finance_start_date" "date",
    "mot_due_date" "date",
    "tax_due_date" "date",
    "last_service_date" "date",
    "last_service_mileage" integer,
    "has_tracker" boolean DEFAULT false,
    "has_remote_immobiliser" boolean DEFAULT false,
    "security_notes" "text",
    "is_disposed" boolean DEFAULT false,
    "disposal_date" "date",
    "sale_proceeds" numeric,
    "disposal_buyer" "text",
    "disposal_notes" "text",
    "photo_url" "text",
    "year" integer,
    "has_logbook" boolean DEFAULT false NOT NULL,
    "warranty_start_date" "date",
    "warranty_end_date" "date",
    "has_service_plan" boolean DEFAULT false,
    "has_spare_key" boolean DEFAULT false,
    "spare_key_holder" "text",
    "spare_key_notes" "text",
    "daily_rent" numeric(10,2),
    "weekly_rent" numeric(10,2),
    "monthly_rent" numeric(10,2),
    "description" "text",
    "fuel_type" "text",
    "tenant_id" "uuid",
    CONSTRAINT "chk_spare_key_holder" CHECK ((("spare_key_holder" IS NULL) OR ("spare_key_holder" = ANY (ARRAY['Company'::"text", 'Customer'::"text"])))),
    CONSTRAINT "vehicles_acquisition_type_check" CHECK (("acquisition_type" = ANY (ARRAY['Purchase'::"text", 'Finance'::"text", 'Lease'::"text", 'Other'::"text"]))),
    CONSTRAINT "vehicles_fuel_type_check" CHECK (("fuel_type" = ANY (ARRAY['Petrol'::"text", 'Diesel'::"text", 'Hybrid'::"text", 'Electric'::"text"])))
);


ALTER TABLE "public"."vehicles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."vehicles"."year" IS 'Year of manufacture of the vehicle';



COMMENT ON COLUMN "public"."vehicles"."daily_rent" IS 'Daily rental rate for the vehicle';



COMMENT ON COLUMN "public"."vehicles"."description" IS 'Detailed description of the vehicle, including special features, condition notes, etc.';



COMMENT ON COLUMN "public"."vehicles"."fuel_type" IS 'Type of fuel the vehicle uses: Petrol, Diesel, Hybrid, or Electric';



CREATE OR REPLACE VIEW "public"."vehicle_pnl_rollup" AS
 SELECT "v"."id" AS "vehicle_id",
    "v"."make",
    "v"."model",
    "v"."reg",
    "pe"."entry_date",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Revenue'::"text") AND ("pe"."category" = 'Rental'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "revenue_rental",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Revenue'::"text") AND ("pe"."category" = 'Initial Fees'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "revenue_initial_fees",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Revenue'::"text") AND ("pe"."category" = 'Other'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "revenue_other",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Acquisition'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_acquisition",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Finance'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_finance",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Service'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_service",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Fines'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_fines",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Other'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_other",
    COALESCE("sum"(
        CASE
            WHEN ("pe"."side" = 'Cost'::"text") THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_total"
   FROM ("public"."vehicles" "v"
     LEFT JOIN "public"."pnl_entries" "pe" ON (("pe"."vehicle_id" = "v"."id")))
  GROUP BY "v"."id", "v"."make", "v"."model", "v"."reg", "pe"."entry_date";


ALTER VIEW "public"."vehicle_pnl_rollup" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_aging_receivables" AS
 SELECT "c"."id" AS "customer_id",
    "c"."name" AS "customer_name",
    "sum"(
        CASE
            WHEN (((CURRENT_DATE - "le"."due_date") >= 0) AND ((CURRENT_DATE - "le"."due_date") <= 30)) THEN "le"."remaining_amount"
            ELSE (0)::numeric
        END) AS "bucket_0_30",
    "sum"(
        CASE
            WHEN (((CURRENT_DATE - "le"."due_date") >= 31) AND ((CURRENT_DATE - "le"."due_date") <= 60)) THEN "le"."remaining_amount"
            ELSE (0)::numeric
        END) AS "bucket_31_60",
    "sum"(
        CASE
            WHEN (((CURRENT_DATE - "le"."due_date") >= 61) AND ((CURRENT_DATE - "le"."due_date") <= 90)) THEN "le"."remaining_amount"
            ELSE (0)::numeric
        END) AS "bucket_61_90",
    "sum"(
        CASE
            WHEN ((CURRENT_DATE - "le"."due_date") > 90) THEN "le"."remaining_amount"
            ELSE (0)::numeric
        END) AS "bucket_90_plus",
    "sum"("le"."remaining_amount") AS "total_due"
   FROM ("public"."customers" "c"
     JOIN "public"."ledger_entries" "le" ON (("le"."customer_id" = "c"."id")))
  WHERE (("le"."type" = 'Charge'::"text") AND ("le"."remaining_amount" > (0)::numeric) AND ("le"."due_date" <= CURRENT_DATE))
  GROUP BY "c"."id", "c"."name"
 HAVING ("sum"("le"."remaining_amount") > (0)::numeric);


ALTER VIEW "public"."view_aging_receivables" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_customer_statements" AS
 SELECT "le"."customer_id",
    "c"."name" AS "customer_name",
    "c"."email" AS "customer_email",
    "c"."phone" AS "customer_phone",
    "le"."id" AS "entry_id",
    "le"."entry_date",
    "le"."type",
    "le"."category",
    "le"."amount",
    "le"."remaining_amount",
    "le"."due_date",
    "le"."rental_id",
    "le"."vehicle_id",
    "v"."reg" AS "vehicle_reg",
    "v"."make" AS "vehicle_make",
    "v"."model" AS "vehicle_model",
        CASE
            WHEN ("le"."type" = 'Payment'::"text") THEN "le"."amount"
            ELSE (- "le"."amount")
        END AS "transaction_amount",
    "sum"(
        CASE
            WHEN ("le"."type" = 'Payment'::"text") THEN "le"."amount"
            ELSE (- "le"."amount")
        END) OVER (PARTITION BY "le"."customer_id" ORDER BY "le"."entry_date", "le"."id" ROWS UNBOUNDED PRECEDING) AS "running_balance"
   FROM (("public"."ledger_entries" "le"
     JOIN "public"."customers" "c" ON (("c"."id" = "le"."customer_id")))
     LEFT JOIN "public"."vehicles" "v" ON (("v"."id" = "le"."vehicle_id")))
  WHERE (("le"."type" <> 'Upcoming'::"text") OR ("le"."type" IS NULL))
  ORDER BY "le"."customer_id", "le"."entry_date", "le"."id";


ALTER VIEW "public"."view_customer_statements" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_fines_export" AS
 SELECT "f"."id" AS "fine_id",
    "f"."amount",
        CASE
            WHEN ("f"."appealed_at" IS NOT NULL) THEN 'Appealed'::"text"
            ELSE 'Not Appealed'::"text"
        END AS "appeal_status",
    "c"."email" AS "customer_email",
    "c"."name" AS "customer_name",
    "c"."phone" AS "customer_phone",
    "f"."due_date",
    "f"."issue_date",
    "f"."liability",
    "f"."notes",
    "f"."reference_no",
    COALESCE(("f"."amount" - COALESCE(( SELECT "sum"("ap"."amount") AS "sum"
           FROM "public"."authority_payments" "ap"
          WHERE ("ap"."fine_id" = "f"."id")), (0)::numeric)), "f"."amount") AS "remaining_amount",
    "f"."status",
    "f"."type",
    "v"."make" AS "vehicle_make",
    "v"."model" AS "vehicle_model",
    "v"."reg" AS "vehicle_reg"
   FROM (("public"."fines" "f"
     LEFT JOIN "public"."customers" "c" ON (("f"."customer_id" = "c"."id")))
     LEFT JOIN "public"."vehicles" "v" ON (("f"."vehicle_id" = "v"."id")));


ALTER VIEW "public"."view_fines_export" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_payments_export" AS
 SELECT "p"."id" AS "payment_id",
    "p"."payment_date",
    "p"."customer_id",
    "c"."name" AS "customer_name",
    "c"."email" AS "customer_email",
    "c"."phone" AS "customer_phone",
    "p"."rental_id",
    "p"."vehicle_id",
    "v"."reg" AS "vehicle_reg",
    "v"."make" AS "vehicle_make",
    "v"."model" AS "vehicle_model",
    "p"."payment_type",
    "p"."method",
    "p"."amount",
    COALESCE("pa_summary"."applied_amount", (0)::numeric) AS "applied_amount",
    ("p"."amount" - COALESCE("pa_summary"."applied_amount", (0)::numeric)) AS "unapplied_amount",
    COALESCE("pa_summary"."allocations_json", '[]'::"jsonb") AS "allocations_json"
   FROM ((("public"."payments" "p"
     LEFT JOIN "public"."customers" "c" ON (("c"."id" = "p"."customer_id")))
     LEFT JOIN "public"."vehicles" "v" ON (("v"."id" = "p"."vehicle_id")))
     LEFT JOIN ( SELECT "pa"."payment_id",
            "sum"("pa"."amount_applied") AS "applied_amount",
            "jsonb_agg"("jsonb_build_object"('charge_id', "le"."id", 'charge_due_date', "le"."due_date", 'amount_applied', "pa"."amount_applied")) AS "allocations_json"
           FROM ("public"."payment_applications" "pa"
             JOIN "public"."ledger_entries" "le" ON (("le"."id" = "pa"."charge_entry_id")))
          GROUP BY "pa"."payment_id") "pa_summary" ON (("pa_summary"."payment_id" = "p"."id")));


ALTER VIEW "public"."view_payments_export" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_pl_by_vehicle" AS
 SELECT "v"."id" AS "vehicle_id",
    "v"."reg" AS "vehicle_reg",
    "concat"("v"."make", ' ', "v"."model") AS "make_model",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Revenue'::"text") AND ("pe"."category" = 'Rental'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "revenue_rental",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Revenue'::"text") AND ("pe"."category" = 'Initial Fees'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "revenue_fees",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Revenue'::"text") AND ("pe"."category" = 'Other'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "revenue_other",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Acquisition'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_acquisition",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Finance'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_finance",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Service'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_service",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Fines'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_fines",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Other'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_other",
    COALESCE("sum"(
        CASE
            WHEN ("pe"."side" = 'Revenue'::"text") THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "total_revenue",
    COALESCE("sum"(
        CASE
            WHEN ("pe"."side" = 'Cost'::"text") THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "total_costs",
    (COALESCE("sum"(
        CASE
            WHEN ("pe"."side" = 'Revenue'::"text") THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) - COALESCE("sum"(
        CASE
            WHEN ("pe"."side" = 'Cost'::"text") THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric)) AS "net_profit"
   FROM ("public"."vehicles" "v"
     LEFT JOIN "public"."pnl_entries" "pe" ON (("pe"."vehicle_id" = "v"."id")))
  GROUP BY "v"."id", "v"."reg", "v"."make", "v"."model";


ALTER VIEW "public"."view_pl_by_vehicle" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_pl_consolidated" AS
 SELECT 'Total'::"text" AS "view_type",
    COALESCE("sum"(
        CASE
            WHEN (("side" = 'Revenue'::"text") AND ("category" = 'Rental'::"text")) THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) AS "revenue_rental",
    COALESCE("sum"(
        CASE
            WHEN (("side" = 'Revenue'::"text") AND ("category" = 'InitialFees'::"text")) THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) AS "revenue_fees",
    COALESCE("sum"(
        CASE
            WHEN (("side" = 'Revenue'::"text") AND ("category" <> ALL (ARRAY['Rental'::"text", 'InitialFees'::"text"]))) THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) AS "revenue_other",
    COALESCE("sum"(
        CASE
            WHEN (("side" = 'Cost'::"text") AND ("category" = 'Acquisition'::"text")) THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) AS "cost_acquisition",
    COALESCE("sum"(
        CASE
            WHEN (("side" = 'Cost'::"text") AND ("category" = 'Service'::"text")) THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) AS "cost_service",
    COALESCE("sum"(
        CASE
            WHEN (("side" = 'Cost'::"text") AND ("category" = 'Finance'::"text")) THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) AS "cost_finance",
    COALESCE("sum"(
        CASE
            WHEN (("side" = 'Cost'::"text") AND ("category" = 'Fines'::"text")) THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) AS "cost_fines",
    COALESCE("sum"(
        CASE
            WHEN (("side" = 'Cost'::"text") AND ("category" <> ALL (ARRAY['Acquisition'::"text", 'Service'::"text", 'Finance'::"text", 'Fines'::"text"]))) THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) AS "cost_other",
    COALESCE("sum"(
        CASE
            WHEN ("side" = 'Revenue'::"text") THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) AS "total_revenue",
    COALESCE("sum"(
        CASE
            WHEN ("side" = 'Cost'::"text") THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) AS "total_costs",
    (COALESCE("sum"(
        CASE
            WHEN ("side" = 'Revenue'::"text") THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric) - COALESCE("sum"(
        CASE
            WHEN ("side" = 'Cost'::"text") THEN "amount"
            ELSE (0)::numeric
        END), (0)::numeric)) AS "net_profit"
   FROM "public"."pnl_entries" "pe";


ALTER VIEW "public"."view_pl_consolidated" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."view_rentals_export" AS
 SELECT "r"."id" AS "rental_id",
    COALESCE(( SELECT "sum"(
                CASE
                    WHEN ("le"."type" = 'charge'::"text") THEN "le"."remaining_amount"
                    ELSE (0)::numeric
                END) AS "sum"
           FROM "public"."ledger_entries" "le"
          WHERE ("le"."rental_id" = "r"."id")), (0)::numeric) AS "balance",
    "c"."name" AS "customer_name",
    "r"."end_date",
    COALESCE(( SELECT "sum"("le"."amount") AS "sum"
           FROM "public"."ledger_entries" "le"
          WHERE (("le"."rental_id" = "r"."id") AND ("le"."category" = 'initial_fee'::"text"))), (0)::numeric) AS "initial_fee_amount",
    "r"."monthly_amount",
    "r"."schedule",
    "r"."start_date",
    "r"."status",
    "v"."reg" AS "vehicle_reg"
   FROM (("public"."rentals" "r"
     LEFT JOIN "public"."customers" "c" ON (("r"."customer_id" = "c"."id")))
     LEFT JOIN "public"."vehicles" "v" ON (("r"."vehicle_id" = "v"."id")));


ALTER VIEW "public"."view_rentals_export" OWNER TO "postgres";


ALTER TABLE ONLY "public"."agreement_templates"
    ADD CONSTRAINT "agreement_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."authority_payments"
    ADD CONSTRAINT "authority_payments_fine_id_payment_date_amount_key" UNIQUE ("fine_id", "payment_date", "amount");



ALTER TABLE ONLY "public"."authority_payments"
    ADD CONSTRAINT "authority_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blocked_dates"
    ADD CONSTRAINT "blocked_dates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blocked_identities"
    ADD CONSTRAINT "blocked_identities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cms_media"
    ADD CONSTRAINT "cms_media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cms_page_sections"
    ADD CONSTRAINT "cms_page_sections_page_id_section_key_key" UNIQUE ("page_id", "section_key");



ALTER TABLE ONLY "public"."cms_page_sections"
    ADD CONSTRAINT "cms_page_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cms_page_versions"
    ADD CONSTRAINT "cms_page_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cms_pages"
    ADD CONSTRAINT "cms_pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cms_pages"
    ADD CONSTRAINT "cms_pages_tenant_slug_unique" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."contact_requests"
    ADD CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_documents"
    ADD CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_logs"
    ADD CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fine_files"
    ADD CONSTRAINT "fine_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fines"
    ADD CONSTRAINT "fines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."global_admin_config"
    ADD CONSTRAINT "global_admin_config_master_email_key" UNIQUE ("master_email");



ALTER TABLE ONLY "public"."global_admin_config"
    ADD CONSTRAINT "global_admin_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."identity_verifications"
    ADD CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."insurance_documents"
    ADD CONSTRAINT "insurance_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."insurance_policies"
    ADD CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."login_attempts"
    ADD CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_runs"
    ADD CONSTRAINT "maintenance_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_settings"
    ADD CONSTRAINT "org_settings_org_id_key" UNIQUE ("org_id");



ALTER TABLE ONLY "public"."org_settings"
    ADD CONSTRAINT "org_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_applications"
    ADD CONSTRAINT "payment_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plates"
    ADD CONSTRAINT "plates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plates"
    ADD CONSTRAINT "plates_plate_number_key" UNIQUE ("plate_number");



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_actions"
    ADD CONSTRAINT "reminder_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_config"
    ADD CONSTRAINT "reminder_config_config_key_key" UNIQUE ("config_key");



ALTER TABLE ONLY "public"."reminder_config"
    ADD CONSTRAINT "reminder_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_emails"
    ADD CONSTRAINT "reminder_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_events"
    ADD CONSTRAINT "reminder_events_charge_id_reminder_type_key" UNIQUE ("charge_id", "reminder_type");



ALTER TABLE ONLY "public"."reminder_events"
    ADD CONSTRAINT "reminder_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_logs"
    ADD CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_rules"
    ADD CONSTRAINT "reminder_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_rules"
    ADD CONSTRAINT "reminder_rules_rule_type_lead_days_key" UNIQUE ("rule_type", "lead_days");



ALTER TABLE ONLY "public"."reminder_settings"
    ADD CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_settings"
    ADD CONSTRAINT "reminder_settings_setting_key_key" UNIQUE ("setting_key");



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rental_handover_photos"
    ADD CONSTRAINT "rental_handover_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rental_insurance_verifications"
    ADD CONSTRAINT "rental_insurance_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rental_key_handovers"
    ADD CONSTRAINT "rental_key_handovers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rental_key_handovers"
    ADD CONSTRAINT "rental_key_handovers_rental_id_handover_type_key" UNIQUE ("rental_id", "handover_type");



ALTER TABLE ONLY "public"."rentals"
    ADD CONSTRAINT "rentals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rentals"
    ADD CONSTRAINT "rentals_rental_number_key" UNIQUE ("rental_number");



ALTER TABLE ONLY "public"."service_records"
    ADD CONSTRAINT "service_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settings_audit"
    ADD CONSTRAINT "settings_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."testimonials"
    ADD CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."insurance_policies"
    ADD CONSTRAINT "unique_policy_number_per_customer" UNIQUE ("customer_id", "policy_number");



ALTER TABLE ONLY "public"."payment_applications"
    ADD CONSTRAINT "ux_payment_app_unique" UNIQUE ("payment_id", "charge_entry_id");



ALTER TABLE ONLY "public"."payment_applications"
    ADD CONSTRAINT "ux_payment_applications_unique" UNIQUE ("payment_id", "charge_entry_id");



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "ux_pnl_entries_reference" UNIQUE ("reference");



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "ux_pnl_initial_fee_once" UNIQUE ("payment_id", "category");



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "ux_pnl_vehicle_category_source" UNIQUE ("vehicle_id", "category", "source_ref");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ux_rental_charge_unique" UNIQUE ("rental_id", "due_date", "type", "category");



ALTER TABLE ONLY "public"."vehicle_events"
    ADD CONSTRAINT "vehicle_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_expenses"
    ADD CONSTRAINT "vehicle_expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_files"
    ADD CONSTRAINT "vehicle_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_photos"
    ADD CONSTRAINT "vehicle_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_reg_key" UNIQUE ("reg");



CREATE INDEX "idx_agreement_templates_tenant_id" ON "public"."agreement_templates" USING "btree" ("tenant_id");



CREATE INDEX "idx_app_users_is_super_admin" ON "public"."app_users" USING "btree" ("is_super_admin");



CREATE INDEX "idx_app_users_tenant_id" ON "public"."app_users" USING "btree" ("tenant_id");



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_entity" ON "public"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_audit_logs_tenant_id" ON "public"."audit_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_authority_payments_tenant_id" ON "public"."authority_payments" USING "btree" ("tenant_id");



CREATE INDEX "idx_blocked_dates_end" ON "public"."blocked_dates" USING "btree" ("end_date");



CREATE INDEX "idx_blocked_dates_range" ON "public"."blocked_dates" USING "btree" ("start_date", "end_date");



CREATE INDEX "idx_blocked_dates_start" ON "public"."blocked_dates" USING "btree" ("start_date");



CREATE INDEX "idx_blocked_dates_tenant_id" ON "public"."blocked_dates" USING "btree" ("tenant_id");



CREATE INDEX "idx_blocked_dates_vehicle" ON "public"."blocked_dates" USING "btree" ("vehicle_id");



CREATE INDEX "idx_blocked_dates_vehicle_range" ON "public"."blocked_dates" USING "btree" ("vehicle_id", "start_date", "end_date");



CREATE INDEX "idx_blocked_identities_active" ON "public"."blocked_identities" USING "btree" ("is_active");



CREATE INDEX "idx_blocked_identities_number" ON "public"."blocked_identities" USING "btree" ("identity_number");



CREATE INDEX "idx_blocked_identities_tenant_id" ON "public"."blocked_identities" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_blocked_identities_unique" ON "public"."blocked_identities" USING "btree" ("identity_type", "identity_number") WHERE ("is_active" = true);



CREATE INDEX "idx_cms_media_created_at" ON "public"."cms_media" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cms_media_folder" ON "public"."cms_media" USING "btree" ("folder");



CREATE INDEX "idx_cms_media_tenant_id" ON "public"."cms_media" USING "btree" ("tenant_id");



CREATE INDEX "idx_cms_page_sections_page_id" ON "public"."cms_page_sections" USING "btree" ("page_id");



CREATE INDEX "idx_cms_page_sections_tenant_id" ON "public"."cms_page_sections" USING "btree" ("tenant_id");



CREATE INDEX "idx_cms_page_versions_created_at" ON "public"."cms_page_versions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cms_page_versions_page_id" ON "public"."cms_page_versions" USING "btree" ("page_id");



CREATE INDEX "idx_cms_pages_slug" ON "public"."cms_pages" USING "btree" ("slug");



CREATE INDEX "idx_cms_pages_status" ON "public"."cms_pages" USING "btree" ("status");



CREATE INDEX "idx_cms_pages_tenant_id" ON "public"."cms_pages" USING "btree" ("tenant_id");



CREATE INDEX "idx_cms_pages_tenant_slug" ON "public"."cms_pages" USING "btree" ("tenant_id", "slug");



CREATE INDEX "idx_contact_requests_created_at" ON "public"."contact_requests" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_contact_requests_status" ON "public"."contact_requests" USING "btree" ("status");



CREATE INDEX "idx_contact_requests_tenant_id" ON "public"."contact_requests" USING "btree" ("tenant_id");



CREATE INDEX "idx_customer_documents_customer_id" ON "public"."customer_documents" USING "btree" ("customer_id");



CREATE INDEX "idx_customer_documents_rental_id" ON "public"."customer_documents" USING "btree" ("rental_id");



CREATE INDEX "idx_customer_documents_scan_status" ON "public"."customer_documents" USING "btree" ("ai_scan_status");



CREATE INDEX "idx_customer_documents_tenant_id" ON "public"."customer_documents" USING "btree" ("tenant_id");



CREATE INDEX "idx_customer_documents_type" ON "public"."customer_documents" USING "btree" ("document_type");



CREATE INDEX "idx_customers_customer_type" ON "public"."customers" USING "btree" ("customer_type");



CREATE UNIQUE INDEX "idx_customers_email_unique" ON "public"."customers" USING "btree" ("email") WHERE (("email" IS NOT NULL) AND ("email" <> ''::"text"));



CREATE INDEX "idx_customers_high_switcher" ON "public"."customers" USING "btree" ("high_switcher");



CREATE INDEX "idx_customers_id_number" ON "public"."customers" USING "btree" ("id_number");



CREATE INDEX "idx_customers_identity_verification_status" ON "public"."customers" USING "btree" ("identity_verification_status");



CREATE INDEX "idx_customers_is_blocked" ON "public"."customers" USING "btree" ("is_blocked");



CREATE INDEX "idx_customers_license_number" ON "public"."customers" USING "btree" ("license_number");



CREATE UNIQUE INDEX "idx_customers_license_number_unique" ON "public"."customers" USING "btree" ("license_number") WHERE (("license_number" IS NOT NULL) AND ("license_number" <> ''::"text"));



CREATE INDEX "idx_customers_status" ON "public"."customers" USING "btree" ("status");



CREATE INDEX "idx_customers_tenant_id" ON "public"."customers" USING "btree" ("tenant_id");



CREATE INDEX "idx_email_logs_tenant_id" ON "public"."email_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_email_templates_active" ON "public"."email_templates" USING "btree" ("is_active");



CREATE INDEX "idx_email_templates_category" ON "public"."email_templates" USING "btree" ("category");



CREATE INDEX "idx_email_templates_tenant_id" ON "public"."email_templates" USING "btree" ("tenant_id");



CREATE INDEX "idx_faqs_tenant_id" ON "public"."faqs" USING "btree" ("tenant_id");



CREATE INDEX "idx_fine_files_tenant_id" ON "public"."fine_files" USING "btree" ("tenant_id");



CREATE INDEX "idx_fines_tenant_id" ON "public"."fines" USING "btree" ("tenant_id");



CREATE INDEX "idx_identity_verifications_customer_id" ON "public"."identity_verifications" USING "btree" ("customer_id");



CREATE INDEX "idx_identity_verifications_session_id" ON "public"."identity_verifications" USING "btree" ("session_id");



CREATE INDEX "idx_identity_verifications_tenant_id" ON "public"."identity_verifications" USING "btree" ("tenant_id");



CREATE INDEX "idx_insurance_customer" ON "public"."insurance_policies" USING "btree" ("customer_id");



CREATE INDEX "idx_insurance_documents_tenant_id" ON "public"."insurance_documents" USING "btree" ("tenant_id");



CREATE INDEX "idx_insurance_expiry" ON "public"."insurance_policies" USING "btree" ("expiry_date");



CREATE INDEX "idx_insurance_policies_tenant_id" ON "public"."insurance_policies" USING "btree" ("tenant_id");



CREATE INDEX "idx_insurance_status" ON "public"."insurance_policies" USING "btree" ("status");



CREATE INDEX "idx_insurance_vehicle" ON "public"."insurance_policies" USING "btree" ("vehicle_id");



CREATE INDEX "idx_invoices_customer" ON "public"."invoices" USING "btree" ("customer_id");



CREATE INDEX "idx_invoices_date" ON "public"."invoices" USING "btree" ("invoice_date");



CREATE INDEX "idx_invoices_rental" ON "public"."invoices" USING "btree" ("rental_id");



CREATE INDEX "idx_invoices_status" ON "public"."invoices" USING "btree" ("status");



CREATE INDEX "idx_invoices_tenant_id" ON "public"."invoices" USING "btree" ("tenant_id");



CREATE INDEX "idx_invoices_vehicle" ON "public"."invoices" USING "btree" ("vehicle_id");



CREATE INDEX "idx_leads_assigned_to" ON "public"."leads" USING "btree" ("assigned_to");



CREATE INDEX "idx_leads_converted_customer" ON "public"."leads" USING "btree" ("converted_to_customer_id");



CREATE INDEX "idx_leads_follow_up_date" ON "public"."leads" USING "btree" ("follow_up_date");



CREATE INDEX "idx_leads_status" ON "public"."leads" USING "btree" ("status");



CREATE INDEX "idx_leads_tenant_id" ON "public"."leads" USING "btree" ("tenant_id");



CREATE INDEX "idx_ledger_customer_due" ON "public"."ledger_entries" USING "btree" ("customer_id", "due_date", "id");



CREATE INDEX "idx_ledger_entries_customer_type" ON "public"."ledger_entries" USING "btree" ("customer_id", "type");



CREATE INDEX "idx_ledger_entries_entry_date" ON "public"."ledger_entries" USING "btree" ("entry_date");



CREATE UNIQUE INDEX "idx_ledger_entries_payment_id" ON "public"."ledger_entries" USING "btree" ("payment_id") WHERE ("payment_id" IS NOT NULL);



CREATE INDEX "idx_ledger_entries_rental_charges" ON "public"."ledger_entries" USING "btree" ("rental_id", "type", "category", "remaining_amount", "due_date", "entry_date") WHERE (("type" = 'Charge'::"text") AND ("category" = 'Rental'::"text") AND ("remaining_amount" > (0)::numeric));



CREATE INDEX "idx_ledger_entries_tenant_id" ON "public"."ledger_entries" USING "btree" ("tenant_id");



CREATE INDEX "idx_ledger_entries_type" ON "public"."ledger_entries" USING "btree" ("type");



CREATE INDEX "idx_ledger_entries_type_entry_date" ON "public"."ledger_entries" USING "btree" ("type", "entry_date");



CREATE INDEX "idx_ledger_rental_due" ON "public"."ledger_entries" USING "btree" ("rental_id", "due_date", "id");



CREATE INDEX "idx_ledger_rental_open" ON "public"."ledger_entries" USING "btree" ("rental_id", "due_date") WHERE (("type" = 'Charge'::"text") AND ("category" = 'Rental'::"text") AND ("remaining_amount" > (0)::numeric));



CREATE INDEX "idx_login_attempts_tenant_id" ON "public"."login_attempts" USING "btree" ("tenant_id");



CREATE INDEX "idx_maintenance_runs_status" ON "public"."maintenance_runs" USING "btree" ("status");



CREATE INDEX "idx_maintenance_runs_tenant_id" ON "public"."maintenance_runs" USING "btree" ("tenant_id");



CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_is_read" ON "public"."notifications" USING "btree" ("is_read");



CREATE INDEX "idx_notifications_tenant_id" ON "public"."notifications" USING "btree" ("tenant_id");



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_org_settings_org_id" ON "public"."org_settings" USING "btree" ("org_id");



CREATE INDEX "idx_org_settings_tenant_id" ON "public"."org_settings" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_org_settings_tenant_id_unique" ON "public"."org_settings" USING "btree" ("tenant_id");



CREATE INDEX "idx_payment_applications_charge_entry_id" ON "public"."payment_applications" USING "btree" ("charge_entry_id");



CREATE INDEX "idx_payment_applications_payment" ON "public"."payment_applications" USING "btree" ("payment_id");



CREATE INDEX "idx_payment_applications_payment_id" ON "public"."payment_applications" USING "btree" ("payment_id");



CREATE INDEX "idx_payment_applications_tenant_id" ON "public"."payment_applications" USING "btree" ("tenant_id");



CREATE INDEX "idx_payments_booking_source" ON "public"."payments" USING "btree" ("booking_source");



CREATE INDEX "idx_payments_capture_status" ON "public"."payments" USING "btree" ("capture_status");



CREATE INDEX "idx_payments_customer_date" ON "public"."payments" USING "btree" ("customer_id", "payment_date" DESC);



CREATE INDEX "idx_payments_is_manual_mode" ON "public"."payments" USING "btree" ("is_manual_mode");



CREATE INDEX "idx_payments_preauth_expires" ON "public"."payments" USING "btree" ("preauth_expires_at") WHERE ("capture_status" = 'requires_capture'::"text");



CREATE INDEX "idx_payments_processing" ON "public"."payments" USING "btree" ("customer_id", "rental_id", "payment_date", "status");



CREATE INDEX "idx_payments_refund_scheduled_date" ON "public"."payments" USING "btree" ("refund_scheduled_date") WHERE ("refund_status" = 'scheduled'::"text");



CREATE INDEX "idx_payments_stripe_payment_intent" ON "public"."payments" USING "btree" ("stripe_payment_intent_id");



CREATE INDEX "idx_payments_tenant_id" ON "public"."payments" USING "btree" ("tenant_id");



CREATE INDEX "idx_payments_verification_status" ON "public"."payments" USING "btree" ("verification_status");



CREATE INDEX "idx_plates_assigned_vehicle" ON "public"."plates" USING "btree" ("assigned_vehicle_id");



CREATE INDEX "idx_plates_plate_number" ON "public"."plates" USING "btree" ("plate_number");



CREATE INDEX "idx_plates_tenant_id" ON "public"."plates" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_pnl_entries_reference" ON "public"."pnl_entries" USING "btree" ("reference") WHERE ("reference" IS NOT NULL);



CREATE UNIQUE INDEX "idx_pnl_entries_reference_unique" ON "public"."pnl_entries" USING "btree" ("reference") WHERE ("reference" IS NOT NULL);



CREATE INDEX "idx_pnl_entries_tenant_id" ON "public"."pnl_entries" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_pnl_reference_unique" ON "public"."pnl_entries" USING "btree" ("reference") WHERE ("reference" IS NOT NULL);



CREATE INDEX "idx_promotions_tenant_id" ON "public"."promotions" USING "btree" ("tenant_id");



CREATE INDEX "idx_reminder_actions_created_at" ON "public"."reminder_actions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_reminder_actions_reminder_id" ON "public"."reminder_actions" USING "btree" ("reminder_id");



CREATE INDEX "idx_reminder_actions_tenant_id" ON "public"."reminder_actions" USING "btree" ("tenant_id");



CREATE INDEX "idx_reminder_config_tenant_id" ON "public"."reminder_config" USING "btree" ("tenant_id");



CREATE INDEX "idx_reminder_emails_tenant_id" ON "public"."reminder_emails" USING "btree" ("tenant_id");



CREATE INDEX "idx_reminder_events_customer" ON "public"."reminder_events" USING "btree" ("customer_id");



CREATE INDEX "idx_reminder_events_due_type" ON "public"."reminder_events" USING "btree" ("reminder_type", "created_at");



CREATE INDEX "idx_reminder_events_status" ON "public"."reminder_events" USING "btree" ("status");



CREATE INDEX "idx_reminder_events_tenant_id" ON "public"."reminder_events" USING "btree" ("tenant_id");



CREATE INDEX "idx_reminder_logs_tenant_id" ON "public"."reminder_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_reminder_rules_tenant_id" ON "public"."reminder_rules" USING "btree" ("tenant_id");



CREATE INDEX "idx_reminder_settings_tenant_id" ON "public"."reminder_settings" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_reminder_unique_key" ON "public"."reminder_events" USING "btree" ("unique_key") WHERE ("unique_key" IS NOT NULL);



CREATE INDEX "idx_reminders_due_status" ON "public"."reminders" USING "btree" ("due_on", "status");



CREATE INDEX "idx_reminders_object" ON "public"."reminders" USING "btree" ("object_type", "object_id");



CREATE INDEX "idx_reminders_status_remind_on" ON "public"."reminders" USING "btree" ("status", "remind_on");



CREATE INDEX "idx_reminders_tenant_id" ON "public"."reminders" USING "btree" ("tenant_id");



CREATE INDEX "idx_rental_handover_photos_handover_id" ON "public"."rental_handover_photos" USING "btree" ("handover_id");



CREATE INDEX "idx_rental_handover_photos_tenant_id" ON "public"."rental_handover_photos" USING "btree" ("tenant_id");



CREATE INDEX "idx_rental_insurance_verifications_axle_account_id" ON "public"."rental_insurance_verifications" USING "btree" ("axle_account_id");



CREATE INDEX "idx_rental_insurance_verifications_customer_id" ON "public"."rental_insurance_verifications" USING "btree" ("customer_id");



CREATE UNIQUE INDEX "idx_rental_insurance_verifications_rental_id" ON "public"."rental_insurance_verifications" USING "btree" ("rental_id") WHERE ("rental_id" IS NOT NULL);



CREATE INDEX "idx_rental_insurance_verifications_tenant_id" ON "public"."rental_insurance_verifications" USING "btree" ("tenant_id");



CREATE INDEX "idx_rental_key_handovers_rental_id" ON "public"."rental_key_handovers" USING "btree" ("rental_id");



CREATE INDEX "idx_rental_key_handovers_tenant_id" ON "public"."rental_key_handovers" USING "btree" ("tenant_id");



CREATE INDEX "idx_rentals_active_lookup" ON "public"."rentals" USING "btree" ("customer_id", "status", "start_date", "end_date") WHERE ("status" = 'Active'::"text");



CREATE INDEX "idx_rentals_customer_id" ON "public"."rentals" USING "btree" ("customer_id");



CREATE INDEX "idx_rentals_document_status" ON "public"."rentals" USING "btree" ("document_status");



CREATE INDEX "idx_rentals_docusign_envelope_id" ON "public"."rentals" USING "btree" ("docusign_envelope_id");



CREATE INDEX "idx_rentals_rental_number" ON "public"."rentals" USING "btree" ("rental_number");



CREATE INDEX "idx_rentals_tenant_id" ON "public"."rentals" USING "btree" ("tenant_id");



CREATE INDEX "idx_service_records_date" ON "public"."service_records" USING "btree" ("service_date" DESC);



CREATE INDEX "idx_service_records_tenant" ON "public"."service_records" USING "btree" ("tenant_id");



CREATE INDEX "idx_service_records_vehicle_id" ON "public"."service_records" USING "btree" ("vehicle_id");



CREATE INDEX "idx_settings_audit_changed_at" ON "public"."settings_audit" USING "btree" ("changed_at");



CREATE INDEX "idx_settings_audit_table_name" ON "public"."settings_audit" USING "btree" ("table_name");



CREATE INDEX "idx_settings_audit_tenant_id" ON "public"."settings_audit" USING "btree" ("tenant_id");



CREATE INDEX "idx_tenants_slug" ON "public"."tenants" USING "btree" ("slug");



CREATE INDEX "idx_tenants_slug_status" ON "public"."tenants" USING "btree" ("slug", "status");



CREATE INDEX "idx_tenants_status" ON "public"."tenants" USING "btree" ("status");



CREATE INDEX "idx_testimonials_created_at" ON "public"."testimonials" USING "btree" ("created_at");



CREATE INDEX "idx_testimonials_stars" ON "public"."testimonials" USING "btree" ("stars");



CREATE INDEX "idx_testimonials_tenant_id" ON "public"."testimonials" USING "btree" ("tenant_id");



CREATE INDEX "idx_vehicle_events_date" ON "public"."vehicle_events" USING "btree" ("event_date");



CREATE INDEX "idx_vehicle_events_tenant_id" ON "public"."vehicle_events" USING "btree" ("tenant_id");



CREATE INDEX "idx_vehicle_events_vehicle_id" ON "public"."vehicle_events" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicle_expenses_date" ON "public"."vehicle_expenses" USING "btree" ("expense_date");



CREATE INDEX "idx_vehicle_expenses_tenant_id" ON "public"."vehicle_expenses" USING "btree" ("tenant_id");



CREATE INDEX "idx_vehicle_expenses_vehicle_id" ON "public"."vehicle_expenses" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicle_files_tenant_id" ON "public"."vehicle_files" USING "btree" ("tenant_id");



CREATE INDEX "idx_vehicle_files_vehicle_id" ON "public"."vehicle_files" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicle_photos_display_order" ON "public"."vehicle_photos" USING "btree" ("vehicle_id", "display_order");



CREATE INDEX "idx_vehicle_photos_tenant_id" ON "public"."vehicle_photos" USING "btree" ("tenant_id");



CREATE INDEX "idx_vehicle_photos_vehicle_id" ON "public"."vehicle_photos" USING "btree" ("vehicle_id");



CREATE INDEX "idx_vehicles_tenant_id" ON "public"."vehicles" USING "btree" ("tenant_id");



CREATE INDEX "ix_fines_customer" ON "public"."fines" USING "btree" ("customer_id", "status");



CREATE INDEX "ix_fines_due_date" ON "public"."fines" USING "btree" ("due_date", "status");



CREATE INDEX "ix_fines_vehicle" ON "public"."fines" USING "btree" ("vehicle_id", "status");



CREATE INDEX "ix_ledger_rental_due" ON "public"."ledger_entries" USING "btree" ("rental_id", "type", "due_date");



CREATE INDEX "ix_ledger_vehicle" ON "public"."ledger_entries" USING "btree" ("vehicle_id", "type", "category");



CREATE INDEX "ix_login_attempts_username" ON "public"."login_attempts" USING "btree" ("username", "attempted_at");



CREATE INDEX "ix_payments_apply_from_date" ON "public"."payments" USING "btree" ("apply_from_date");



CREATE INDEX "ix_payments_payment_date" ON "public"."payments" USING "btree" ("payment_date");



CREATE INDEX "ix_payments_rental_date" ON "public"."payments" USING "btree" ("rental_id", "payment_date");



CREATE INDEX "ix_pnl_vehicle_date" ON "public"."pnl_entries" USING "btree" ("vehicle_id", "entry_date", "side");



CREATE UNIQUE INDEX "unique_active_template_per_tenant" ON "public"."agreement_templates" USING "btree" ("tenant_id") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "ux_initialfee_ledger_unique" ON "public"."ledger_entries" USING "btree" ("rental_id", "customer_id", "vehicle_id", "entry_date", "amount") WHERE (("type" = 'Payment'::"text") AND ("category" = 'InitialFee'::"text"));



CREATE UNIQUE INDEX "ux_ledger_entries_payment_id" ON "public"."ledger_entries" USING "btree" ("payment_id") WHERE ("payment_id" IS NOT NULL);



CREATE UNIQUE INDEX "ux_ledger_payment_reference" ON "public"."ledger_entries" USING "btree" ("reference") WHERE (("reference" IS NOT NULL) AND ("type" = 'Payment'::"text"));



COMMENT ON INDEX "public"."ux_ledger_payment_reference" IS 'Ensures idempotent payment ledger entries';



CREATE UNIQUE INDEX "ux_ledger_rental_charge_unique" ON "public"."ledger_entries" USING "btree" ("rental_id", "due_date") WHERE (("type" = 'Charge'::"text") AND ("category" = 'Rental'::"text"));



CREATE UNIQUE INDEX "ux_payments_rental_initial_fee" ON "public"."payments" USING "btree" ("rental_id", "payment_type") WHERE ("payment_type" = 'InitialFee'::"text");



CREATE UNIQUE INDEX "ux_pnl_payment_reference" ON "public"."pnl_entries" USING "btree" ("reference") WHERE ("reference" IS NOT NULL);



CREATE UNIQUE INDEX "ux_pnl_reference" ON "public"."pnl_entries" USING "btree" ("reference") WHERE ("reference" IS NOT NULL);



CREATE UNIQUE INDEX "ux_pnl_source_reference" ON "public"."pnl_entries" USING "btree" ("source_ref") WHERE ("source_ref" IS NOT NULL);



COMMENT ON INDEX "public"."ux_pnl_source_reference" IS 'Ensures idempotent P&L entries';



CREATE UNIQUE INDEX "ux_reminders_identity" ON "public"."reminders" USING "btree" ("rule_code", "object_type", "object_id", "due_on", "remind_on");



CREATE OR REPLACE TRIGGER "auto_allocate_payments_on_new_charge" AFTER INSERT ON "public"."ledger_entries" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_auto_allocate_payments"();



CREATE OR REPLACE TRIGGER "cms_page_sections_updated_at" BEFORE UPDATE ON "public"."cms_page_sections" FOR EACH ROW EXECUTE FUNCTION "public"."update_cms_updated_at"();



CREATE OR REPLACE TRIGGER "cms_pages_updated_at" BEFORE UPDATE ON "public"."cms_pages" FOR EACH ROW EXECUTE FUNCTION "public"."update_cms_updated_at"();



CREATE OR REPLACE TRIGGER "customers_set_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "fine_create_charge_trigger" AFTER INSERT ON "public"."fines" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_create_fine_charge"();



CREATE OR REPLACE TRIGGER "ledger_entries_set_updated_at" BEFORE UPDATE ON "public"."ledger_entries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "payments_set_updated_at" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "rental_charges_trigger" AFTER INSERT ON "public"."rentals" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_generate_rental_charges"();



CREATE OR REPLACE TRIGGER "rentals_set_updated_at" BEFORE UPDATE ON "public"."rentals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_vehicle_photos_updated_at" BEFORE UPDATE ON "public"."vehicle_photos" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "trg_org_settings_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."org_settings" FOR EACH ROW EXECUTE FUNCTION "public"."audit_settings_changes"();



CREATE OR REPLACE TRIGGER "trg_org_settings_updated_at" BEFORE UPDATE ON "public"."org_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_generate_rental_number" BEFORE INSERT ON "public"."rentals" FOR EACH ROW EXECUTE FUNCTION "public"."generate_rental_number"();



CREATE OR REPLACE TRIGGER "trigger_plates_pnl" AFTER INSERT OR DELETE OR UPDATE ON "public"."plates" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_update_plate_pnl"();



CREATE OR REPLACE TRIGGER "trigger_service_records_update_vehicle" AFTER INSERT OR DELETE OR UPDATE ON "public"."service_records" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_update_vehicle_last_service"();



CREATE OR REPLACE TRIGGER "trigger_update_agreement_templates_updated_at" BEFORE UPDATE ON "public"."agreement_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_agreement_templates_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_insurance_docs_count" AFTER INSERT OR DELETE ON "public"."insurance_documents" FOR EACH ROW EXECUTE FUNCTION "public"."update_insurance_docs_count"();



CREATE OR REPLACE TRIGGER "trigger_update_leads_updated_at" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."update_leads_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_rental_insurance_verifications_updated_at" BEFORE UPDATE ON "public"."rental_insurance_verifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_rental_insurance_verifications_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_rental_key_handovers_updated_at" BEFORE UPDATE ON "public"."rental_key_handovers" FOR EACH ROW EXECUTE FUNCTION "public"."update_rental_key_handovers_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_update_vehicle_status_on_rental" AFTER INSERT OR DELETE OR UPDATE ON "public"."rentals" FOR EACH ROW EXECUTE FUNCTION "public"."update_vehicle_status_on_rental_change"();



CREATE OR REPLACE TRIGGER "update_app_users_updated_at" BEFORE UPDATE ON "public"."app_users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_customer_documents_updated_at" BEFORE UPDATE ON "public"."customer_documents" FOR EACH ROW EXECUTE FUNCTION "public"."update_customer_documents_updated_at"();



CREATE OR REPLACE TRIGGER "update_email_templates_modtime" BEFORE UPDATE ON "public"."email_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_email_template_timestamp"();



CREATE OR REPLACE TRIGGER "update_insurance_policies_updated_at" BEFORE UPDATE ON "public"."insurance_policies" FOR EACH ROW EXECUTE FUNCTION "public"."update_insurance_updated_at"();



CREATE OR REPLACE TRIGGER "update_plates_updated_at" BEFORE UPDATE ON "public"."plates" FOR EACH ROW EXECUTE FUNCTION "public"."update_plates_updated_at"();



CREATE OR REPLACE TRIGGER "update_reminder_rules_updated_at" BEFORE UPDATE ON "public"."reminder_rules" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_reminders_updated_at" BEFORE UPDATE ON "public"."reminders" FOR EACH ROW EXECUTE FUNCTION "public"."update_reminders_updated_at"();



CREATE OR REPLACE TRIGGER "vehicle_acquisition_trigger" AFTER INSERT OR UPDATE ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_post_acquisition"();



CREATE OR REPLACE TRIGGER "vehicle_expense_pnl_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."vehicle_expenses" FOR EACH ROW EXECUTE FUNCTION "public"."handle_vehicle_expense_pnl"();



CREATE OR REPLACE TRIGGER "vehicle_file_event_trigger" AFTER INSERT OR DELETE ON "public"."vehicle_files" FOR EACH ROW EXECUTE FUNCTION "public"."log_vehicle_file_event"();



CREATE OR REPLACE TRIGGER "vehicles_set_updated_at" BEFORE UPDATE ON "public"."vehicles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."agreement_templates"
    ADD CONSTRAINT "agreement_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."authority_payments"
    ADD CONSTRAINT "authority_payments_fine_id_fkey" FOREIGN KEY ("fine_id") REFERENCES "public"."fines"("id");



ALTER TABLE ONLY "public"."authority_payments"
    ADD CONSTRAINT "authority_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blocked_dates"
    ADD CONSTRAINT "blocked_dates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."blocked_dates"
    ADD CONSTRAINT "blocked_dates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blocked_dates"
    ADD CONSTRAINT "blocked_dates_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blocked_identities"
    ADD CONSTRAINT "blocked_identities_blocked_by_fkey" FOREIGN KEY ("blocked_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."blocked_identities"
    ADD CONSTRAINT "blocked_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cms_media"
    ADD CONSTRAINT "cms_media_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cms_media"
    ADD CONSTRAINT "cms_media_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."cms_page_sections"
    ADD CONSTRAINT "cms_page_sections_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."cms_pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cms_page_sections"
    ADD CONSTRAINT "cms_page_sections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cms_page_versions"
    ADD CONSTRAINT "cms_page_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."cms_page_versions"
    ADD CONSTRAINT "cms_page_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."cms_pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cms_page_versions"
    ADD CONSTRAINT "cms_page_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cms_pages"
    ADD CONSTRAINT "cms_pages_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."cms_pages"
    ADD CONSTRAINT "cms_pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_requests"
    ADD CONSTRAINT "contact_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_documents"
    ADD CONSTRAINT "customer_documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_documents"
    ADD CONSTRAINT "customer_documents_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_documents"
    ADD CONSTRAINT "customer_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_documents"
    ADD CONSTRAINT "customer_documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_logs"
    ADD CONSTRAINT "email_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fine_files"
    ADD CONSTRAINT "fine_files_fine_id_fkey" FOREIGN KEY ("fine_id") REFERENCES "public"."fines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fine_files"
    ADD CONSTRAINT "fine_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fines"
    ADD CONSTRAINT "fines_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."fines"
    ADD CONSTRAINT "fines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fines"
    ADD CONSTRAINT "fines_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "fk_ledger_entries_payment_id" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id");



ALTER TABLE ONLY "public"."identity_verifications"
    ADD CONSTRAINT "identity_verifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."identity_verifications"
    ADD CONSTRAINT "identity_verifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."identity_verifications"
    ADD CONSTRAINT "identity_verifications_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."insurance_documents"
    ADD CONSTRAINT "insurance_documents_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."insurance_policies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insurance_documents"
    ADD CONSTRAINT "insurance_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insurance_policies"
    ADD CONSTRAINT "insurance_policies_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insurance_policies"
    ADD CONSTRAINT "insurance_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."insurance_policies"
    ADD CONSTRAINT "insurance_policies_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_converted_to_customer_id_fkey" FOREIGN KEY ("converted_to_customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id");



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ledger_entries"
    ADD CONSTRAINT "ledger_entries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."login_attempts"
    ADD CONSTRAINT "login_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_runs"
    ADD CONSTRAINT "maintenance_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_settings"
    ADD CONSTRAINT "org_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_applications"
    ADD CONSTRAINT "payment_applications_charge_entry_id_fkey" FOREIGN KEY ("charge_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_applications"
    ADD CONSTRAINT "payment_applications_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_applications"
    ADD CONSTRAINT "payment_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_refund_scheduled_by_fkey" FOREIGN KEY ("refund_scheduled_by") REFERENCES "public"."app_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."plates"
    ADD CONSTRAINT "plates_assigned_vehicle_id_fkey" FOREIGN KEY ("assigned_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."plates"
    ADD CONSTRAINT "plates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plates"
    ADD CONSTRAINT "plates_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pnl_entries"
    ADD CONSTRAINT "pnl_entries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_actions"
    ADD CONSTRAINT "reminder_actions_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_actions"
    ADD CONSTRAINT "reminder_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_config"
    ADD CONSTRAINT "reminder_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_emails"
    ADD CONSTRAINT "reminder_emails_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_events"
    ADD CONSTRAINT "reminder_events_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "public"."ledger_entries"("id");



ALTER TABLE ONLY "public"."reminder_events"
    ADD CONSTRAINT "reminder_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."reminder_events"
    ADD CONSTRAINT "reminder_events_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id");



ALTER TABLE ONLY "public"."reminder_events"
    ADD CONSTRAINT "reminder_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_events"
    ADD CONSTRAINT "reminder_events_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."reminder_logs"
    ADD CONSTRAINT "reminder_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_rules"
    ADD CONSTRAINT "reminder_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_settings"
    ADD CONSTRAINT "reminder_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rental_handover_photos"
    ADD CONSTRAINT "rental_handover_photos_handover_id_fkey" FOREIGN KEY ("handover_id") REFERENCES "public"."rental_key_handovers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rental_handover_photos"
    ADD CONSTRAINT "rental_handover_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rental_handover_photos"
    ADD CONSTRAINT "rental_handover_photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."rental_insurance_verifications"
    ADD CONSTRAINT "rental_insurance_verifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rental_insurance_verifications"
    ADD CONSTRAINT "rental_insurance_verifications_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rental_insurance_verifications"
    ADD CONSTRAINT "rental_insurance_verifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rental_key_handovers"
    ADD CONSTRAINT "rental_key_handovers_handed_by_fkey" FOREIGN KEY ("handed_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."rental_key_handovers"
    ADD CONSTRAINT "rental_key_handovers_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rental_key_handovers"
    ADD CONSTRAINT "rental_key_handovers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rentals"
    ADD CONSTRAINT "rentals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."rentals"
    ADD CONSTRAINT "rentals_signed_document_id_fkey" FOREIGN KEY ("signed_document_id") REFERENCES "public"."customer_documents"("id");



ALTER TABLE ONLY "public"."rentals"
    ADD CONSTRAINT "rentals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rentals"
    ADD CONSTRAINT "rentals_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id");



ALTER TABLE ONLY "public"."service_records"
    ADD CONSTRAINT "service_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_records"
    ADD CONSTRAINT "service_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settings_audit"
    ADD CONSTRAINT "settings_audit_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."testimonials"
    ADD CONSTRAINT "testimonials_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."testimonials"
    ADD CONSTRAINT "testimonials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_events"
    ADD CONSTRAINT "vehicle_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_events"
    ADD CONSTRAINT "vehicle_events_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_expenses"
    ADD CONSTRAINT "vehicle_expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_expenses"
    ADD CONSTRAINT "vehicle_expenses_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_files"
    ADD CONSTRAINT "vehicle_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_files"
    ADD CONSTRAINT "vehicle_files_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_photos"
    ADD CONSTRAINT "vehicle_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_photos"
    ADD CONSTRAINT "vehicle_photos_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicles"
    ADD CONSTRAINT "vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can delete blocked identities" ON "public"."blocked_identities" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Admins can insert blocked identities" ON "public"."blocked_identities" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Admins can update blocked identities" ON "public"."blocked_identities" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Admins can view blocked identities" ON "public"."blocked_identities" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow all for authenticated" ON "public"."identity_verifications" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated users" ON "public"."identity_verifications" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated users" ON "public"."promotions" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for all users" ON "public"."customers" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."authority_payments" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."customer_documents" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."fine_files" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."ledger_entries" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."maintenance_runs" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."payment_applications" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."payments" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."plates" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."pnl_entries" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."reminder_events" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."reminder_logs" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."reminder_settings" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."rentals" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."service_records" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."settings_audit" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users" ON "public"."vehicles" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users on reminder_rules" ON "public"."reminder_rules" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users on vehicle_events" ON "public"."vehicle_events" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users on vehicle_expenses" ON "public"."vehicle_expenses" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations for app users on vehicle_files" ON "public"."vehicle_files" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all operations on reminders" ON "public"."reminders" USING (true) WITH CHECK (true);



CREATE POLICY "Allow anon access for fines" ON "public"."fines" TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow anon read cms_media" ON "public"."cms_media" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow anon to link verification to customer" ON "public"."identity_verifications" FOR UPDATE TO "anon" USING (("customer_id" IS NULL)) WITH CHECK (("customer_id" IS NOT NULL));



CREATE POLICY "Allow anon to read verifications for booking" ON "public"."identity_verifications" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow anon users read access" ON "public"."identity_verifications" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow anon users read access to org_settings" ON "public"."org_settings" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow authenticated delete cms_media" ON "public"."cms_media" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated delete cms_page_versions" ON "public"."cms_page_versions" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated insert cms_media" ON "public"."cms_media" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated insert cms_page_versions" ON "public"."cms_page_versions" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated read cms_media" ON "public"."cms_media" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated read cms_page_versions" ON "public"."cms_page_versions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users full access" ON "public"."identity_verifications" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow authenticated users full access to org_settings" ON "public"."org_settings" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow authenticated users to delete handovers" ON "public"."rental_key_handovers" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to delete photos" ON "public"."rental_handover_photos" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to delete reminder actions" ON "public"."reminder_actions" FOR DELETE USING (true);



CREATE POLICY "Allow authenticated users to insert handovers" ON "public"."rental_key_handovers" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated users to insert photos" ON "public"."rental_handover_photos" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow authenticated users to insert reminder actions" ON "public"."reminder_actions" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow authenticated users to manage FAQs" ON "public"."faqs" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow authenticated users to manage blocked dates" ON "public"."blocked_dates" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow authenticated users to manage invoices" ON "public"."invoices" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow authenticated users to manage leads" ON "public"."leads" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow authenticated users to manage testimonials" ON "public"."testimonials" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow authenticated users to read reminder actions" ON "public"."reminder_actions" FOR SELECT USING (true);



CREATE POLICY "Allow authenticated users to update handovers" ON "public"."rental_key_handovers" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to update photos" ON "public"."rental_handover_photos" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to update reminder actions" ON "public"."reminder_actions" FOR UPDATE USING (true);



CREATE POLICY "Allow authenticated users to view blocked dates" ON "public"."blocked_dates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to view handovers" ON "public"."rental_key_handovers" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to view invoices" ON "public"."invoices" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow authenticated users to view photos" ON "public"."rental_handover_photos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow full access for authenticated users" ON "public"."customers" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access for service role" ON "public"."rental_insurance_verifications" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Allow insert for authenticated users" ON "public"."rental_insurance_verifications" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Allow public insert on customers" ON "public"."customers" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public insert on invoices" ON "public"."invoices" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public read" ON "public"."promotions" FOR SELECT TO "anon" USING (true);



CREATE POLICY "Allow public read on customers" ON "public"."customers" FOR SELECT USING (true);



CREATE POLICY "Allow public select on invoices" ON "public"."invoices" FOR SELECT USING (true);



CREATE POLICY "Allow public to create invoices" ON "public"."invoices" FOR INSERT WITH CHECK (true);



CREATE POLICY "Allow public to read active FAQs" ON "public"."faqs" FOR SELECT TO "anon" USING (("is_active" = true));



CREATE POLICY "Allow public to view blocked dates" ON "public"."blocked_dates" FOR SELECT USING (true);



CREATE POLICY "Allow public to view invoices" ON "public"."invoices" FOR SELECT USING (true);



CREATE POLICY "Allow public to view testimonials" ON "public"."testimonials" FOR SELECT USING (true);



CREATE POLICY "Allow public update on customers" ON "public"."customers" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Allow public update on invoices" ON "public"."invoices" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Allow select for authenticated users" ON "public"."rental_insurance_verifications" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow service role access for fines" ON "public"."fines" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Allow service role full access" ON "public"."identity_verifications" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Anyone can delete vehicle photos" ON "public"."vehicle_photos" FOR DELETE USING (true);



CREATE POLICY "Anyone can insert vehicle photos" ON "public"."vehicle_photos" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can read active tenant branding" ON "public"."tenants" FOR SELECT TO "authenticated", "anon" USING (("status" = 'active'::"text"));



CREATE POLICY "Anyone can update vehicle photos" ON "public"."vehicle_photos" FOR UPDATE USING (true);



CREATE POLICY "Anyone can view vehicle photos" ON "public"."vehicle_photos" FOR SELECT USING (true);



CREATE POLICY "Authenticated can insert notifications" ON "public"."notifications" FOR INSERT WITH CHECK (true);



CREATE POLICY "Authenticated users can view email logs" ON "public"."email_logs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Email templates are editable by admins" ON "public"."email_templates" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."app_users"
  WHERE (("app_users"."id" = "auth"."uid"()) AND ("app_users"."role" = ANY (ARRAY['head_admin'::"text", 'admin'::"text"]))))));



CREATE POLICY "Email templates are viewable by authenticated users" ON "public"."email_templates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Enable all operations for authenticated users - reminder_config" ON "public"."reminder_config" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable all operations for authenticated users - reminder_emails" ON "public"."reminder_emails" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable all operations for insurance_documents" ON "public"."insurance_documents" USING (true) WITH CHECK (true);



CREATE POLICY "Enable all operations for insurance_policies" ON "public"."insurance_policies" USING (true) WITH CHECK (true);



CREATE POLICY "System can insert email logs" ON "public"."email_logs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "System can insert notifications" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "System can manage login attempts" ON "public"."login_attempts" USING (true);



CREATE POLICY "Users can delete notifications" ON "public"."notifications" FOR DELETE USING ((("user_id" IN ( SELECT "app_users"."id"
   FROM "public"."app_users"
  WHERE ("app_users"."auth_user_id" = "auth"."uid"()))) OR ("user_id" IS NULL)));



CREATE POLICY "Users can delete their own notifications" ON "public"."notifications" FOR DELETE TO "authenticated" USING ((("user_id" IN ( SELECT "app_users"."id"
   FROM "public"."app_users"
  WHERE ("app_users"."auth_user_id" = "auth"."uid"()))) OR ("user_id" IS NULL)));



CREATE POLICY "Users can update notifications" ON "public"."notifications" FOR UPDATE USING ((("user_id" IN ( SELECT "app_users"."id"
   FROM "public"."app_users"
  WHERE ("app_users"."auth_user_id" = "auth"."uid"()))) OR ("user_id" IS NULL)));



CREATE POLICY "Users can update their own notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING ((("user_id" IN ( SELECT "app_users"."id"
   FROM "public"."app_users"
  WHERE ("app_users"."auth_user_id" = "auth"."uid"()))) OR ("user_id" IS NULL)));



CREATE POLICY "Users can view notifications" ON "public"."notifications" FOR SELECT USING ((("user_id" IN ( SELECT "app_users"."id"
   FROM "public"."app_users"
  WHERE ("app_users"."auth_user_id" = "auth"."uid"()))) OR ("user_id" IS NULL)));



CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((("user_id" IN ( SELECT "app_users"."id"
   FROM "public"."app_users"
  WHERE ("app_users"."auth_user_id" = "auth"."uid"()))) OR ("user_id" IS NULL)));



CREATE POLICY "allow_all_delete" ON "public"."customers" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_delete" ON "public"."fines" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_delete" ON "public"."payments" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_delete" ON "public"."plates" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_delete" ON "public"."rentals" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_delete" ON "public"."vehicles" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_insert" ON "public"."customers" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_insert" ON "public"."fines" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_insert" ON "public"."payments" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_insert" ON "public"."plates" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_insert" ON "public"."rentals" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_insert" ON "public"."vehicles" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_select" ON "public"."customers" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_select" ON "public"."fines" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_select" ON "public"."payments" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_select" ON "public"."plates" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_select" ON "public"."rentals" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_select" ON "public"."vehicles" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



COMMENT ON POLICY "allow_all_select" ON "public"."vehicles" IS 'Permissive policy - allows all authenticated users to view vehicles';



CREATE POLICY "allow_all_tenants_delete" ON "public"."tenants" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_tenants_insert" ON "public"."tenants" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_tenants_select" ON "public"."tenants" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



COMMENT ON POLICY "allow_all_tenants_select" ON "public"."tenants" IS 'Permissive policy - allows all authenticated users to view tenants';



CREATE POLICY "allow_all_tenants_update" ON "public"."tenants" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_update" ON "public"."customers" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_update" ON "public"."fines" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_update" ON "public"."payments" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_update" ON "public"."plates" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_update" ON "public"."rentals" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_all_update" ON "public"."vehicles" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_authenticated_contact_select" ON "public"."contact_requests" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "allow_authenticated_contact_update" ON "public"."contact_requests" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "cms_pages_anon_read_published" ON "public"."cms_pages" FOR SELECT TO "anon" USING ((("status")::"text" = 'published'::"text"));



CREATE POLICY "cms_pages_tenant_delete" ON "public"."cms_pages" FOR DELETE TO "authenticated" USING (("tenant_id" = "public"."get_user_tenant_id"()));



CREATE POLICY "cms_pages_tenant_insert" ON "public"."cms_pages" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = "public"."get_user_tenant_id"()));



CREATE POLICY "cms_pages_tenant_read" ON "public"."cms_pages" FOR SELECT TO "authenticated" USING ((("tenant_id" = "public"."get_user_tenant_id"()) OR ("tenant_id" IS NULL)));



CREATE POLICY "cms_pages_tenant_update" ON "public"."cms_pages" FOR UPDATE TO "authenticated" USING ((("tenant_id" = "public"."get_user_tenant_id"()) OR ("tenant_id" IS NULL))) WITH CHECK ((("tenant_id" = "public"."get_user_tenant_id"()) OR ("tenant_id" IS NULL)));



CREATE POLICY "cms_sections_anon_read" ON "public"."cms_page_sections" FOR SELECT TO "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."cms_pages"
  WHERE (("cms_pages"."id" = "cms_page_sections"."page_id") AND (("cms_pages"."status")::"text" = 'published'::"text")))));



CREATE POLICY "cms_sections_tenant_delete" ON "public"."cms_page_sections" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."cms_pages"
  WHERE (("cms_pages"."id" = "cms_page_sections"."page_id") AND ("cms_pages"."tenant_id" = "public"."get_user_tenant_id"())))));



CREATE POLICY "cms_sections_tenant_insert" ON "public"."cms_page_sections" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."cms_pages"
  WHERE (("cms_pages"."id" = "cms_page_sections"."page_id") AND (("cms_pages"."tenant_id" = "public"."get_user_tenant_id"()) OR ("cms_pages"."tenant_id" IS NULL))))));



CREATE POLICY "cms_sections_tenant_read" ON "public"."cms_page_sections" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."cms_pages"
  WHERE (("cms_pages"."id" = "cms_page_sections"."page_id") AND (("cms_pages"."tenant_id" = "public"."get_user_tenant_id"()) OR ("cms_pages"."tenant_id" IS NULL))))));



CREATE POLICY "cms_sections_tenant_update" ON "public"."cms_page_sections" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."cms_pages"
  WHERE (("cms_pages"."id" = "cms_page_sections"."page_id") AND (("cms_pages"."tenant_id" = "public"."get_user_tenant_id"()) OR ("cms_pages"."tenant_id" IS NULL))))));



ALTER TABLE "public"."global_admin_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "p_audit_read" ON "public"."audit_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."app_users" "au"
  WHERE (("au"."auth_user_id" = "auth"."uid"()) AND ("au"."role" = ANY (ARRAY['admin'::"text", 'head_admin'::"text"])) AND ("au"."is_active" = true)))));



CREATE POLICY "p_update_own_password_flag" ON "public"."app_users" FOR UPDATE TO "authenticated" USING (("auth_user_id" = "auth"."uid"())) WITH CHECK (("auth_user_id" = "auth"."uid"()));



CREATE POLICY "public_contact_insert" ON "public"."contact_requests" FOR INSERT WITH CHECK (true);



CREATE POLICY "public_insert_contact_requests" ON "public"."contact_requests" FOR INSERT WITH CHECK (true);



CREATE POLICY "super_admin_manage_agreement_templates" ON "public"."agreement_templates" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_manage_all" ON "public"."app_users" FOR INSERT WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_manage_all_delete" ON "public"."app_users" FOR DELETE USING ("public"."is_super_admin"());



CREATE POLICY "super_admin_manage_all_update" ON "public"."app_users" FOR UPDATE USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_manage_contact_requests" ON "public"."contact_requests" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_manage_tenants" ON "public"."tenants" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "super_admin_read_all" ON "public"."app_users" FOR SELECT USING ("public"."is_super_admin"());



CREATE POLICY "tenant_isolation_agreement_templates_read" ON "public"."agreement_templates" FOR SELECT USING ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "tenant_isolation_customers" ON "public"."customers" USING ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"())) WITH CHECK ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "tenant_isolation_fines" ON "public"."fines" USING ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"())) WITH CHECK ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "tenant_isolation_invoices" ON "public"."invoices" USING ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"())) WITH CHECK ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "tenant_isolation_ledger_entries" ON "public"."ledger_entries" USING ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"())) WITH CHECK ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "tenant_isolation_payments" ON "public"."payments" USING ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"())) WITH CHECK ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "tenant_isolation_rentals" ON "public"."rentals" USING ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"())) WITH CHECK ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "tenant_isolation_vehicles" ON "public"."vehicles" USING ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"())) WITH CHECK ((("tenant_id" = "public"."get_user_tenant_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "users_read_self" ON "public"."app_users" FOR SELECT USING (("auth"."uid"() = "auth_user_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."plates";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

















































































































































































REVOKE ALL ON FUNCTION "public"."app_login"("p_username" "text", "p_password" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_login"("p_username" "text", "p_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_login"("p_username" "text", "p_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_login"("p_username" "text", "p_password" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_payment"("payment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_payment"("payment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_payment"("payment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_payment_fully"("p_payment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_payment_fully"("p_payment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_payment_fully"("p_payment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_payments_to_charges"("p_rental_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_payments_to_charges"("p_rental_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_payments_to_charges"("p_rental_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."approve_booking_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."approve_booking_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_booking_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."approve_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."approve_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_payment"("p_payment_id" "uuid", "p_approved_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."attach_payments_to_rentals"() TO "anon";
GRANT ALL ON FUNCTION "public"."attach_payments_to_rentals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."attach_payments_to_rentals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_settings_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_settings_changes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_settings_changes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_apply_customer_credit"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_apply_customer_credit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_apply_customer_credit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."backfill_payment_rental_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."backfill_payment_rental_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."backfill_payment_rental_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."backfill_rental_charges_first_month_only"() TO "anon";
GRANT ALL ON FUNCTION "public"."backfill_rental_charges_first_month_only"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."backfill_rental_charges_first_month_only"() TO "service_role";



GRANT ALL ON FUNCTION "public"."backfill_rental_charges_full"() TO "anon";
GRANT ALL ON FUNCTION "public"."backfill_rental_charges_full"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."backfill_rental_charges_full"() TO "service_role";



GRANT ALL ON FUNCTION "public"."block_customer"("p_customer_id" "uuid", "p_reason" "text", "p_blocked_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."block_customer"("p_customer_id" "uuid", "p_reason" "text", "p_blocked_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."block_customer"("p_customer_id" "uuid", "p_reason" "text", "p_blocked_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_vehicle_book_cost"("p_vehicle_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_vehicle_book_cost"("p_vehicle_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_vehicle_book_cost"("p_vehicle_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_policy_overlap"("p_customer_id" "uuid", "p_vehicle_id" "uuid", "p_start_date" "date", "p_expiry_date" "date", "p_policy_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_policy_overlap"("p_customer_id" "uuid", "p_vehicle_id" "uuid", "p_start_date" "date", "p_expiry_date" "date", "p_policy_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_policy_overlap"("p_customer_id" "uuid", "p_vehicle_id" "uuid", "p_start_date" "date", "p_expiry_date" "date", "p_policy_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_rental_charges"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_rental_charges"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_rental_charges"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_vehicle_pl"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_vehicle_pl"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_vehicle_pl"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_rental_cascade"("rental_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_rental_cascade"("rental_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_rental_cascade"("rental_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."dispose_vehicle"("p_vehicle_id" "uuid", "p_disposal_date" "date", "p_sale_proceeds" numeric, "p_buyer" "text", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."dispose_vehicle"("p_vehicle_id" "uuid", "p_disposal_date" "date", "p_sale_proceeds" numeric, "p_buyer" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dispose_vehicle"("p_vehicle_id" "uuid", "p_disposal_date" "date", "p_sale_proceeds" numeric, "p_buyer" "text", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fine_void_charge"("f_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fine_void_charge"("f_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fine_void_charge"("f_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_daily_reminders"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_daily_reminders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_daily_reminders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_first_charge_for_rental"("rental_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_first_charge_for_rental"("rental_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_first_charge_for_rental"("rental_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_monthly_charges"("rental_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_monthly_charges"("rental_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_monthly_charges"("rental_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_next_rental_charge"("r_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_next_rental_charge"("r_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_next_rental_charge"("r_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_rental_charges"("r_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_rental_charges"("r_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_rental_charges"("r_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_rental_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_rental_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_rental_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_current_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_customer_balance_with_status"("customer_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_customer_balance_with_status"("customer_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_balance_with_status"("customer_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_customer_credit"("customer_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_customer_credit"("customer_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_credit"("customer_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_customer_net_position"("customer_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_customer_net_position"("customer_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_net_position"("customer_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_customer_statement"("p_customer_id" "uuid", "p_from_date" "date", "p_to_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_customer_statement"("p_customer_id" "uuid", "p_from_date" "date", "p_to_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_customer_statement"("p_customer_id" "uuid", "p_from_date" "date", "p_to_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_effective_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_effective_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_effective_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_expiring_bookings"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_expiring_bookings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_expiring_bookings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_payment_remaining"("payment_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_payment_remaining"("payment_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_payment_remaining"("payment_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_pending_bookings_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_pending_bookings_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pending_bookings_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_pending_charges_for_reminders"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_pending_charges_for_reminders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pending_charges_for_reminders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_pending_payments_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_pending_payments_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_pending_payments_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_refunds_due_today"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_refunds_due_today"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_refunds_due_today"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_rental_credit"("rental_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_rental_credit"("rental_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rental_credit"("rental_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_rental_insurance_documents"("p_rental_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_rental_insurance_documents"("p_rental_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rental_insurance_documents"("p_rental_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role"("user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role"("user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_vehicle_expense_pnl"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_vehicle_expense_pnl"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_vehicle_expense_pnl"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_any_role"("_user_id" "uuid", "_roles" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."has_any_role"("_user_id" "uuid", "_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_any_role"("_user_id" "uuid", "_roles" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_upfront_finance_entry"("v_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_upfront_finance_entry"("v_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_upfront_finance_entry"("v_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."hash_password"("password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hash_password"("password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hash_password"("password" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_current_user_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_current_user_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_current_user_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_global_master_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_global_master_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_global_master_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_identity_blocked"("p_identity_number" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_identity_blocked"("p_identity_number" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_identity_blocked"("p_identity_number" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_primary_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_primary_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_primary_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_vehicle_file_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_vehicle_file_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_vehicle_file_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."payment_apply_fifo"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."payment_apply_fifo"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."payment_apply_fifo"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."payment_apply_fifo_v2"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."payment_apply_fifo_v2"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."payment_apply_fifo_v2"("p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."payment_auto_apply_due_credit"() TO "anon";
GRANT ALL ON FUNCTION "public"."payment_auto_apply_due_credit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."payment_auto_apply_due_credit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."pnl_post_acquisition"("v_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."pnl_post_acquisition"("v_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pnl_post_acquisition"("v_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."process_payment_transaction"("p_payment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."process_payment_transaction"("p_payment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_payment_transaction"("p_payment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."process_payment_transaction"("p_payment_id" "uuid", "p_customer_id" "uuid", "p_rental_id" "uuid", "p_vehicle_id" "uuid", "p_amount" numeric, "p_payment_type" "text", "p_payment_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."process_payment_transaction"("p_payment_id" "uuid", "p_customer_id" "uuid", "p_rental_id" "uuid", "p_vehicle_id" "uuid", "p_amount" numeric, "p_payment_type" "text", "p_payment_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_payment_transaction"("p_payment_id" "uuid", "p_customer_id" "uuid", "p_rental_id" "uuid", "p_vehicle_id" "uuid", "p_amount" numeric, "p_payment_type" "text", "p_payment_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."reapply_all_payments"() TO "anon";
GRANT ALL ON FUNCTION "public"."reapply_all_payments"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reapply_all_payments"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reapply_all_payments_v2"() TO "anon";
GRANT ALL ON FUNCTION "public"."reapply_all_payments_v2"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reapply_all_payments_v2"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_insurance_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_insurance_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_insurance_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_vehicle_pl"("p_vehicle_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_vehicle_pl"("p_vehicle_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_vehicle_pl"("p_vehicle_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_payment"("p_customer" "uuid", "p_vehicle" "uuid", "p_rental" "uuid", "p_amount" numeric, "p_type" "text", "p_method" "text", "p_payment_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."record_payment"("p_customer" "uuid", "p_vehicle" "uuid", "p_rental" "uuid", "p_amount" numeric, "p_type" "text", "p_method" "text", "p_payment_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_payment"("p_customer" "uuid", "p_vehicle" "uuid", "p_rental" "uuid", "p_amount" numeric, "p_type" "text", "p_method" "text", "p_payment_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_booking_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reject_booking_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_booking_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reject_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_payment"("p_payment_id" "uuid", "p_rejected_by" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rental_create_charge"("r_id" "uuid", "due" "date", "amt" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."rental_create_charge"("r_id" "uuid", "due" "date", "amt" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rental_create_charge"("r_id" "uuid", "due" "date", "amt" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_apply_payment_on_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_apply_payment_on_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_apply_payment_on_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_apply_payments_on_charge"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_apply_payments_on_charge"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_apply_payments_on_charge"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_apply_payments_on_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_apply_payments_on_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_apply_payments_on_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_auto_allocate_payments"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_auto_allocate_payments"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_auto_allocate_payments"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_create_fine_charge"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_create_fine_charge"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_create_fine_charge"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_generate_rental_charges"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_generate_rental_charges"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_generate_rental_charges"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_post_acquisition"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_post_acquisition"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_post_acquisition"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_update_plate_pnl"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_update_plate_pnl"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_update_plate_pnl"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_update_vehicle_last_service"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_update_vehicle_last_service"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_update_vehicle_last_service"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unblock_customer"("p_customer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unblock_customer"("p_customer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unblock_customer"("p_customer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."undo_vehicle_disposal"("p_vehicle_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."undo_vehicle_disposal"("p_vehicle_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."undo_vehicle_disposal"("p_vehicle_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_agreement_templates_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_agreement_templates_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_agreement_templates_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_cms_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_cms_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_cms_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_balance"("customer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_balance"("customer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_balance"("customer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_customer_documents_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_customer_documents_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer_documents_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_email_template_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_email_template_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_email_template_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_identity_verifications_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_identity_verifications_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_identity_verifications_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_insurance_docs_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_insurance_docs_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_insurance_docs_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_insurance_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_insurance_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_insurance_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_leads_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_leads_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_leads_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_plates_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_plates_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_plates_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_protection_plans_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_protection_plans_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_protection_plans_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_refund_status"("p_payment_id" "uuid", "p_new_status" "text", "p_stripe_refund_id" "text", "p_error_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_refund_status"("p_payment_id" "uuid", "p_new_status" "text", "p_stripe_refund_id" "text", "p_error_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_refund_status"("p_payment_id" "uuid", "p_new_status" "text", "p_stripe_refund_id" "text", "p_error_message" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_reminders_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_reminders_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_reminders_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_rental_insurance_verifications_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_rental_insurance_verifications_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_rental_insurance_verifications_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_rental_key_handovers_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_rental_key_handovers_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_rental_key_handovers_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_vehicle_last_service"("p_vehicle_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_vehicle_last_service"("p_vehicle_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_vehicle_last_service"("p_vehicle_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_vehicle_status_on_rental_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_vehicle_status_on_rental_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_vehicle_status_on_rental_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_plate_pnl_entry"("p_plate_id" "uuid", "p_cost" numeric, "p_order_date" "date", "p_vehicle_id" "uuid", "p_created_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_plate_pnl_entry"("p_plate_id" "uuid", "p_cost" numeric, "p_order_date" "date", "p_vehicle_id" "uuid", "p_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_plate_pnl_entry"("p_plate_id" "uuid", "p_cost" numeric, "p_order_date" "date", "p_vehicle_id" "uuid", "p_created_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_service_pnl_entry"("p_service_record_id" "uuid", "p_cost" numeric, "p_service_date" "date", "p_vehicle_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_service_pnl_entry"("p_service_record_id" "uuid", "p_cost" numeric, "p_service_date" "date", "p_vehicle_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_service_pnl_entry"("p_service_record_id" "uuid", "p_cost" numeric, "p_service_date" "date", "p_vehicle_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_global_master_password"("p_email" "text", "p_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_global_master_password"("p_email" "text", "p_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_global_master_password"("p_email" "text", "p_password" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_password"("stored_hash" "text", "provided_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_password"("stored_hash" "text", "provided_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_password"("stored_hash" "text", "provided_password" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."agreement_templates" TO "anon";
GRANT ALL ON TABLE "public"."agreement_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."agreement_templates" TO "service_role";



GRANT ALL ON TABLE "public"."app_users" TO "anon";
GRANT ALL ON TABLE "public"."app_users" TO "authenticated";
GRANT ALL ON TABLE "public"."app_users" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."authority_payments" TO "anon";
GRANT ALL ON TABLE "public"."authority_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."authority_payments" TO "service_role";



GRANT ALL ON TABLE "public"."blocked_dates" TO "anon";
GRANT ALL ON TABLE "public"."blocked_dates" TO "authenticated";
GRANT ALL ON TABLE "public"."blocked_dates" TO "service_role";



GRANT ALL ON TABLE "public"."blocked_identities" TO "anon";
GRANT ALL ON TABLE "public"."blocked_identities" TO "authenticated";
GRANT ALL ON TABLE "public"."blocked_identities" TO "service_role";



GRANT ALL ON TABLE "public"."cms_media" TO "anon";
GRANT ALL ON TABLE "public"."cms_media" TO "authenticated";
GRANT ALL ON TABLE "public"."cms_media" TO "service_role";



GRANT ALL ON TABLE "public"."cms_page_sections" TO "anon";
GRANT ALL ON TABLE "public"."cms_page_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."cms_page_sections" TO "service_role";



GRANT ALL ON TABLE "public"."cms_page_versions" TO "anon";
GRANT ALL ON TABLE "public"."cms_page_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."cms_page_versions" TO "service_role";



GRANT ALL ON TABLE "public"."cms_pages" TO "anon";
GRANT ALL ON TABLE "public"."cms_pages" TO "authenticated";
GRANT ALL ON TABLE "public"."cms_pages" TO "service_role";



GRANT ALL ON TABLE "public"."contact_requests" TO "anon";
GRANT ALL ON TABLE "public"."contact_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_requests" TO "service_role";



GRANT ALL ON TABLE "public"."customer_documents" TO "anon";
GRANT ALL ON TABLE "public"."customer_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_documents" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."email_logs" TO "anon";
GRANT ALL ON TABLE "public"."email_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."email_logs" TO "service_role";



GRANT ALL ON TABLE "public"."email_templates" TO "anon";
GRANT ALL ON TABLE "public"."email_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."email_templates" TO "service_role";



GRANT ALL ON TABLE "public"."faqs" TO "anon";
GRANT ALL ON TABLE "public"."faqs" TO "authenticated";
GRANT ALL ON TABLE "public"."faqs" TO "service_role";



GRANT ALL ON TABLE "public"."fine_files" TO "anon";
GRANT ALL ON TABLE "public"."fine_files" TO "authenticated";
GRANT ALL ON TABLE "public"."fine_files" TO "service_role";



GRANT ALL ON TABLE "public"."fines" TO "anon";
GRANT ALL ON TABLE "public"."fines" TO "authenticated";
GRANT ALL ON TABLE "public"."fines" TO "service_role";



GRANT ALL ON TABLE "public"."global_admin_config" TO "anon";
GRANT ALL ON TABLE "public"."global_admin_config" TO "authenticated";
GRANT ALL ON TABLE "public"."global_admin_config" TO "service_role";



GRANT ALL ON TABLE "public"."identity_verifications" TO "anon";
GRANT ALL ON TABLE "public"."identity_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."identity_verifications" TO "service_role";



GRANT ALL ON TABLE "public"."insurance_documents" TO "anon";
GRANT ALL ON TABLE "public"."insurance_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."insurance_documents" TO "service_role";



GRANT ALL ON TABLE "public"."insurance_policies" TO "anon";
GRANT ALL ON TABLE "public"."insurance_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."insurance_policies" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."ledger_entries" TO "anon";
GRANT ALL ON TABLE "public"."ledger_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."ledger_entries" TO "service_role";



GRANT ALL ON TABLE "public"."login_attempts" TO "anon";
GRANT ALL ON TABLE "public"."login_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."login_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."maintenance_runs" TO "anon";
GRANT ALL ON TABLE "public"."maintenance_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_runs" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."org_settings" TO "anon";
GRANT ALL ON TABLE "public"."org_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."org_settings" TO "service_role";



GRANT ALL ON TABLE "public"."payment_applications" TO "anon";
GRANT ALL ON TABLE "public"."payment_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_applications" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."plates" TO "anon";
GRANT ALL ON TABLE "public"."plates" TO "authenticated";
GRANT ALL ON TABLE "public"."plates" TO "service_role";



GRANT ALL ON TABLE "public"."pnl_entries" TO "anon";
GRANT ALL ON TABLE "public"."pnl_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."pnl_entries" TO "service_role";



GRANT ALL ON TABLE "public"."promotions" TO "anon";
GRANT ALL ON TABLE "public"."promotions" TO "authenticated";
GRANT ALL ON TABLE "public"."promotions" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_actions" TO "anon";
GRANT ALL ON TABLE "public"."reminder_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_actions" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_config" TO "anon";
GRANT ALL ON TABLE "public"."reminder_config" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_config" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_emails" TO "anon";
GRANT ALL ON TABLE "public"."reminder_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_emails" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_events" TO "anon";
GRANT ALL ON TABLE "public"."reminder_events" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_events" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_logs" TO "anon";
GRANT ALL ON TABLE "public"."reminder_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_logs" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_rules" TO "anon";
GRANT ALL ON TABLE "public"."reminder_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_rules" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_settings" TO "anon";
GRANT ALL ON TABLE "public"."reminder_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_settings" TO "service_role";



GRANT ALL ON TABLE "public"."reminders" TO "anon";
GRANT ALL ON TABLE "public"."reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."reminders" TO "service_role";



GRANT ALL ON TABLE "public"."rental_handover_photos" TO "anon";
GRANT ALL ON TABLE "public"."rental_handover_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."rental_handover_photos" TO "service_role";



GRANT ALL ON TABLE "public"."rental_insurance_verifications" TO "anon";
GRANT ALL ON TABLE "public"."rental_insurance_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."rental_insurance_verifications" TO "service_role";



GRANT ALL ON TABLE "public"."rental_key_handovers" TO "anon";
GRANT ALL ON TABLE "public"."rental_key_handovers" TO "authenticated";
GRANT ALL ON TABLE "public"."rental_key_handovers" TO "service_role";



GRANT ALL ON TABLE "public"."rentals" TO "anon";
GRANT ALL ON TABLE "public"."rentals" TO "authenticated";
GRANT ALL ON TABLE "public"."rentals" TO "service_role";



GRANT ALL ON TABLE "public"."service_records" TO "anon";
GRANT ALL ON TABLE "public"."service_records" TO "authenticated";
GRANT ALL ON TABLE "public"."service_records" TO "service_role";



GRANT ALL ON TABLE "public"."settings_audit" TO "anon";
GRANT ALL ON TABLE "public"."settings_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."settings_audit" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."testimonials" TO "anon";
GRANT ALL ON TABLE "public"."testimonials" TO "authenticated";
GRANT ALL ON TABLE "public"."testimonials" TO "service_role";



GRANT ALL ON TABLE "public"."v_customer_credit" TO "anon";
GRANT ALL ON TABLE "public"."v_customer_credit" TO "authenticated";
GRANT ALL ON TABLE "public"."v_customer_credit" TO "service_role";



GRANT ALL ON TABLE "public"."v_payment_remaining" TO "anon";
GRANT ALL ON TABLE "public"."v_payment_remaining" TO "authenticated";
GRANT ALL ON TABLE "public"."v_payment_remaining" TO "service_role";



GRANT ALL ON TABLE "public"."v_rental_credit" TO "anon";
GRANT ALL ON TABLE "public"."v_rental_credit" TO "authenticated";
GRANT ALL ON TABLE "public"."v_rental_credit" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_events" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_events" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_events" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_expenses" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_expenses" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_files" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_files" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_files" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_photos" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_photos" TO "service_role";



GRANT ALL ON TABLE "public"."vehicles" TO "anon";
GRANT ALL ON TABLE "public"."vehicles" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicles" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_pnl_rollup" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_pnl_rollup" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_pnl_rollup" TO "service_role";



GRANT ALL ON TABLE "public"."view_aging_receivables" TO "anon";
GRANT ALL ON TABLE "public"."view_aging_receivables" TO "authenticated";
GRANT ALL ON TABLE "public"."view_aging_receivables" TO "service_role";



GRANT ALL ON TABLE "public"."view_customer_statements" TO "anon";
GRANT ALL ON TABLE "public"."view_customer_statements" TO "authenticated";
GRANT ALL ON TABLE "public"."view_customer_statements" TO "service_role";



GRANT ALL ON TABLE "public"."view_fines_export" TO "anon";
GRANT ALL ON TABLE "public"."view_fines_export" TO "authenticated";
GRANT ALL ON TABLE "public"."view_fines_export" TO "service_role";



GRANT ALL ON TABLE "public"."view_payments_export" TO "anon";
GRANT ALL ON TABLE "public"."view_payments_export" TO "authenticated";
GRANT ALL ON TABLE "public"."view_payments_export" TO "service_role";



GRANT ALL ON TABLE "public"."view_pl_by_vehicle" TO "anon";
GRANT ALL ON TABLE "public"."view_pl_by_vehicle" TO "authenticated";
GRANT ALL ON TABLE "public"."view_pl_by_vehicle" TO "service_role";



GRANT ALL ON TABLE "public"."view_pl_consolidated" TO "anon";
GRANT ALL ON TABLE "public"."view_pl_consolidated" TO "authenticated";
GRANT ALL ON TABLE "public"."view_pl_consolidated" TO "service_role";



GRANT ALL ON TABLE "public"."view_rentals_export" TO "anon";
GRANT ALL ON TABLE "public"."view_rentals_export" TO "authenticated";
GRANT ALL ON TABLE "public"."view_rentals_export" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































