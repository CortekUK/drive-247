// =============================================================================
// integrations/accounting — WHERE THE TWO PROVIDERS ARE NOT THE SAME FUNCTION.
//
// The brief for this folder was "write the cases once, table-driven over both
// providers", and oauth-start.test.ts and oauth-callback-state.test.ts do
// exactly that. This file is the counterweight, and it exists because a
// table-driven suite has one characteristic failure: it quietly asserts the
// INTERSECTION of two functions and reads as twice the coverage.
//
// Xero and Zoho are close enough that one set of cases is right. They are not
// identical, and every difference below is load-bearing — each one is a place
// where the two files must NOT be made to look alike:
//
//   region              Zoho has six data centres; Xero has none. The region
//                       decides which host the authorization code is redeemed
//                       at, and a code is only valid at the one that issued it.
//   scope separator     Xero wants spaces, Zoho wants commas.
//   scope encoding      Xero's identity server needs RFC 3986 %20 and rejects
//                       the `+` that URLSearchParams produces.
//   refresh tokens      Xero asks via a SCOPE (offline_access); Zoho asks via
//                       URL PARAMS (access_type + prompt).
//   token endpoint      Xero's is a constant; Zoho's is derived at callback time.
//   failure reporting   Zoho returns errors as HTTP 200 with an error in the
//                       body; Xero uses status codes.
//
// If these ever do converge, these cases fail — and that failure is the healthy
// one: it means somebody changed a provider integration on purpose and this
// file is where they say so.
// =============================================================================

import { describe, expect, it } from "vitest";
import { XERO, ZOHO } from "@fn/_shared/accounting/oauth-constants.ts";
import { liveStatus } from "../../helpers/live-call";
import { providerById, readAccountingFunction, requireAt } from "./helpers/accounting-source";
import { accountingLiveFetch } from "./helpers/accounting-live";

const xeroStart = () => readAccountingFunction("xero-oauth-start", "json-body");
const zohoStart = () => readAccountingFunction("zoho-oauth-start", "json-body");
const xeroCb = () => readAccountingFunction("xero-oauth-callback", "query-string");
const zohoCb = () => readAccountingFunction("zoho-oauth-callback", "query-string");

// ===========================================================================
// REGION — the asymmetry a shared suite gets wrong
// ===========================================================================
describe("accounting/asymmetry — region is Zoho's alone", () => {
  it("zoho-oauth-start accepts a region; xero-oauth-start has no such concept", () => {
    const zoho = zohoStart();
    const xero = xeroStart();

    expect(
      zoho.fields,
      "zoho-oauth-start no longer reads `region`. Every connection would then be built " +
        "against accounts.zoho.com, and an operator whose Zoho account lives in the EU " +
        "or India DC cannot connect at all.",
    ).toContain("region");

    expect(
      xero.fields,
      "xero-oauth-start now reads a `region` field. Xero has ONE identity server " +
        "(login.xero.com) — if a region has appeared here it is either dead code or " +
        "somebody copied the Zoho file, and the shared suite would not have noticed.",
    ).not.toContain("region");
    expect(xero.src).not.toContain("ALLOWED_REGIONS");
  });

  it("the six connectable regions are the ones the portal offers", () => {
    // A cross-file invariant with no compiler behind it: the portal's picker and
    // the function's allow-list live in different apps. When they disagree the
    // operator picks a region and gets a 400 they cannot act on.
    const zoho = zohoStart();
    const spec = providerById("zoho").region;
    expect(spec, "The zoho provider spec no longer declares region support.").not.toBeNull();

    const declared = /const ALLOWED_REGIONS = new Set\(\[([^\]]*)\]\)/.exec(zoho.src);
    expect(
      declared,
      "Could not read ALLOWED_REGIONS out of zoho-oauth-start. Retarget this assertion " +
        "rather than dropping it — it is the only thing tying the function's allow-list " +
        "to the portal's region picker.",
    ).not.toBeNull();

    const actual = [...(declared as RegExpExecArray)[1].matchAll(/["']([^"']+)["']/g)]
      .map((m) => m[1])
      .sort();
    expect(
      actual,
      "zoho-oauth-start's ALLOWED_REGIONS no longer matches the set this suite (and the " +
        "portal's CONNECTABLE_REGIONS list) expects. Adding a data centre is fine — add " +
        "it in both places, and here.",
    ).toEqual([...(spec as { allowed: readonly string[] }).allowed].sort());
  });

  it("zoho-oauth-start validates the region BEFORE it authenticates the caller", () => {
    // Stated because it is surprising, and because two live cases depend on it:
    //
    //   - the "unauthenticated caller is refused" case must NOT send a bogus
    //     region, or it would measure the 400 and report a 401 it never saw;
    //   - the "unknown region is refused" case needs no session at all.
    //
    // It is not a vulnerability — the region is validated against a fixed set
    // and nothing is written or read before it — but it IS the kind of ordering
    // that becomes one the day the pre-auth block starts touching the database.
    const zoho = zohoStart();
    const regionGuard = requireAt(zoho, "ALLOWED_REGIONS.has(region)", "the region allow-list check");
    const authGuard = requireAt(zoho, "if (!jwt)", "the missing-bearer check");
    expect(
      regionGuard < authGuard,
      "zoho-oauth-start now authenticates before validating the region (region@" +
        `${regionGuard}, auth@${authGuard}).\n` +
        "  That is arguably the better order. It also changes what an anonymous caller " +
        "sees, so the two live cases in this folder that rely on the current order need " +
        "updating together with it — this is failure mode (a).",
    ).toBe(true);
  });

  it("only Zoho persists the picked region on the state row, and only Zoho reads it back", () => {
    expect(
      zohoStart().src,
      "zoho-oauth-start no longer stores the region on accounting_oauth_state. The " +
        "callback needs it to know which data centre to talk to, and its only other " +
        "sources are query params Zoho may or may not send.",
    ).toContain("metadata: { region }");
    expect(
      xeroStart().src,
      "xero-oauth-start now writes metadata to the state row. Xero has nothing " +
        "region-shaped to carry; if this is real, say what it is here.",
    ).not.toContain("metadata:");

    expect(zohoCb().src).toContain("stateRow.metadata");
    expect(xeroCb().src).not.toContain("stateRow.metadata");
  });

  it("only Zoho stores an external_region on the connection", () => {
    // accounting_connections.external_region is documented as "NULL for Xero".
    // The refresh cron and the API clients both rebuild their base URL from it,
    // so a Xero row that somehow carried one would send Xero traffic at a Zoho host.
    expect(xeroCb().src).toContain("p_external_region: null");
    expect(zohoCb().src).toContain("p_external_region: region");
  });
});

// ===========================================================================
// SCOPES — two providers, two grammars
// ===========================================================================
describe("accounting/asymmetry — scopes are encoded differently on purpose", () => {
  it("Xero joins scopes with spaces; Zoho joins them with commas", () => {
    // Imported from the functions' own constants module, not retyped. Retyping
    // them here would make this test agree with itself.
    expect(
      XERO.scopes.includes(" ") && !XERO.scopes.includes(","),
      `XERO.scopes is no longer a space-separated list: "${XERO.scopes}". Xero's identity ` +
        `server rejects the consent request outright, so the operator never reaches a ` +
        `consent screen — and only NEW connections are affected, so it looks intermittent.`,
    ).toBe(true);
    expect(
      ZOHO.scopes.includes(",") && !ZOHO.scopes.includes(" "),
      `ZOHO.scopes is no longer a comma-separated list: "${ZOHO.scopes}".`,
    ).toBe(true);
  });

  it("each provider still asks for the write scopes the sync path needs", () => {
    // Scopes are baked into the grant at consent time. A scope dropped here does
    // not fail at connect — it fails weeks later, on the first sync that needs
    // it, and only the operator who reconnects gets the fix.
    for (const scope of ["accounting.contacts", "accounting.invoices", "accounting.payments", "offline_access"]) {
      expect(XERO.scopes, `XERO.scopes no longer asks for ${scope}.`).toContain(scope);
    }
    for (const scope of [
      "ZohoBooks.contacts.ALL",
      "ZohoBooks.invoices.ALL",
      "ZohoBooks.customerpayments.ALL",
      // Chart of Accounts lives under the Accountant module, not settings.
      // Without it the mapping screen's dropdowns are empty, no mapping can be
      // saved, and nothing ever syncs.
      "ZohoBooks.accountants.READ",
    ]) {
      expect(ZOHO.scopes, `ZOHO.scopes no longer asks for ${scope}.`).toContain(scope);
    }
  });

  it("refresh tokens are requested by a SCOPE on Xero and by URL PARAMS on Zoho", () => {
    // Same outcome, two mechanisms, and neither works for the other provider.
    // Without a refresh token the connection dies at the first token expiry —
    // an hour for Zoho, half an hour for Xero — and the operator must reconnect.
    expect(
      XERO.scopes,
      "XERO.scopes no longer includes offline_access. Xero issues no refresh token " +
        "without it, so the connection expires in 30 minutes and never comes back.",
    ).toContain("offline_access");

    const zoho = zohoStart();
    expect(zoho.src).toContain('"access_type", "offline"');
    expect(
      zoho.src,
      "zoho-oauth-start no longer passes prompt=consent. Zoho returns a refresh_token " +
        "only on the FIRST consent, so a re-authorising operator gets none — and " +
        "zoho-oauth-callback bails with reason=no_refresh_token after they have already " +
        "granted access.",
    ).toContain('"prompt", "consent"');

    // And the mirror: these are meaningless to Xero, so they must not appear.
    expect(xeroStart().src).not.toContain("access_type");
  });

  it("Xero builds its query string by hand, because URLSearchParams would break it", () => {
    // The single most deletable-looking line in these two files, and the one
    // that must not be deleted. `URLSearchParams` encodes a space as `+`; Xero's
    // identity server requires RFC 3986, where a space is %20. Xero's scope
    // string is space-separated (asserted above), so "tidying" this to match the
    // Zoho file silently breaks every new Xero connection.
    const xero = xeroStart();
    expect(
      xero.src,
      "xero-oauth-start now builds its authorize URL with URLSearchParams. Its scopes " +
        "are space-separated and URLSearchParams encodes a space as `+`; Xero requires " +
        "%20 and rejects the request. Existing connections keep working, so this shows " +
        "up only as 'new operators cannot connect'.",
    ).not.toContain("url.searchParams.set");
    expect(xero.src).toContain("encodeURIComponent");

    // Zoho's list has no spaces in it, so URLSearchParams is safe there — and it
    // is what that file uses.
    expect(zohoStart().src).toContain("url.searchParams.set");
  });
});

// ===========================================================================
// THE CALLBACK — where the two diverge most
// ===========================================================================
describe("accounting/asymmetry — the callbacks redeem their codes differently", () => {
  it("Xero's token endpoint is a constant; Zoho's is chosen at request time", () => {
    // This is the difference with the sharpest edge on it, and it is why this
    // file exists. See README finding 1 for what Zoho's version currently
    // allows. Xero's side is asserted here as the safe contrast: if XERO.tokenUrl
    // ever stops being a fixed constant, the same class of problem arrives on
    // the provider that does not have it today.
    expect(
      XERO.tokenUrl,
      "XERO.tokenUrl is no longer the fixed identity.xero.com endpoint. Xero has ONE " +
        "token endpoint; anything derived from a request here would decide at runtime " +
        "where the client secret is POSTed.",
    ).toBe("https://identity.xero.com/connect/token");
    expect(xeroCb().src).toContain("fetch(XERO.tokenUrl");

    // Zoho's is a function of the region, by necessity — a code is only valid at
    // the data centre that issued it.
    expect(typeof ZOHO.tokenUrl).toBe("function");
    expect(ZOHO.tokenUrl("eu")).toBe("https://accounts.zoho.eu/oauth/v2/token");
  });

  it("Zoho's callback prefers what Zoho SAYS over what the operator picked", () => {
    // The operator's dropdown is a hint for building the authorize URL. Zoho
    // bounces the request to whichever DC owns the account and then reports it,
    // and the authorization code is only redeemable there. Preferring the
    // dropdown is what broke this flow in production (`invalid_code`), so the
    // precedence order below is a fix, not a preference.
    const zoho = zohoCb();
    const fromServer = requireAt(zoho, "regionFromServer", "the accounts-server derivation");
    const meta = requireAt(zoho, "meta?.region", "the operator's stored pick");
    expect(
      fromServer < meta,
      "zoho-oauth-callback now consults the operator's stored region before Zoho's own " +
        "answer. An authorization code is only valid at the data centre that issued it, " +
        "so this reintroduces the production `invalid_code` failure.",
    ).toBe(true);
    expect(zoho.src).toMatch(/regionFromServer\s*\?\?\s*regionFromLocation\s*\?\?\s*meta\?\.region/);
  });

  it("Zoho's DC codes are mapped, not used raw", () => {
    // `location=us` is a DC code; our URL templates take a suffix. Using it raw
    // produces accounts.zoho.us, which does not exist. The map is the fix.
    const zoho = zohoCb();
    expect(zoho.src).toContain("LOCATION_TO_REGION");
    expect(
      zoho.src,
      "The us -> com mapping is gone. Zoho says 'us' where our templates want 'com', and " +
        "an unmapped value builds a hostname that does not resolve.",
    ).toMatch(/us:\s*["']com["']/);
    expect(
      zoho.src,
      "The au -> com.au mapping is gone; the same failure applies to Australia.",
    ).toMatch(/au:\s*["']com\.au["']/);
  });

  it("the callback can persist a region the start function would refuse", () => {
    // A genuine, deliberate asymmetry INSIDE Zoho, worth pinning because it is
    // invisible until a Reconnect button replays a stored region and gets a 400.
    // The portal already compensates (asConnectableRegion); this asserts the
    // compensation is still needed and still there.
    const zoho = zohoCb();
    const allowed = providerById("zoho").region?.allowed ?? [];
    const mapped = [...zoho.src.matchAll(/^\s*([a-z]{2}):\s*["']([^"']+)["'],/gm)].map((m) => m[2]);
    const unconnectable = mapped.filter((r) => !allowed.includes(r));
    expect(
      unconnectable.length,
      "zoho-oauth-callback can no longer derive a region outside ALLOWED_REGIONS. That is " +
        "an improvement — and it means the portal's asConnectableRegion() fallback is now " +
        "dead code that can be removed. Update both together.",
    ).toBeGreaterThan(0);
  });

  it("Zoho treats an HTTP 200 with an error body as a failure; Xero does not need to", () => {
    // Verified live in production, per the function's own comment: a bad grant
    // comes back `200 {"error":"invalid_code"}`. Checking `!res.ok` alone let
    // that through and the only symptom was a generic no_access_token redirect
    // with nothing in the logs.
    const zoho = zohoCb();
    expect(
      zoho.src,
      "zoho-oauth-callback no longer inspects the token response BODY for an error. Zoho " +
        "reports a bad grant as HTTP 200 with `{\"error\": ...}`, so the !ok check alone " +
        "reads a failure as a success and carries on with an undefined access token.",
    ).toMatch(/tokenJson\.error\s*\|\|\s*!tokenJson\.access_token/);

    // Xero uses status codes, so its callback legitimately has no equivalent.
    // Asserting the absence keeps the two files from being "harmonised" into
    // carrying each other's workarounds.
    expect(xeroCb().src).not.toContain("tokenJson.error");
  });

  it("each callback flips its own tenant flag", () => {
    // Two different columns. Copying one file onto the other and missing this
    // line connects the integration and leaves the portal showing it as
    // disconnected — with tokens quietly stored and syncing.
    expect(xeroCb().src).toContain("integration_xero: true");
    expect(zohoCb().src).toContain("integration_zoho_books: true");
    expect(xeroCb().src).not.toContain("integration_zoho_books");
    expect(zohoCb().src).not.toContain("integration_xero:");
  });

  it("only Zoho distinguishes an organisations API failure from an empty account", () => {
    // Zoho Books answers with HTTP 200 and a `code` field where 0 means success.
    // Checking only `organizations.length === 0` reported every auth or DC error
    // as "this account has no organisations", which sent operators off to create
    // an org they already had. Xero's /connections returns a real status code and
    // needs no equivalent.
    expect(zohoCb().src).toMatch(/orgJson\.code\s*!==\s*0/);
    expect(zohoCb().src).toContain("reason=organisations_lookup_failed");
    expect(xeroCb().src).toContain("reason=connections_lookup_failed");
  });
});

// ===========================================================================
// LAYER 2 — the one live case that exists for exactly one provider.
//
// It needs no session (Zoho's region check runs above its auth check, asserted
// above) and writes nothing: the request is refused before the app_users
// lookup, let alone the nonce insert.
// ===========================================================================
describe("accounting/asymmetry — live (Layer 2)", () => {
  it("live: zoho-oauth-start refuses a data centre it does not serve", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip("D247_LIVE_ANON_KEY is not set; the gateway would answer instead of the function.");
      return;
    }

    const res = await accountingLiveFetch("zoho-oauth-start", {
      method: "POST",
      auth: "anon",
      body: { region: "notadatacentre", redirectBack: null, tenantSlug: null },
    });

    expect(
      res.status,
      `zoho-oauth-start did not refuse the region "notadatacentre".\n` +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        `  An unvalidated region is interpolated straight into ` +
        `https://accounts.zoho.<region>/oauth/v2/auth, so it decides which host the ` +
        `operator is sent to consent at.\n` +
        `  A 401 here means the region check has moved BELOW the auth check — a real ` +
        `change (failure mode (a)); the Layer 1 order case in this file says which way.`,
    ).toBe(400);
    expect(
      String(res.json?.error ?? res.text),
      "zoho-oauth-start answered 400 but not with the region message. Reworded (mode a), " +
        "or a different validation is now firing first.",
    ).toMatch(/invalid region/i);

    // Xero has no region to reject, so there is deliberately no mirror case.
    expect(providerById("xero").region).toBeNull();
  });
});
