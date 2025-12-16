import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const { tenantId, masterPassword } = await req.json();

    if (!tenantId || !masterPassword) {
      return new Response(
        JSON.stringify({ error: 'Missing tenantId or masterPassword' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Fetch tenant from database
    const { data: tenant, error: tenantError } = await supabaseClient
      .from('tenants')
      .select('id, name, master_password_hash, admin_user_id')
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenant) {
      return new Response(
        JSON.stringify({ error: 'Tenant not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    // Verify master password using crypto.subtle
    const encoder = new TextEncoder();
    const data = encoder.encode(masterPassword);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    if (hashHex !== tenant.master_password_hash) {
      return new Response(
        JSON.stringify({ error: 'Invalid master password' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Fetch the admin user for this tenant
    const { data: user, error: userError } = await supabaseClient.auth.admin.getUserById(
      tenant.admin_user_id
    );

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Admin user not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    // Generate a session for the admin user with impersonation flag
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.admin.generateLink({
      type: 'magiclink',
      email: user.user.email!,
      options: {
        redirectTo: `${Deno.env.get('PORTAL_URL')}?impersonated=true`
      }
    });

    if (sessionError || !sessionData) {
      return new Response(
        JSON.stringify({ error: 'Failed to generate session' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        tenant: {
          id: tenant.id,
          name: tenant.name,
        },
        magicLink: sessionData.properties.action_link,
        impersonated: true
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
