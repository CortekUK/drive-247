// Cron-driven Tesla Supercharger sync.
// Triggered hourly by pg_cron; loops over every tenant with the integration enabled
// and runs the same per-tenant sync engine the portal's refresh button uses.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { syncTeslaChargesForTenant } from '../_shared/tesla-sync-engine.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: tenants, error } = await supabase
      .from('tenants')
      .select('id, slug')
      .eq('integration_tesla_fleet', true);

    if (error) return errorResponse(`Failed to list tenants: ${error.message}`, 500);
    if (!tenants?.length) return jsonResponse({ ok: true, tenantsProcessed: 0 });

    const perTenant: Array<{ tenantId: string; slug: string; synced?: number; vehiclesChecked?: number; error?: string }> = [];
    let totalSynced = 0;

    for (const tenant of tenants) {
      try {
        const result = await syncTeslaChargesForTenant(supabase, tenant.id);
        totalSynced += result.synced;
        perTenant.push({
          tenantId: tenant.id,
          slug: tenant.slug,
          synced: result.synced,
          vehiclesChecked: result.vehiclesChecked,
        });
      } catch (tenantErr: any) {
        console.error(`[sync-tesla-charges-cron] tenant ${tenant.slug} failed:`, tenantErr);
        perTenant.push({ tenantId: tenant.id, slug: tenant.slug, error: tenantErr.message });
      }
    }

    return jsonResponse({
      ok: true,
      tenantsProcessed: tenants.length,
      totalSynced,
      perTenant,
    });
  } catch (err: any) {
    console.error('[sync-tesla-charges-cron] Error:', err);
    return errorResponse(err.message || 'Internal server error', 500);
  }
});
