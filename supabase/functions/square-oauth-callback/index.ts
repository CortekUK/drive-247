// square-oauth-callback — public redirect target for the Square OAuth flow.
//
// Square 302-redirects the OPERATOR'S BROWSER here with ?code&state (or ?error
// when they cancel or deny). A top-level browser navigation cannot carry a JWT,
// so this function requires `[functions.square-oauth-callback] verify_jwt = false`
// in supabase/config.toml. That entry is owned by another change — this file only
// depends on it. Security comes from two places instead of a JWT:
//   1. the single-use `square_oauth_state` row minted by square-oauth-start,
//      which was itself authenticated and tenant-scoped, and expires in 30 min;
//   2. the authorization-code exchange, which only succeeds against our
//      application secret.
//
// ── WHY THIS IS NOT A COPY OF stripe-oauth-callback ──────────────────────────
// Stripe hands back an ACCOUNT ID that never expires and is addressed with a
// Stripe-Account header, so its callback can write one column on `tenants` and
// be done. Square hands back an ACCESS TOKEN that EXPIRES IN 30 DAYS, and that
// token IS the merchant addressing — Square has no Stripe-Account header. So:
//   * tokens go into Vault through the square_store_tokens RPC, never into a
//     column and never into a log line;
//   * ownership of the token passes immediately to the refresh cron;
//   * `state` is a DB row we CONSUME rather than an HMAC we verify, because the
//     row also carries created_by, which becomes square_connections.connected_by.
// The nearest precedent in this repo is _shared/accounting/ + zoho-oauth-callback
// (Vault-backed, expiring, refresh-cron-owned), not the Stripe pair.
//
// ── WHY WE PROBE BEFORE DECLARING SUCCESS ────────────────────────────────────
// Stripe exposes one boolean, `charges_enabled`. Square exposes nothing
// equivalent. The nearest composite is: a location with status ACTIVE whose
// `capabilities` contain CREDIT_CARD_PROCESSING, AND whose currency matches the
// tenant's own currency_code — Square binds currency to the LOCATION and will
// not convert, so a mismatch 400s every payment link that tenant will ever
// create. On 17 Aug 2026 the Stripe flow reported "connected" for an account
// Stripe had paused and took a live tenant offline for two days. Same failure
// mode, same answer: never activate a tenant on the strength of a token alone.
//
// This function NEVER writes to `tenants`. payment_provider carries an
// immutability trigger and the flip to Square is an onboarding decision made
// elsewhere; connecting a merchant account is not the same event as routing a
// tenant's money to it.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, errorResponse } from "../_shared/cors.ts";
import { exchangeSquareCode, SQUARE_OAUTH_SCOPES } from "../_shared/payments/square-oauth.ts";
import { squareFetch } from "../_shared/payments/square-client.ts";
import { SquareError, type SquareMode } from "../_shared/payments/types.ts";

const LOG = "[square-oauth-callback]";

/** Fallback token lifetime if Square ever omits expires_at. Square's OAuth
 *  access tokens live 30 days; a NULL here would leave the refresh cron with no
 *  due date, so we write a conservative concrete one instead. */
const FALLBACK_TOKEN_TTL_DAYS = 30;

/**
 * The three outcomes, deliberately identical to the Stripe callback's.
 *
 * `incomplete` is a THIRD state, not a flavour of failure. The handshake really
 * did succeed and we really do hold the merchant's tokens — but Square cannot
 * take a card on this connection yet (no ACTIVE card-capable location, or the
 * location's currency is not the tenant's). Calling that 'ok' is the 17 Aug
 * outage. Calling it 'error' pushes the operator to redo a step they finished.
 */
type Outcome = "ok" | "incomplete" | "error";

interface StateRow {
  state: string;
  tenant_id: string;
  square_mode: string;
  return_to: string | null;
  origin: string | null;
  created_by: string | null;
  expires_at: string;
}

interface SquareLocation {
  id?: string;
  name?: string;
  status?: string;
  currency?: string;
  country?: string;
  capabilities?: string[];
}

interface SquareMerchant {
  business_name?: string;
  country?: string;
  currency?: string;
  status?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe diagnostics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make an UNTRUSTED string safe to interpolate into a log line.
 *
 * `error` and `error_description` arrive in the query string of a PUBLIC
 * endpoint, so they are attacker-controlled, not Square-controlled — anyone
 * holding a live state nonce can put anything in them. Interpolated raw, an
 * embedded newline ends the current log line and starts a new one that is
 * byte-identical in shape to this function's own success line:
 *
 *   ?error_description=x%0A[square-oauth-callback] stored connection FORGED …
 *
 * Measured against the deployed function on 27 Aug 2026: the forged lines
 * landed in the logs exactly as written, and a 2 KB parameter produced a 2,095
 * byte log entry. `redirectBack` already clamps the same values before they
 * reach a URL; this is the identical defence applied to the other sink.
 *
 * Control characters are replaced rather than slugged, because Square's real
 * `error_description` is prose an operator needs to read — destroying it would
 * trade one defect for another.
 */
function safeForLog(raw: string, max = 200): string {
  const flattened = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return flattened.length > max ? `${flattened.slice(0, max)}…[truncated]` : flattened;
}

/**
 * Render an error for a log line WITHOUT leaking credentials.
 *
 * Deliberately drops SquareError.raw: that is the full parsed response body, and
 * on the /oauth2/token path an echoed request field would put the authorization
 * code (or worse, our application secret) into the log. category + code + detail
 * is everything an operator actually needs to act on.
 */
function describeError(err: unknown): string {
  if (err instanceof SquareError) return `square ${err.category}/${err.code} (${err.httpStatus}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

// ─────────────────────────────────────────────────────────────────────────────
// Redirecting the operator's browser back
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hosts we are willing to 302 a browser to.
 *
 * `origin` reaches us from a DB row rather than from the request, and
 * square-oauth-start already authenticates its caller — but this endpoint is
 * unauthenticated and the redirect is the one attacker-visible primitive it has,
 * so the allowlist is defence in depth rather than the only defence. Preview
 * deploys live on *.vercel.app, so that suffix is included; a forged origin
 * would still need an authenticated tenant admin to plant the state row first.
 */
const ALLOWED_ORIGIN_SUFFIXES = ["drive-247.com", "vercel.app"];

/** Normalise and allowlist an origin. Returns the bare scheme://host[:port]. */
function safeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return url.origin;
    if (ALLOWED_ORIGIN_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return url.origin;
    console.warn(`${LOG} refusing to redirect to non-allowlisted origin host=${host}`);
    return null;
  } catch {
    return null;
  }
}

/**
 * Where inside the app to land.
 *
 * square-oauth-start owns the `return_to` vocabulary and this file does not, so
 * all three conventions in the repo are accepted: the Stripe pair's
 * 'portal' | 'admin' keywords, and zoho-oauth-callback's absolute-path or
 * absolute-URL form. Anything unrecognised falls back to the portal payments tab
 * rather than failing — the operator has already connected; stranding them on a
 * 400 because of a routing string would be the worse outcome.
 */
function targetPath(row: StateRow): string {
  const rt = (row.return_to ?? "").trim();
  if (rt.startsWith("/")) return rt;
  if (rt.startsWith("http")) {
    try {
      const url = new URL(rt);
      return `${url.pathname}${url.search}`;
    } catch {
      /* fall through to the keyword handling */
    }
  }
  if (rt === "admin") return `/admin/rentals/${row.tenant_id}?tab=payments`;
  return "/settings?tab=payments";
}

/**
 * Send the browser home.
 *
 * The result param is `square=` and NOT `oauth=`: the portal already listens for
 * `?oauth=ok|incomplete|error` to report the *Stripe* connection
 * (own-stripe-settings.tsx), and reusing it would make a Square return pop a
 * Stripe toast. `reason` carries a machine-readable cause on the non-ok paths so
 * the settings UI can say something specific instead of "something went wrong".
 */
function redirectBack(row: StateRow, outcome: Outcome, reason?: string): Response {
  // `reason` can originate from Square's own ?error param, i.e. from outside our
  // trust boundary. Clamp it to a short slug before it lands in a URL the portal
  // will render — encodeURIComponent alone would happily carry 2KB of anything.
  const safeReason = reason
    ? reason.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48)
    : "";

  const origin =
    safeOrigin(row.origin) ??
    safeOrigin(row.return_to) ??
    safeOrigin(Deno.env.get("PORTAL_BASE_URL"));

  const path = targetPath(row);
  const query = `square=${outcome}${safeReason ? `&reason=${encodeURIComponent(safeReason)}` : ""}`;
  const relative = `${path}${path.includes("?") ? "&" : "?"}${query}`;

  if (!origin) {
    // No trustworthy place to send them. A readable page beats a 302 to a URL
    // that resolves against the Supabase functions host and 404s — the exact
    // bug zoho-oauth-callback shipped with.
    return plainText(
      outcome === "ok"
        ? "Your Square account is connected. Return to Settings → Payments in your dashboard."
        : `Square connection did not complete (${outcome}${safeReason ? `: ${safeReason}` : ""}). ` +
          "Return to Settings → Payments in your dashboard and try again.",
      outcome === "ok" ? 200 : 400,
    );
  }

  return new Response(null, { status: 302, headers: { Location: `${origin}${relative}` } });
}

function plainText(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Square application credentials (per mode)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mode comes from the STATE ROW, never from SQUARE_ENV.
 *
 * Sandbox and Production are physically separate Square hosts with separate
 * applications and non-interchangeable credentials, and a single deployment
 * serves tenants in both. A global env switch would silently exchange a sandbox
 * code against the production app (or vice versa) the moment two tenants
 * disagreed.
 */
function appCredentials(mode: SquareMode): { applicationId: string; applicationSecret: string } {
  const prefix = mode === "live" ? "SQUARE_LIVE" : "SQUARE_TEST";
  const applicationId = Deno.env.get(`${prefix}_APP_ID`) ?? "";
  const applicationSecret = Deno.env.get(`${prefix}_APP_SECRET`) ?? "";
  if (!applicationId || !applicationSecret) {
    throw new Error(`Missing ${prefix}_APP_ID / ${prefix}_APP_SECRET for ${mode} mode`);
  }
  return { applicationId, applicationSecret };
}

/**
 * The redirect URI sent with the code exchange.
 *
 * THIS MUST RESOLVE BYTE-FOR-BYTE TO square-oauth-start's getSquareRedirectUri().
 * Square compares the redirect_uri on ObtainToken against the one it received on
 * the authorize request and rejects the exchange on any difference — so the two
 * functions read the SAME env var, in the same order, with the same fallback. A
 * per-mode override was considered and rejected precisely because it would let
 * the two sides drift apart while both look correct in isolation.
 *
 * Mode is deliberately not part of this URL: the callback host is OURS, not
 * Square's, so the sandbox and production applications register the same URL and
 * the state row is what tells us which environment the code came from.
 */
function squareRedirectUri(): string {
  const explicit = Deno.env.get("SQUARE_REDIRECT_URI");
  if (explicit && explicit.length > 0) return explicit;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return `${supabaseUrl}/functions/v1/square-oauth-callback`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Readiness probe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The first location the merchant can actually take a card at.
 *
 * BOTH conditions are required and neither is softened. `status === 'ACTIVE'`
 * alone admits a location Square has deactivated; `capabilities` alone admits a
 * location that exists only for reporting. location_id is mandatory on every
 * payment link, so "no eligible location" means "cannot take money", full stop.
 */
function pickCardCapableLocation(locations: SquareLocation[]): SquareLocation | null {
  return (
    locations.find(
      (loc) =>
        !!loc.id &&
        loc.status === "ACTIVE" &&
        Array.isArray(loc.capabilities) &&
        loc.capabilities.includes("CREDIT_CARD_PROCESSING"),
    ) ?? null
  );
}

/**
 * Granted scopes, from the only endpoint that reports them.
 *
 * exchangeSquareCode() returns grantedScopes: [] because Square's ObtainToken
 * response simply does not carry the scope list. Writing our REQUESTED list into
 * square_connections.scopes would make that column a record of our intent rather
 * than of the grant — which is worthless precisely when it matters (diagnosing a
 * PERMISSION denied at charge time). RetrieveTokenStatus reports the real thing.
 * Best-effort: a merchant who has already consented must not be stranded because
 * a cosmetic lookup failed, so we fall back to the requested list and say so.
 */
async function fetchGrantedScopes(mode: SquareMode, accessToken: string): Promise<string[]> {
  try {
    const res = await squareFetch<{ scopes?: string[] }>({
      mode,
      accessToken,
      method: "POST",
      path: "/oauth2/token/status",
      body: {},
    });
    const scopes = Array.isArray(res.scopes) ? res.scopes : [];
    return scopes.length > 0 ? scopes : [...SQUARE_OAUTH_SCOPES];
  } catch (err) {
    console.warn(`${LOG} token/status unavailable, recording requested scopes: ${describeError(err)}`);
    return [...SQUARE_OAUTH_SCOPES];
  }
}

/**
 * Demote a just-stored connection to 'error'.
 *
 * square_store_tokens always writes status='active' (it is also the refresh
 * cron's entry point, where 'active' is always correct), so an unusable
 * connection has to be demoted in a second statement. We still store it: the
 * tokens are real, the operator did consent, and the portal needs a row to hang
 * "connected but not ready — here is why" on. Because status is no longer
 * 'active', square_get_tokens returns nothing and every checkout SKIPs rather
 * than attempting a charge that Square would reject.
 *
 * There is a millisecond window between the two statements in which the row
 * reads 'active'. It is not worth a transaction: the location_id we pass on the
 * unusable path is NULL, so the RPC's COALESCE leaves whatever was there before,
 * and nothing new becomes chargeable inside the window.
 */
async function markConnectionUnusable(
  supabase: SupabaseClient,
  connectionId: string,
  lastError: string,
): Promise<void> {
  const { error } = await supabase
    .from("square_connections")
    .update({ status: "error", last_error: lastError, updated_at: new Date().toISOString() })
    .eq("id", connectionId);
  if (error) {
    console.error(`${LOG} failed to demote connection ${connectionId} to error: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // HEAD MUST NOT CONSUME THE NONCE.
  //
  // The state row is single-use and whoever reaches it first wins it. A
  // top-level browser navigation — which is the only thing Square ever sends
  // here — is ALWAYS a GET. So anything issuing HEAD against this URL is an
  // intermediary rather than the operator: browser speculative prefetch, a
  // corporate link scanner, or a security proxy that HEAD-probes a redirect
  // target before permitting the navigation.
  //
  // Measured against the deployed function on 27 Aug 2026: one HEAD consumed
  // the state and the operator's real GET immediately after got a hard 400
  // ("expired or was already used") with no route forward except restarting
  // from the dashboard. Answering HEAD with a bodyless 200 and NO database work
  // makes those probes harmless and leaves the real flow byte-for-byte as it
  // was.
  if (req.method === "HEAD") {
    return new Response(null, { status: 200 });
  }

  if (req.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const oauthErrorDescription = url.searchParams.get("error_description");

  if (!stateParam) {
    console.error(`${LOG} missing state parameter`);
    return plainText(
      "Invalid Square connection link (missing state). Please restart the connection from your dashboard.",
      400,
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // ── Consume the state ──────────────────────────────────────────────────────
  // DELETE ... RETURNING, not SELECT-then-DELETE. Two browsers replaying the
  // same callback URL is a real event (double-click, a link-preview fetcher,
  // a back button), and only one of them may proceed. Postgres hands the row to
  // exactly one deleter, so this single statement IS the single-use guarantee.
  // It also means the row is gone on every path below, success or failure —
  // there is no branch left where a used state survives.
  const { data: consumed, error: consumeError } = await supabase
    .from("square_oauth_state")
    .delete()
    .eq("state", stateParam)
    .select("state, tenant_id, square_mode, return_to, origin, created_by, expires_at");

  if (consumeError) {
    console.error(`${LOG} could not consume oauth state: ${consumeError.message}`);
    return plainText("Could not verify the Square connection request. Please try again.", 500);
  }

  const stateRow = (consumed ?? [])[0] as StateRow | undefined;
  if (!stateRow) {
    // Missing means forged, or already used. Both are hard stops, and we have no
    // trusted origin to bounce to, so this is the one branch that renders rather
    // than redirects.
    console.error(`${LOG} unknown or already-consumed state`);
    return plainText(
      "This Square connection link has expired or was already used. Please restart the connection from your dashboard.",
      400,
    );
  }

  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    console.error(`${LOG} expired state for tenant ${stateRow.tenant_id} (expired ${stateRow.expires_at})`);
    return redirectBack(stateRow, "error", "state_expired");
  }

  const mode: SquareMode = stateRow.square_mode === "live" ? "live" : "test";

  // Operator denied consent, or Square refused. Nothing was created.
  if (oauthError || !code) {
    // safeForLog on BOTH: these are query-string values on a public endpoint,
    // so a raw interpolation lets the caller forge extra log lines (verified
    // against the deployed function, 27 Aug 2026). The redirect is already
    // clamped by redirectBack; this closes the matching hole in the log sink.
    console.error(
      `${LOG} authorization failed for tenant ${stateRow.tenant_id}: ` +
        `${oauthError ? safeForLog(oauthError, 64) : "missing code"}` +
        `${oauthErrorDescription ? ` — ${safeForLog(oauthErrorDescription)}` : ""}`,
    );
    return redirectBack(stateRow, "error", oauthError ?? "missing_code");
  }

  try {
    // ── 1. Exchange the code ─────────────────────────────────────────────────
    // Square authorization codes are valid for FIVE MINUTES, far shorter than
    // the 30-minute state TTL — so a valid state does not imply a live code, and
    // a slow operator lands here as an ordinary exchange failure.
    const { applicationId, applicationSecret } = appCredentials(mode);
    const tokens = await exchangeSquareCode({
      mode,
      applicationId,
      applicationSecret,
      code,
      redirectUri: squareRedirectUri(),
    });

    if (!tokens.accessToken || !tokens.merchantId) {
      throw new Error("Square token exchange returned no access token or merchant id");
    }

    const expiresAt =
      tokens.expiresAt ??
      new Date(Date.now() + FALLBACK_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    if (!tokens.expiresAt) {
      console.warn(
        `${LOG} Square returned no expires_at for merchant ${tokens.merchantId}; ` +
          `assuming ${FALLBACK_TOKEN_TTL_DAYS} days so the refresh cron still has a due date`,
      );
    }

    // ── 2. Locations: can this merchant take a card, and in which currency? ───
    const locationsRes = await squareFetch<{ locations?: SquareLocation[] }>({
      mode,
      accessToken: tokens.accessToken,
      method: "GET",
      path: "/v2/locations",
    });
    const locations = locationsRes.locations ?? [];
    const location = pickCardCapableLocation(locations);

    // ── 3. Merchant profile: business name for the portal ────────────────────
    // MERCHANT_PROFILE_READ is in SQUARE_OAUTH_SCOPES, so this is authorised.
    // Best-effort all the same — a cosmetic label must never fail a connection.
    let businessName: string | null = null;
    let merchantCountry: string | null = null;
    try {
      const merchantRes = await squareFetch<{ merchant?: SquareMerchant }>({
        mode,
        accessToken: tokens.accessToken,
        method: "GET",
        path: `/v2/merchants/${encodeURIComponent(tokens.merchantId)}`,
      });
      businessName = merchantRes.merchant?.business_name ?? null;
      merchantCountry = merchantRes.merchant?.country ?? null;
    } catch (err) {
      console.warn(`${LOG} RetrieveMerchant failed (non-fatal): ${describeError(err)}`);
    }

    const scopes = await fetchGrantedScopes(mode, tokens.accessToken);

    // ── 4. Currency reconciliation ───────────────────────────────────────────
    // Square fixes currency at the LOCATION and will not convert, so a location
    // in the wrong currency 400s every payment link forever. We assert against
    // tenants.currency_code and refuse to activate on mismatch — and we never
    // rewrite currency_code to "fix" it: that column is anon-granted and drives
    // customer-facing prices on the booking site.
    //
    // Only currency_code is selected. We deliberately do NOT gate on
    // tenants.payment_provider: connecting a merchant account is allowed before
    // the routing decision, and requiring the flip first would be a chicken and
    // egg (you cannot safely flip a tenant onto a provider they have not
    // connected).
    const { data: tenantRow, error: tenantError } = await supabase
      .from("tenants")
      .select("id, currency_code")
      .eq("id", stateRow.tenant_id)
      .maybeSingle();

    if (tenantError || !tenantRow) {
      throw new Error(
        `Tenant ${stateRow.tenant_id} not readable: ${tenantError?.message ?? "no row"}`,
      );
    }

    const tenantCurrency = String((tenantRow as { currency_code?: string | null }).currency_code ?? "")
      .trim()
      .toUpperCase();
    const locationCurrency = String(location?.currency ?? "").trim().toUpperCase();

    let unusableReason: string | null = null;
    let unusableDetail: string | null = null;

    if (!location) {
      unusableReason = "no_card_capable_location";
      unusableDetail =
        `Square returned ${locations.length} location(s) but none is ACTIVE with CREDIT_CARD_PROCESSING. ` +
        `Activate a location in the Square dashboard and reconnect.`;
    } else if (tenantCurrency && locationCurrency && locationCurrency !== tenantCurrency) {
      unusableReason = "currency_mismatch";
      unusableDetail =
        `Square location ${location.id} bills in ${locationCurrency} but this account is configured for ` +
        `${tenantCurrency}. Square cannot convert; connect a ${tenantCurrency} location or change the ` +
        `account currency before taking payments.`;
    } else if (!tenantCurrency) {
      // Nothing to assert against. Not a blocker — record it so a later
      // mismatch is not mistaken for a regression here.
      console.warn(
        `${LOG} tenant ${stateRow.tenant_id} has no currency_code; skipped the currency assertion ` +
          `(location currency ${locationCurrency || "unknown"})`,
      );
    }

    // ── 5. Persist ───────────────────────────────────────────────────────────
    // Tokens go to Vault inside the RPC. Nothing below this line, and nothing
    // above it, writes a raw token to a column or a log.
    const { data: connectionId, error: storeError } = await supabase.rpc("square_store_tokens", {
      p_tenant_id: stateRow.tenant_id,
      p_square_mode: mode,
      p_access_token: tokens.accessToken,
      p_refresh_token: tokens.refreshToken,
      p_expires_at: expiresAt,
      p_merchant_id: tokens.merchantId,
      // NULL on the unusable path: the RPC COALESCEs, so a previously-good
      // location survives rather than being replaced by an unchargeable one.
      p_location_id: unusableReason ? null : (location?.id ?? null),
      p_location_currency: unusableReason ? null : (locationCurrency || null),
      p_business_name: businessName,
      p_scopes: scopes,
      p_connected_by: stateRow.created_by,
    });

    if (storeError || !connectionId) {
      throw new Error(`square_store_tokens failed: ${storeError?.message ?? "no connection id"}`);
    }

    console.log(
      `${LOG} stored connection ${connectionId} tenant=${stateRow.tenant_id} mode=${mode} ` +
        `merchant=${tokens.merchantId} country=${merchantCountry ?? "unknown"} ` +
        `location=${location?.id ?? "none"} currency=${locationCurrency || "unknown"} ` +
        `scopes=${scopes.length} expires=${expiresAt}`,
    );

    if (unusableReason) {
      await markConnectionUnusable(supabase, String(connectionId), unusableDetail ?? unusableReason);
      console.warn(
        `${LOG} tenant ${stateRow.tenant_id} connected but NOT chargeable — ${unusableReason}: ${unusableDetail}`,
      );
      return redirectBack(stateRow, "incomplete", unusableReason);
    }

    return redirectBack(stateRow, "ok");
  } catch (err) {
    // describeError, never the error object: SquareError.raw can echo request
    // fields and this is the one path where the authorization code is in flight.
    console.error(`${LOG} connection failed for tenant ${stateRow.tenant_id}: ${describeError(err)}`);
    return redirectBack(stateRow, "error", "connection_failed");
  }
});
