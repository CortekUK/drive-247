-- ============================================================================
-- FIX: RLS Policy Violation on rag_sync_queue Table
-- ============================================================================
-- Problem: When authenticated users create/update/delete records in tables with
-- RAG triggers (rentals, customers, vehicles, etc.), the queue_for_rag() trigger
-- function fails with "new row violates row-level security policy for table
-- rag_sync_queue" because:
--   1. The trigger function executes with the caller's privileges (authenticated user)
--   2. The rag_sync_queue table's RLS policy only allows service_role to INSERT
--
-- Solution: Add SECURITY DEFINER to the queue_for_rag() function so it executes
-- with the privileges of the function owner (postgres/superuser), bypassing RLS.
-- This is safe because:
--   1. The function only inserts into rag_sync_queue (an internal processing queue)
--   2. The tenant_id is always taken from the triggering record (cannot be spoofed)
--   3. No sensitive data is exposed or modified
-- ============================================================================

-- Recreate the queue_for_rag function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION queue_for_rag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- Execute with owner privileges to bypass RLS
SET search_path = public  -- Security best practice for SECURITY DEFINER functions
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Get tenant_id from the record (all our tables have tenant_id)
    IF TG_OP = 'DELETE' THEN
        v_tenant_id := OLD.tenant_id;
        INSERT INTO rag_sync_queue (tenant_id, source_table, source_id, action)
        VALUES (v_tenant_id, TG_TABLE_NAME, OLD.id::TEXT, 'DELETE');
        RETURN OLD;
    ELSE
        v_tenant_id := NEW.tenant_id;
        INSERT INTO rag_sync_queue (tenant_id, source_table, source_id, action)
        VALUES (v_tenant_id, TG_TABLE_NAME, NEW.id::TEXT, TG_OP);
        RETURN NEW;
    END IF;
END;
$$;

-- Grant execute permission to authenticated users (triggers need this)
GRANT EXECUTE ON FUNCTION queue_for_rag() TO authenticated;

-- Note: The existing triggers (customers_rag_trigger, vehicles_rag_trigger,
-- rentals_rag_trigger, payments_rag_trigger, fines_rag_trigger, plates_rag_trigger)
-- will automatically use the updated function - no need to recreate them.
