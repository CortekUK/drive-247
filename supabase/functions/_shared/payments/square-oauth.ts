/**
 * Square OAuth — authorize URL, token exchange, refresh.
 *
 * MODELLED ON _shared/accounting/ (Xero/Zoho), NOT on stripe-oauth-*.
 *
 * That choice matters. stripe-oauth-callback stores an ACCOUNT ID and no secret,
 * because Stripe Connect tokens do not expire and the platform addresses the
 * merchant with a Stripe-Account header. Square has neither property: the OAuth
 * ACCESS TOKEN *is* the merchant addressing, and it EXPIRES IN 30 DAYS. So Square
 * needs encrypted credential storage plus a refresh cron — which this repo
 * already runs in production for accounting (accounting_connections + Vault
 * secret ids + refresh-accounting-tokens, pg_cron jobid 49, every 10 minutes).
 * Cloning that is what turns Square's hardest requirement from a greenfield XL
 * into an M.
 */

import { SquareMode } from "./types.ts";
import { squareBaseUrl, squareAuthorizeBaseUrl, squareFetch, SQUARE_VERSION } from "./square-client.ts";

/**
 * The pinned OAuth scope list.
 *
 * TWO THINGS ARE LOAD-BEARING HERE.
 *
 * 1. NEVER omit `scope`. Square's default when the parameter is absent is
 *    MERCHANT_PROFILE_READ PAYMENTS_READ BANK_ACCOUNTS_READ SETTLEMENTS_READ —
 *    read-only. A tenant would connect "successfully" and then be unable to take
 *    a single payment.
 *
 * 2. Adding a scope LATER forces every already-connected merchant back through
 *    the consent flow, with the operator present. So this list is effectively
 *    one-shot. CUSTOMERS_* are included even though card-on-file is out of scope
 *    for v1, purely so that decision is not foreclosed by this one.
 *
 * PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS is DELIBERATELY ABSENT. It is the scope
 * for app_fee_money. Verified by grep: application_fee, transfer_data and
 * on_behalf_of appear NOWHERE in supabase/functions — this platform takes zero
 * cut of tenant<->customer money and monetises through the Stripe subscription
 * instead. Requesting it would put "this app can take a portion of your payments"
 * on the consent screen of an app that provably takes none.
 */
export const SQUARE_OAUTH_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_WRITE",
  "PAYMENTS_READ",
  "ORDERS_WRITE",
  "ORDERS_READ",
  "CUSTOMERS_READ",
  "CUSTOMERS_WRITE",
] as const;

export function squareAuthorizeUrl(opts: {
  mode: SquareMode;
  applicationId: string;
  state: string;
  /** Square's authorize host differs from the API host in sandbox. */
  scopes?: readonly string[];
}): string {
  const scopes = (opts.scopes ?? SQUARE_OAUTH_SCOPES).join("+");
  // The AUTHORIZE host, not the API host. See squareAuthorizeBaseUrl: the two
  // differ in sandbox, and the API host renders a blank page rather than an
  // error, so getting this wrong is silent.
  const base = squareAuthorizeBaseUrl(opts.mode);
  // session=false forces a fresh sign-in. Square does NOT support it in sandbox.
  const session = opts.mode === "live" ? "&session=false" : "";
  return `${base}/oauth2/authorize?client_id=${encodeURIComponent(opts.applicationId)}` +
    `&scope=${scopes}${session}&state=${encodeURIComponent(opts.state)}`;
}

export interface SquareTokenSet {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp. Square returns expires_at; tokens live 30 days. */
  expiresAt: string;
  merchantId: string;
  /** Scopes actually GRANTED, which may be narrower than requested. */
  grantedScopes: string[];
}

interface ObtainTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  merchant_id: string;
  // deno-lint-ignore camelcase
  short_lived?: boolean;
}

/** Exchange an authorization code (valid 5 minutes) for a token set. */
export async function exchangeSquareCode(opts: {
  mode: SquareMode;
  applicationId: string;
  applicationSecret: string;
  code: string;
  redirectUri: string;
}): Promise<SquareTokenSet> {
  const res = await squareFetch<ObtainTokenResponse>({
    mode: opts.mode,
    // ObtainToken authenticates with the application secret in the BODY, not a
    // bearer token. Anything truthy in the header slot is ignored by Square.
    accessToken: "",
    method: "POST",
    path: "/oauth2/token",
    body: {
      client_id: opts.applicationId,
      client_secret: opts.applicationSecret,
      code: opts.code,
      grant_type: "authorization_code",
      redirect_uri: opts.redirectUri,
    },
  });
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: res.expires_at,
    merchantId: res.merchant_id,
    grantedScopes: [],
  };
}

/**
 * Refresh an access token.
 *
 * Square advises refreshing every 7 days or less regardless of activity, so the
 * cron window is 7 days and NOT 30 — waiting until near expiry means one failed
 * run strands the tenant. Code-flow refresh tokens do not expire and are not
 * rotated on use, so the stored refresh token stays valid across refreshes.
 */
export async function refreshSquareToken(opts: {
  mode: SquareMode;
  applicationId: string;
  applicationSecret: string;
  refreshToken: string;
}): Promise<SquareTokenSet> {
  const res = await squareFetch<ObtainTokenResponse>({
    mode: opts.mode,
    accessToken: "",
    method: "POST",
    path: "/oauth2/token",
    body: {
      client_id: opts.applicationId,
      client_secret: opts.applicationSecret,
      refresh_token: opts.refreshToken,
      grant_type: "refresh_token",
    },
  });
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? opts.refreshToken,
    expiresAt: res.expires_at,
    merchantId: res.merchant_id,
    grantedScopes: [],
  };
}

/** Days before expiry at which the refresh cron should act. */
export const SQUARE_REFRESH_WINDOW_DAYS = 7;

export { SQUARE_VERSION };
