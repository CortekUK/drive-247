import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DeleteTenantRequest {
  tenant_id: string;
}

Deno.serve(async (req) => {
  console.log('admin-delete-tenant function called');

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

    // Verify user session and check if they're a super admin
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Failed to verify user session:', userError);
      return new Response(
        JSON.stringify({ error: 'Invalid session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is a super admin
    const { data: currentUserData, error: roleError } = await supabase
      .from('app_users')
      .select('role, is_active, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (roleError || !currentUserData) {
      console.error('Failed to get user role:', roleError);
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!currentUserData.is_super_admin) {
      console.error('User is not a super admin');
      return new Response(
        JSON.stringify({ error: 'Only super admins can delete tenants' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { tenant_id }: DeleteTenantRequest = await req.json();

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: 'tenant_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Deleting tenant:', tenant_id);

    // Get all app_users for this tenant to delete their auth accounts
    const { data: appUsers, error: appUsersError } = await supabaseAdmin
      .from('app_users')
      .select('id, auth_user_id, email')
      .eq('tenant_id', tenant_id);

    if (appUsersError) {
      console.error('Error fetching app_users:', appUsersError);
    }

    const deletedAuthUsers: string[] = [];
    const failedAuthUsers: string[] = [];

    // Delete auth users for this tenant
    if (appUsers && appUsers.length > 0) {
      for (const appUser of appUsers) {
        if (appUser.auth_user_id) {
          try {
            const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(appUser.auth_user_id);
            if (deleteAuthError) {
              console.error(`Failed to delete auth user ${appUser.auth_user_id}:`, deleteAuthError);
              failedAuthUsers.push(appUser.email);
            } else {
              console.log(`Deleted auth user: ${appUser.email}`);
              deletedAuthUsers.push(appUser.email);
            }
          } catch (err) {
            console.error(`Exception deleting auth user ${appUser.auth_user_id}:`, err);
            failedAuthUsers.push(appUser.email);
          }
        }
      }
    }

    // Get vehicle IDs for this tenant (needed for pnl_entries)
    const { data: vehicles } = await supabaseAdmin
      .from('vehicles')
      .select('id')
      .eq('tenant_id', tenant_id);

    const vehicleIds = vehicles ? vehicles.map(v => v.id) : [];

    // Delete all related data in order of dependencies
    const deletionResults: Record<string, number | string> = {};

    // Delete pnl_entries by vehicle_id
    if (vehicleIds.length > 0) {
      const { data: pnlData, error: pnlError } = await supabaseAdmin
        .from('pnl_entries')
        .delete()
        .in('vehicle_id', vehicleIds)
        .select('id');
      deletionResults.pnl_entries = pnlError ? pnlError.message : (pnlData?.length || 0);
    }

    // Delete tables with tenant_id
    const tablesWithTenantId = [
      'ledger_entries',
      'payments',
      'fines',
      'reminders',
      'service_records',
      'rentals',
      'vehicles',
      'customers',
      'app_users',
      'audit_logs',
    ];

    for (const table of tablesWithTenantId) {
      try {
        const { data, error } = await supabaseAdmin
          .from(table)
          .delete()
          .eq('tenant_id', tenant_id)
          .select('id');

        deletionResults[table] = error ? error.message : (data?.length || 0);
      } catch (err) {
        deletionResults[table] = `Error: ${err}`;
      }
    }

    // Finally delete the tenant
    const { error: tenantError } = await supabaseAdmin
      .from('tenants')
      .delete()
      .eq('id', tenant_id);

    if (tenantError) {
      console.error('Error deleting tenant:', tenantError);
      return new Response(
        JSON.stringify({
          error: `Failed to delete tenant: ${tenantError.message}`,
          deletionResults,
          deletedAuthUsers,
          failedAuthUsers
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Tenant deleted successfully:', tenant_id);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Tenant and all associated data deleted successfully',
        deletionResults,
        deletedAuthUsers,
        failedAuthUsers
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
