// Shared BoldSign client helper for per-tenant mode support
// Mirrors pattern from stripe-client.ts

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export type BoldSignMode = 'test' | 'live';

/**
 * Get BoldSign API key for the given mode
 */
export function getBoldSignApiKey(mode: BoldSignMode): string {
  const apiKey = mode === 'live'
    ? (Deno.env.get('BOLDSIGN_LIVE_API_KEY') || Deno.env.get('BOLDSIGN_API_KEY'))
    : Deno.env.get('BOLDSIGN_TEST_API_KEY');

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
 * Get tenant's BoldSign mode from database
 */
export async function getTenantBoldSignMode(
  supabase: SupabaseClient,
  tenantId: string
): Promise<BoldSignMode> {
  const { data, error } = await supabase
    .from('tenants')
    .select('boldsign_mode')
    .eq('id', tenantId)
    .single();

  if (error || !data) {
    console.error('Failed to get tenant BoldSign mode, defaulting to test:', error);
    return 'test';
  }

  return (data.boldsign_mode as BoldSignMode) || 'test';
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
