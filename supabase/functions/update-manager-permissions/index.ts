import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PermissionEntry {
  tab_key: string;
  access_level: 'viewer' | 'editor';
}

interface UpdatePermissionsRequest {
  userId: string;
  permissions: PermissionEntry[];
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
  console.log('update-manager-permissions function called');

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user session
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check caller is head_admin or super admin
    const { data: currentUserData, error: roleError } = await supabaseAdmin
      .from('app_users')
      .select('id, role, is_active, tenant_id, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (roleError || !currentUserData) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!currentUserData.is_active || (currentUserData.role !== 'head_admin' && !currentUserData.is_super_admin)) {
      return new Response(
        JSON.stringify({ error: 'Only head admin can update manager permissions' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { userId, permissions }: UpdatePermissionsRequest = await req.json();

    // Validate permissions
    if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return new Response(
        JSON.stringify({ error: 'At least one permission is required' }),
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

    const invalidLevels = permissions.filter(p => !['viewer', 'editor'].includes(p.access_level));
    if (invalidLevels.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid access levels. Must be "viewer" or "editor"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify target user is a manager in the same tenant
    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from('app_users')
      .select('id, role, tenant_id, email')
      .eq('id', userId)
      .single();

    if (targetError || !targetUser) {
      return new Response(
        JSON.stringify({ error: 'Target user not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (targetUser.role !== 'manager') {
      return new Response(
        JSON.stringify({ error: 'Target user is not a manager' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ensure same tenant (unless super admin)
    if (!currentUserData.is_super_admin && targetUser.tenant_id !== currentUserData.tenant_id) {
      return new Response(
        JSON.stringify({ error: 'Cannot modify permissions for users in other tenants' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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
      return new Response(
        JSON.stringify({ error: 'Failed to update permissions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log the action
    await supabaseAdmin
      .from('audit_logs')
      .insert({
        actor_id: currentUserData.id,
        action: 'update_manager_permissions',
        target_user_id: userId,
        tenant_id: currentUserData.tenant_id,
        details: {
          target_email: targetUser.email,
          permissions: permissions,
        }
      });

    console.log('Manager permissions updated successfully for user:', userId);

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
