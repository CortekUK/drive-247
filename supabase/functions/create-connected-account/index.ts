import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'

// Always use live key for Stripe Connect onboarding
const stripeLiveKey = Deno.env.get('STRIPE_LIVE_SECRET_KEY') || '';

if (!stripeLiveKey || !stripeLiveKey.startsWith('sk_live_')) {
  console.error('STRIPE_LIVE_SECRET_KEY is not configured or is not a live key');
}

const stripe = new Stripe(stripeLiveKey, {
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
    // Verify live key is configured
    if (!stripeLiveKey || !stripeLiveKey.startsWith('sk_live_')) {
      return new Response(
        JSON.stringify({ error: 'Stripe Connect is not properly configured. Please contact your platform administrator.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 503 }
      )
    }

    const { tenantId, email, businessName, country, returnUrl, refreshUrl } = await req.json()

    if (!tenantId || !email) {
      return new Response(
        JSON.stringify({ error: 'tenantId and email are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check if tenant already has a Stripe account
    const { data: tenant, error: tenantError } = await supabaseClient
      .from('tenants')
      .select('id, stripe_account_id, company_name')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenant) {
      return new Response(
        JSON.stringify({ error: 'Tenant not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    let stripeAccountId = tenant.stripe_account_id

    // Create new Stripe Express account if one doesn't exist
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: country || 'US', // Default to US
        email: email,
        business_type: 'company',
        company: {
          name: businessName || tenant.company_name,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          tenant_id: tenantId,
        },
      })

      stripeAccountId = account.id

      // Store the Stripe account ID in the database
      const { error: updateError } = await supabaseClient
        .from('tenants')
        .update({
          stripe_account_id: stripeAccountId,
          stripe_account_status: 'pending',
          stripe_onboarding_complete: false,
        })
        .eq('id', tenantId)

      if (updateError) {
        console.error('Error updating tenant with Stripe account:', updateError)
        return new Response(
          JSON.stringify({ error: 'Failed to save Stripe account ID' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }
    }

    // Generate onboarding link
    const origin = req.headers.get('origin') || 'https://portal.drive-247.com'
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      type: 'account_onboarding',
      return_url: returnUrl || `${origin}/settings?tab=stripe-connect&status=success`,
      refresh_url: refreshUrl || `${origin}/settings?tab=stripe-connect&status=refresh`,
    })

    return new Response(
      JSON.stringify({
        success: true,
        stripeAccountId: stripeAccountId,
        onboardingUrl: accountLink.url,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error creating connected account:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
