/**
 * Accounting sync v2 — provider constants.
 *
 * A NEW module beside `_shared/accounting/` (v1), not an edit of it: v1's
 * functions import that one and V2_PLAN §7 forbids changing a shared helper
 * under them.
 *
 * Redirect URIs: v2 has its own callbacks, so they need their own redirect URI
 * registered in each provider's developer console:
 *   Xero  → https://<project>.supabase.co/functions/v1/xero-oauth-callback-v2
 *   Zoho  → https://<project>.supabase.co/functions/v1/zoho-oauth-callback-v2
 * Override with XERO_V2_REDIRECT_URI / ZOHO_V2_REDIRECT_URI if they differ.
 * (XERO_REDIRECT_URI / ZOHO_REDIRECT_URI are v1's and point at v1's callbacks.)
 */

export type Provider = "xero" | "zoho";

export const XERO = {
  authorizeUrl: "https://login.xero.com/identity/connect/authorize",
  tokenUrl: "https://identity.xero.com/connect/token",
  revokeUrl: "https://identity.xero.com/connect/revocation",
  connectionsUrl: "https://api.xero.com/connections",
  apiBase: "https://api.xero.com/api.xro/2.0",
  /**
   * Granular scopes — apps created after 2 March 2026 cannot request the old
   * broad `accounting.transactions`. Minimum set for what the engine calls:
   *   contacts          → accounting.contacts
   *   invoices, credit notes → accounting.invoices
   *   payments, prepayment/credit-note refunds → accounting.payments
   *   prepayments (RECEIVE-PREPAYMENT bank transactions) → accounting.banktransactions
   *   organisation, accounts, tax rates (read only) → accounting.settings.read
   */
  scopes: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "accounting.contacts",
    "accounting.invoices",
    "accounting.payments",
    "accounting.banktransactions",
    "accounting.settings.read",
  ].join(" "),
} as const;

export const ZOHO = {
  scopes: [
    "ZohoBooks.contacts.ALL",
    "ZohoBooks.invoices.ALL",
    "ZohoBooks.customerpayments.ALL",
    "ZohoBooks.creditnotes.ALL",
    "ZohoBooks.settings.READ",
    // GET /chartofaccounts is under the Accountant module, not settings.
    "ZohoBooks.accountants.READ",
  ].join(","),
};

/** Data centres the portal offers (accounts.zoho.<suffix>). Zoho tells us the real one on return. */
export const ZOHO_REGIONS = ["com", "eu", "uk", "in", "com.au", "jp", "sa", "ca"] as const;

export function zohoAccountsServer(region: string): string {
  return region === "ca" ? "https://accounts.zohocloud.ca" : `https://accounts.zoho.${region}`;
}

/** accounts-server URL (as Zoho returns it) → our region suffix. */
export function zohoRegionFromAccountsServer(server: string | null): string | null {
  if (!server) return null;
  try {
    const host = new URL(server).hostname;
    if (host.endsWith("zohocloud.ca")) return "ca";
    const m = host.match(/^accounts\.zoho\.(.+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** The Zoho Books web app for an api_domain, for "Open Zoho". */
export function zohoBooksWebUrl(apiDomain: string | null, region: string | null, orgId: string | null): string {
  let host = "books.zoho.com";
  if (apiDomain) {
    try {
      const h = new URL(apiDomain).hostname; // www.zohoapis.eu
      host = h.endsWith("zohoapis.ca") ? "books.zohocloud.ca" : h.replace(/^www\.zohoapis\./, "books.zoho.");
    } catch { /* fall through */ }
  } else if (region) {
    host = region === "ca" ? "books.zohocloud.ca" : `books.zoho.${region}`;
  }
  return orgId ? `https://${host}/app/${orgId}#/home/dashboard` : `https://${host}/`;
}

export function xeroWebUrl(shortCode: string | null): string {
  return shortCode
    ? `https://go.xero.com/organisationlogin/default.aspx?shortcode=${encodeURIComponent(shortCode)}`
    : "https://go.xero.com/";
}

export function redirectUri(provider: Provider): string {
  const explicit = Deno.env.get(provider === "xero" ? "XERO_V2_REDIRECT_URI" : "ZOHO_V2_REDIRECT_URI");
  if (explicit) return explicit;
  return `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/${provider}-oauth-callback-v2`;
}

export function clientCreds(provider: Provider): { id: string; secret: string } | null {
  const id = Deno.env.get(provider === "xero" ? "XERO_CLIENT_ID" : "ZOHO_CLIENT_ID");
  const secret = Deno.env.get(provider === "xero" ? "XERO_CLIENT_SECRET" : "ZOHO_CLIENT_SECRET");
  return id && secret ? { id, secret } : null;
}

/**
 * Where the browser may be sent back to after OAuth. The callback 302s to this
 * verbatim, so an unchecked value would be an open redirect carrying a freshly
 * authorised session. Our own portal hosts, localhost, or the tenant's own
 * custom portal domain.
 */
export function isAllowedRedirect(raw: string, customPortalDomain: string | null): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1") return true;
    if (u.protocol !== "https:") return false;
    if (host === "drive-247.com" || host.endsWith(".drive-247.com")) return true;
    if (customPortalDomain && host === customPortalDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
