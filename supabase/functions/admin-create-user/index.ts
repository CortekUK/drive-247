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

    // Check if user has admin privileges
    const { data: currentUserData, error: roleError } = await supabase
      .from('app_users')
      .select('role, is_active')
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
    const { email, name, role, temporaryPassword }: CreateUserRequest = await req.json();

    if ((role === 'admin' || role === 'head_admin') && currentUserData.role !== 'head_admin') {
      return new Response(
        JSON.stringify({ error: 'Only head admin can create admin users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create the user in Supabase Auth using admin API
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

    // Create corresponding app_users record
    const { data: appUser, error: appUserError } = await supabaseAdmin
      .from('app_users')
      .insert({
        auth_user_id: newUser.user.id,
        email,
        name,
        role,
        is_active: true,
        must_change_password: true
      })
      .select()
      .single();

    if (appUserError) {
      console.error('Failed to create app_users record:', appUserError);
      // Try to clean up the auth user
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      return new Response(
        JSON.stringify({ error: 'Failed to create user profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log the action
    await supabase
      .from('audit_logs')
      .insert({
        actor_id: (await supabase.from('app_users').select('id').eq('auth_user_id', user.id).single()).data?.id,
        action: 'create_user',
        target_user_id: appUser.id,
        details: {
          email,
          name,
          role
        }
      });

    console.log('User created successfully:', { id: newUser.user.id, email, role });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: appUser.id,
          email,
          name,
          role,
          auth_user_id: newUser.user.id
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