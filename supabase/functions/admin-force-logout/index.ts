import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ForceLogoutRequest {
  tenantId?: string | null;
}

Deno.serve(async (req) => {
  console.log('admin-force-logout function called');

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

    // Verify user session
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
      .select('id, role, is_active, is_super_admin')
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
        JSON.stringify({ error: 'Only super admins can force logout users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { tenantId }: ForceLogoutRequest = await req.json();
    const isGlobal = !tenantId;

    console.log(isGlobal ? 'Global force logout requested' : `Force logout for tenant: ${tenantId}`);

    // Gather auth_user_ids to sign out
    const authUserIds: string[] = [];

    // Get app_users (portal staff)
    const appUsersQuery = supabaseAdmin
      .from('app_users')
      .select('auth_user_id, is_super_admin');

    if (tenantId) {
      appUsersQuery.eq('tenant_id', tenantId);
    }

    const { data: appUsers, error: appUsersError } = await appUsersQuery;

    if (appUsersError) {
      console.error('Error fetching app_users:', appUsersError);
    } else if (appUsers) {
      for (const u of appUsers) {
        // Skip super admins on global logout to prevent locking out the caller
        if (isGlobal && u.is_super_admin) continue;
        if (u.auth_user_id) authUserIds.push(u.auth_user_id);
      }
    }

    // Get customer_users (booking customers)
    const customerUsersQuery = supabaseAdmin
      .from('customer_users')
      .select('auth_user_id');

    if (tenantId) {
      customerUsersQuery.eq('tenant_id', tenantId);
    }

    const { data: customerUsers, error: customerUsersError } = await customerUsersQuery;

    if (customerUsersError) {
      console.error('Error fetching customer_users:', customerUsersError);
    } else if (customerUsers) {
      for (const u of customerUsers) {
        if (u.auth_user_id) authUserIds.push(u.auth_user_id);
      }
    }

    // Deduplicate
    const uniqueIds = [...new Set(authUserIds)];

    console.log(`Found ${uniqueIds.length} users to sign out`);

    // Sign out each user
    let successCount = 0;
    let failCount = 0;

    for (const authUserId of uniqueIds) {
      try {
        await supabaseAdmin.auth.admin.signOut(authUserId, 'global');
        successCount++;
      } catch (err) {
        failCount++;
        console.warn(`Failed to sign out ${authUserId}:`, err);
      }
    }

    // Audit log
    try {
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          actor_id: currentUserData.id,
          action: isGlobal ? 'force_logout_global' : 'force_logout_tenant',
          tenant_id: tenantId || null,
          details: {
            target_tenant_id: tenantId || 'all',
            total_users: uniqueIds.length,
            success_count: successCount,
            fail_count: failCount,
          }
        });
    } catch (auditError) {
      console.warn('Failed to write audit log:', auditError);
    }

    console.log(`Force logout complete: ${successCount} success, ${failCount} failed out of ${uniqueIds.length} total`);

    return new Response(
      JSON.stringify({
        success: true,
        totalUsers: uniqueIds.length,
        successCount,
        failCount,
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
