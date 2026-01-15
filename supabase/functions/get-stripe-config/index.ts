// Get Stripe Configuration for Frontend
// Returns the appropriate Stripe publishable key based on tenant's mode

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getPublishableKey, type StripeMode } from '../_shared/stripe-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

interface StripeConfigRequest {
  tenantSlug?: string;
  tenantId?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { tenantSlug, tenantId }: StripeConfigRequest = await req.json();

    if (!tenantSlug && !tenantId) {
      return new Response(
        JSON.stringify({
          error: 'Missing required parameter: tenantSlug or tenantId',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Fetch tenant by slug or ID
    let query = supabase
      .from('tenants')
      .select('id, slug, stripe_mode, company_name');

    if (tenantSlug) {
      query = query.eq('slug', tenantSlug);
    } else if (tenantId) {
      query = query.eq('id', tenantId);
    }

    const { data: tenant, error: tenantError } = await query
      .eq('status', 'active')
      .single();

    if (tenantError || !tenant) {
      console.error('Tenant not found:', tenantError);
      return new Response(
        JSON.stringify({
          error: 'Tenant not found',
        }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const stripeMode = (tenant.stripe_mode as StripeMode) || 'test';
    const publishableKey = getPublishableKey(stripeMode);

    console.log(`Stripe config for tenant ${tenant.slug}: mode=${stripeMode}`);

    return new Response(
      JSON.stringify({
        publishableKey,
        mode: stripeMode,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.company_name,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error getting Stripe config:', error);
    return new Response(
      JSON.stringify({
        error: error.message || 'Failed to get Stripe configuration',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
