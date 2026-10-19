/**
 * The only door to a tenant's Twilio secrets.
 *
 * The Auth Token and the API key secret live in Supabase Vault
 * (migration 20261019160100). `tenants` keeps only their vault ids. The RPCs
 * below are SECURITY DEFINER and executable by service_role alone, so this
 * module only works with a service-role client — which is the point.
 *
 * Rules for callers:
 *   - never log a value returned from here, nor an object that contains one;
 *   - never return one to a client (status endpoints say "stored", nothing more);
 *   - write through storeTwilioAuthToken / storeTwilioApiKeySecret, never by
 *     updating `tenants.twilio_auth_token` (a CHECK constraint now rejects it).
 */

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

export interface TwilioSecrets {
  authToken: string;
  apiKeySecret: string;
}

export async function getTwilioSecrets(supabase: ServiceClient, tenantId: string): Promise<TwilioSecrets> {
  const { data, error } = await supabase.rpc('twilio_get_secrets', { p_tenant_id: tenantId });
  if (error) throw new Error(`Could not read Twilio credentials: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { authToken: row?.auth_token ?? '', apiKeySecret: row?.api_key_secret ?? '' };
}

async function setSecret(supabase: ServiceClient, tenantId: string, kind: 'auth_token' | 'api_key_secret', value: string | null) {
  const { error } = await supabase.rpc('twilio_set_secret', { p_tenant_id: tenantId, p_kind: kind, p_value: value ?? null });
  if (error) throw new Error(`Could not store Twilio credentials: ${error.message}`);
}

/** Pass null to delete. */
export function storeTwilioAuthToken(supabase: ServiceClient, tenantId: string, token: string | null) {
  return setSecret(supabase, tenantId, 'auth_token', token);
}

/** Pass null to delete. */
export function storeTwilioApiKeySecret(supabase: ServiceClient, tenantId: string, secret: string | null) {
  return setSecret(supabase, tenantId, 'api_key_secret', secret);
}

/**
 * Auth token for whichever tenant owns this Account SID (webhook signature
 * checks only know the AccountSid). Returns null when no tenant matches.
 */
export async function authTokenForAccountSid(supabase: ServiceClient, accountSid: string | null | undefined): Promise<string | null> {
  if (!accountSid) return null;
  const { data } = await supabase
    .from('tenants')
    .select('id')
    .eq('twilio_account_sid', accountSid)
    .not('twilio_auth_token_vault_id', 'is', null)
    .limit(1);
  const tenantId = data?.[0]?.id;
  if (!tenantId) return null;
  const { authToken } = await getTwilioSecrets(supabase, tenantId);
  return authToken || null;
}

export async function authTokenForTenant(supabase: ServiceClient, tenantId: string | null | undefined): Promise<string | null> {
  if (!tenantId) return null;
  const { authToken } = await getTwilioSecrets(supabase, tenantId);
  return authToken || null;
}
