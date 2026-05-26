/**
 * Finance Sync — shared OAuth constants per provider.
 *
 * Centralised so the start, callback, and refresh edge functions all agree
 * on the same URLs + scopes. Per Spec §6.4 (provider-specific URLs).
 */

export const XERO = {
  authorizeUrl: "https://login.xero.com/identity/connect/authorize",
  tokenUrl: "https://identity.xero.com/connect/token",
  connectionsUrl: "https://api.xero.com/connections",
  apiBase: "https://api.xero.com/api.xro/2.0",
  /** Drive247 uses Xero's NEW granular scopes (Xero deprecated the broad
   *  `accounting.transactions` scope for apps created after 2 March 2026).
   *
   *  What we need per API endpoint we call (xero-client.ts):
   *    - POST /Contacts        → accounting.contacts
   *    - POST /Invoices        → accounting.invoices
   *    - POST /Payments        → accounting.payments
   *    - POST /CreditNotes     → accounting.invoices (credit notes are under invoices in the new model)
   *    - GET  /Accounts        → accounting.settings (covers .read too)
   *    - GET  /TaxRates        → accounting.settings
   *    - POST /Invoices/{id}   → accounting.invoices (for void)
   *
   *  offline_access is mandatory for refresh tokens. */
  scopes: [
    "openid",
    "profile",
    "email",
    "accounting.contacts",
    "accounting.invoices",
    "accounting.payments",
    "accounting.settings",
    "offline_access",
  ].join(" "),
} as const;

export const ZOHO = {
  /** Region-specific URLs — interpolate {region} = 'com'|'eu'|'in'|'com.au'|'jp'|'sa'. */
  authorizeUrl: (region: string) => `https://accounts.zoho.${region}/oauth/v2/auth`,
  tokenUrl: (region: string) => `https://accounts.zoho.${region}/oauth/v2/token`,
  organizationsUrl: (region: string) => `https://www.zohoapis.${region}/books/v3/organizations`,
  apiBase: (region: string) => `https://www.zohoapis.${region}/books/v3`,
  scopes: [
    "ZohoBooks.contacts.ALL",
    "ZohoBooks.invoices.ALL",
    "ZohoBooks.customerpayments.ALL",
    "ZohoBooks.creditnotes.ALL",
    "ZohoBooks.settings.READ",
  ].join(","),
} as const;

/** Build the redirect URI the provider will send the user back to. */
export function getRedirectUri(provider: "xero" | "zoho"): string {
  const explicit = Deno.env.get(provider === "xero" ? "XERO_REDIRECT_URI" : "ZOHO_REDIRECT_URI");
  if (explicit && explicit.length > 0) return explicit;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return `${supabaseUrl}/functions/v1/${provider}-oauth-callback`;
}

/** Where to send the operator back in the portal after a successful round-trip. */
export function defaultRedirectBack(provider: "xero" | "zoho"): string {
  const portalBase = Deno.env.get("PORTAL_BASE_URL") ?? "";
  // Tenant subdomain isn't known here; we rely on the start fn to pass redirect_back
  // when it has the slug. This is the absolute fallback.
  return portalBase
    ? `${portalBase}/settings?tab=accounting&status=success&provider=${provider}`
    : `/settings?tab=accounting&status=success&provider=${provider}`;
}
