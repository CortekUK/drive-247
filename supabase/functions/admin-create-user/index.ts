import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateUserRequest {
  email: string;
  name: string;
  role: 'head_admin' | 'admin' | 'ops' | 'viewer';
  temporaryPassword: string;
  tenant_id?: string; // Optional: super admins can specify tenant_id for the new user
}

Deno.serve(async (req) => {
  console.log('admin-create-user function called');

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('No authorization header provided');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Client with user's JWT for verification
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Service role client for admin operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user session and get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Failed to verify user session:', userError);
      return new Response(
        JSON.stringify({ error: 'Invalid session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user has admin privileges and get their tenant_id
    const { data: currentUserData, error: roleError } = await supabase
      .from('app_users')
      .select('role, is_active, tenant_id, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (roleError || !currentUserData) {
      console.error('Failed to get user role:', roleError);
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!currentUserData.is_active || !['head_admin', 'admin'].includes(currentUserData.role)) {
      console.error('User does not have admin privileges:', currentUserData);
      return new Response(
        JSON.stringify({ error: 'Insufficient privileges' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only head_admin can create other admins or head_admins
    const { email, name, role, temporaryPassword, tenant_id }: CreateUserRequest = await req.json();

    if ((role === 'admin' || role === 'head_admin') && currentUserData.role !== 'head_admin' && !currentUserData.is_super_admin) {
      return new Response(
        JSON.stringify({ error: 'Only head admin can create admin users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Super admins can specify tenant_id, others inherit from creator
    if (tenant_id && !currentUserData.is_super_admin) {
      return new Response(
        JSON.stringify({ error: 'Only super admins can specify tenant_id' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine tenant_id for the new user
    // If tenant_id is specified (by super admin), use it
    // Otherwise: super admins create users with NULL tenant_id, regular users inherit from creator
    const newUserTenantId = tenant_id || (currentUserData.is_super_admin ? null : currentUserData.tenant_id);

    // Check if user already exists in auth by trying to list users with that email
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingAuthUser = existingUsers?.users?.find(u => u.email === email);

    let authUserId: string;
    let isExistingUser = false;

    if (existingAuthUser) {
      // User already exists in auth
      console.log('User already exists in auth:', existingAuthUser.id);
      authUserId = existingAuthUser.id;
      isExistingUser = true;

      // Check if they already have an app_users record for this tenant
      const { data: existingAppUser } = await supabaseAdmin
        .from('app_users')
        .select('id, tenant_id')
        .eq('auth_user_id', authUserId)
        .eq('tenant_id', newUserTenantId)
        .single();

      if (existingAppUser) {
        // User already linked to this tenant
        console.log('User already linked to this tenant:', existingAppUser.id);
        return new Response(
          JSON.stringify({
            success: true,
            user: {
              id: existingAppUser.id,
              email,
              name,
              role,
              auth_user_id: authUserId
            },
            message: 'User already exists and is linked to this tenant'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if user has an app_users record for a DIFFERENT tenant
      const { data: otherTenantAppUser } = await supabaseAdmin
        .from('app_users')
        .select('id, tenant_id')
        .eq('auth_user_id', authUserId)
        .single();

      if (otherTenantAppUser && otherTenantAppUser.tenant_id !== newUserTenantId) {
        // User exists but belongs to another tenant - update their tenant_id
        console.log('Updating user tenant_id from', otherTenantAppUser.tenant_id, 'to', newUserTenantId);
        const { data: updatedAppUser, error: updateError } = await supabaseAdmin
          .from('app_users')
          .update({
            tenant_id: newUserTenantId,
            role: role,
            name: name,
            is_active: true
          })
          .eq('id', otherTenantAppUser.id)
          .select()
          .single();

        if (updateError) {
          console.error('Failed to update user tenant:', updateError);
          return new Response(
            JSON.stringify({ error: 'Failed to update user tenant' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            user: {
              id: updatedAppUser.id,
              email,
              name,
              role,
              auth_user_id: authUserId
            },
            message: 'Existing user linked to new tenant'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Create new user in Supabase Auth
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          name,
          role
        }
      });

      if (createError || !newUser.user) {
        console.error('Failed to create user in auth:', createError);
        return new Response(
          JSON.stringify({ error: createError?.message || 'Failed to create user' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      authUserId = newUser.user.id;
    }

    // Create app_users record (only if not already handled above)
    const { data: appUser, error: appUserError } = await supabaseAdmin
      .from('app_users')
      .insert({
        auth_user_id: authUserId,
        email,
        name,
        role,
        is_active: true,
        must_change_password: !isExistingUser, // Only require password change for new users
        tenant_id: newUserTenantId
      })
      .select()
      .single();

    if (appUserError) {
      console.error('Failed to create app_users record:', appUserError);
      // Only delete auth user if we just created it
      if (!isExistingUser) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
      }
      return new Response(
        JSON.stringify({ error: 'Failed to create user profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log the action (tenant_id is auto-set by trigger, but we can be explicit)
    await supabaseAdmin
      .from('audit_logs')
      .insert({
        actor_id: (await supabase.from('app_users').select('id').eq('auth_user_id', user.id).single()).data?.id,
        action: 'create_user',
        target_user_id: appUser.id,
        tenant_id: newUserTenantId,
        details: {
          email,
          name,
          role
        }
      });

    console.log('User created successfully:', { id: authUserId, email, role, isExistingUser });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: appUser.id,
          email,
          name,
          role,
          auth_user_id: authUserId
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});