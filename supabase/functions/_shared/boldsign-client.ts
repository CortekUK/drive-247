// Shared BoldSign client helper for per-tenant mode support
// Mirrors pattern from stripe-client.ts

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { resolveBoldSignMode } from './lean-tenants.ts';

export type BoldSignMode = 'test' | 'live';

/**
 * Get BoldSign API key for the given mode
 */
export function getBoldSignApiKey(mode: BoldSignMode): string {
  const apiKey = mode === 'live'
    ? (Deno.env.get('BOLDSIGN_LIVE_API_KEY') || Deno.env.get('BOLDSIGN_API_KEY'))
    : (Deno.env.get('BOLDSIGN_TEST_API_KEY') || Deno.env.get('BOLDSIGN_API_KEY'));

  if (!apiKey) {
    throw new Error(`Missing BoldSign API key for ${mode} mode`);
  }

  return apiKey;
}

/**
 * Get BoldSign base URL (same for both modes)
 */
export function getBoldSignBaseUrl(): string {
  return Deno.env.get('BOLDSIGN_BASE_URL') || 'https://api.boldsign.com';
}

/**
 * Get tenant's BoldSign mode from database.
 *
 * Lean tenants are ALWAYS live — the lean product has no test modes — so the
 * `boldsign_mode` column is overridden for them here. `slug` is selected purely
 * to feed that gate, which is slug-keyed because a tenant's id differs per
 * environment.
 */
export async function getTenantBoldSignMode(
  supabase: SupabaseClient,
  tenantId: string
): Promise<BoldSignMode> {
  const { data, error } = await supabase
    .from('tenants')
    .select('boldsign_mode, slug')
    .eq('id', tenantId)
    .single();

  if (error || !data) {
    console.error('Failed to get tenant BoldSign mode, defaulting to test:', error);
    return 'test';
  }

  return resolveBoldSignMode(data.boldsign_mode as string | null, data.slug as string | null);
}

/**
 * Get the appropriate brand ID for the tenant's current mode
 */
export function getBoldSignBrandId(
  tenant: { boldsign_test_brand_id?: string | null; boldsign_live_brand_id?: string | null },
  mode: BoldSignMode
): string | null {
  if (mode === 'test') {
    return tenant.boldsign_test_brand_id || null;
  }
  return tenant.boldsign_live_brand_id || null;
}
