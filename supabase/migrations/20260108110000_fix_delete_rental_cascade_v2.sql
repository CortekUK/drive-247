-- Fix delete_rental_cascade - rental_handover_photos uses handover_id, not rental_id

CREATE OR REPLACE FUNCTION "public"."delete_rental_cascade"("rental_uuid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  v_vehicle_id UUID;
  v_status TEXT;
BEGIN
  -- Get the vehicle_id and status before deleting
  SELECT vehicle_id, status INTO v_vehicle_id, v_status
  FROM rentals
  WHERE id = rental_uuid;

  -- If rental doesn't exist, just return
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Delete in correct dependency order to avoid FK violations
  -- Order matters! Delete child tables before parent tables.

  -- 1. First handle payment_applications (references payments)
  DELETE FROM payment_applications
  WHERE payment_id IN (SELECT id FROM payments WHERE rental_id = rental_uuid);

  -- 2. Delete ledger_entries (references both rentals AND payments)
  -- Must be before payments deletion due to fk_ledger_entries_payment_id
  DELETE FROM ledger_entries WHERE rental_id = rental_uuid;

  -- 3. Now safe to delete payments
  DELETE FROM payments WHERE rental_id = rental_uuid;

  -- 4. Delete other rental-related tables
  DELETE FROM invoices WHERE rental_id = rental_uuid;
  DELETE FROM fines WHERE rental_id = rental_uuid;
  DELETE FROM reminders WHERE rental_id = rental_uuid;

  -- rental_handover_photos references rental_key_handovers via handover_id, not rental_id
  DELETE FROM rental_handover_photos
  WHERE handover_id IN (SELECT id FROM rental_key_handovers WHERE rental_id = rental_uuid);

  DELETE FROM rental_key_handovers WHERE rental_id = rental_uuid;
  DELETE FROM rental_insurance_verifications WHERE rental_id = rental_uuid;

  -- Delete protection selections if table exists
  BEGIN
    DELETE FROM rental_protection_selections WHERE rental_id = rental_uuid;
  EXCEPTION WHEN undefined_table THEN
    -- Table doesn't exist, skip
  END;

  -- Delete customer_documents linked to this rental
  DELETE FROM customer_documents WHERE rental_id = rental_uuid;

  -- 5. Finally, delete the rental itself
  DELETE FROM rentals WHERE id = rental_uuid;

  -- 6. Update vehicle status to Available if the rental was Active
  IF v_status = 'Active' AND v_vehicle_id IS NOT NULL THEN
    UPDATE vehicles SET status = 'Available' WHERE id = v_vehicle_id;
  END IF;
END;
$_$;
