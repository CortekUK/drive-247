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

    const { email, password, tenantId } = await req.json();

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: 'Missing email or password' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Check if this is a global master admin login
    const isGlobalAdmin = email.toLowerCase() === 'admin@cortek.io';

    if (isGlobalAdmin) {
      // Verify global master password using database function
      const { data: isValid, error: verifyError } = await supabaseClient
        .rpc('verify_global_master_password', {
          p_email: email.toLowerCase(),
          p_password: password
        });

      if (verifyError || !isValid) {
        console.error('Global master password verification failed:', verifyError);
        return new Response(
          JSON.stringify({ error: 'Invalid master password' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        );
      }

      // Get or create the global master admin user
      let { data: adminUser, error: adminUserError } = await supabaseClient
        .from('app_users')
        .select('id, auth_user_id, email, name, role, is_super_admin, is_primary_super_admin')
        .eq('email', 'admin@cortek.io')
        .single();

      if (adminUserError || !adminUser) {
        // Create the global admin user if doesn't exist
        // First create auth user
        const { data: authUser, error: authError } = await supabaseClient.auth.admin.createUser({
          email: 'admin@cortek.io',
          password: password,
          email_confirm: true,
          user_metadata: {
            name: 'Global Master Admin',
            role: 'head_admin',
            is_super_admin: true,
            is_primary_super_admin: true
          }
        });

        if (authError || !authUser.user) {
          // User might already exist in auth, try to get them
          const { data: existingUsers } = await supabaseClient.auth.admin.listUsers();
          const existingAuth = existingUsers?.users?.find(u => u.email === 'admin@cortek.io');

          if (!existingAuth) {
            console.error('Failed to create/find auth user:', authError);
            return new Response(
              JSON.stringify({ error: 'Failed to setup admin user' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
            );
          }

          // Create app_users record
          const { data: newAppUser, error: appUserError } = await supabaseClient
            .from('app_users')
            .insert({
              auth_user_id: existingAuth.id,
              email: 'admin@cortek.io',
              name: 'Global Master Admin',
              role: 'head_admin',
              is_super_admin: true,
              is_primary_super_admin: true,
              is_active: true,
              tenant_id: null
            })
            .select()
            .single();

          if (appUserError) {
            console.error('Failed to create app_users record:', appUserError);
          }

          adminUser = newAppUser;
        } else {
          // Create app_users record for the new auth user
          const { data: newAppUser } = await supabaseClient
            .from('app_users')
            .insert({
              auth_user_id: authUser.user.id,
              email: 'admin@cortek.io',
              name: 'Global Master Admin',
              role: 'head_admin',
              is_super_admin: true,
              is_primary_super_admin: true,
              is_active: true,
              tenant_id: null
            })
            .select()
            .single();

          adminUser = newAppUser;
        }
      }

      if (!adminUser?.auth_user_id) {
        return new Response(
          JSON.stringify({ error: 'Admin user not properly configured' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      // Generate magic link for the admin user
      // If tenantId is provided, include it for impersonation
      const redirectUrl = tenantId
        ? `${Deno.env.get('PORTAL_URL')}?impersonated=true&tenant_id=${tenantId}`
        : `${Deno.env.get('ADMIN_URL') || Deno.env.get('PORTAL_URL')}?super_admin=true`;

      // Get the auth user to generate link
      const { data: authUserData } = await supabaseClient.auth.admin.getUserById(adminUser.auth_user_id);

      if (!authUserData?.user?.email) {
        return new Response(
          JSON.stringify({ error: 'Failed to get admin auth user' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      // Update user metadata with impersonation info if tenantId provided
      if (tenantId) {
        await supabaseClient.auth.admin.updateUserById(adminUser.auth_user_id, {
          user_metadata: {
            ...authUserData.user.user_metadata,
            impersonated_tenant_id: tenantId
          }
        });
      }

      const { data: sessionData, error: sessionError } = await supabaseClient.auth.admin.generateLink({
        type: 'magiclink',
        email: authUserData.user.email,
        options: {
          redirectTo: redirectUrl
        }
      });

      if (sessionError || !sessionData) {
        console.error('Failed to generate session:', sessionError);
        return new Response(
          JSON.stringify({ error: 'Failed to generate session' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          isGlobalAdmin: true,
          impersonatedTenantId: tenantId || null,
          magicLink: sessionData.properties.action_link,
          user: {
            id: adminUser.id,
            email: adminUser.email,
            name: adminUser.name,
            role: adminUser.role,
            is_super_admin: true,
            is_primary_super_admin: true
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Per-tenant master password login is no longer supported
    return new Response(
      JSON.stringify({ error: 'Per-tenant master password login is no longer supported. Use global admin login instead.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );

  } catch (error) {
    console.error('Master password login error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
