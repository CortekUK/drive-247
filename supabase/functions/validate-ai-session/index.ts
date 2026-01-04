// @ts-nocheck - This is a Deno Edge Function, not Node.js TypeScript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ValidateSessionRequest {
  qrToken: string;
}

interface ValidateSessionResponse {
  ok: boolean;
  sessionId?: string;
  tenantSlug?: string;
  tenantName?: string;
  tenantLogo?: string;
  customerName?: string;
  expiresAt?: string;
  status?: string;
  error?: string;
  detail?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { qrToken } = await req.json() as ValidateSessionRequest;

    if (!qrToken) {
      return new Response(
        JSON.stringify({ ok: false, error: 'qrToken is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Look up session by QR token
    const { data: verification, error: verificationError } = await supabaseClient
      .from('identity_verifications')
      .select(`
        id,
        status,
        review_status,
        qr_session_expires_at,
        first_name,
        last_name,
        customer_id,
        tenant_id,
        customers:customer_id (
          name,
          email
        )
      `)
      .eq('qr_session_token', qrToken)
      .eq('verification_provider', 'ai')
      .single();

    if (verificationError || !verification) {
      console.error('Session lookup error:', verificationError);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Invalid or expired session',
          detail: 'The QR code is invalid or has expired. Please request a new one.'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if session is expired
    const expiresAt = new Date(verification.qr_session_expires_at);
    if (expiresAt < new Date()) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Session expired',
          detail: 'This verification session has expired. Please request a new QR code.'
        }),
        { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if session is already completed
    if (verification.status === 'completed') {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Session already completed',
          detail: 'This verification has already been completed.'
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get tenant information for branding
    let tenantSlug = '';
    let tenantName = '';
    let tenantLogo = '';

    if (verification.tenant_id) {
      const { data: tenant, error: tenantError } = await supabaseClient
        .from('tenants')
        .select('slug, company_name, logo_url')
        .eq('id', verification.tenant_id)
        .single();

      if (!tenantError && tenant) {
        tenantSlug = tenant.slug || '';
        tenantName = tenant.company_name || '';
        tenantLogo = tenant.logo_url || '';
      }
    }

    // Get customer name if available
    let customerName = '';
    if (verification.customers && (verification.customers as any).name) {
      customerName = (verification.customers as any).name;
    } else if (verification.first_name || verification.last_name) {
      customerName = [verification.first_name, verification.last_name].filter(Boolean).join(' ');
    }

    // Update session status to indicate it's being used
    await supabaseClient
      .from('identity_verifications')
      .update({
        status: 'pending',
        review_status: 'pending',
        updated_at: new Date().toISOString()
      })
      .eq('id', verification.id);

    const response: ValidateSessionResponse = {
      ok: true,
      sessionId: verification.id,
      tenantSlug,
      tenantName,
      tenantLogo,
      customerName,
      expiresAt: verification.qr_session_expires_at,
      status: verification.status,
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Internal server error',
        detail: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
