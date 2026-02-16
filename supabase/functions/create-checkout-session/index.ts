import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, x-tenant-slug',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const { bookingId, rentalId, customerEmail, customerName, totalAmount, tenantSlug, tenantId: bodyTenantId, bonzahPolicyId, successUrl, cancelUrl, targetCategories, source } = await req.json()

    // Get tenant slug from header or body
    const slug = tenantSlug || req.headers.get('x-tenant-slug')

    const origin = req.headers.get('origin') || 'http://localhost:5173'

    // Support both bookingId (legacy) and rentalId (portal integration)
    const referenceId = rentalId || bookingId

    // Initialize Supabase client to fetch tenant info
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch tenant details for customization
    let tenantId: string | null = bodyTenantId || null
    let companyName = 'Drive 917'
    let currencyCode = 'gbp'
    let stripeMode: StripeMode = 'test' // Default to test mode for safety
    let tenantData: any = null

    // Try to get tenant by slug first, then by ID, then from rental
    if (slug) {
      const { data: tenant, error: tenantError } = await supabaseClient
        .from('tenants')
        .select('id, company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete')
        .eq('slug', slug)
        .eq('status', 'active')
        .single()

      if (tenant && !tenantError) {
        tenantId = tenant.id
        companyName = tenant.company_name || companyName
        currencyCode = (tenant.currency_code || 'USD').toLowerCase()
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
        tenantData = tenant
        console.log('Tenant loaded from slug:', tenantId, 'mode:', stripeMode)
      }
    } else if (tenantId) {
      // Lookup tenant by ID if slug not provided
      const { data: tenant, error: tenantError } = await supabaseClient
        .from('tenants')
        .select('id, company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete')
        .eq('id', tenantId)
        .eq('status', 'active')
        .single()

      if (tenant && !tenantError) {
        companyName = tenant.company_name || companyName
        currencyCode = (tenant.currency_code || 'USD').toLowerCase()
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
        tenantData = tenant
        console.log('Tenant loaded from ID:', tenantId, 'mode:', stripeMode)
      }
    } else if (rentalId) {
      // Fallback: get tenant from rental
      const { data: rental } = await supabaseClient
        .from('rentals')
        .select('tenant_id')
        .eq('id', rentalId)
        .single()

      if (rental?.tenant_id) {
        tenantId = rental.tenant_id

        const { data: tenant } = await supabaseClient
          .from('tenants')
          .select('company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete')
          .eq('id', tenantId)
          .single()

        if (tenant) {
          companyName = tenant.company_name || companyName
          currencyCode = (tenant.currency_code || 'USD').toLowerCase()
          stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
          tenantData = tenant
          console.log('Tenant loaded from rental:', tenantId, 'mode:', stripeMode)
        }
      }
    }

    // Get Stripe client for the tenant's mode
    const stripe = getStripeClient(stripeMode)

    // Determine which Connect account to use based on tenant mode
    const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null

    console.log('Checkout session - tenantId:', tenantId, 'mode:', stripeMode, 'connectAccount:', stripeAccountId)

    // Create Stripe Checkout Session
    const sessionConfig: any = {
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currencyCode,
            product_data: {
              name: 'Vehicle Rental',
              description: `Premium vehicle rental - ${companyName}`,
            },
            unit_amount: Math.round(totalAmount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: customerEmail,
      client_reference_id: referenceId,
      success_url: successUrl || (rentalId
        ? `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rentalId}`
        : `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}`),
      cancel_url: cancelUrl || (rentalId
        ? `${origin}/booking-cancelled?rental_id=${rentalId}`
        : `${origin}/booking-cancelled`),
      metadata: {
        booking_id: bookingId,
        rental_id: rentalId,
        customer_name: customerName,
        tenant_id: tenantId,
        tenant_slug: slug,
        stripe_mode: stripeMode, // Track which mode was used
        ...(bonzahPolicyId ? { bonzah_policy_id: bonzahPolicyId } : {}),
        ...(source ? { source } : {}),
        ...(targetCategories && targetCategories.length > 0 ? { target_categories: JSON.stringify(targetCategories) } : {}),
      },
    }

    // For direct charges: create checkout session on connected account
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
    if (stripeAccountId) {
      console.log(`Creating checkout session on connected account (${stripeMode} mode):`, stripeAccountId)
    } else {
      console.log(`Creating checkout session on platform account (${stripeMode} mode)`)
    }

    const session = await stripe.checkout.sessions.create(sessionConfig, stripeOptions)

    // CRITICAL FIX: Save stripe_checkout_session_id to payment record
    // This allows the webhook to find and update the payment when checkout completes
    if (referenceId) {
      // First try to update existing payment record (portal flow)
      const { data: updatedPayment, error: updateError } = await supabaseClient
        .from('payments')
        .update({
          stripe_checkout_session_id: session.id,
          updated_at: new Date().toISOString(),
        })
        .eq('rental_id', referenceId)
        .is('stripe_checkout_session_id', null)
        .select('id')

      if (updateError) {
        console.error('Failed to update payment with session ID:', updateError)
      } else if (updatedPayment && updatedPayment.length > 0) {
        console.log('✅ Updated existing payment with session ID:', updatedPayment[0].id, 'session:', session.id)
      } else {
        // No existing payment found - create one (booking app flow)
        console.log('No existing payment found, creating new payment record for rental:', referenceId)

        // Get rental details
        const { data: rental } = await supabaseClient
          .from('rentals')
          .select('customer_id, vehicle_id, monthly_amount, tenant_id')
          .eq('id', referenceId)
          .single()

        if (rental) {
          const paymentAmount = Math.round(totalAmount * 100) / 100 // From checkout session
          const today = new Date().toISOString().split('T')[0]

          const { data: createdPayment, error: createError } = await supabaseClient
            .from('payments')
            .insert({
              rental_id: referenceId,
              customer_id: rental.customer_id,
              vehicle_id: rental.vehicle_id,
              tenant_id: rental.tenant_id || tenantId,
              amount: paymentAmount,
              payment_date: today,
              method: 'Card',
              payment_type: 'Payment',
              status: 'Pending',
              remaining_amount: paymentAmount,
              verification_status: 'pending',
              stripe_checkout_session_id: session.id,
              capture_status: 'requires_capture',
              booking_source: source === 'portal' ? 'admin' : 'website',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select('id')
            .single()

          if (createError) {
            console.error('Failed to create payment record:', createError)
          } else {
            console.log('✅ Created new payment with session ID:', createdPayment.id, 'session:', session.id)
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ sessionId: session.id, url: session.url }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error creating checkout session:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
