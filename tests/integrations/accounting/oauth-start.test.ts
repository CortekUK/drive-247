// =============================================================================
// integrations/accounting — THE START HALF: xero-oauth-start / zoho-oauth-start.
//
// ONE FILE, TWO PROVIDERS, WRITTEN ONCE.
//
//   "Zoho–Xero toh ek hi hai na takreeban, woh cases toh EK HI BANENGE."
//
// Every case below is driven over `PROVIDERS`, so a case added here is a case
// added for both. The places where the two genuinely differ are NOT smoothed
// over — they are declared on the provider spec and asserted separately in
// provider-asymmetry.test.ts. A shared suite that quietly asserts the
// intersection of two functions is worse than two suites: it looks like twice
// the coverage and is less.
//
// WHAT A START FUNCTION IS
// ------------------------
// The portal's "Connect Xero" / "Connect Zoho Books" button. It is
// AUTHENTICATED (unlike the callbacks), it resolves the caller to a tenant, it
// writes one short-lived nonce row to `accounting_oauth_state`, and it returns
// the provider's authorize URL with that nonce as the OAuth `state`.
//
// The nonce is the entire CSRF and confused-deputy story for this integration.
// Half of the properties below are about ORDER for that reason: a nonce row
// written before the caller has been authorised is a row an unauthorised caller
// created, and the callback trusts every nonce it finds.
//
// TWO LAYERS, as the spine has:
//   LAYER 1  source-derived, no network, always runs.
//   LAYER 2  live. Two cases need only D247_LIVE_TESTS=1 and write nothing;
//            one needs D247_LIVE_ALLOW_WRITES=1 and persists nonce rows.
//            There is no third rung here — nothing on this surface moves money.
//            See helpers/accounting-live.ts for why that is stated rather than
//            faked.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../helpers/edge-contract";
import { liveStatus } from "../../helpers/live-call";
import {
  PROVIDERS,
  assertStartContract,
  readAccountingFunction,
  requireAt,
  type ProviderSpec,
} from "./helpers/accounting-source";
import {
  accountingLiveFetch,
  accountingWriteGate,
  liveWritesRequested,
} from "./helpers/accounting-live";

const shapeOf = (p: ProviderSpec) => readAccountingFunction(p.startFn, "json-body");

// ===========================================================================
// LAYER 1 — the request contract
// ===========================================================================
describe.each(PROVIDERS)("accounting/$label — $startFn request contract", (p) => {
  it("parses a request shape the shared contract helper cannot", () => {
    // The guard against a silent zero. tests/helpers/edge-contract.ts throws on
    // all four of these functions (an `as` cast, not an annotation), which is
    // why helpers/accounting-source.ts exists. If THAT parser ever starts
    // returning nothing, every assertion in this file passes against a function
    // that reads no fields at all — the exact failure the shared helper's
    // "teach the parser rather than deleting the test" comment warns about.
    const shape = shapeOf(p);
    expect(
      shape.fields.length,
      `Parsed no request fields out of ${shape.file}. Every contract assertion in ` +
        `this file would now pass for the wrong reason.`,
    ).toBeGreaterThan(0);
    expect(shape.typeName).toBe("Payload");
  });

  it("agrees with the payload the portal actually builds", () => {
    // assertStartContract, not a bare diff compared to []. Both detect the same
    // drift; only one of them names the file that builds the payload, the file
    // that reads it, and which of the two failure modes it is — the one thing
    // every failure in this suite is required to do.
    const shape = assertStartContract(p);
    expect(shape.fields.length).toBeGreaterThan(0);
  });

  it("reads tenantSlug even though the declared Payload type does not mention it", () => {
    // Not trivia. `tenantSlug` is the field that decides WHOSE BOOKS get
    // connected when the caller is a super admin (app_users.tenant_id is NULL
    // by design for them), and it is read through an inline cast:
    //
    //     (body as { tenantSlug?: string }).tenantSlug
    //
    // A contract derived from the `Payload` interface alone would not see it,
    // would call the portal's payload "extra", and would push a developer to
    // DELETE the field that carries cross-tenant intent. Pinning the origin is
    // what stops that.
    const shape = shapeOf(p);
    expect(
      shape.fields,
      `${p.startFn} no longer reads tenantSlug. For a scoped admin that changes ` +
        `nothing (resolve-tenant.ts pins them to their own tenant regardless), but ` +
        `a super admin then has no way to say which tenant they are connecting and ` +
        `the request 400s with "did not identify one".`,
    ).toContain("tenantSlug");
    expect(
      shape.origin.tenantSlug,
      "tenantSlug is now declared on the Payload interface. That is an improvement, " +
        "not a break — retarget this assertion to `declared-type` and keep the case.",
    ).toContain("inline-cast");
  });
});

// ===========================================================================
// LAYER 1 — authorisation, and the ORDER it happens in
// ===========================================================================
describe.each(PROVIDERS)("accounting/$label — $startFn refuses before it writes", (p) => {
  it("refuses a caller with no Authorization header", () => {
    const shape = shapeOf(p);
    expect(
      shape.src,
      `${p.startFn} no longer 401s a request with no bearer token. The gateway also ` +
        `enforces JWT on this function (it is absent from config.toml's verify_jwt=false ` +
        `list), so this is defence in depth — but it is the layer that survives a ` +
        `config change, and it is the one the live case below measures.`,
    ).toMatch(/if\s*\(\s*!jwt\s*\)\s*return\s+errorResponse\(\s*["']Unauthorised["']\s*,\s*401/);
  });

  it("refuses a bearer token that resolves to no user", () => {
    const shape = shapeOf(p);
    requireAt(shape, "auth.getUser()", "the auth.getUser() call");
    expect(
      shape.src,
      `${p.startFn} no longer checks the result of auth.getUser(). An anon key is a ` +
        `perfectly valid JWT and gets past both the gateway and the !jwt check above; ` +
        `this is the only thing that distinguishes it from a signed-in operator.`,
    ).toMatch(/if\s*\(\s*!userResp\?\.user\s*\)\s*return\s+errorResponse\(\s*["']Unauthorised["']\s*,\s*401/);
  });

  it("refuses a caller with no app_users row", () => {
    const shape = shapeOf(p);
    requireAt(shape, '.from("app_users")', "the app_users lookup");
    expect(shape.src).toMatch(/if\s*\(\s*!appUser\s*\)\s*return\s+errorResponse\([^)]*403/);
  });

  it("refuses anyone who is not admin, head_admin or a super admin", () => {
    const shape = shapeOf(p);
    expect(
      shape.src,
      `The role gate is gone from ${p.startFn}. Any authenticated user of the tenant — ` +
        `an ops user, a viewer — could then start a connection to the operator's ` +
        `accounting system.`,
    ).toContain(p.roleRefusal);
    expect(shape.src).toMatch(/is_super_admin/);
  });

  it("does every one of those checks BEFORE writing a nonce row", () => {
    // The order case, and the reason this file is not just a field list.
    //
    // `accounting_oauth_state` is the ONLY thing authenticating the callback:
    // the callback runs with verify_jwt = false and trusts any nonce it finds in
    // that table. So a nonce written above the role gate is a nonce an
    // unauthorised caller created, and it is redeemable by anyone holding it.
    // A guard below the insert is not a guard.
    const shape = shapeOf(p);
    const insertAt = requireAt(
      shape,
      '.from("accounting_oauth_state")',
      "the accounting_oauth_state insert",
    );

    const gates: [string, number][] = [
      ["the missing-bearer check", requireAt(shape, "if (!jwt)", "the missing-bearer check")],
      ["auth.getUser()", requireAt(shape, "auth.getUser()", "the auth.getUser() call")],
      ["the app_users lookup", requireAt(shape, '.from("app_users")', "the app_users lookup")],
      ["the tenant resolution", requireAt(shape, "resolveTenantId", "the tenant resolution")],
      ["the role gate", requireAt(shape, p.roleRefusal, "the role gate")],
      ["the server-config check", requireAt(shape, p.clientIdEnv, "the client-id config check")],
    ];

    for (const [name, idx] of gates) {
      expect(
        idx < insertAt,
        `${name} has moved BELOW the accounting_oauth_state insert in ${shape.file}.\n` +
          `  gate@${idx}  insert@${insertAt}\n` +
          `  The nonce is written before the caller has been cleared, and the callback\n` +
          `  (verify_jwt = false) trusts any nonce that exists. This is not a stale\n` +
          `  test — nothing in this assertion depends on a field name.`,
      ).toBe(true);
    }
  });

  it("checks the server is configured before writing, so a failed click leaves no orphan", () => {
    // Both functions carry a comment saying this was deliberately moved above
    // the insert. Cheap to assert, and it is the difference between a
    // misconfigured server collecting one dead row per click and collecting none.
    const shape = shapeOf(p);
    const secretAt = requireAt(shape, p.clientSecretEnv, "the client-secret config check");
    const insertAt = requireAt(
      shape,
      '.from("accounting_oauth_state")',
      "the accounting_oauth_state insert",
    );
    expect(
      secretAt < insertAt,
      `${p.clientSecretEnv} is now checked after the nonce is persisted. Every click on ` +
        `a half-configured server leaves a row that can never be redeemed — and, worse, ` +
        `the operator is redirected all the way to ${p.label} before anything fails.`,
    ).toBe(true);
  });
});

// ===========================================================================
// LAYER 1 — what the nonce row and the authorize URL carry
// ===========================================================================
describe.each(PROVIDERS)("accounting/$label — $startFn hands out a usable state", (p) => {
  it("writes tenant_id, the right provider literal, and who started it", () => {
    const shape = shapeOf(p);
    const insertAt = requireAt(shape, ".insert({", "the state-row insert");
    const insertBlock = shape.src.slice(insertAt, insertAt + 400);

    expect(insertBlock).toContain("tenant_id: tenantId");
    expect(insertBlock).toContain("initiated_by");
    expect(
      insertBlock,
      `${p.startFn} writes a state row whose provider is not "${p.stateProvider}".\n` +
        `  The callback refuses a nonce whose provider does not match its own\n` +
        `  (state_provider_mismatch), so the two files disagreeing means this ` +
        `provider's connect flow is dead end-to-end — and the classic way to get here ` +
        `is copying one of these two files onto the other.`,
    ).toContain(`provider: "${p.stateProvider}"`);
  });

  it("puts the NONCE in the OAuth state, and never the tenant id", () => {
    // Spec §6.2, and the reason the nonce table exists at all: "We never trust
    // the redirect to carry tenant_id." A tenant id in the state is a tenant id
    // the browser can edit, and the callback would then write another
    // operator's tokens against it.
    const shape = shapeOf(p);
    expect(shape.src, "The authorize URL's state is no longer the persisted nonce.").toContain(
      "stateRow.nonce",
    );

    const nonceSelectAt = requireAt(shape, '.select("nonce")', "the nonce read-back");
    const lastTenantId = shape.src.lastIndexOf("tenantId");
    expect(
      lastTenantId < nonceSelectAt,
      `${shape.file} mentions \`tenantId\` after the nonce is read back (@${lastTenantId}, ` +
        `nonce read-back @${nonceSelectAt}).\n` +
        `  The tenant id must stop at the state row. If it has reached the authorize URL\n` +
        `  it is now a value the operator's browser can edit on the way to ${p.label},\n` +
        `  and the callback would bind tokens to whatever came back.`,
    ).toBe(true);
  });

  it("builds an authorize URL with response_type, client_id, redirect_uri, scope and state", () => {
    const shape = shapeOf(p);
    for (const param of ["response_type", "client_id", "redirect_uri", "scope", "state"]) {
      expect(
        shape.src,
        `${p.startFn} no longer puts \`${param}\` in the authorize URL. ${p.label} rejects ` +
          `the consent request outright, so the operator never even sees a consent screen.`,
      ).toContain(param);
    }
    // The redirect_uri must be OURS, derived from getRedirectUri, not echoed
    // from the request. An attacker-chosen redirect_uri is how an authorization
    // code gets delivered to somebody else.
    expect(
      shape.src,
      `${p.startFn} no longer derives redirect_uri from getRedirectUri("${p.id}"). If it ` +
        `is now taken from the request, the authorization code can be delivered to a ` +
        `host we do not own.`,
    ).toContain(`getRedirectUri("${p.id}")`);
  });

  it("never lets the client secret reach the response", () => {
    // The secret is read here only to fail fast when it is missing — the
    // callback is what actually uses it. It must not travel any further: this
    // response goes to a browser.
    const shape = shapeOf(p);
    const lastSecret = shape.src.lastIndexOf("clientSecret");
    const responseAt = requireAt(shape, "return jsonResponse(", "the success response");
    expect(
      lastSecret >= 0 && lastSecret < responseAt,
      `${shape.file} mentions \`clientSecret\` at or after the response it sends to the ` +
        `browser (secret@${lastSecret}, response@${responseAt}).\n` +
        `  ${p.clientSecretEnv} is a PLATFORM-WIDE credential shared by every tenant. It ` +
        `is read here only to fail fast when unset.`,
    ).toBe(true);
  });

  it("is still JWT-verified at the gateway (unlike its callback)", () => {
    // Read from config.toml rather than asserted from memory. The two callbacks
    // are deliberately verify_jwt = false; the two START functions must not be,
    // because their in-function auth is what the whole nonce story rests on.
    const toml = readFileSync(join(REPO_ROOT, "supabase", "config.toml"), "utf8");
    const section = new RegExp(
      `\\[functions\\.${p.startFn}\\][^\\[]*verify_jwt\\s*=\\s*false`,
    ).test(toml);
    expect(
      section,
      `supabase/config.toml now sets verify_jwt = false for ${p.startFn}.\n` +
        `  That is correct for the CALLBACK (the provider redirects without our session)\n` +
        `  and wrong here: this endpoint writes a nonce row that the callback then\n` +
        `  trusts unconditionally. The in-function checks would be the only barrier left.`,
    ).toBe(false);
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// WHAT EACH CASE DOES IF ENABLED:
//
//   "an unauthenticated caller is refused"
//       POSTs at *-oauth-start carrying the project's ANON key as the bearer.
//       The anon key is a valid project JWT, so it gets past the gateway and
//       the FUNCTION's own auth.getUser() check is what answers. Writes
//       nothing: the Layer 1 order case above is what proves the refusal
//       happens above the insert. Needs only D247_LIVE_TESTS=1. This is this
//       folder's equivalent of the spine's signup-slug-check — the case that
//       proves the harness reaches a real deployed function.
//
//   "a GET is refused"
//       The method guard, which sits above everything including the body parse.
//       Harmless by construction.
//
//   "an admin is handed an authorize URL that carries a fresh state"
//       WRITES. Two calls, so two rows in accounting_oauth_state on the target
//       project. They are short-lived (30 min) and reaped hourly, and they are
//       still rows: D247_LIVE_ALLOW_WRITES=1 plus D247_LIVE_PORTAL_JWT.
//       No money gate — nothing on this surface can move money.
// ===========================================================================
describe.each(PROVIDERS)("accounting/$label — $startFn live (Layer 2)", (p) => {
  it("live: an unauthenticated caller is refused", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip(
        "D247_LIVE_ANON_KEY is not set. Supabase's gateway 401s a request with no apikey " +
          "header before the function is ever invoked, so this probe would measure the " +
          "gateway rather than " + p.startFn + ".",
      );
      return;
    }

    // Deliberately no `region` for Zoho. Its region check runs ABOVE the auth
    // check (see provider-asymmetry.test.ts), so an invalid region here would
    // be answered 400 and this case would report a refusal it did not test.
    // Omitting it takes the documented "com" default and reaches the 401.
    const res = await accountingLiveFetch(p.startFn, {
      method: "POST",
      auth: "anon",
      body: { redirectBack: null, tenantSlug: null },
    });

    expect(
      res.status,
      `Expected 401 from ${p.startFn} for a caller with no user session.\n` +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        `  A 200 here is FAILURE MODE (b) and the worst one on this surface: anyone\n` +
        `  holding the public anon key could mint a nonce row, and the callback trusts\n` +
        `  any nonce it finds.\n` +
        `  A 403 means the function got PAST auth and refused on role or tenant instead —\n` +
        `  which would mean auth.getUser() accepted an anon key. Also mode (b).\n` +
        `  A 404 means the function is not deployed on this project.`,
    ).toBe(401);
  });

  it("live: a GET is refused with 405", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip("D247_LIVE_ANON_KEY is not set; the gateway would answer instead of the function.");
      return;
    }
    const res = await accountingLiveFetch(p.startFn, { method: "GET", auth: "anon" });
    expect(
      res.status,
      `${p.startFn} no longer refuses a GET.\n` +
        `  got ${res.status}: ${res.text.slice(0, 200)}\n` +
        `  This guard is above the body parse and the auth check, so a change here means ` +
        `the handler's opening lines were rewritten.`,
    ).toBe(405);
  });

  it.skipIf(!liveWritesRequested())(
    "live: an admin is handed an authorize URL carrying a fresh, unguessable state",
    async (ctx) => {
      const gate = accountingWriteGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }

      const body: Record<string, unknown> = { redirectBack: null, tenantSlug: null };
      if (p.region) body[p.region.bodyField] = p.region.fallback;

      const first = await accountingLiveFetch(p.startFn, { method: "POST", auth: "portal", body });
      expect(
        first.status,
        `${p.startFn} did not accept an admin session.\n` +
          `  ${first.status}: ${first.text.slice(0, 400)}\n` +
          `  403 with "Only admin or head_admin" means D247_LIVE_PORTAL_JWT belongs to a\n` +
          `  user without the role — a fixture problem, not a bug.\n` +
          `  503 means ${p.clientIdEnv}/${p.clientSecretEnv} are unset on the target project;\n` +
          `  that is also a fixture problem, and the function is behaving correctly.`,
      ).toBe(200);

      const authorizeUrl = String(first.json?.authorizeUrl ?? "");
      expect(authorizeUrl, "No authorizeUrl in the response.").toBeTruthy();
      const url = new URL(authorizeUrl);

      expect(url.searchParams.get("response_type")).toBe("code");
      expect(
        url.searchParams.get("client_id"),
        `The authorize URL carries no client_id. ${p.label} would reject the consent ` +
          `request and the operator would see the provider's own error page.`,
      ).toBeTruthy();

      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      expect(
        redirectUri.endsWith(`${p.id}-oauth-callback`),
        `redirect_uri is "${redirectUri}", which does not end at ${p.id}-oauth-callback.\n` +
          `  The authorization code is delivered to whatever this names. If it is not a\n` +
          `  host we own, the code is not ours.`,
      ).toBe(true);

      // The scope list is the whole of what the connection will be ALLOWED to do
      // for its lifetime — scopes are baked into the grant at consent time and
      // cannot be widened afterwards without the operator reconnecting.
      const scope = url.searchParams.get("scope") ?? "";
      expect(
        scope.length,
        "The authorize URL carries an empty scope. The grant would be useless and the " +
          "operator would have to reconnect to fix it.",
      ).toBeGreaterThan(0);
      expect(
        scope.includes(p.scopeSeparator),
        `The scope list is not ${p.scopeSeparator === "," ? "comma" : "space"}-separated: ` +
          `"${scope}".\n` +
          `  Xero takes spaces, Zoho takes commas. Swapping them is accepted by the URL\n` +
          `  builder and rejected by the provider, for new connections only.`,
      ).toBe(true);

      const state = url.searchParams.get("state") ?? "";
      expect(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state),
        `state is "${state}", not a UUID. The nonce is the only unguessable thing in ` +
          `this flow; a predictable state is a forgeable callback.`,
      ).toBe(true);

      for (const extra of p.extraAuthorizeParams) {
        expect(
          url.searchParams.get(extra),
          `${p.label}'s authorize URL is missing \`${extra}\`. For Zoho, dropping ` +
            `access_type=offline or prompt=consent means no refresh_token comes back and ` +
            `the callback dies at no_refresh_token — after the operator has already ` +
            `granted consent.`,
        ).toBeTruthy();
      }

      // A second call must not hand back the same nonce. A reused state is a
      // replayable one, and it is the failure a single-call test cannot see.
      const second = await accountingLiveFetch(p.startFn, { method: "POST", auth: "portal", body });
      expect(second.status).toBe(200);
      const secondState = new URL(String(second.json?.authorizeUrl)).searchParams.get("state");
      expect(
        secondState,
        `Two consecutive calls to ${p.startFn} returned the SAME state nonce. The nonce is ` +
          `single-use — the callback deletes it on redemption — so a reused one means the ` +
          `second connect attempt is dead on arrival, and it means the value is derived ` +
          `rather than random.`,
      ).not.toBe(state);
    },
  );
});
