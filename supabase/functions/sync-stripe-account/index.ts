import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const { tenantId, stripeAccountId } = await req.json()

    if (!tenantId || !stripeAccountId) {
      return new Response(
        JSON.stringify({ error: 'tenantId and stripeAccountId are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Validate that the Stripe account exists and get its status
    let account: Stripe.Account
    try {
      account = await stripe.accounts.retrieve(stripeAccountId)
    } catch (stripeErr) {
      return new Response(
        JSON.stringify({ error: `Stripe account not found: ${stripeErr.message}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    // Determine account status
    let status = 'pending'
    let onboardingComplete = false

    if (account.charges_enabled && account.payouts_enabled) {
      status = 'active'
      onboardingComplete = true
    } else if (account.requirements?.disabled_reason) {
      status = 'restricted'
    } else if (account.requirements?.currently_due?.length === 0) {
      status = 'active'
      onboardingComplete = true
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check if tenant exists
    const { data: tenant, error: tenantError } = await supabaseClient
      .from('tenants')
      .select('id, company_name, stripe_account_id')
      .eq('id', tenantId)
      .single()

    if (tenantError || !tenant) {
      return new Response(
        JSON.stringify({ error: 'Tenant not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    // Update tenant with Stripe account info
    const { error: updateError } = await supabaseClient
      .from('tenants')
      .update({
        stripe_account_id: stripeAccountId,
        stripe_account_status: status,
        stripe_onboarding_complete: onboardingComplete,
      })
      .eq('id', tenantId)

    if (updateError) {
      console.error('Error updating tenant:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to update tenant' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    // Audit log
    try {
      await supabaseClient.from('audit_logs').insert({
        action: 'stripe_account_synced',
        actor_id: null,
        entity_type: 'settings',
        entity_id: tenantId,
        tenant_id: tenantId,
        details: { stripe_account_id: stripeAccountId, status, onboarding_complete: onboardingComplete },
      })
    } catch (e) {
      console.error('[Audit] stripe_account_synced failed:', e)
    }

    console.log(`Synced Stripe account ${stripeAccountId} to tenant ${tenant.company_name}: status=${status}, onboarding=${onboardingComplete}`)

    return new Response(
      JSON.stringify({
        success: true,
        tenant: {
          id: tenantId,
          company_name: tenant.company_name,
        },
        stripe: {
          account_id: stripeAccountId,
          status: status,
          onboarding_complete: onboardingComplete,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          email: account.email,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error syncing Stripe account:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
