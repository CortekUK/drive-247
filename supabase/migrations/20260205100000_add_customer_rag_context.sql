-- RPC function to gather customer-specific data for AI chat context
-- No message storage - chat history is kept in client memory only

CREATE OR REPLACE FUNCTION get_customer_rag_context(
    p_tenant_id UUID,
    p_customer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
    v_customer JSONB;
    v_rentals JSONB;
    v_payments JSONB;
    v_agreements JSONB;
    v_installments JSONB;
    v_bonzah_policies JSONB;
    v_verification JSONB;
BEGIN
    -- Get customer profile (customer_id is unique, no need for tenant_id filter)
    SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'email', c.email,
        'phone', c.phone,
        'identity_verification_status', c.identity_verification_status,
        'customer_type', c.customer_type,
        'status', c.status,
        'date_of_birth', c.date_of_birth,
        'created_at', c.created_at
    ) INTO v_customer
    FROM customers c
    WHERE c.id = p_customer_id;

    -- Get recent rentals (last 5) - only filter by customer_id since it's unique
    SELECT COALESCE(jsonb_agg(rental_data ORDER BY rental_data->>'created_at' DESC), '[]'::jsonb)
    INTO v_rentals
    FROM (
        SELECT jsonb_build_object(
            'id', r.id,
            'rental_number', r.rental_number,
            'status', r.status,
            'start_date', r.start_date,
            'end_date', r.end_date,
            'vehicle_registration', v.reg,
            'vehicle_make', v.make,
            'vehicle_model', v.model,
            'total_cost', r.total_cost,
            'payment_status', r.payment_status,
            'pickup_location', r.pickup_location,
            'dropoff_location', r.dropoff_location,
            'created_at', r.created_at
        ) as rental_data
        FROM rentals r
        LEFT JOIN vehicles v ON v.id = r.vehicle_id
        WHERE r.customer_id = p_customer_id
        ORDER BY r.created_at DESC
        LIMIT 5
    ) sub;

    -- Get recent payments (last 10)
    SELECT COALESCE(jsonb_agg(payment_data ORDER BY payment_data->>'created_at' DESC), '[]'::jsonb)
    INTO v_payments
    FROM (
        SELECT jsonb_build_object(
            'id', p.id,
            'amount', p.amount,
            'status', p.status,
            'payment_method', p.payment_method,
            'payment_type', p.payment_type,
            'description', p.description,
            'rental_number', r.rental_number,
            'created_at', p.created_at
        ) as payment_data
        FROM payments p
        LEFT JOIN rentals r ON r.id = p.rental_id
        WHERE p.customer_id = p_customer_id
        ORDER BY p.created_at DESC
        LIMIT 10
    ) sub;

    -- Get agreements with DocuSign status
    SELECT COALESCE(jsonb_agg(agreement_data ORDER BY agreement_data->>'created_at' DESC), '[]'::jsonb)
    INTO v_agreements
    FROM (
        SELECT jsonb_build_object(
            'id', a.id,
            'rental_number', r.rental_number,
            'status', a.status,
            'docusign_status', a.docusign_status,
            'signed_at', a.signed_at,
            'created_at', a.created_at
        ) as agreement_data
        FROM rental_agreements a
        LEFT JOIN rentals r ON r.id = a.rental_id
        WHERE a.customer_id = p_customer_id
        ORDER BY a.created_at DESC
        LIMIT 5
    ) sub;

    -- Get active installment plans
    SELECT COALESCE(jsonb_agg(installment_data ORDER BY installment_data->>'created_at' DESC), '[]'::jsonb)
    INTO v_installments
    FROM (
        SELECT jsonb_build_object(
            'id', ip.id,
            'rental_number', r.rental_number,
            'total_amount', ip.total_amount,
            'paid_amount', ip.paid_amount,
            'remaining_amount', ip.remaining_amount,
            'installment_count', ip.installment_count,
            'status', ip.status,
            'next_payment_date', ip.next_payment_date,
            'created_at', ip.created_at
        ) as installment_data
        FROM installment_plans ip
        LEFT JOIN rentals r ON r.id = ip.rental_id
        WHERE ip.customer_id = p_customer_id
          AND ip.status IN ('active', 'pending')
        ORDER BY ip.created_at DESC
        LIMIT 5
    ) sub;

    -- Get Bonzah insurance policies
    SELECT COALESCE(jsonb_agg(policy_data ORDER BY policy_data->>'created_at' DESC), '[]'::jsonb)
    INTO v_bonzah_policies
    FROM (
        SELECT jsonb_build_object(
            'id', bp.id,
            'rental_number', r.rental_number,
            'policy_number', bp.policy_number,
            'status', bp.status,
            'coverage_type', bp.coverage_type,
            'start_date', bp.start_date,
            'end_date', bp.end_date,
            'premium_amount', bp.premium_amount,
            'created_at', bp.created_at
        ) as policy_data
        FROM bonzah_policies bp
        LEFT JOIN rentals r ON r.id = bp.rental_id
        WHERE bp.customer_id = p_customer_id
        ORDER BY bp.created_at DESC
        LIMIT 5
    ) sub;

    -- Get verification status
    SELECT jsonb_build_object(
        'id', iv.id,
        'status', iv.status,
        'verification_type', iv.verification_type,
        'verified_at', iv.verified_at,
        'created_at', iv.created_at
    ) INTO v_verification
    FROM identity_verifications iv
    WHERE iv.customer_id = p_customer_id
    ORDER BY iv.created_at DESC
    LIMIT 1;

    -- Build final result
    v_result := jsonb_build_object(
        'customer', v_customer,
        'rentals', v_rentals,
        'payments', v_payments,
        'agreements', v_agreements,
        'installments', v_installments,
        'bonzah_policies', v_bonzah_policies,
        'verification', v_verification
    );

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_customer_rag_context IS 'Gathers customer-specific data for AI chat context (Trax assistant)';
