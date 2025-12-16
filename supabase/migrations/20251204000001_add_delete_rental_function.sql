-- Drop the old function if it exists
DROP FUNCTION IF EXISTS delete_rental_cascade(UUID);

-- Create a robust function that ONLY deletes from tables with FK to rentals
-- Uses dynamic SQL to find all related tables automatically
CREATE OR REPLACE FUNCTION delete_rental_cascade(rental_uuid UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION delete_rental_cascade(UUID) TO authenticated;
