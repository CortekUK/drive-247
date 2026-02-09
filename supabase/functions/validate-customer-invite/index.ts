import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();

    if (!token) {
      return errorResponse('token is required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Look up the invite
    const { data: invite, error: inviteError } = await supabase
      .from('customer_registration_invites')
      .select('id, tenant_id, status, expires_at')
      .eq('token', token)
      .single();

    if (inviteError || !invite) {
      return errorResponse('Invalid invite link', 404);
    }

    if (invite.status !== 'pending') {
      return errorResponse('This invite has already been used or revoked');
    }

    if (new Date(invite.expires_at) < new Date()) {
      // Auto-expire
      await supabase
        .from('customer_registration_invites')
        .update({ status: 'expired' })
        .eq('id', invite.id);
      return errorResponse('This invite link has expired');
    }

    // Get tenant branding
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, slug, name, logo_url, primary_color')
      .eq('id', invite.tenant_id)
      .single();

    if (tenantError || !tenant) {
      return errorResponse('Tenant not found', 404);
    }

    return jsonResponse({
      ok: true,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      tenantLogo: tenant.logo_url,
      tenantPrimaryColor: tenant.primary_color,
      expiresAt: invite.expires_at,
    });
  } catch (error) {
    console.error('Function error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
