// =============================================================================
// integrations/accounting — THE CALLBACK HALF, and the case that matters most.
//
// `state` IS THE ONLY AUTHENTICATION THESE ENDPOINTS HAVE.
//
// Both callbacks run with `verify_jwt = false` (supabase/config.toml), because
// Xero and Zoho redirect the operator's browser back without our session token.
// There is therefore NO caller identity on this request at all. Everything the
// function goes on to do — redeem an authorization code, store OAuth tokens
// against a tenant, flip that tenant's integration flag, enqueue every
// previously-unsynced financial event — is authorised by one thing: a nonce in
// `accounting_oauth_state` that a `*-oauth-start` call wrote for an
// authenticated admin.
//
// So a callback that accepts a missing, unknown, mismatched, reused or expired
// state is not a cosmetic bug. It is the whole boundary.
//
// WHY THESE ARE SOURCE ASSERTIONS AND NOT MOCKS
// ---------------------------------------------
// Seeding `accounting_oauth_state` to drive a real expired-nonce callback needs
// service-role credentials. Layer 2 deliberately holds none — it is a caller,
// like the browser is (tests/README.md §6). Mocking the Supabase client instead
// would test a mock. So the guards are asserted where they live, in the
// function's own source, and the live cases at the bottom prove the two guards
// that CAN be reached without a database: an unknown state, and no state.
//
// WHAT IS PROVEN, WHAT IS NOT, PER CASE:
//
//   missing state          L1 source + L2 live
//   unknown state          L1 source + L2 live
//   provider mismatch      L1 source only  (needs a seeded nonce of the other provider)
//   expired state          L1 source only  (needs a seeded, back-dated nonce)
//   consumed state         L1 source only  (consumption is a DELETE on the success path)
//   provider `error` param L1 source + L2 live
//
// The three that are L1-only say so here rather than being quietly omitted.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../helpers/edge-contract";
import { liveStatus } from "../../helpers/live-call";
import {
  PROVIDERS,
  readAccountingFunction,
  requireAt,
  selectedColumnsAfterFrom,
  type ProviderSpec,
} from "./helpers/accounting-source";
import {
  NON_EXISTENT_NONCE,
  UNREDEEMABLE_CODE,
  accountingLiveFetch,
  callbackReason,
  describeCallback,
} from "./helpers/accounting-live";

const shapeOf = (p: ProviderSpec) => readAccountingFunction(p.callbackFn, "query-string");

/** Where the one-time authorization code stops being reusable. */
const TOKEN_EXCHANGE = "const tokenRes = await fetch(";

// ===========================================================================
// LAYER 1 — the query-string contract
//
// These functions take NO JSON body. `req.json()` is never called, so
// tests/helpers/edge-contract.ts has nothing to parse and throws. Their inputs
// arrive in the query string of a browser GET, and that is what is derived here.
// ===========================================================================
describe.each(PROVIDERS)("accounting/$label — $callbackFn query contract", (p) => {
  it("reads its inputs from the query string, not a body", () => {
    const shape = shapeOf(p);
    expect(
      shape.fields.length,
      `Parsed no query parameters out of ${shape.file}. Every assertion in this file ` +
        `would now pass against a function that reads nothing.`,
    ).toBeGreaterThan(0);

    for (const required of ["code", "state", "error"]) {
      expect(
        shape.fields,
        `${p.callbackFn} no longer reads \`${required}\` from the query string. ` +
          `${p.label} sends it on every redirect; not reading it means either the code is ` +
          `never redeemed, the CSRF guard has no input, or a denied consent is processed ` +
          `as a success.`,
      ).toContain(required);
    }
    expect(shape.src).not.toContain("req.json()");
  });

  it("reads exactly the extra parameters this provider sends, and no others", () => {
    // The asymmetry, stated rather than averaged. Zoho echoes `location` and
    // `accounts-server` to say which data centre owns the account; Xero has no
    // such concept. A shared suite that asserted the intersection would never
    // notice either one going missing.
    const shape = shapeOf(p);
    const extras = shape.fields.filter((f) => !["code", "state", "error"].includes(f));
    expect(
      extras.sort(),
      `${p.callbackFn} reads a different set of provider-specific query parameters than ` +
        `this suite declares.\n` +
        `  declared: ${[...p.extraCallbackParams].sort().join(", ") || "(none)"}\n` +
        `  read:     ${extras.join(", ") || "(none)"}\n` +
        `  For Zoho these decide WHICH DATA CENTRE the authorization code is redeemed at, ` +
        `and a code is only valid at the one that issued it.`,
    ).toEqual([...p.extraCallbackParams].sort());
  });

  it("is still verify_jwt = false in config.toml", () => {
    // Read from the file, not from memory. Flipping this to true does not make
    // the endpoint safer — it makes it unreachable: the provider redirects a
    // browser here with no Authorization header, so every operator's connect
    // flow would end on a gateway 401 with nothing in our logs.
    const toml = readFileSync(join(REPO_ROOT, "supabase", "config.toml"), "utf8");
    const declared = new RegExp(
      `\\[functions\\.${p.callbackFn}\\][^\\[]*verify_jwt\\s*=\\s*false`,
    ).test(toml);
    expect(
      declared,
      `supabase/config.toml no longer declares verify_jwt = false for ${p.callbackFn}.\n` +
        `  This endpoint is a REDIRECT TARGET: ${p.label} sends the operator's browser ` +
        `here with no session token. With JWT verification on, the gateway answers 401 ` +
        `before the function runs and the integration cannot be connected at all.\n` +
        `  It is also why every assertion in this file matters: the state nonce is the ` +
        `only authentication left.`,
    ).toBe(true);
  });
});

// ===========================================================================
// LAYER 1 — THE STATE GUARD. Five refusals, one provider error, and the order.
// ===========================================================================
describe.each(PROVIDERS)("accounting/$label — $callbackFn refuses a bad state", (p) => {
  it("refuses a request with no state (and one with no code)", () => {
    const shape = shapeOf(p);
    expect(
      shape.src,
      `${p.callbackFn} no longer refuses a request that carries no state. With no nonce ` +
        `there is nothing to look up and nothing authenticating the request, so the only ` +
        `safe answer is to stop.`,
    ).toMatch(/if\s*\(\s*!code\s*\|\|\s*!state\s*\)/);
    expect(shape.src).toContain("reason=missing_params");
  });

  it("refuses a state that is not in accounting_oauth_state", () => {
    const shape = shapeOf(p);
    requireAt(shape, '.from("accounting_oauth_state")', "the state lookup");
    expect(
      shape.src,
      `${p.callbackFn} no longer looks the nonce up by the state it was given.`,
    ).toMatch(/\.eq\(\s*["']nonce["']\s*,\s*state\s*\)/);
    expect(
      shape.src,
      `${p.callbackFn} no longer refuses an unknown nonce. A forged state would then fall ` +
        `through with \`stateRow\` undefined, and the tenant the tokens are stored against ` +
        `is read off that row.`,
    ).toMatch(/if\s*\(\s*!stateRow\s*\)/);
    expect(shape.src).toContain("reason=invalid_state");
  });

  it("refuses a state minted for the OTHER provider", () => {
    // Confused-deputy protection. Without it a Zoho nonce could be redeemed at
    // the Xero callback: the tenant would be right, the provider column on the
    // stored connection would be wrong, and the tokens would be filed under an
    // API they do not work against.
    const shape = shapeOf(p);
    expect(
      shape.src,
      `${p.callbackFn} no longer checks that the nonce was minted for ${p.id}.`,
    ).toMatch(new RegExp(`stateRow\\.provider\\s*!==\\s*["']${p.id}["']`));
    expect(shape.src).toContain("reason=state_provider_mismatch");
  });

  it("refuses an expired state, and compares the clock the right way round", () => {
    const shape = shapeOf(p);
    expect(
      shape.src,
      `${p.callbackFn} no longer enforces the nonce TTL. The nonce would then be valid ` +
        `until the hourly reaper happens to run — turning a 30-minute window into an ` +
        `hours-long one for a value that authenticates a token store.`,
    ).toMatch(/new Date\(\s*stateRow\.expires_at\s*\)\.getTime\(\)\s*<\s*Date\.now\(\)/);
    expect(shape.src).toContain("reason=state_expired");
  });

  it("selects the columns the guards read, so none of them can fail open", () => {
    // Not pedantry. The expiry check is
    //
    //     new Date(stateRow.expires_at).getTime() < Date.now()
    //
    // and if `expires_at` is dropped from the select, `stateRow.expires_at` is
    // undefined, `.getTime()` is NaN, and `NaN < Date.now()` is FALSE. The nonce
    // then NEVER expires, silently, with no error anywhere. `provider` fails the
    // same way: undefined !== "xero" is true, so that one at least fails closed.
    const shape = shapeOf(p);
    const cols = selectedColumnsAfterFrom(shape, "accounting_oauth_state");
    expect(
      cols.length,
      "Could not read the select list on the accounting_oauth_state lookup — the query " +
        "was rewritten. Retarget this assertion rather than deleting it: it is the only " +
        "thing pinning a dependency that is invisible at the comparison itself.",
    ).toBeGreaterThan(0);

    for (const col of ["tenant_id", "provider", "expires_at", "initiated_by"]) {
      expect(
        cols,
        `${p.callbackFn} no longer selects \`${col}\` from accounting_oauth_state.\n` +
          `  expires_at is the dangerous one: dropping it makes the TTL check read ` +
          `undefined, which yields NaN, and \`NaN < Date.now()\` is false — the guard ` +
          `fails OPEN and every nonce becomes immortal.`,
      ).toContain(col);
    }
  });

  it("handles a provider `error` parameter instead of treating it as success", () => {
    // The operator clicked "Cancel" on the consent screen, or the provider
    // refused. There is no `code` in that redirect. Without this branch the
    // flow would fall to the missing_params guard, which is the right outcome by
    // accident and loses the provider's own reason — the operator is told
    // "missing_params" for what was actually "access_denied".
    const shape = shapeOf(p);
    const guardAt = requireAt(shape, "if (providerError)", "the provider-error branch");
    const tokenAt = requireAt(shape, TOKEN_EXCHANGE, "the token exchange");
    expect(
      shape.src,
      `${p.callbackFn} no longer passes the provider's own error through to the portal.`,
    ).toContain("status=error");
    expect(
      guardAt < tokenAt,
      `The provider-error branch now sits BELOW the token exchange (@${guardAt} vs ` +
        `@${tokenAt}). A denied consent carries no code, so the exchange would be ` +
        `attempted with an empty one.`,
    ).toBe(true);
  });

  it("does EVERY state check before the authorization code is redeemed", () => {
    // The order case, and the reason this file exists.
    //
    // Redeeming the code is the irreversible step on this surface. It is
    // one-time-use at the provider: once spent, the operator has to walk the
    // whole consent round-trip again. Worse, a state check that runs after the
    // exchange has already sent our client_id and client_secret somewhere.
    const shape = shapeOf(p);
    const tokenAt = requireAt(shape, TOKEN_EXCHANGE, "the token exchange");

    const guards: [string, number][] = [
      ["the missing-params guard", requireAt(shape, "reason=missing_params", "the missing-params guard")],
      ["the unknown-nonce guard", requireAt(shape, "reason=invalid_state", "the unknown-nonce guard")],
      ["the provider-mismatch guard", requireAt(shape, "reason=state_provider_mismatch", "the provider-mismatch guard")],
      ["the expiry guard", requireAt(shape, "reason=state_expired", "the expiry guard")],
    ];

    for (const [name, idx] of guards) {
      expect(
        idx < tokenAt,
        `${name} has moved BELOW the token exchange in ${shape.file}.\n` +
          `  guard@${idx}  exchange@${tokenAt}\n` +
          `  The one-time authorization code would be spent on a request that was then\n` +
          `  refused, and the operator would have to restart consent. Nothing in this\n` +
          `  assertion depends on a field name — this is not a stale test.`,
      ).toBe(true);
    }
  });

  it("does every state check before any token is stored against a tenant", () => {
    const shape = shapeOf(p);
    const storeAt = requireAt(shape, 'rpc("accounting_store_tokens"', "the token store");
    for (const reason of [
      "reason=missing_params",
      "reason=invalid_state",
      "reason=state_provider_mismatch",
      "reason=state_expired",
    ]) {
      expect(
        requireAt(shape, reason, reason) < storeAt,
        `${reason} now sits below accounting_store_tokens. Tokens would be written ` +
          `against a tenant chosen by an unvalidated nonce.`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// LAYER 1 — single use, and where the tenant comes from
// ===========================================================================
describe.each(PROVIDERS)("accounting/$label — $callbackFn consumes the nonce", (p) => {
  it("deletes the nonce once it has been redeemed", () => {
    // "Already consumed" is not a separate branch in these functions: a redeemed
    // nonce is DELETED, so a second attempt lands on the unknown-nonce guard
    // above and gets `invalid_state`. That is a legitimate design — but it means
    // this delete IS the single-use guarantee, and losing it makes every nonce
    // replayable for the rest of its 30-minute TTL.
    const shape = shapeOf(p);
    expect(
      shape.src,
      `${p.callbackFn} no longer deletes the nonce after redeeming it. Consumption is not ` +
        `tracked any other way — there is no \`used_at\` column — so the nonce would stay ` +
        `valid until it expires and the callback could be driven again by anyone holding it.`,
    ).toMatch(/\.from\(\s*["']accounting_oauth_state["']\s*\)\s*\.delete\(\)\s*\.eq\(\s*["']nonce["']\s*,\s*state\s*\)/);
  });

  it("deletes it only after the tokens are safely stored", () => {
    // Order in the other direction. Deleting the nonce BEFORE the store would
    // mean a failed store leaves the operator with a spent code, a spent nonce
    // and no connection — with nothing to retry.
    const shape = shapeOf(p);
    const storeAt = requireAt(shape, 'rpc("accounting_store_tokens"', "the token store");
    const deleteAt = requireAt(shape, ".delete().eq(", "the nonce delete");
    expect(
      storeAt < deleteAt,
      `The nonce is now deleted before accounting_store_tokens runs (delete@${deleteAt}, ` +
        `store@${storeAt}). A failed store would leave nothing to retry with: the ` +
        `authorization code is already spent and the nonce is gone.`,
    ).toBe(true);
  });

  it("takes the tenant from the state row, never from the query string", () => {
    // The confused-deputy property in one line. `stateRow.tenant_id` was written
    // by an authenticated admin at start time. Anything read off `url` was
    // written by whoever built the link.
    const shape = shapeOf(p);
    expect(
      shape.src,
      `${p.callbackFn} no longer stores tokens against stateRow.tenant_id. If the tenant ` +
        `now comes from anywhere the browser can influence, one operator's tokens can be ` +
        `filed against another operator's books.`,
    ).toContain("p_tenant_id: stateRow.tenant_id");
  });

  it("stores tokens through the RPC, never by writing the connection row directly", () => {
    // accounting_connections has no token columns at all — only
    // `access_token_secret_id` / `refresh_token_secret_id`, which are Vault
    // references (20260526110000_create_accounting_connections.sql: "NEVER store
    // raw tokens here"). accounting_store_tokens() is the SECURITY DEFINER
    // function that puts the secret in Vault and writes the reference. A direct
    // insert cannot do that, so a direct insert either loses the tokens or
    // parks them somewhere they were never meant to be.
    const shape = shapeOf(p);
    requireAt(shape, 'rpc("accounting_store_tokens"', "the accounting_store_tokens RPC call");
    expect(
      shape.src,
      `${p.callbackFn} now writes accounting_connections directly instead of going through ` +
        `accounting_store_tokens(). That table holds Vault REFERENCES, not tokens; the RPC ` +
        `is what creates the Vault secret.`,
    ).not.toContain('.from("accounting_connections")');
  });

  it("never writes a token or the client secret into a log line", () => {
    // Edge function logs are readable by everyone with dashboard access and are
    // retained. A refresh token in one is a standing grant to an operator's
    // accounting system; the client secret is platform-wide.
    const shape = shapeOf(p);
    const forbidden = /\b(accessToken|refreshToken|access_token|refresh_token|clientSecret|client_secret|basicAuth)\b/;
    for (const m of shape.src.matchAll(/console\.(log|warn|error)\s*\(/g)) {
      const start = m.index ?? 0;
      // Read to the end of the call. Depth-counted, because these calls span
      // several lines and contain template literals with their own parens.
      let depth = 0;
      let end = start;
      for (let i = start; i < shape.src.length; i += 1) {
        if (shape.src[i] === "(") depth += 1;
        else if (shape.src[i] === ")") {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const call = shape.src.slice(start, end + 1);
      expect(
        forbidden.test(call),
        `A console call in ${shape.file} now includes a credential:\n` +
          `    ${call.replace(/\s+/g, " ").slice(0, 200)}\n` +
          `  Function logs are readable by anyone with project dashboard access and are ` +
          `retained. A refresh token there is a standing grant to that operator's books; ` +
          `${p.clientSecretEnv} is shared by every tenant on the platform.`,
      ).toBe(false);
    }
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// WHAT EACH CASE DOES IF ENABLED, AND WHY IT IS HARMLESS:
//
// All four send NO credentials — no Authorization, no apikey — because that is
// exactly what a provider's redirect looks like, and these endpoints are
// verify_jwt = false. None of them carries a real nonce, and without one the
// function answers from its state guards before it reads or writes anything:
// no token exchange, no RPC, no row. That is not an assumption — it is the
// Layer 1 order case above, which is what makes these safe to run with
// D247_LIVE_TESTS=1 alone and no write flag.
//
// A REAL nonce must never be used here. Anything holding one can drive the
// callback for real, which is the entire point of the tests above.
// ===========================================================================
describe.each(PROVIDERS)("accounting/$label — $callbackFn live (Layer 2)", (p) => {
  it("live: a provider `error` is reported as an error, not as a success", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    const res = await accountingLiveFetch(p.callbackFn, {
      method: "GET",
      auth: "none",
      query: { error: "access_denied", error_description: "drive247 suite probe" },
    });

    // Two legal shapes — a 302 back to the portal, or a 400 carrying the reason
    // when no portal origin can be resolved. Which one arrives is not a property
    // of this request; see README finding 2. The VERDICT is what is asserted.
    expect(
      callbackReason(res),
      `${p.callbackFn} did not report the provider's error back.\n` +
        `  ${describeCallback(res)}\n` +
        `  A 2xx with no reason would be FAILURE MODE (b) and the worst outcome on this ` +
        `endpoint: a denied consent processed as a success.\n` +
        `  A 401 means config.toml's verify_jwt = false was flipped — the Layer 1 case ` +
        `above says so directly, and every operator's connect flow is broken.\n` +
        `  A 404 means the function is not deployed on this project.`,
    ).toBe("access_denied");
  });

  it("live: no state at all is refused", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    // A code with no state. Nothing to look up, so nothing is looked up.
    const withoutState = await accountingLiveFetch(p.callbackFn, {
      method: "GET",
      auth: "none",
      query: { code: UNREDEEMABLE_CODE },
    });
    expect(
      callbackReason(withoutState),
      `${p.callbackFn} accepted a callback with NO state.\n` +
        `  ${describeCallback(withoutState)}\n` +
        `  state is the only authentication this endpoint has. Accepting a request ` +
        `without one means anyone who can reach the URL can drive it.`,
    ).toBe("missing_params");

    // And the mirror: a state with no code. Same guard, and it must stay that
    // way — an empty code sent to the provider is a wasted round-trip that
    // reveals our client credentials for nothing.
    const withoutCode = await accountingLiveFetch(p.callbackFn, {
      method: "GET",
      auth: "none",
      query: { state: NON_EXISTENT_NONCE },
    });
    expect(
      callbackReason(withoutCode),
      `${p.callbackFn} accepted a callback with a state but NO code.\n  ${describeCallback(withoutCode)}`,
    ).toBe("missing_params");
  });

  it("live: an unknown state is refused before any code is redeemed", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    // The all-zero UUID: valid for the column's type, never produced by
    // gen_random_uuid(). It reaches the real lookup and misses.
    const res = await accountingLiveFetch(p.callbackFn, {
      method: "GET",
      auth: "none",
      query: { code: UNREDEEMABLE_CODE, state: NON_EXISTENT_NONCE },
    });

    expect(
      callbackReason(res),
      `${p.callbackFn} did not refuse an unknown state.\n` +
        `  ${describeCallback(res)}\n` +
        `  THIS IS THE ONE THAT MATTERS. A callback that accepts a nonce it never issued ` +
        `is a callback anyone can drive: it redeems a code, stores tokens against a ` +
        `tenant it read off that row, flips the tenant's integration flag and enqueues ` +
        `every unsynced financial event.\n` +
        `  reason=token_exchange_failed instead of invalid_state would mean the exchange ` +
        `was attempted FIRST — the guard has moved below it, and our client_id and ` +
        `client_secret went out on an unauthenticated request. The Layer 1 order case ` +
        `above is what should have caught that; if both fail, believe them.`,
    ).toBe("invalid_state");
  });

  it("live: a POST is refused with 405", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    const res = await accountingLiveFetch(p.callbackFn, {
      method: "POST",
      auth: "none",
      body: { code: UNREDEEMABLE_CODE, state: NON_EXISTENT_NONCE },
    });
    expect(
      res.status,
      `${p.callbackFn} no longer refuses a POST.\n` +
        `  got ${res.status}: ${res.text.slice(0, 200)}\n` +
        `  This endpoint is a browser redirect target; a POST is never something ` +
        `${p.label} sends. Accepting one widens the surface for no gain.`,
    ).toBe(405);
  });
});
