/**
 * Finance Sync — provider factory (Spec §7.2).
 *
 * Single entry point for `process-accounting-sync` / list-edge-fns to get
 * a configured provider client. Encapsulates:
 *   - Calling `accounting_get_tokens` RPC to retrieve vault-decrypted creds
 *   - Validating the connection is still active (not expired/revoked)
 *   - Constructing the right concrete client (Xero or Zoho)
 *
 * Refresh-on-expiry is handled separately by the `refresh-accounting-tokens`
 * cron. If a token has expired between cron ticks and a worker request fires
 * with a stale access_token, the provider call will 401 → ProviderError(auth)
 * → next cron tick refreshes → retry succeeds.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { AccountingProvider, ProviderError, ProviderName } from "./types.ts";
import { XeroClient } from "./xero-client.ts";
import { ZohoClient } from "./zoho-client.ts";

export async function getProvider(
  supabase: SupabaseClient,
  tenantId: string,
  provider: ProviderName,
): Promise<AccountingProvider> {
  // accounting_get_tokens returns a row containing the decrypted vault
  // secrets (access_token, refresh_token) + org metadata.
  const { data, error } = await supabase.rpc("accounting_get_tokens", {
    p_tenant_id: tenantId,
    p_provider: provider,
  });
  if (error) {
    throw new ProviderError(
      `Failed to load ${provider} tokens for tenant ${tenantId}: ${error.message}`,
      "unknown",
      undefined,
      "TOKEN_FETCH_FAILED",
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.access_token) {
    throw new ProviderError(
      `No active ${provider} connection for tenant ${tenantId}`,
      "auth",
      undefined,
      "NO_ACTIVE_CONNECTION",
    );
  }

  if (provider === "xero") {
    return new XeroClient(row.access_token as string, row.external_org_id as string);
  }
  return new ZohoClient(
    row.access_token as string,
    row.external_org_id as string,
    (row.external_region as string | null) ?? "com",
  );
}
