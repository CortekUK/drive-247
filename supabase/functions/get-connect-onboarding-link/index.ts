import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
const isTestMode = stripeSecretKey.startsWith('sk_test_');

const stripe = new Stripe(stripeSecretKey, {
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
    // Block test mode for Stripe Connect onboarding
    if (isTestMode) {
      return new Response(
        JSON.stringify({ error: 'Stripe Connect onboarding is only available in live mode. Ask your platform manager to switch to live mode.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    const { tenantId, returnUrl, refreshUrl } = await req.json()

    if (!tenantId) {
      return new Response(
        JSON.stringify({ error: 'tenantId is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get tenant's Stripe account ID
    const { data: tenant, error: tenantError } = await supabaseClient
      .from('tenants')
      .select('id, stripe_account_id')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenant) {
      return new Response(
        JSON.stringify({ error: 'Tenant not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    if (!tenant.stripe_account_id) {
      return new Response(
        JSON.stringify({ error: 'Tenant does not have a Stripe account. Create one first.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Generate new onboarding link
    const origin = req.headers.get('origin') || 'https://portal.drive-247.com'
    const accountLink = await stripe.accountLinks.create({
      account: tenant.stripe_account_id,
      type: 'account_onboarding',
      return_url: returnUrl || `${origin}/settings?tab=stripe-connect&status=success`,
      refresh_url: refreshUrl || `${origin}/settings?tab=stripe-connect&status=refresh`,
    })

    return new Response(
      JSON.stringify({
        success: true,
        onboardingUrl: accountLink.url,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error generating onboarding link:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
