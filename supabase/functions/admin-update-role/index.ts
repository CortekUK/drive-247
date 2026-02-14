import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PermissionEntry {
  tab_key: string;
  access_level: 'viewer' | 'editor';
}

interface UpdateRoleRequest {
  userId: string;
  newRole: 'head_admin' | 'admin' | 'manager' | 'ops' | 'viewer';
  permissions?: PermissionEntry[]; // Required when newRole is 'manager'
}

const ALLOWED_TAB_KEYS = [
  'vehicles', 'rentals', 'pending_bookings', 'availability',
  'customers', 'blocked_customers', 'messages',
  'payments', 'invoices', 'fines',
  'documents', 'reminders', 'reports', 'pl_dashboard',
  'cms', 'audit_logs', 'settings',
  'settings.general', 'settings.locations', 'settings.branding',
  'settings.rental', 'settings.extras', 'settings.payments',
  'settings.reminders', 'settings.templates', 'settings.integrations',
  'settings.subscription',
];

Deno.serve(async (req) => {
  console.log('admin-update-role function called');

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
      .select('id, role, is_active, tenant_id')
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

    const { userId, newRole, permissions }: UpdateRoleRequest = await req.json();

    // Validate manager permissions
    if (newRole === 'manager') {
      if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Manager role requires at least one permission' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const invalidKeys = permissions.filter(p => !ALLOWED_TAB_KEYS.includes(p.tab_key));
      if (invalidKeys.length > 0) {
        return new Response(
          JSON.stringify({ error: `Invalid tab keys: ${invalidKeys.map(k => k.tab_key).join(', ')}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Get target user details
    const { data: targetUser, error: targetError } = await supabase
      .from('app_users')
      .select('id, auth_user_id, email, role')
      .eq('id', userId)
      .single();

    if (targetError || !targetUser) {
      console.error('Target user not found:', targetError);
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only head_admin can change roles of admins/managers or promote to admin/head_admin/manager
    if (
      (targetUser.role === 'admin' || targetUser.role === 'head_admin' || targetUser.role === 'manager' ||
       newRole === 'admin' || newRole === 'head_admin' || newRole === 'manager') &&
      currentUserData.role !== 'head_admin'
    ) {
      return new Response(
        JSON.stringify({ error: 'Only head admin can manage admin and manager roles' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prevent users from changing their own role
    if (targetUser.id === currentUserData.id) {
      return new Response(
        JSON.stringify({ error: 'Cannot change your own role' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const oldRole = targetUser.role;

    // Update the role
    const { error: updateError } = await supabaseAdmin
      .from('app_users')
      .update({ role: newRole })
      .eq('id', userId);

    if (updateError) {
      console.error('Failed to update role:', updateError);
      return new Response(
        JSON.stringify({ error: updateError.message || 'Failed to update role' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle manager permissions
    if (newRole === 'manager' && permissions && permissions.length > 0) {
      // Delete existing permissions
      await supabaseAdmin
        .from('manager_permissions')
        .delete()
        .eq('app_user_id', userId);

      // Insert new permissions
      const permissionRows = permissions.map(p => ({
        app_user_id: userId,
        tab_key: p.tab_key,
        access_level: p.access_level,
      }));

      const { error: permError } = await supabaseAdmin
        .from('manager_permissions')
        .insert(permissionRows);

      if (permError) {
        console.error('Failed to insert manager permissions:', permError);
        // Revert role change
        await supabaseAdmin.from('app_users').update({ role: oldRole }).eq('id', userId);
        return new Response(
          JSON.stringify({ error: 'Failed to set manager permissions' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (oldRole === 'manager' && newRole !== 'manager') {
      // Changing FROM manager — clean up permissions
      await supabaseAdmin
        .from('manager_permissions')
        .delete()
        .eq('app_user_id', userId);
    }

    // Update auth user metadata
    await supabaseAdmin.auth.admin.updateUserById(
      targetUser.auth_user_id,
      {
        user_metadata: {
          role: newRole,
          role_updated_by: currentUserData.id,
          role_updated_at: new Date().toISOString()
        }
      }
    );

    // Log the action
    const auditData: any = {
      actor_id: currentUserData.id,
      action: 'update_role',
      target_user_id: targetUser.id,
      details: {
        old_role: oldRole,
        new_role: newRole,
        target_email: targetUser.email
      }
    };

    // Add tenant_id if available
    if (currentUserData.tenant_id) {
      auditData.tenant_id = currentUserData.tenant_id;
    }

    await supabase
      .from('audit_logs')
      .insert(auditData);

    console.log('Role updated successfully:', { email: targetUser.email, oldRole, newRole });

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