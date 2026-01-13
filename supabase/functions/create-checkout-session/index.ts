import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

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
    const { bookingId, rentalId, customerEmail, customerName, totalAmount, tenantSlug, tenantId: bodyTenantId } = await req.json()

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
    let currencyCode = 'usd'
    let stripeAccountId: string | null = null

    // Try to get tenant by slug first, then by ID, then from rental
    if (slug) {
      const { data: tenant, error: tenantError } = await supabaseClient
        .from('tenants')
        .select('id, company_name, currency_code, stripe_account_id, stripe_onboarding_complete')
        .eq('slug', slug)
        .eq('status', 'active')
        .single()

      if (tenant && !tenantError) {
        tenantId = tenant.id
        companyName = tenant.company_name || companyName
        currencyCode = (tenant.currency_code || 'USD').toLowerCase()

        // Only use Stripe Connect if tenant has completed onboarding
        if (tenant.stripe_account_id && tenant.stripe_onboarding_complete) {
          stripeAccountId = tenant.stripe_account_id
          console.log('Using Stripe Connect account from slug:', stripeAccountId)
        }
      }
    } else if (tenantId) {
      // Lookup tenant by ID if slug not provided
      const { data: tenant, error: tenantError } = await supabaseClient
        .from('tenants')
        .select('id, company_name, currency_code, stripe_account_id, stripe_onboarding_complete')
        .eq('id', tenantId)
        .eq('status', 'active')
        .single()

      if (tenant && !tenantError) {
        companyName = tenant.company_name || companyName
        currencyCode = (tenant.currency_code || 'USD').toLowerCase()

        if (tenant.stripe_account_id && tenant.stripe_onboarding_complete) {
          stripeAccountId = tenant.stripe_account_id
          console.log('Using Stripe Connect account from tenantId:', stripeAccountId)
        }
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
          .select('company_name, currency_code, stripe_account_id, stripe_onboarding_complete')
          .eq('id', tenantId)
          .single()

        if (tenant) {
          companyName = tenant.company_name || companyName
          currencyCode = (tenant.currency_code || 'USD').toLowerCase()

          if (tenant.stripe_account_id && tenant.stripe_onboarding_complete) {
            stripeAccountId = tenant.stripe_account_id
            console.log('Using Stripe Connect account from rental:', stripeAccountId)
          }
        }
      }
    }

    console.log('Checkout session - tenantId:', tenantId, 'stripeAccountId:', stripeAccountId)

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
      success_url: rentalId
        ? `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rentalId}`
        : `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: rentalId
        ? `${origin}/booking-cancelled?rental_id=${rentalId}`
        : `${origin}/booking-cancelled`,
      metadata: {
        booking_id: bookingId,
        rental_id: rentalId,
        customer_name: customerName,
        tenant_id: tenantId,
        tenant_slug: slug,
      },
    }

    // For direct charges: create checkout session on connected account
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;

    const session = await stripe.checkout.sessions.create(sessionConfig, stripeOptions)

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
