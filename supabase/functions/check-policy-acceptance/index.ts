import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function getClientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, email, tenant_id, user_agent } = body;

    if (!email || !tenant_id) {
      return errorResponse('email and tenant_id are required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Look up app_user by email
    const { data: appUser, error: userError } = await supabase
      .from('app_users')
      .select('id, is_super_admin, tenant_id')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (userError || !appUser) {
      return jsonResponse({ needsAcceptance: true });
    }

    // Super admins skip DB logging entirely — acceptance is frontend-only
    if (appUser.is_super_admin) {
      return jsonResponse(action === 'record' ? { success: true } : { needsAcceptance: false });
    }

    // For regular users, verify they belong to the tenant
    if (appUser.tenant_id !== tenant_id) {
      return jsonResponse({ needsAcceptance: true });
    }

    // Get tenant's current policy versions
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('privacy_policy_version, terms_version')
      .eq('id', tenant_id)
      .single();

    if (tenantError || !tenant) {
      return jsonResponse({ needsAcceptance: true });
    }

    const privacyVersion = tenant.privacy_policy_version || '1.0';
    const termsVersion = tenant.terms_version || '1.0';

    // --- ACTION: record acceptance ---
    if (action === 'record') {
      const ipAddress = getClientIp(req);

      const { error: upsertError } = await supabase
        .from('policy_acceptances')
        .upsert([
          {
            app_user_id: appUser.id,
            tenant_id,
            policy_type: 'privacy_policy',
            version: privacyVersion,
            ip_address: ipAddress,
            user_agent: user_agent || null,
          },
          {
            app_user_id: appUser.id,
            tenant_id,
            policy_type: 'terms_and_conditions',
            version: termsVersion,
            ip_address: ipAddress,
            user_agent: user_agent || null,
          },
        ], { onConflict: 'app_user_id,policy_type,version' });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        return errorResponse('Failed to record acceptance', 500);
      }

      // Mark tenant as having accepted policies
      await supabase
        .from('tenants')
        .update({ policies_accepted_at: new Date().toISOString() })
        .eq('id', tenant_id);

      return jsonResponse({ success: true });
    }

    // --- ACTION: check acceptance (default) ---
    const { data: acceptances, error: acceptError } = await supabase
      .from('policy_acceptances')
      .select('policy_type, version')
      .eq('app_user_id', appUser.id)
      .in('policy_type', ['privacy_policy', 'terms_and_conditions']);

    if (acceptError) {
      return jsonResponse({ needsAcceptance: true });
    }

    const hasPrivacy = acceptances?.some(
      (a: { policy_type: string; version: string }) => a.policy_type === 'privacy_policy' && a.version === privacyVersion
    );
    const hasTerms = acceptances?.some(
      (a: { policy_type: string; version: string }) => a.policy_type === 'terms_and_conditions' && a.version === termsVersion
    );

    return jsonResponse({ needsAcceptance: !(hasPrivacy && hasTerms) });
  } catch (error) {
    console.error('Function error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
