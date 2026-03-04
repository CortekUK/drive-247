-- Comprehensive get_rag_metrics covering all portal tabs
-- Uses LOWER() for case-insensitive status matching
-- Split into multiple jsonb_build_object calls to avoid 100-arg limit

CREATE OR REPLACE FUNCTION get_rag_metrics(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    customers_metrics JSONB;
    vehicles_metrics JSONB;
    rentals_metrics JSONB;
    payments_metrics JSONB;
    fines_metrics JSONB;
    financial_metrics JSONB;
    other_metrics JSONB;
BEGIN
    -- CUSTOMERS
    SELECT jsonb_build_object(
        'total_customers', (SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id),
        'active_customers', (SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id AND LOWER(status) = 'active'),
        'inactive_customers', (SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id AND LOWER(status) = 'inactive'),
        'gig_driver_customers', (SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id AND is_gig_driver = true),
        'blocked_customers', (SELECT COUNT(*) FROM blocked_identities WHERE tenant_id = p_tenant_id)
    ) INTO customers_metrics;

    -- VEHICLES
    SELECT jsonb_build_object(
        'total_vehicles', (SELECT COUNT(*) FROM vehicles WHERE tenant_id = p_tenant_id),
        'available_vehicles', (SELECT COUNT(*) FROM vehicles WHERE tenant_id = p_tenant_id AND LOWER(status) = 'available'),
        'rented_vehicles', (SELECT COUNT(*) FROM vehicles WHERE tenant_id = p_tenant_id AND LOWER(status) = 'rented'),
        'maintenance_vehicles', (SELECT COUNT(*) FROM vehicles WHERE tenant_id = p_tenant_id AND LOWER(status) = 'maintenance'),
        'disposed_vehicles', (SELECT COUNT(*) FROM vehicles WHERE tenant_id = p_tenant_id AND LOWER(status) IN ('sold', 'disposed')),
        'total_fleet_value', (SELECT COALESCE(SUM(purchase_price), 0) FROM vehicles WHERE tenant_id = p_tenant_id),
        'vehicles_by_make', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', make, 'value', cnt) ORDER BY cnt DESC), '[]'::jsonb) FROM (SELECT make, COUNT(*) as cnt FROM vehicles WHERE tenant_id = p_tenant_id GROUP BY make) sub)
    ) INTO vehicles_metrics;

    -- RENTALS
    SELECT jsonb_build_object(
        'total_rentals', (SELECT COUNT(*) FROM rentals WHERE tenant_id = p_tenant_id),
        'active_rentals', (SELECT COUNT(*) FROM rentals WHERE tenant_id = p_tenant_id AND LOWER(status) = 'active'),
        'pending_rentals', (SELECT COUNT(*) FROM rentals WHERE tenant_id = p_tenant_id AND LOWER(status) = 'pending'),
        'closed_rentals', (SELECT COUNT(*) FROM rentals WHERE tenant_id = p_tenant_id AND LOWER(status) = 'closed'),
        'cancelled_rentals', (SELECT COUNT(*) FROM rentals WHERE tenant_id = p_tenant_id AND LOWER(status) = 'cancelled'),
        'completed_rentals', (SELECT COUNT(*) FROM rentals WHERE tenant_id = p_tenant_id AND LOWER(status) IN ('closed', 'completed')),
        'gig_driver_rentals', (SELECT COUNT(*) FROM rentals WHERE tenant_id = p_tenant_id AND is_gig_driver = true),
        'lockbox_rentals', (SELECT COUNT(*) FROM rentals WHERE tenant_id = p_tenant_id AND LOWER(delivery_method) = 'lockbox'),
        'rentals_by_status', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', status, 'value', cnt) ORDER BY cnt DESC), '[]'::jsonb) FROM (SELECT status, COUNT(*) as cnt FROM rentals WHERE tenant_id = p_tenant_id GROUP BY status) sub)
    ) INTO rentals_metrics;

    -- PAYMENTS
    SELECT jsonb_build_object(
        'total_payments_count', (SELECT COUNT(*) FROM payments WHERE tenant_id = p_tenant_id),
        'total_payments_amount', (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE tenant_id = p_tenant_id),
        'pending_payments', (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE tenant_id = p_tenant_id AND LOWER(status) = 'pending'),
        'pending_payments_count', (SELECT COUNT(*) FROM payments WHERE tenant_id = p_tenant_id AND LOWER(status) = 'pending'),
        'completed_payments_amount', (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE tenant_id = p_tenant_id AND LOWER(status) IN ('applied', 'completed')),
        'refunded_payments_amount', (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE tenant_id = p_tenant_id AND LOWER(status) = 'refunded'),
        'refunded_payments_count', (SELECT COUNT(*) FROM payments WHERE tenant_id = p_tenant_id AND LOWER(status) = 'refunded'),
        'payments_by_status', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', status, 'value', cnt) ORDER BY cnt DESC), '[]'::jsonb) FROM (SELECT status, COUNT(*) as cnt FROM payments WHERE tenant_id = p_tenant_id GROUP BY status) sub)
    ) INTO payments_metrics;

    -- FINES + INVOICES
    SELECT jsonb_build_object(
        'total_fines', (SELECT COUNT(*) FROM fines WHERE tenant_id = p_tenant_id),
        'paid_fines', (SELECT COUNT(*) FROM fines WHERE tenant_id = p_tenant_id AND LOWER(status) = 'paid'),
        'unpaid_fines', (SELECT COUNT(*) FROM fines WHERE tenant_id = p_tenant_id AND LOWER(status) NOT IN ('paid', 'waived')),
        'waived_fines', (SELECT COUNT(*) FROM fines WHERE tenant_id = p_tenant_id AND LOWER(status) = 'waived'),
        'total_fine_amount', (SELECT COALESCE(SUM(amount), 0) FROM fines WHERE tenant_id = p_tenant_id),
        'unpaid_fine_amount', (SELECT COALESCE(SUM(amount), 0) FROM fines WHERE tenant_id = p_tenant_id AND LOWER(status) NOT IN ('paid', 'waived')),
        'fines_by_status', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', status, 'value', cnt) ORDER BY cnt DESC), '[]'::jsonb) FROM (SELECT status, COUNT(*) as cnt FROM fines WHERE tenant_id = p_tenant_id GROUP BY status) sub),
        'total_invoices', (SELECT COUNT(*) FROM invoices WHERE tenant_id = p_tenant_id),
        'pending_invoices', (SELECT COUNT(*) FROM invoices WHERE tenant_id = p_tenant_id AND LOWER(status) = 'pending'),
        'total_invoiced_amount', (SELECT COALESCE(SUM(total_amount), 0) FROM invoices WHERE tenant_id = p_tenant_id),
        'pending_invoiced_amount', (SELECT COALESCE(SUM(total_amount), 0) FROM invoices WHERE tenant_id = p_tenant_id AND LOWER(status) = 'pending')
    ) INTO fines_metrics;

    -- P&L / LEDGER / EXPENSES
    SELECT jsonb_build_object(
        'total_revenue', (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE tenant_id = p_tenant_id AND LOWER(type) = 'charge'),
        'total_collected', (SELECT COALESCE(SUM(ABS(amount)), 0) FROM ledger_entries WHERE tenant_id = p_tenant_id AND LOWER(type) = 'payment'),
        'total_refunds', (SELECT COALESCE(SUM(ABS(amount)), 0) FROM ledger_entries WHERE tenant_id = p_tenant_id AND LOWER(type) = 'refund'),
        'outstanding_balance', (SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE tenant_id = p_tenant_id),
        'revenue_by_category', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', category, 'value', total) ORDER BY total DESC), '[]'::jsonb) FROM (SELECT category, COALESCE(SUM(amount), 0) as total FROM ledger_entries WHERE tenant_id = p_tenant_id AND LOWER(type) = 'charge' GROUP BY category) sub),
        'total_expenses_count', (SELECT COUNT(*) FROM vehicle_expenses WHERE tenant_id = p_tenant_id),
        'total_expenses_amount', (SELECT COALESCE(SUM(amount), 0) FROM vehicle_expenses WHERE tenant_id = p_tenant_id),
        'expenses_by_category', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', category::text, 'value', total) ORDER BY total DESC), '[]'::jsonb) FROM (SELECT category, COALESCE(SUM(amount), 0) as total FROM vehicle_expenses WHERE tenant_id = p_tenant_id GROUP BY category) sub)
    ) INTO financial_metrics;

    -- REVIEWS, AGREEMENTS, LEADS, REMINDERS, STAFF
    SELECT jsonb_build_object(
        'total_reviews', (SELECT COUNT(*) FROM rental_reviews WHERE tenant_id = p_tenant_id AND is_skipped = false),
        'average_review_rating', (SELECT COALESCE(ROUND(AVG(rating)::numeric, 1), 0) FROM rental_reviews WHERE tenant_id = p_tenant_id AND is_skipped = false),
        'skipped_reviews', (SELECT COUNT(*) FROM rental_reviews WHERE tenant_id = p_tenant_id AND is_skipped = true),
        'total_agreements', (SELECT COUNT(*) FROM rental_agreements WHERE tenant_id = p_tenant_id),
        'total_leads', (SELECT COUNT(*) FROM leads WHERE tenant_id = p_tenant_id),
        'leads_by_status', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', status, 'value', cnt) ORDER BY cnt DESC), '[]'::jsonb) FROM (SELECT status, COUNT(*) as cnt FROM leads WHERE tenant_id = p_tenant_id GROUP BY status) sub),
        'total_reminders', (SELECT COUNT(*) FROM reminders WHERE tenant_id = p_tenant_id),
        'pending_reminders', (SELECT COUNT(*) FROM reminders WHERE tenant_id = p_tenant_id AND LOWER(status) = 'pending'),
        'total_staff', (SELECT COUNT(*) FROM app_users WHERE tenant_id = p_tenant_id),
        'staff_by_role', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', role, 'value', cnt) ORDER BY cnt DESC), '[]'::jsonb) FROM (SELECT role, COUNT(*) as cnt FROM app_users WHERE tenant_id = p_tenant_id GROUP BY role) sub)
    ) INTO other_metrics;

    -- Merge all into one JSONB object
    RETURN customers_metrics || vehicles_metrics || rentals_metrics || payments_metrics || fines_metrics || financial_metrics || other_metrics;
END;
$$;
