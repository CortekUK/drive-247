import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DeactivateUserRequest {
  userId: string;
  isActive: boolean;
}

Deno.serve(async (req) => {
  console.log('admin-deactivate-user function called');

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
      .select('id, role, is_active')
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

    const { userId, isActive }: DeactivateUserRequest = await req.json();

    // Get target user details
    const { data: targetUser, error: targetError } = await supabase
      .from('app_users')
      .select('id, auth_user_id, email, role, is_active')
      .eq('id', userId)
      .single();

    if (targetError || !targetUser) {
      console.error('Target user not found:', targetError);
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only head_admin can deactivate other admins
    if ((targetUser.role === 'admin' || targetUser.role === 'head_admin') && currentUserData.role !== 'head_admin') {
      return new Response(
        JSON.stringify({ error: 'Only head admin can deactivate admin users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prevent users from deactivating themselves
    if (targetUser.id === currentUserData.id) {
      return new Response(
        JSON.stringify({ error: 'Cannot deactivate your own account' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const wasActive = targetUser.is_active;

    // Update the active status
    const { error: updateError } = await supabaseAdmin
      .from('app_users')
      .update({ is_active: isActive })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to update user status:', updateError);
      return new Response(
        JSON.stringify({ error: updateError.message || 'Failed to update user status' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If deactivating, sign out the user by invalidating all sessions
    if (!isActive && wasActive) {
      try {
        await supabaseAdmin.auth.admin.signOut(targetUser.auth_user_id, 'global');
      } catch (signOutError) {
        console.warn('Failed to sign out user sessions:', signOutError);
        // Continue as this is not critical - the user will be blocked on next request anyway
      }
    }

    // Log the action
    await supabase
      .from('audit_logs')
      .insert({
        actor_id: currentUserData.id,
        action: isActive ? 'activate_user' : 'deactivate_user',
        target_user_id: targetUser.id,
        details: {
          target_email: targetUser.email,
          previous_status: wasActive ? 'active' : 'inactive',
          new_status: isActive ? 'active' : 'inactive'
        }
      });

    console.log(`User ${isActive ? 'activated' : 'deactivated'} successfully:`, targetUser.email);

    return new Response(
      JSON.stringify({ success: true }),
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