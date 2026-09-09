// =============================================================================
// integrations/bonzah — bonzah-verify-credentials.
//
// "ARE THE STORED CREDENTIALS USABLE?" — the question this endpoint answers, and
// the answer is written straight into `tenants.bonzah_username` /
// `bonzah_password` by both callers the moment it comes back `valid: true`.
// Nothing downstream re-checks. Every live premium, every policy, every
// certificate download for that operator afterwards runs on whatever this
// function blessed.
//
// WHAT IT ACTUALLY DOES (read, not assumed):
//   1. trims the submitted username/password
//   2. 400s a blank one, 400s a missing tenantId
//   3. reads `tenants.bonzah_mode` with the SERVICE ROLE client — the mode is
//      never taken from the request
//   4. TEST MODE: short-circuits. Returns `{ valid: true, platform: true }`
//      having compared nothing against anything.
//   5. LIVE MODE: authenticates against bonzah.insillion.com and returns
//      `{ valid: true }` or HTTP 200 `{ valid: false, error }`
//
// SO THE LIVE RUNG IS NOT "READ-ONLY". Step 5 is a login attempt at production
// insurance, and Insillion counts failures (`fail_count` is in the payload the
// shared client logs). This folder's gate therefore demands the same
// `D247_LIVE_BONZAH_MODE=test` declaration the money gate does, for the reason
// spelled out in servicing.ts: the host is chosen server-side from a per-tenant
// column, so no URL guard in this process can see where the call went.
//
// LAYERS: 1 (contract + guard order, from source), 2 (live, opt-in), and one
// case that EXECUTES the shipped token cache out of _shared/bonzah-client.ts.
// =============================================================================

import { describe, expect, it } from "vitest";
import { assertContract, readEdgeFunction, type PayloadContract } from "../../helpers/edge-contract";
import { classifyLive, liveCall } from "../../helpers/live-call";
import { liftSharedClient } from "./rate-card";
import { BONZAH_LIVE_HOST, BONZAH_SANDBOX_HOST } from "./sandbox";
import {
  bonzahModeDeclared,
  bonzahServicingGate,
  fixtureOrNull,
  liftAsyncSharedClient,
  readRepoFile,
  srcOf,
} from "./servicing";

const FN = "bonzah-verify-credentials";
const src = () => srcOf(FN);

/** Not a spine step — this folder runs independently of the 01..05 chain. */
const AT = "integrations/bonzah";

/** The newer of the two callers, and the one whose behaviour is correct. */
const PANEL = "apps/portal/src/app/(dashboard)/integrations/_panels/bonzah.tsx";
/** The older Settings component, still shipped, still calling this endpoint. */
const SETTINGS = "apps/portal/src/components/settings/bonzah-settings.tsx";

const CONTRACT: PayloadContract = {
  step: AT,
  fn: FN,
  builtIn: PANEL,
  // Byte-identical bodies are built in bonzah-settings.tsx (`handleVerifyAndConnect`)
  // and in bonzah-partner-review's approve path, which calls this function
  // server-to-server with exactly these three keys.
  payload: {
    username: "operator@example.invalid",
    password: "not-a-real-password",
    tenantId: "00000000-0000-0000-0000-000000000000",
  },
};

describe("bonzah/verify-credentials — contract", () => {
  it("agrees with the payload the integrations panel builds", () => {
    const shape = assertContract(CONTRACT);
    expect(shape.typeName).toBe("VerifyCredentialsRequest");
    expect(
      shape.fields.length,
      `Parsed no request fields out of ${shape.file} — the contract would then pass vacuously.`,
    ).toBeGreaterThan(0);
    expect(
      shape.requiredByType,
      "One of username / password / tenantId became optional in the request type. All " +
        "three are hard-required by the guards below, so an optional marking here is a " +
        "type that lies to its callers.",
    ).toEqual(["password", "tenantId", "username"]);
  });

  it("takes no `mode` off the request — the DB is the only source of it", () => {
    // The single most dangerous field this endpoint could grow. A caller-supplied
    // mode would let a LIVE tenant be "verified" against the sandbox (which
    // accepts platform credentials and answers valid for anything), and the
    // wrong password would then be stored as verified.
    const shape = readEdgeFunction(FN);
    for (const forbidden of ["mode", "bonzah_mode", "apiUrl", "api_url"]) {
      expect(
        shape.fields,
        `${FN} now reads \`${forbidden}\` off the request body. The mode decides which ` +
          "Bonzah world the credentials are checked against; taking it from the caller " +
          "means the caller decides whether the check is real.",
      ).not.toContain(forbidden);
    }
    expect(
      src(),
      "The bonzah_mode lookup on the tenants table is gone. Without it there is nothing " +
        "left to decide test from live except the request.",
    ).toMatch(/\.select\('bonzah_mode'\)/);
  });

  it("verifies against the tenant it was told about, not against every tenant", () => {
    const s = src();
    expect(
      s,
      "The tenant lookup is no longer filtered by the request's tenantId. `.single()` on " +
        "an unfiltered tenants select reads an arbitrary operator's mode.",
    ).toMatch(/\.eq\('id',\s*body\.tenantId\)/);
  });
});

describe("bonzah/verify-credentials — guard order", () => {
  it("trims BEFORE it validates, so a space-only password cannot pass", () => {
    // The function's own header records why: a space-prefixed password pasted at
    // save time otherwise passes the test-mode short circuit unverified, gets
    // persisted, and then fails every live Bonzah auth after go-live.
    const s = src();
    const trimAt = s.indexOf("(body.username || '').trim()");
    const guardAt = s.indexOf("if (!username || !password)");
    expect(trimAt, "The username trim is gone from bonzah-verify-credentials.").toBeGreaterThan(-1);
    expect(s, "The password trim is gone.").toMatch(/\(body\.password \|\| ''\)\.trim\(\)/);
    expect(guardAt, "The blank-credential guard is gone.").toBeGreaterThan(-1);
    expect(
      trimAt < guardAt,
      `The trim moved BELOW the blank check (trim@${trimAt}, guard@${guardAt}). A password ` +
        'of "   " would then pass the guard, be verified as whatever the mode allows, and ' +
        "be stored — both callers write the credentials on the strength of this answer.",
    ).toBe(true);
  });

  it("validates the trimmed locals, not the raw body", () => {
    // `if (!body.password)` would let "   " through even with the trim above it,
    // because the trimmed value is the one used from that point on.
    const s = src();
    expect(
      /if\s*\(\s*!body\.username\s*\|\|\s*!body\.password\s*\)/.test(s),
      "The blank-credential guard reads the raw body again instead of the trimmed local. " +
        'A whitespace-only credential would pass it and then be sent to Bonzah as "".',
    ).toBe(false);
    expect(s).toMatch(/if\s*\(\s*!username\s*\|\|\s*!password\s*\)/);
  });

  it("refuses a missing tenantId before it touches the database", () => {
    const s = src();
    const tenantGuardAt = s.indexOf("if (!body.tenantId)");
    const selectAt = s.indexOf(".from('tenants')");
    expect(tenantGuardAt, "The missing-tenantId guard is gone.").toBeGreaterThan(-1);
    expect(selectAt, "The tenants lookup is gone.").toBeGreaterThan(-1);
    expect(
      tenantGuardAt < selectAt,
      "The tenantId guard moved below the tenants query. `.eq('id', undefined).single()` " +
        "is a 500-shaped failure where a 400 naming the field belongs.",
    ).toBe(true);
  });

  it("short-circuits test mode ABOVE the live API call, and says so with `platform: true`", () => {
    // The order is the whole safety property. Below the auth call, a test-mode
    // tenant's credentials would be checked against bonzah.insillion.com — the
    // LIVE host — because getBonzahApiUrl() is what resolves it.
    const s = src();
    const shortCircuitAt = s.indexOf("if (mode === 'test')");
    const apiUrlAt = s.indexOf("getBonzahApiUrl(mode)");
    const authAt = s.indexOf("getBonzahTokenForCredentials(");
    expect(shortCircuitAt, "The test-mode short circuit is gone.").toBeGreaterThan(-1);
    expect(authAt, `${FN} no longer authenticates at all.`).toBeGreaterThan(-1);
    expect(
      shortCircuitAt < apiUrlAt && shortCircuitAt < authAt,
      `The test-mode short circuit moved below the Bonzah call (short-circuit@${shortCircuitAt}, ` +
        `apiUrl@${apiUrlAt}, auth@${authAt}). Test-mode tenants have no credentials of their ` +
        "own, so what would be sent to Bonzah is whatever is in the form.",
    ).toBe(true);
    expect(
      s,
      "`platform: true` left the test-mode response. That flag is the ONLY thing telling a " +
        "caller the answer was a short circuit rather than a check — the integrations panel " +
        "reads it to decide between \"Bonzah login verified\" and \"Saved\".",
    ).toMatch(/platform:\s*true/);
  });

  it("never applies the SELL gate — servicing must work in every mode", () => {
    // Scope note in _shared/bonzah-client.ts, asserted so it is not widened: the
    // gate blocks SELLING. Applied here it would stop an operator fixing a stale
    // password precisely when their integration is broken.
    expect(
      /assertBonzahSellable|getBonzahSellability/.test(src()),
      `${FN} has started calling the Bonzah sell gate. Checking a login is not selling a ` +
        "policy; gating it strands an operator whose credentials went stale, because " +
        "repairing them is the one action that would clear the gate.",
    ).toBe(false);
  });
});

describe("bonzah/verify-credentials — the answer both callers key on", () => {
  it("is not in supabase/config.toml, so the gateway keeps demanding a JWT", () => {
    // verify_jwt defaults to TRUE; the only way to make an edge function public
    // is to add it to config.toml. This one takes a tenantId off the request and answers with a verdict that both callers write straight into tenants.bonzah_username / bonzah_password.
    //
    // Derived from the file rather than remembered: a `[functions.bonzah-verify-credentials]` block
    // with verify_jwt = false is a one-line change with no other visible effect.
    const toml = readRepoFile("supabase/config.toml");
    const block = new RegExp(`\\[functions\\.bonzah-verify-credentials\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(toml);
    const verifyJwtOff = block ? /verify_jwt\s*=\s*false/.test(block[1]) : false;
    expect(
      verifyJwtOff,
      "bonzah-verify-credentials has been given verify_jwt = false in supabase/config.toml.\n" +
        "  An unauthenticated caller could then submit credentials against any tenantId and read back whether a Bonzah login works — a login oracle, on someone else's account, with Insillion counting the failures.",
    ).toBe(false);
  });

  it("answers HTTP 200 with `valid: false` when Bonzah rejects the login", () => {
    // Not a 4xx. `supabase.functions.invoke` only populates `error` on a non-2xx,
    // so a caller reading `error` alone would store a dead password and report
    // success — which is exactly what the panel's own comment says it avoids.
    const s = src();
    const catchAt = s.indexOf("} catch (authError) {");
    expect(catchAt, "The auth-failure catch is gone from the live path.").toBeGreaterThan(-1);
    const tail = s.slice(catchAt, catchAt + 400);
    expect(
      tail,
      "The rejected-login branch no longer answers with jsonResponse({ valid: false }). If it " +
        "became an errorResponse, `data` is null in both callers and they fall into their " +
        "generic catch — the operator is told the platform failed rather than that Bonzah " +
        "rejected their password.",
    ).toMatch(/jsonResponse\(\{\s*valid:\s*false/);
  });

  it("the panel reads `valid`, not the transport error — asserted on both sides", () => {
    // One side derived from source above, one side read out of the caller. The
    // pair is the contract; neither half proves anything alone.
    const panel = readRepoFile(PANEL);
    expect(
      panel,
      `${PANEL} no longer checks \`data.valid\`. This endpoint answers 200 with ` +
        "{ valid: false } on a rejected login, so dropping that check stores a password " +
        "Bonzah has already refused.",
    ).toMatch(/if\s*\(!data\?\.valid\)/);
    expect(
      panel,
      "The panel no longer distinguishes the test-mode short circuit (`platform: true`) " +
        'from a real check. It would then print "Bonzah login verified" for an answer that ' +
        "compared nothing.",
    ).toMatch(/data\?\.platform\s*!==\s*true/);
  });

  it("WATCHDOG: the older Settings component still reports a short circuit as verified", () => {
    // KNOWN DEFECT, tracked rather than blessed. bonzah-settings.tsx is still in
    // the tree and still calls this endpoint. It checks `data.valid` (good) but
    // not `data.platform`, so on a test-mode tenant it prints "Your Bonzah
    // credentials have been verified and saved" for an answer that verified
    // nothing — and then writes integration_bonzah = true.
    //
    // This case converts itself: the day someone adds the `platform` check, the
    // first branch below becomes the real assertion and this watchdog is done.
    const settings = readRepoFile(SETTINGS);
    const stillCalls = settings.includes("bonzah-verify-credentials");
    if (!stillCalls) {
      // The component was removed or rewired — nothing left to watch.
      expect(stillCalls).toBe(false);
      return;
    }
    const checksPlatform = /data\??\.platform/.test(settings);
    if (checksPlatform) {
      // The fix landed. Assert it properly from here on.
      expect(
        settings,
        "bonzah-settings.tsx reads `platform` now — pin it the way the panel is pinned.",
      ).toMatch(/platform/);
      return;
    }
    expect(
      settings.includes("verified and saved"),
      [
        "",
        "  bonzah-settings.tsx no longer says \"verified and saved\" — or the copy moved.",
        "",
        "  This case pins a KNOWN DEFECT so it cannot be lost:",
        `    ${SETTINGS} calls bonzah-verify-credentials, reads only \`data.valid\`, and`,
        "    reports success. In TEST mode this endpoint returns { valid: true,",
        "    platform: true } WITHOUT contacting Bonzah at all, so the operator is told",
        "    their credentials are verified when nothing was checked — and",
        "    integration_bonzah is set to true on the strength of it.",
        "",
        `  The fix is the check ${PANEL} already makes: treat \`platform === true\` as`,
        "  \"saved, not verified\". When that lands, this case turns itself into the",
        "  positive assertion above.",
        "",
      ].join("\n"),
    ).toBe(true);
  });
});

describe("bonzah/verify-credentials — the token cache decides the verdict", () => {
  it("WATCHDOG (executed): a cached token is handed out for the WRONG password", () => {
    // This is the shipped `getBonzahTokenForCredentials`, lifted out of
    // _shared/bonzah-client.ts and RUN against a fake fetch. Nothing here is a
    // re-implementation: the cache, the TTL check and the early return are the
    // real ones.
    //
    // THE DEFECT: the cache is keyed on USERNAME ALONE and the cached branch
    // returns before the password is looked at.
    //
    //     const cached = tenantTokenCache.get(username);
    //     if (cached && Date.now() < cached.expiresAt) return cached.token;
    //
    // bonzah-verify-credentials answers `valid: true` on a token, so within one
    // warm isolate and the 14-minute TTL, an operator who edits only the
    // password field and clicks Verify is told the new password is good — and
    // both callers then persist it. It fails silently ~14 minutes later, on the
    // next real policy, with an error that reads like Bonzah's fault.
    const cache = new Map<string, { token: string; expiresAt: number }>();
    const authAttempts: { username: string; password: string }[] = [];
    const fakeFetch = async (_url: string, init: { body: string }) => {
      const sent = JSON.parse(init.body) as { email: string; pwd: string };
      authAttempts.push({ username: sent.email, password: sent.pwd });
      // Bonzah's own contract: status 0 is a good login, anything else is not.
      const good = sent.pwd === "the-right-password";
      return {
        json: async () =>
          good
            ? { status: 0, data: { token: `token-${authAttempts.length}`, email: sent.email } }
            : { status: -1, txt: `Authentication failed ${sent.email}` },
      };
    };

    const lifted = liftAsyncSharedClient<
      (u: string, p: string, apiUrl: string, ctx?: string) => Promise<string>
    >("getBonzahTokenForCredentials", {
      tenantTokenCache: cache,
      TOKEN_TTL_MS: 14 * 60 * 1000,
      BONZAH_AUTH_FAILED: "BONZAH_AUTH_FAILED",
      fetch: fakeFetch,
      console: { log() {}, error() {} },
    });

    const keyedOnPasswordToo =
      /tenantTokenCache\.get\(\s*(?!username\s*\))/.test(lifted.body) ||
      /tenantTokenCache\.set\(\s*(?!username\s*,)/.test(lifted.body);

    return (async () => {
      const first = await lifted.call("operator@example.invalid", "the-right-password", "https://api.invalid");
      expect(first, "A correct password no longer yields a token at all.").toBe("token-1");
      expect(authAttempts.length, "The correct login did not reach Bonzah.").toBe(1);

      if (keyedOnPasswordToo) {
        // THE FIX LANDED. This is now a real assertion, and it is the one that
        // should have been here all along.
        await expect(
          lifted.call("operator@example.invalid", "a-completely-wrong-password", "https://api.invalid"),
          "The token cache is keyed on more than the username now, so a wrong password " +
            "must be rejected instead of served from cache. It was not.",
        ).rejects.toThrow();
        return;
      }

      // Caught rather than awaited bare: if the cache has been removed or fixed
      // some other way, this call REJECTS, and an unhandled rejection would
      // report the Bonzah auth error instead of the sentence that explains what
      // just changed.
      let outcome: string;
      try {
        outcome = `returned the cached token (${await lifted.call(
          "operator@example.invalid",
          "a-completely-wrong-password",
          "https://api.invalid",
        )})`;
      } catch (e) {
        outcome = `rejected: ${(e as Error).message.slice(0, 60)}`;
      }

      expect(
        { outcome, bonzahWasAsked: authAttempts.length },
        [
          "",
          "  The shipped token cache stopped serving a cached token for a wrong password.",
          "",
          "  `outcome: rejected` above means the WRONG password is now refused. That is the",
          "  fix, and this watchdog has done its job: delete this branch and keep the",
          "  `keyedOnPasswordToo` assertion above, which is already written. (Key the cache",
          "  on the password as well as the username, or keep the cache out of the verify",
          "  path — either closes it.)",
          "",
          "  What it was pinning (a real defect, reported and not blessed):",
          "    _shared/bonzah-client.ts caches Bonzah tokens under the USERNAME only and",
          "    returns the cached token before comparing anything. bonzah-verify-credentials",
          "    reports `valid: true` on a token, so a wrong password submitted within the",
          "    14-minute TTL of a good one is reported as valid and then written to",
          "    tenants.bonzah_password by both callers.",
          "",
        ].join("\n"),
      ).toEqual({ outcome: "returned the cached token (token-1)", bonzahWasAsked: 1 });
    })();
  });

  it("a genuinely rejected login throws BONZAH_AUTH_FAILED, cold", () => {
    // The cold path — nothing cached — is correct, and is what the live rung
    // exercises. Asserted so the watchdog above cannot be mistaken for "this
    // function never checks anything".
    const cache = new Map<string, { token: string; expiresAt: number }>();
    const lifted = liftAsyncSharedClient<
      (u: string, p: string, apiUrl: string, ctx?: string) => Promise<string>
    >("getBonzahTokenForCredentials", {
      tenantTokenCache: cache,
      TOKEN_TTL_MS: 14 * 60 * 1000,
      BONZAH_AUTH_FAILED: "BONZAH_AUTH_FAILED",
      fetch: async () => ({ json: async () => ({ status: -1, txt: "Authentication failed" }) }),
      console: { log() {}, error() {} },
    });

    return expect(
      lifted.call("cold@example.invalid", "wrong", "https://api.invalid", "entered"),
      "A rejected Bonzah login no longer throws. bonzah-verify-credentials would then " +
        "fall through to `valid: true` and bless a password Bonzah has refused.",
    ).rejects.toThrow(/Bonzah rejected these credentials/);
  });

  it("a token that is present but EXPIRED is re-authenticated", () => {
    const cache = new Map<string, { token: string; expiresAt: number }>([
      ["operator@example.invalid", { token: "stale", expiresAt: Date.now() - 1 }],
    ]);
    let calls = 0;
    const lifted = liftAsyncSharedClient<(u: string, p: string, a: string) => Promise<string>>(
      "getBonzahTokenForCredentials",
      {
        tenantTokenCache: cache,
        TOKEN_TTL_MS: 14 * 60 * 1000,
        BONZAH_AUTH_FAILED: "BONZAH_AUTH_FAILED",
        fetch: async () => {
          calls += 1;
          return { json: async () => ({ status: 0, data: { token: "fresh", email: "e" } }) };
        },
        console: { log() {}, error() {} },
      },
    );
    return (async () => {
      const token = await lifted.call("operator@example.invalid", "p", "https://api.invalid");
      expect(
        { token, calls },
        "An expired cached token is being served instead of re-authenticating. The TTL " +
          "check is the only thing that ever re-tests a stored credential.",
      ).toEqual({ token: "fresh", calls: 1 });
    })();
  });
});

describe("bonzah/verify-credentials — which Bonzah world a live check reaches", () => {
  it("live mode resolves to the LIVE insurance host", () => {
    // Reused discipline from premium-parity.test.ts's Layer 1 block: the hosts
    // are lifted out of the shipped `getBonzahApiUrl`, never retyped, so this
    // cannot end up guarding a hostname the app no longer uses.
    const apiUrl = liftSharedClient<(mode: string) => string>("getBonzahApiUrl").call;
    expect(
      new URL(apiUrl("live")).hostname,
      "getBonzahApiUrl('live') no longer resolves to the live Bonzah host. The gate in " +
        "servicing.ts exists because this function can reach it.",
    ).toBe(BONZAH_LIVE_HOST);
    expect(new URL(apiUrl("test")).hostname).toBe(BONZAH_SANDBOX_HOST);
    expect(src(), "The live path no longer resolves its host through getBonzahApiUrl.").toMatch(
      /getBonzahApiUrl\(mode\)/,
    );
  });

  it("is refused unless BOTH rungs are asked for — the ladder, asserted offline", () => {
    // The refusal is asserted before anybody turns the flags on. A gate nobody
    // has ever seen say no is not a gate.
    //
    // Written as the LADDER rather than as "always false", because this same
    // case has to be correct during a real live run too: with the flags set it
    // must say YES, and a test that demanded "no" unconditionally would go red
    // for the one person who configured the suite properly.
    const layer2Requested = process.env.D247_LIVE_TESTS === "1";
    const modeDeclared = bonzahModeDeclared();
    const gate = bonzahServicingGate(); // throws on a production Supabase target

    if (!layer2Requested || !modeDeclared) {
      expect(
        gate.allowed,
        [
          "The Bonzah servicing gate allowed a live call without both rungs:",
          `    D247_LIVE_TESTS=1        ${layer2Requested}`,
          `    D247_LIVE_BONZAH_MODE    ${process.env.D247_LIVE_BONZAH_MODE ?? "(unset)"}`,
          "",
          "  Every live case in this file would then run, and — if the fixture tenant is in",
          `  live mode — that is a real login attempt at ${BONZAH_LIVE_HOST}.`,
        ].join("\n"),
      ).toBe(false);
      if (!gate.allowed) {
        expect(gate.reason.length, "The refusal came back with no explanation.").toBeGreaterThan(20);
      }
      return;
    }

    expect(
      gate.allowed,
      "Both rungs are set (D247_LIVE_TESTS=1 and D247_LIVE_BONZAH_MODE=test) and the gate " +
        "still refused. Something new is being demanded of a live run and the message " +
        "below should say what.",
    ).toBe(true);
  });
});

// ===========================================================================
// LAYER 2 — live.
//
//   "live: the test-mode short circuit"  needs D247_LIVE_TESTS +
//       D247_LIVE_BONZAH_MODE=test + D247_LIVE_BONZAH_TENANT_ID. Writes
//       nothing, contacts Bonzah not at all (that is the property being
//       asserted), and proves the `platform: true` flag the panel keys on is
//       really on the wire.
//
//   "live: a blank credential is refused"  same rungs, no fixture. Answered by
//       the guard, before the database is touched.
//
// There is deliberately NO live case for the live-mode path: it is a login
// attempt at production insurance, and Insillion counts failures.
// ===========================================================================
describe("bonzah/verify-credentials — live (Layer 2)", () => {
  it("live: a test-mode tenant is short-circuited, and says so", async (ctx) => {
    const gate = bonzahServicingGate();
    if (!gate.allowed) {
      ctx.skip(gate.reason);
      return;
    }
    const tenantId = fixtureOrNull("D247_LIVE_BONZAH_TENANT_ID");
    if (!tenantId) {
      ctx.skip("D247_LIVE_BONZAH_TENANT_ID is not set. Fixtures are never inferred.");
      return;
    }

    const res = await liveCall(FN, {
      username: "spine-suite@drive-247.invalid",
      password: "not-a-real-password",
      tenantId,
    });

    expect(res.status, `${FN} did not return 200.\n` + classifyLive(res).explain).toBe(200);
    expect(
      res.json?.mode,
      `The fixture tenant answered mode "${res.json?.mode}". D247_LIVE_BONZAH_MODE=test says ` +
        "it is a test-mode tenant; if it is not, this call just attempted a login at " +
        `${BONZAH_LIVE_HOST} with a junk password. Fix the fixture, not this test.`,
    ).toBe("test");
    expect(
      res.json?.platform,
      "The test-mode answer no longer carries `platform: true`. The integrations panel " +
        "uses it to avoid printing \"verified\" for a check that did not happen.",
    ).toBe(true);
    expect(
      res.json?.valid,
      "The test-mode short circuit stopped answering valid. Both callers gate the credential " +
        "write on this field.",
    ).toBe(true);
  });

  it("live: a blank password is refused before the database is touched", async (ctx) => {
    const gate = bonzahServicingGate();
    if (!gate.allowed) {
      ctx.skip(gate.reason);
      return;
    }
    const res = await liveCall(FN, { username: "  ", password: "   ", tenantId: "whatever" });
    expect(
      res.status,
      "Expected 400 from the blank-credential guard.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 200 here means whitespace-only credentials were accepted and — in test mode — " +
        "reported valid.\n" +
        classifyLive(res).explain,
    ).toBe(400);
    expect(String(res.json?.error ?? res.text)).toMatch(/Missing username or password/);
  });
});
