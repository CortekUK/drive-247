import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, type StripeMode } from '../_shared/stripe-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

// Phase 3: server-authoritative extension checkout.
//
// Preferred call shape:
//   { extensionId, customerEmail }
// The edge function reads the authoritative amount + breakdown from the
// rental_extensions row. Legacy fields (extensionAmount, extensionDays, ...)
// are still accepted for backwards compat until the portal UI is updated in
// Phase 3 step 4, but a deprecation warning is logged.

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json();
    const {
      extensionId,
      customerEmail,
      // Phase 4: Bonzah quote to confirm later (after Stripe succeeds)
      bonzahPolicyId,
      // Legacy fields — retained for backwards compat with the existing portal UI
      rentalId: legacyRentalId,
      customerId: legacyCustomerId,
      vehicleId: legacyVehicleId,
      customerName,
      extensionAmount: legacyExtensionAmount,
      extensionDays: legacyExtensionDays,
      newEndDate: legacyNewEndDate,
      previousEndDate: legacyPreviousEndDate,
      tenantId: legacyTenantId,
    } = body;

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Resolve the rental_extensions row + authoritative figures. Two paths:
    //   A (preferred) — extensionId supplied → read from DB (server-authoritative).
    //   B (legacy)    — client passed amount + dates; we still create a row in
    //                   rental_extensions on the fly so downstream phases see
    //                   a consistent shape.
    let extRow: {
      id: string;
      rental_id: string;
      tenant_id: string;
      sequence_number: number;
      new_end_date: string | null;
      previous_end_date: string | null;
      extension_days: number | null;
      total_amount: number;
      rental_amount: number;
      tax_amount: number;
      service_fee_amount: number;
      insurance_amount: number;
    };

    if (extensionId) {
      const { data, error } = await supabaseClient
        .from('rental_extensions')
        .select('id, rental_id, tenant_id, sequence_number, new_end_date, previous_end_date, extension_days, total_amount, rental_amount, tax_amount, service_fee_amount, insurance_amount, status')
        .eq('id', extensionId)
        .maybeSingle();

      if (error || !data) {
        return errorResponse(`rental_extension ${extensionId} not found`, 404);
      }
      if (data.status === 'paid') {
        return errorResponse(`rental_extension ${extensionId} is already paid`, 409);
      }
      if (Number(data.total_amount) <= 0) {
        return errorResponse(`rental_extension ${extensionId} has zero total_amount`, 400);
      }
      extRow = data as any;
    } else {
      // Legacy path. Validate the old required fields and synthesise a row.
      console.warn('[create-extension-checkout] Legacy call path used (no extensionId). Deprecated; update the caller to pass extensionId.');
      if (!legacyRentalId || !legacyTenantId || !legacyExtensionAmount || !legacyExtensionDays) {
        return errorResponse('Missing required fields: extensionId (preferred), or legacy rentalId + tenantId + extensionAmount + extensionDays');
      }

      // Next sequence_number for this rental
      const { data: seqRow } = await supabaseClient
        .from('rental_extensions')
        .select('sequence_number')
        .eq('rental_id', legacyRentalId)
        .order('sequence_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextSeq = (seqRow?.sequence_number ?? 0) + 1;

      const { data: created, error: createError } = await supabaseClient
        .from('rental_extensions')
        .insert({
          rental_id: legacyRentalId,
          tenant_id: legacyTenantId,
          sequence_number: nextSeq,
          status: 'approved',
          previous_end_date: legacyPreviousEndDate || null,
          new_end_date: legacyNewEndDate || null,
          extension_days: Number(legacyExtensionDays) || null,
          // In the legacy path the client only sends a lump-sum; park it
          // entirely in rental_amount. Phase 4 callers will send a proper
          // breakdown and we'll tighten the invariant then.
          rental_amount: Number(legacyExtensionAmount),
          approved_at: new Date().toISOString(),
        })
        .select('id, rental_id, tenant_id, sequence_number, new_end_date, previous_end_date, extension_days, total_amount, rental_amount, tax_amount, service_fee_amount, insurance_amount')
        .single();

      if (createError || !created) {
        return errorResponse(`Failed to create rental_extension: ${createError?.message}`, 500);
      }
      extRow = created as any;
    }

    // Fetch tenant details for Stripe configuration
    const { data: tenantData, error: tenantError } = await supabaseClient
      .from('tenants')
      .select('id, company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id')
      .eq('id', extRow.tenant_id)
      .eq('status', 'active')
      .single();

    if (tenantError || !tenantData) {
      return errorResponse('Tenant not found or inactive', 404);
    }

    // Fetch rental for customer/vehicle context (so the caller doesn't have
    // to pass these fields — server is the source of truth)
    const { data: rentalData } = await supabaseClient
      .from('rentals')
      .select('customer_id, vehicle_id')
      .eq('id', extRow.rental_id)
      .maybeSingle();

    const customerId = legacyCustomerId || rentalData?.customer_id;
    const vehicleId = legacyVehicleId || rentalData?.vehicle_id;

    const companyName = tenantData.company_name || 'Drive 247';
    const currencyCode = (tenantData.currency_code || 'USD').toLowerCase();
    const stripeMode = (tenantData.stripe_mode as StripeMode) || 'test';
    const totalAmount = Number(extRow.total_amount); // authoritative
    const extensionDays = extRow.extension_days ?? legacyExtensionDays ?? 0;

    const origin = req.headers.get('origin') || 'https://drive-247.com';

    console.log('Extension checkout — extensionId:', extRow.id, 'rental:', extRow.rental_id, 'mode:', stripeMode, 'total:', totalAmount);

    const platformAccount = getChargePlatformAccount(tenantData);
    const stripe = getStripeClientForAccount(platformAccount, stripeMode);
    const stripeAccountId = getConnectAccountId(tenantData);
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currencyCode,
            product_data: {
              name: `Rental Extension \u2014 ${extensionDays} day${extensionDays !== 1 ? 's' : ''}`,
              description: `Extension for ${companyName} rental`,
            },
            unit_amount: Math.round(totalAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: customerEmail,
      client_reference_id: extRow.rental_id,
      success_url: `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${extRow.rental_id}&type=invoice`,
      cancel_url: `${origin}/portal/bookings?extension=cancelled`,
      metadata: {
        type: 'extension',
        extension_id: extRow.id,
        rental_id: extRow.rental_id,
        customer_id: customerId || '',
        tenant_id: extRow.tenant_id,
        extension_days: String(extensionDays),
        new_end_date: extRow.new_end_date || '',
        previous_end_date: extRow.previous_end_date || '',
        stripe_mode: stripeMode,
        target_categories: JSON.stringify(['Extension Rental', 'Extension Tax', 'Extension Service Fee', 'Extension Insurance']),
      },
    }, stripeOptions);

    console.log('Extension checkout session created:', session.id);

    // Create payment record — stamp extension_id so apply-payment can route
    // deterministically and process-pending-payment can call the finalize RPC.
    const today = new Date().toISOString().split('T')[0];
    const { data: payment, error: paymentError } = await supabaseClient
      .from('payments')
      .insert({
        rental_id: extRow.rental_id,
        customer_id: customerId,
        vehicle_id: vehicleId,
        tenant_id: extRow.tenant_id,
        extension_id: extRow.id,
        amount: Math.round(totalAmount * 100) / 100,
        payment_date: today,
        method: 'Card',
        payment_type: 'Payment',
        status: 'Pending',
        verification_status: 'pending',
        target_categories: ['Extension Rental', 'Extension Tax', 'Extension Service Fee', 'Extension Insurance'],
        stripe_checkout_session_id: session.id,
        capture_status: 'requires_capture',
        platform_account: platformAccount,
        booking_source: 'portal',
        notes: `Extension #${extRow.sequence_number}: ${extensionDays} day${extensionDays !== 1 ? 's' : ''}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (paymentError) {
      console.error('Failed to create extension payment record:', paymentError);
    } else {
      console.log('Created extension payment record:', payment.id);
    }

    // Stamp the rental_extensions row with Stripe session info + (Phase 4)
    // the Bonzah policy quote id so process-pending-payment can confirm it
    // after Stripe succeeds instead of confirming pre-payment.
    await supabaseClient
      .from('rental_extensions')
      .update({
        stripe_checkout_session_id: session.id,
        checkout_url: session.url,
        ...(bonzahPolicyId ? { bonzah_policy_id: bonzahPolicyId } : {}),
      })
      .eq('id', extRow.id);

    // Also keep the legacy rentals.extension_checkout_url / extension_amount in
    // sync so existing UI code paths keep working until Phase 5 migrates them.
    await supabaseClient
      .from('rentals')
      .update({
        extension_checkout_url: session.url,
        extension_amount: totalAmount,
      })
      .eq('id', extRow.rental_id);

    return jsonResponse({
      checkoutUrl: session.url,
      sessionId: session.id,
      paymentId: payment?.id,
      extensionId: extRow.id,
      sequenceNumber: extRow.sequence_number,
    });
  } catch (error) {
    console.error('Error creating extension checkout:', error);
    return errorResponse(error.message || 'Internal server error', 500);
  }
});
