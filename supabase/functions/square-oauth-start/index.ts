// square-oauth-start — begin the Square OAuth flow for a tenant.
//
// JWT-verified. The portal (or a super admin in the admin app) calls this with a
// tenant + mode and gets back the Square authorize URL to redirect the operator
// to. square-oauth-callback finishes the round trip.
//
// Modelled on stripe-oauth-start/index.ts — the RBAC check below is that file's
// authorizeCaller() reproduced in spirit — but it differs from it in four ways,
// each forced by something Square does that Stripe does not:
//
//  1. STATE IS A ROW, NOT AN HMAC BLOB. stripe-oauth-start signs
//     `tenant|mode|returnTo|origin|exp` with the service-role key and the
//     callback re-derives it. That is stateless but also un-revocable and
//     un-auditable, and its verifier hard-validates its own field order, so a
//     Square state could never be fed through it (plan A-3). We already have
//     square_oauth_state with a reaper, cloned from accounting_oauth_state, so
//     the nonce is a row: single-use, revocable by DELETE, and it leaves an audit
//     trail of who started which connect attempt.
//  2. ELIGIBILITY IS CHECKED BEFORE WE HAND BACK A URL. A tenant outside Square's
//     8 countries can never take a payment, and tenants.payment_provider is
//     immutable by DB trigger — so a wrong-country connect is not a bad click, it
//     is an unrecoverable tenant. Refuse loudly here rather than let the operator
//     complete a consent screen that buys them nothing.
//  3. THE SCOPE LIST IS PINNED AND ALWAYS SENT. Square's default when `scope` is
//     absent is read-only; the tenant would connect "successfully" and then be
//     unable to take a single payment. Worse, widening scopes later drags every
//     already-connected merchant back through consent. See SQUARE_OAUTH_SCOPES.
//  4. MODE IS A DIFFERENT HOST, NOT A DIFFERENT KEY. Sandbox and production are
//     physically separate universes with separate application ids and secrets, so
//     mode fans out into the authorize host AND the credential pair, and a token
//     minted in one is worthless in the other.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolvePaymentProvider } from "../_shared/payments/resolve.ts";
import { isStripeTenant } from "../_shared/payments/guard.ts";
import { capabilitiesFor, isCountrySupported } from "../_shared/payments/capabilities.ts";
import { squareAuthorizeUrl, SQUARE_OAUTH_SCOPES } from "../_shared/payments/square-oauth.ts";
import { ProviderResolution, SquareMode } from "../_shared/payments/types.ts";

/** Matches square_oauth_state.expires_at's own DEFAULT (now() + 30 minutes). We
 *  set it explicitly anyway so the TTL is visible in this file rather than only
 *  in a column default nobody reads. */
const STATE_TTL_SECONDS = 60 * 30;

/** tenants.id is uuid; a non-uuid string reaches Postgres as error 22P02 and
 *  surfaces as an opaque 500. Reject it here with a sentence a human can act on. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** origin lands in a text column and is echoed back by the callback as a redirect
 *  target. Cap it so a caller cannot park kilobytes in the row. */
const MAX_ORIGIN_CHARS = 256;

interface StartRequest {
  tenantId?: unknown;
  mode?: unknown;
  returnTo?: unknown;
  origin?: unknown;
}

type AuthorizeResult =
  | { ok: true; appUserId: string }
  | { ok: false; response: Response };

/**
 * Authorize the caller for this tenant. Only a super admin, or a head_admin/
 * admin belonging to THIS tenant, may start an OAuth flow — otherwise anyone
 * with a project JWT (incl. a self-registered booking customer, who holds a
 * perfectly valid one) could bind their own Square account to a victim tenant
 * and collect that tenant's rental payments into their own bank account.
 *
 * Differs from stripe-oauth-start's version only in returning the acting
 * app_users.id, which we persist on the state row so a connect attempt is
 * attributable to a person.
 */
async function authorizeCaller(
  req: Request,
  supabase: SupabaseClient,
  tenantId: string,
): Promise<AuthorizeResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { ok: false, response: errorResponse("Missing authorization header", 401) };
  }

  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
  if (userError || !user) {
    return { ok: false, response: errorResponse("Unauthorized", 401) };
  }

  const { data: appUser } = await supabase
    .from("app_users")
    .select("id, is_super_admin, tenant_id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!appUser) {
    // A booking customer authenticates against auth.users but has no app_users
    // row at all. That is the single most likely holder of a stray project JWT.
    return { ok: false, response: errorResponse("Not authorized to connect Square for this tenant", 403) };
  }

  const isSuperAdmin = appUser.is_super_admin === true;
  const canManageOwnTenant =
    appUser.tenant_id === tenantId &&
    (appUser.role === "head_admin" || appUser.role === "admin");

  if (isSuperAdmin || canManageOwnTenant) {
    return { ok: true, appUserId: appUser.id as string };
  }
  return { ok: false, response: errorResponse("Not authorized to connect Square for this tenant", 403) };
}

/**
 * A 256-bit CSRF nonce, base64url.
 *
 * getRandomValues rather than randomUUID: a v4 UUID carries only 122 bits of
 * entropy inside a fixed, guessable frame, and this value is the ONLY thing
 * standing between an attacker and completing an OAuth round trip on a tenant's
 * behalf. 32 raw random bytes cost the same and leave no structure to attack.
 */
function generateStateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Where Square sends the operator back.
 *
 * This string is a REGISTERED EXTERNAL CONTRACT: it must byte-match the Redirect
 * URL configured on the Square application (sandbox and production are separate
 * applications with separate configuration), and square-oauth-callback must send
 * the identical string to ObtainToken or the exchange is rejected. Sending it
 * explicitly, rather than letting Square fall back to the console value, means a
 * mismatch fails visibly at the authorize step instead of silently at the token
 * exchange after the operator has already consented.
 *
 * SQUARE_REDIRECT_URI overrides the derivation for a deploy whose functions are
 * fronted by a custom domain — same escape hatch as accounting's getRedirectUri.
 */
function getSquareRedirectUri(): string {
  const explicit = Deno.env.get("SQUARE_REDIRECT_URI");
  if (explicit && explicit.length > 0) return explicit;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return `${supabaseUrl}/functions/v1/square-oauth-callback`;
}

/** Sandbox and production are separate application registrations. Never mix. */
function getApplicationCredentials(mode: SquareMode): { appId?: string; appSecret?: string } {
  return mode === "live"
    ? { appId: Deno.env.get("SQUARE_LIVE_APP_ID"), appSecret: Deno.env.get("SQUARE_LIVE_APP_SECRET") }
    : { appId: Deno.env.get("SQUARE_TEST_APP_ID"), appSecret: Deno.env.get("SQUARE_TEST_APP_SECRET") };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    let body: StartRequest;
    try {
      body = (await req.json()) as StartRequest;
    } catch {
      return errorResponse("Request body must be JSON");
    }

    const { tenantId, mode, returnTo, origin } = body ?? {};

    if (!tenantId || typeof tenantId !== "string" || !UUID_RE.test(tenantId)) {
      return errorResponse("tenantId is required and must be a uuid");
    }
    // mode is OPTIONAL and defaults to the tenant's own square_mode below.
    // Connecting a live merchant to a tenant whose payments run in sandbox (or
    // vice versa) yields a connection that can never settle real money, so the
    // tenant's configured mode is the only safe default. An explicit mode is
    // still honoured — pre-provisioning live credentials before flipping the
    // tenant over is a legitimate onboarding order.
    if (mode !== undefined && mode !== "test" && mode !== "live") {
      return errorResponse("mode must be 'test' or 'live'");
    }
    if (returnTo !== undefined && returnTo !== "portal" && returnTo !== "admin") {
      return errorResponse("returnTo must be 'portal' or 'admin'");
    }
    if (!origin || typeof origin !== "string" || !/^https?:\/\//.test(origin)) {
      return errorResponse("origin must be a valid http(s) origin");
    }
    if (origin.length > MAX_ORIGIN_CHARS) {
      return errorResponse("origin is too long");
    }
    // Reject anything that is not parseable as a URL. Unlike the Stripe original
    // there is NO delimiter-injection check here and none is needed: the state is
    // a row with typed columns, not a '|'-joined string, so there is no payload
    // for a crafted origin to forge a field in.
    try {
      new URL(origin);
    } catch {
      return errorResponse("origin must be a valid http(s) origin");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing Supabase service configuration", 500);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Only a super admin or this tenant's own admin may start the flow.
    const auth = await authorizeCaller(req, supabase, tenantId);
    if (!auth.ok) return auth.response;

    // ---- eligibility: refuse BEFORE handing back a URL -------------------
    //
    // Both checks below are permanent conditions, not transient ones:
    // payment_provider is immutable by DB trigger and the country gate is a DB
    // CHECK. A tenant that fails either can never take a Square payment, so
    // sending them to a consent screen would only produce a connected account
    // that is dead on arrival.
    let resolution: ProviderResolution;
    try {
      resolution = await resolvePaymentProvider(supabase, tenantId);
    } catch (resolveError) {
      console.error("[square-oauth-start] tenant not readable:", resolveError);
      return errorResponse("Tenant not found", 404);
    }

    if (isStripeTenant(resolution)) {
      // Deliberately phrased in terms of the rail the tenant IS on. Provider
      // choice is permanent, so the fix is never "connect Square anyway".
      return errorResponse(
        "This tenant's payments run on the Stripe rail. Square cannot be connected to it — " +
          "use stripe-oauth-start instead.",
        409,
      );
    }

    if (!isCountrySupported(resolution.provider, resolution.country)) {
      const supported = (capabilitiesFor(resolution.provider).supportedCountries ?? []).join(", ");
      return errorResponse(
        `Square cannot process payments for a tenant in ${resolution.country ?? "an unknown country"}. ` +
          `Supported countries are: ${supported}. Set tenants.country to one of these before connecting.`,
        409,
      );
    }

    const effectiveMode: SquareMode = (mode as SquareMode | undefined) ?? resolution.squareMode ?? "test";
    if (mode !== undefined && resolution.squareMode && mode !== resolution.squareMode) {
      // Not an error — see the note on the mode validation above — but worth a
      // breadcrumb, because the resulting connection is unusable until someone
      // flips tenants.square_mode to match.
      console.log(
        `[square-oauth-start] tenant ${tenantId}: connecting in '${effectiveMode}' while ` +
          `square_mode='${resolution.squareMode}'`,
      );
    }

    // ---- server configuration --------------------------------------------
    //
    // Checked BEFORE the nonce is written (same reasoning as xero-oauth-start):
    // persisting a nonce we already know cannot be redeemed just leaves an orphan
    // row behind on every failed click. The application SECRET is checked here
    // too even though only the callback spends it — a half-configured deploy
    // would otherwise pass this step, walk the operator all the way through
    // Square's consent screen, and only fail on the way back.
    const { appId, appSecret } = getApplicationCredentials(effectiveMode);
    if (!appId || !appSecret) {
      const prefix = `SQUARE_${effectiveMode === "live" ? "LIVE" : "TEST"}`;
      const missing = [
        !appId ? `${prefix}_APP_ID` : null,
        !appSecret ? `${prefix}_APP_SECRET` : null,
      ].filter(Boolean);
      return errorResponse(
        `Square is not configured on the server for ${effectiveMode} mode — ` +
          `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing.`,
        503,
      );
    }

    // Best-effort sweep of this tenant's own dead nonces. Only EXPIRED rows: a
    // live row may belong to a second browser tab the operator has open, and
    // deleting it would break that flow. The hourly reaper is still the real
    // cleanup; this just keeps a tenant that clicks Connect twenty times from
    // leaving twenty rows behind until the next reaper run.
    const { error: sweepError } = await supabase
      .from("square_oauth_state")
      .delete()
      .eq("tenant_id", tenantId)
      .lt("expires_at", new Date().toISOString());
    if (sweepError) {
      console.warn("[square-oauth-start] expired-state sweep failed (non-fatal):", sweepError.message);
    }

    const state = generateStateNonce();
    const expiresAt = new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString();

    const { error: stateError } = await supabase
      .from("square_oauth_state")
      .insert({
        state,
        tenant_id: tenantId,
        square_mode: effectiveMode,
        return_to: (returnTo as string | undefined) ?? "portal",
        origin,
        // app_users.id, not auth.users.id — the same actor identity accounting's
        // initiated_by carries, and what square_store_tokens' p_connected_by
        // expects the callback to forward.
        created_by: auth.appUserId,
        expires_at: expiresAt,
      });

    if (stateError) {
      console.error("[square-oauth-start] failed to persist oauth state:", stateError);
      return errorResponse("Failed to initiate Square OAuth", 500);
    }

    // scopes passed EXPLICITLY even though they are squareAuthorizeUrl's default:
    // omitting `scope` entirely makes Square grant a read-only token, so this call
    // site should never be silently at the mercy of a default changing.
    const authorizeUrl = squareAuthorizeUrl({
      mode: effectiveMode,
      applicationId: appId,
      state,
      scopes: SQUARE_OAUTH_SCOPES,
    });

    const redirectUri = getSquareRedirectUri();
    const url = `${authorizeUrl}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    // The nonce is deliberately absent from this log line: it is the CSRF secret
    // for an in-flight flow, and anyone who can read logs could otherwise finish
    // the round trip in the operator's place.
    console.log(`[square-oauth-start] tenant ${tenantId} starting Square connect in ${effectiveMode} mode`);

    return jsonResponse({ url });
  } catch (error) {
    console.error("[square-oauth-start] Error:", error);
    return errorResponse(error instanceof Error ? error.message : "Internal error", 500);
  }
});
