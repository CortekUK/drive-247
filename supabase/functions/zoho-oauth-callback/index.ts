/**
 * zoho-oauth-callback — Sprint 5, Spec §6.
 *
 * Zoho redirects to this URL after the operator clicks "Allow access". Same
 * shape as xero-oauth-callback with three differences:
 *   1. The region was persisted on accounting_oauth_state.metadata.region
 *      by zoho-oauth-start — we read it back here.
 *   2. The token endpoint is region-specific.
 *   3. Org discovery is a separate API call (Zoho doesn't include the org
 *      in the token response). We pick the FIRST org returned and log a
 *      warning if the user has multiple — the org-picker UI is a V2 follow-up.
 *
 * Also runs with verify_jwt=false (set in supabase/config.toml) because Zoho
 * redirects without our session JWT. State nonce validates authenticity.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { ZOHO, getRedirectUri } from "../_shared/accounting/oauth-constants.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const location = url.searchParams.get("location"); // Zoho echoes this back

  if (providerError) {
    return redirect(`/settings?tab=accounting&status=error&provider=zoho&reason=${encodeURIComponent(providerError)}`);
  }
  if (!code || !state) {
    return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=missing_params");
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 1. Validate nonce
    const { data: stateRow } = await supabase
      .from("accounting_oauth_state")
      .select("tenant_id, provider, redirect_back, initiated_by, expires_at, metadata")
      .eq("nonce", state)
      .maybeSingle();
    if (!stateRow) {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=invalid_state");
    }
    // Learn the portal origin BEFORE any further early-return, so the error
    // paths below redirect back to the tenant's portal rather than emitting a
    // relative path the browser resolves against the Supabase host.
    rememberPortalBase(stateRow.redirect_back as string | null);
    if (stateRow.provider !== "zoho") {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=state_provider_mismatch");
    }
    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=state_expired");
    }

    // Which Zoho data centre actually holds this account?
    //
    // This used to read `meta?.region ?? location ?? "com"` — the operator's
    // dropdown pick first, with a comment saying to trust it over Zoho. That is
    // backwards, and it is what broke the connect flow in production:
    //
    //   operator picked ....... eu   (the modal's default, not a real choice)
    //   Zoho redirected with .. location=us, accounts-server=accounts.zoho.com
    //   we redeemed the code at accounts.zoho.eu  →  invalid_code
    //
    // Zoho bounces the authorize request to whichever DC owns the account and
    // then TELLS us which one that was. An authorization code is only valid at
    // the DC that issued it, so Zoho's answer is authoritative and the dropdown
    // is only ever a hint for building the initial URL.
    //
    // The second bug in that line: `location` is a DC code (us/eu/in/au/jp/ca),
    // not the suffix our URL templates take (com/eu/in/com.au/jp/sa). Falling
    // back to it directly would have produced accounts.zoho.us, which does not
    // exist. It has to be mapped.
    const meta = (stateRow.metadata as { region?: string } | null) ?? null;
    const accountsServer = url.searchParams.get("accounts-server");
    const regionFromServer: string | null = regionFromAccountsServer(accountsServer);
    const regionFromLocation: string | null =
      location ? (LOCATION_TO_REGION[location.toLowerCase()] ?? null) : null;
    const region: string = regionFromServer ?? regionFromLocation ?? meta?.region ?? "com";

    if (meta?.region && meta.region !== region) {
      console.log(
        `zoho-oauth-callback: operator picked region '${meta.region}' but Zoho reports '${region}' ` +
        `(location=${location ?? "—"}, accounts-server=${accountsServer ?? "—"}); using Zoho's.`,
      );
    }

    // 2. Exchange code for tokens — region-specific endpoint
    const clientId = Deno.env.get("ZOHO_CLIENT_ID");
    const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=server_misconfigured");
    }
    const redirectUri = getRedirectUri("zoho");

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    // Redeem at the server Zoho named, falling back to the templated URL.
    // Using its own URL verbatim is both more accurate and more durable: it
    // covers data centres whose host does not follow the `zoho.<suffix>`
    // pattern (Canada is zohocloud.ca), which the template cannot express.
    const tokenEndpoint = accountsServer
      ? `${accountsServer.replace(/\/+$/, "")}/oauth/v2/token`
      : ZOHO.tokenUrl(region);

    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "unknown");
      console.error("zoho-oauth-callback: token exchange failed", tokenRes.status, errText);
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=token_exchange_failed");
    }
    const tokenJson = await tokenRes.json().catch(() => null) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      api_domain?: string;
      token_type?: string;
      error?: string;
    } | null;

    // Zoho reports failure as HTTP 200 with an error in the BODY, so the
    // `!tokenRes.ok` branch above does not catch the common cases (verified
    // live: a bad grant returns `200 {"error":"invalid_code"}`). Without this
    // the only symptom was a generic no_access_token redirect and nothing in the
    // logs, which is indistinguishable from a dozen unrelated failures.
    if (!tokenJson || tokenJson.error || !tokenJson.access_token) {
      const reason = tokenJson?.error ?? (tokenJson ? "no_access_token" : "unparseable_token_response");
      console.error("zoho-oauth-callback: token exchange rejected", tokenRes.status, reason);
      return redirect(
        `/settings?tab=accounting&status=error&provider=zoho&reason=${encodeURIComponent(reason)}`,
      );
    }

    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token;
    if (!refreshToken) {
      // Likely the user already authorised this app before and we forgot to
      // pass prompt=consent. The start fn DOES pass prompt=consent so this
      // should be rare — surface it loudly if it happens.
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=no_refresh_token");
    }
    // Guard the arithmetic: a missing expires_in yields NaN, and .toISOString()
    // on an Invalid Date throws — which here would abort the callback AFTER the
    // operator had already granted consent, losing the one-time code. Zoho's
    // access tokens are one hour, so that is the safe fallback.
    const expiresInSeconds = Number.isFinite(tokenJson.expires_in) && (tokenJson.expires_in as number) > 0
      ? (tokenJson.expires_in as number)
      : 3600;
    const expiresAt = new Date(Date.now() + (expiresInSeconds - 30) * 1000).toISOString();

    // 3. Fetch the user's Zoho organisations
    const orgsEndpoint = ZOHO.organizationsUrl(region);
    const orgRes = await fetch(orgsEndpoint, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: "application/json" },
    });
    const orgJson = await orgRes.json().catch(() => null) as {
      code?: number;
      message?: string;
      organizations?: Array<{ organization_id: string; name: string; country_code?: string }>;
    } | null;

    // Zoho Books answers with HTTP 200 and a `code` field: 0 means success,
    // anything else is an error (bad scope, wrong DC, expired token...).
    // Checking only `organizations.length === 0` therefore reported every one of
    // those as "this account has no organisations", which sent the operator off
    // to create an org they may well already have. Distinguish them, and log the
    // response either way — previously nothing was recorded at all, so a failure
    // here could not be diagnosed from the logs afterwards.
    const apiFailed = !orgRes.ok || !orgJson || (typeof orgJson.code === "number" && orgJson.code !== 0);
    if (apiFailed) {
      console.error(
        "zoho-oauth-callback: organizations lookup failed",
        `http=${orgRes.status}`,
        `endpoint=${orgsEndpoint}`,
        `code=${orgJson?.code ?? "—"}`,
        `message=${orgJson?.message ?? "—"}`,
      );
      return redirect(
        `/settings?tab=accounting&status=error&provider=zoho&reason=organisations_lookup_failed`,
      );
    }

    const orgs = orgJson.organizations ?? [];
    if (orgs.length === 0) {
      // Genuinely empty — the API said success and returned no organisations.
      console.warn(
        `zoho-oauth-callback: account has no Zoho Books organisations (region=${region}, endpoint=${orgsEndpoint})`,
      );
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=no_organisations");
    }
    console.log(
      `zoho-oauth-callback: found ${orgs.length} organisation(s) in region ${region}; using ${orgs[0].organization_id} (${orgs[0].name})`,
    );
    if (orgs.length > 1) {
      // V1 limitation per master plan: pick the first one. V2 will surface
      // an org-picker UI. Logged so we know when this triggers.
      console.warn(`zoho-oauth-callback: user has ${orgs.length} orgs, picking first one (${orgs[0].organization_id})`);
    }
    const zohoOrg = orgs[0];

    // 4. Store tokens in Vault + create the connection row
    const { error: storeErr } = await supabase.rpc("accounting_store_tokens", {
      p_tenant_id: stateRow.tenant_id,
      p_provider: "zoho",
      p_access_token: accessToken,
      p_refresh_token: refreshToken,
      p_expires_at: expiresAt,
      p_external_org_id: zohoOrg.organization_id,
      p_external_org_name: zohoOrg.name,
      p_external_region: region,
      p_connected_by: stateRow.initiated_by ?? null,
    });
    if (storeErr) {
      console.error("zoho-oauth-callback: store_tokens failed", storeErr);
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=persist_failed");
    }

    // 5. Flip tenant flag
    await supabase
      .from("tenants")
      .update({ integration_zoho_books: true })
      .eq("id", stateRow.tenant_id);

    // 6. Seed default mappings (Sprint 3 helper) — operator lands on a pre-filled
    // mapping screen. Idempotent: if mappings already exist, nothing happens.
    try {
      await supabase.rpc("seed_default_accounting_mappings", {
        p_tenant_id: stateRow.tenant_id,
        p_provider: "zoho",
      });
    } catch (err) {
      console.warn("zoho-oauth-callback: seed_default_accounting_mappings failed (non-fatal):", err);
    }

    // 6b. Retro-enqueue events recorded while this tenant had no active
    // connection. enqueue_financial_event only fans out to connections that are
    // 'active' at insert time, so anything booked while disconnected has no
    // sync row and would stay invisible forever. Idempotent — see the matching
    // comment in xero-oauth-callback for the full rationale.
    try {
      const { data: backfilled } = await supabase.rpc("backfill_missing_sync_rows", {
        p_tenant_id: stateRow.tenant_id,
        p_provider: "zoho",
      });
      if (backfilled) {
        console.log(`zoho-oauth-callback: enqueued ${backfilled} event(s) missed while disconnected`);
      }
    } catch (err) {
      console.warn("zoho-oauth-callback: backfill_missing_sync_rows failed (non-fatal):", err);
    }

    // 7. Consume the nonce
    await supabase.from("accounting_oauth_state").delete().eq("nonce", state);

    // 8. Redirect back to portal
    const target = stateRow.redirect_back
      ?? "/settings?tab=accounting&status=success&provider=zoho";
    return redirect(target);
  } catch (err) {
    console.error("zoho-oauth-callback error:", err);
    return redirect(`/settings?tab=accounting&status=error&provider=zoho&reason=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`);
  }
});

/**
 * Remembered for the lifetime of this request once the oauth_state row is read.
 *
 * The state row carries `redirect_back` — the absolute portal URL the operator
 * started from, e.g. https://test.portal.drive-247.com/settings?tab=accounting.
 * Its ORIGIN is the only reliable way to get back to the right place, because
 * the portal is per-tenant: a single PORTAL_BASE_URL env var cannot serve
 * test.portal…, acme.portal… and everyone else.
 */
/**
 * Zoho's DC code (the `?location=` param) → the suffix our URL templates use.
 * These are NOT the same vocabulary: Zoho says "us" where our templates want
 * "com", and "au" where they want "com.au".
 */
const LOCATION_TO_REGION: Record<string, string> = {
  us: "com",
  eu: "eu",
  in: "in",
  au: "com.au",
  jp: "jp",
  sa: "sa",
  uk: "uk",
  ca: "ca",
};

/**
 * Derive our region suffix from the `accounts-server` URL Zoho hands back.
 * Preferred over `location` because it is a real URL rather than a code, so it
 * stays correct even if Zoho adds a DC we have not mapped.
 *
 * Canada is deliberately special-cased: it is served from zohocloud.ca, not
 * zoho.ca, so the generic `zoho.<suffix>` pattern does not match it.
 */
function regionFromAccountsServer(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (host === "accounts.zohocloud.ca") return "ca";
    const m = host.match(/^accounts\.zoho\.(.+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

let requestPortalBase: string | null = null;

/** Record the portal origin from the state row's redirect_back, if usable. */
function rememberPortalBase(redirectBack: string | null | undefined): void {
  if (!redirectBack) return;
  try {
    requestPortalBase = new URL(redirectBack).origin;
  } catch {
    // Not an absolute URL — leave the fallbacks to handle it.
  }
}

/**
 * Send the operator back to the portal.
 *
 * Relative paths used to be emitted as-is whenever PORTAL_BASE_URL was unset —
 * which it is — so the browser resolved "/settings?…" against the SUPABASE
 * function host and landed on {"error":"requested path is invalid"}. Every
 * error path did this; only the success path worked, because it passes the
 * absolute redirect_back straight through.
 *
 * Order of preference: the origin from this request's redirect_back, then
 * PORTAL_BASE_URL, then give up on redirecting and render the reason instead —
 * a readable message beats a 302 to a page that cannot exist.
 */
function redirect(location: string): Response {
  let resolved = location;
  if (resolved.startsWith("/")) {
    const base = (requestPortalBase ?? Deno.env.get("PORTAL_BASE_URL") ?? "").replace(/\/$/, "");
    if (base) {
      resolved = `${base}${location}`;
    } else {
      const reason = new URLSearchParams(location.split("?")[1] ?? "").get("reason") ?? "unknown";
      return jsonResponse({
        error: `Could not complete the connection: ${reason}`,
        detail:
          "The portal URL for this tenant could not be determined, so you were not redirected back. " +
          "Return to Settings → Accounting and try again.",
        reason,
      }, 400);
    }
  }
  return new Response(null, {
    status: 302,
    headers: { Location: resolved },
  });
}
