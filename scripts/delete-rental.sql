-- =====================================================
-- Script to Delete a Rental Company (Tenant)
-- =====================================================
-- WARNING: This is a DESTRUCTIVE operation!
-- This will delete ALL data associated with the tenant:
-- - The tenant record
-- - All users (app_users)
-- - All vehicles
-- - All customers
-- - All rentals
-- - All payments
-- - All bookings
-- - ALL related data

-- =====================================================
-- SAFETY CHECKS BEFORE RUNNING
-- =====================================================
-- 1. Make sure you have a backup
-- 2. Verify the tenant slug is correct
-- 3. Get confirmation from authorized personnel
-- 4. Consider "suspending" instead of deleting (safer option)

-- =====================================================
-- Option 1: SOFT DELETE (RECOMMENDED) - Suspend Tenant
-- =====================================================
-- This keeps all data but marks the tenant as suspended
-- Users cannot login, but data is preserved

UPDATE tenants
SET status = 'suspended', updated_at = now()
WHERE slug = 'demo-rental';  -- Change this to the slug you want to suspend

-- To reactivate later:
-- UPDATE tenants SET status = 'active', updated_at = now() WHERE slug = 'demo-rental';

-- =====================================================
-- Option 2: HARD DELETE (DANGEROUS) - Permanently Delete Tenant
-- =====================================================
-- ONLY use this if you're absolutely sure you want to delete ALL data

-- Step 1: First, get the tenant_id to verify before deletion
SELECT id, slug, company_name, status, created_at
FROM tenants
WHERE slug = 'demo-rental';  -- CHANGE THIS to the slug you want to delete

-- Step 2: Delete ALL related data (in correct order to respect foreign keys)

-- Get tenant ID (replace this with actual ID from Step 1)
DO $$
DECLARE
    target_tenant_id UUID;
BEGIN
    -- Get the tenant ID
    SELECT id INTO target_tenant_id
    FROM tenants
    WHERE slug = 'demo-rental';  -- CHANGE THIS

    IF target_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant not found with slug: demo-rental';
    END IF;

    -- Log what we're about to delete
    RAISE NOTICE 'About to delete tenant: % (ID: %)', 'demo-rental', target_tenant_id;

    -- Delete data in order (respecting foreign key constraints)

    -- 1. Delete payment items (child of payments)
    DELETE FROM payment_items WHERE payment_id IN (
        SELECT id FROM payments WHERE tenant_id = target_tenant_id
    );
    RAISE NOTICE 'Deleted payment_items';

    -- 2. Delete charges
    DELETE FROM charges WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted charges';

    -- 3. Delete payments
    DELETE FROM payments WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted payments';

    -- 4. Delete rental extensions
    DELETE FROM rental_extensions WHERE rental_id IN (
        SELECT id FROM rentals WHERE tenant_id = target_tenant_id
    );
    RAISE NOTICE 'Deleted rental_extensions';

    -- 5. Delete rental vehicle assignments
    DELETE FROM rental_vehicles WHERE rental_id IN (
        SELECT id FROM rentals WHERE tenant_id = target_tenant_id
    );
    RAISE NOTICE 'Deleted rental_vehicles';

    -- 6. Delete rentals
    DELETE FROM rentals WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted rentals';

    -- 7. Delete bookings
    DELETE FROM bookings WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted bookings';

    -- 8. Delete invoices
    DELETE FROM invoices WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted invoices';

    -- 9. Delete fines
    DELETE FROM fines WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted fines';

    -- 10. Delete vehicle files
    DELETE FROM vehicle_files WHERE vehicle_id IN (
        SELECT id FROM vehicles WHERE tenant_id = target_tenant_id
    );
    RAISE NOTICE 'Deleted vehicle_files';

    -- 11. Delete vehicles
    DELETE FROM vehicles WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted vehicles';

    -- 12. Delete customer audit logs
    DELETE FROM customer_audit_logs WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted customer_audit_logs';

    -- 13. Delete customers
    DELETE FROM customers WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted customers';

    -- 14. Delete blocked dates
    DELETE FROM blocked_dates WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted blocked_dates';

    -- 15. Delete insurance records
    DELETE FROM insurance WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted insurance';

    -- 16. Delete plates
    DELETE FROM plates WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted plates';

    -- 17. Delete reminders
    DELETE FROM reminders WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted reminders';

    -- 18. Delete testimonials
    DELETE FROM testimonials WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted testimonials';

    -- 19. Delete audit logs
    DELETE FROM audit_logs WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted audit_logs';

    -- 20. Delete app users (portal users)
    DELETE FROM app_users WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Deleted app_users';

    -- 21. Finally, delete the tenant itself
    DELETE FROM tenants WHERE id = target_tenant_id;
    RAISE NOTICE 'Deleted tenant record';

    RAISE NOTICE 'Tenant deletion completed successfully';
END $$;

-- =====================================================
-- Verification: Check tenant was deleted
-- =====================================================
SELECT * FROM tenants WHERE slug = 'demo-rental';
-- Should return 0 rows if deletion was successful

-- =====================================================
-- Quick Delete by Slug (Single Command)
-- =====================================================
-- Use this if you want a simple one-liner to delete by slug
-- WARNING: Still destructive!

/*
DELETE FROM tenants WHERE slug = 'demo-rental';
-- This will CASCADE delete all related data if CASCADE is configured
-- Otherwise, run the detailed deletion script above
*/
