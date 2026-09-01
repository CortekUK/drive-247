// User-initiated Tesla Supercharger sync (refresh button in portal).
// Cron-driven sync is in `sync-tesla-charges-cron`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { syncTeslaChargesForTenant } from '../_shared/tesla-sync-engine.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse('Unauthorized', 401);

    const { data: appUser } = await supabase
      .from('app_users')
      .select('tenant_id, role, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (!appUser) return errorResponse('User not found', 403);

    const body = await req.json();
    const requestedTenantId = body.tenantId;
    const rentalId = body.rentalId;
    const vehicleId = body.vehicleId;

    if (requestedTenantId && requestedTenantId !== appUser.tenant_id && !appUser.is_super_admin) {
      return errorResponse('Forbidden: cannot sync another tenant', 403);
    }
    const tenantId = requestedTenantId || appUser.tenant_id;
    if (!tenantId) return errorResponse('No tenant ID', 400);

    const { data: tenant } = await supabase
      .from('tenants')
      .select('integration_tesla_fleet')
      .eq('id', tenantId)
      .single();

    if (!tenant?.integration_tesla_fleet) {
      return errorResponse('Tesla Fleet API not enabled for this tenant', 400);
    }

    const result = await syncTeslaChargesForTenant(supabase, tenantId, { rentalId, vehicleId });
    return jsonResponse(result);
  } catch (err: any) {
    console.error('[sync-tesla-charges] Error:', err);
    return errorResponse(err.message || 'Internal server error', 500);
  }
});
