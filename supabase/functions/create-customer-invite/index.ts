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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('Missing authorization header', 401);
    }

    const { tenantId, tenantSlug } = await req.json();

    if (!tenantId || !tenantSlug) {
      return errorResponse('tenantId and tenantSlug are required');
    }

    // Verify the calling user
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return errorResponse('Unauthorized', 401);
    }

    // Service role for DB operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify user is an app_user for this tenant
    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('id, tenant_id, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (appUserError || !appUser) {
      return errorResponse('User not found in app_users', 403);
    }

    if (!appUser.is_super_admin && appUser.tenant_id !== tenantId) {
      return errorResponse('Forbidden: tenant mismatch', 403);
    }

    // Generate invite with 7-day expiry
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const { data: invite, error: insertError } = await supabase
      .from('customer_registration_invites')
      .insert({
        tenant_id: tenantId,
        token,
        created_by: appUser.id,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      })
      .select('id, token, expires_at')
      .single();

    if (insertError) {
      console.error('Error creating invite:', insertError);
      return errorResponse('Failed to create invite: ' + insertError.message, 500);
    }

    const url = `https://${tenantSlug}.drive-247.com/register/${token}`;

    return jsonResponse({
      ok: true,
      token: invite.token,
      url,
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
