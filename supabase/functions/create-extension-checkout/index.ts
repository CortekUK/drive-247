import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const {
      rentalId,
      customerId,
      vehicleId,
      customerEmail,
      customerName,
      extensionAmount,
      extensionDays,
      newEndDate,
      previousEndDate,
      tenantId,
    } = await req.json();

    if (!rentalId || !tenantId || !extensionAmount || !extensionDays) {
      return errorResponse('Missing required fields: rentalId, tenantId, extensionAmount, extensionDays');
    }

    const origin = req.headers.get('origin') || 'https://drive-247.com';

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch tenant details for Stripe configuration
    const { data: tenantData, error: tenantError } = await supabaseClient
      .from('tenants')
      .select('id, company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete')
      .eq('id', tenantId)
      .eq('status', 'active')
      .single();

    if (tenantError || !tenantData) {
      return errorResponse('Tenant not found or inactive', 404);
    }

    const companyName = tenantData.company_name || 'Drive 247';
    const currencyCode = (tenantData.currency_code || 'USD').toLowerCase();
    const stripeMode = (tenantData.stripe_mode as StripeMode) || 'test';

    console.log('Extension checkout - tenantId:', tenantId, 'mode:', stripeMode, 'amount:', extensionAmount);

    // Get Stripe client and Connect account
    const stripe = getStripeClient(stripeMode);
    const stripeAccountId = getConnectAccountId(tenantData);
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;

    // Create Stripe Checkout Session
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
            unit_amount: Math.round(extensionAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: customerEmail,
      client_reference_id: rentalId,
      success_url: `${origin}/portal/bookings?extension=success`,
      cancel_url: `${origin}/portal/bookings?extension=cancelled`,
      metadata: {
        type: 'extension',
        rental_id: rentalId,
        customer_id: customerId,
        tenant_id: tenantId,
        extension_days: String(extensionDays),
        new_end_date: newEndDate,
        previous_end_date: previousEndDate,
        stripe_mode: stripeMode,
      },
    }, stripeOptions);

    console.log('Extension checkout session created:', session.id);

    // Create payment record for webhook to find
    const today = new Date().toISOString().split('T')[0];
    const { data: payment, error: paymentError } = await supabaseClient
      .from('payments')
      .insert({
        rental_id: rentalId,
        customer_id: customerId,
        vehicle_id: vehicleId,
        tenant_id: tenantId,
        amount: Math.round(extensionAmount * 100) / 100,
        payment_date: today,
        method: 'Card',
        payment_type: 'Payment',
        status: 'Applied',
        verification_status: 'auto_approved',
        stripe_checkout_session_id: session.id,
        capture_status: 'requires_capture',
        booking_source: 'portal',
        notes: `Extension payment: ${extensionDays} days`,
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

    return jsonResponse({
      checkoutUrl: session.url,
      sessionId: session.id,
      paymentId: payment?.id,
    });
  } catch (error) {
    console.error('Error creating extension checkout:', error);
    return errorResponse(error.message || 'Internal server error', 500);
  }
});
