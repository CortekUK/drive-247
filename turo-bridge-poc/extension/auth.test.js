/**
 * auth.test.js — the Drive247 sign-in, run in Node with no Chrome and no
 * Supabase.
 *
 *     node turo-bridge-poc/extension/auth.test.js
 *
 * WHY THIS EXISTS. Authentication is the one part of this extension whose
 * failures are silent and expensive. A refresh that signs the tenant out on a
 * dropped wifi packet loses a half-finished sync and looks like a bug in Turo.
 * A refresh that DOESN'T sign them out when the session is genuinely revoked
 * leaves a deactivated employee syncing a tenant's bookings. A sign-out that
 * clears the session but not the run leaves the next person at that machine
 * looking at someone else's guest names. None of those are visible by reading
 * the code, and none can be reproduced by hand without a live Supabase project.
 *
 * So GoTrue and PostgREST are faked at the fetch boundary, and every assertion
 * below is about a decision the worker made — what it stored, what it sent, and
 * what it refused.
 */

"use strict";

const path = require("path");
const DIR = __dirname;

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.log("  ✗ " + name + (extra ? "  -> " + extra : "")); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, "got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
}

// ====================================================== the fake browser =====

function makeChrome(store) {
  const alarms = new Map();
  return {
    runtime: {
      id: "d247-test-extension",
      onMessage: { addListener(fn) { this._fn = fn; } },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} },
      getManifest: () => ({ version: "0.2.0-test" })
    },
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") { const o = {}; if (key in store) o[key] = store[key]; return o; }
          const o = {};
          for (const k of key) if (k in store) o[k] = store[k];
          return o;
        },
        async set(patch) { Object.assign(store, patch); },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k]; }
      },
      onChanged: { addListener() {} }
    },
    alarms: {
      async get(n) { return alarms.get(n) || null; },
      create(n, o) { alarms.set(n, o); },
      async clear(n) { return alarms.delete(n); },
      onAlarm: { addListener() {} }
    },
    tabs: {
      async query() { return [{ id: 1, status: "complete" }]; },
      async create() { return { id: 1 }; },
      async get() { return { id: 1, status: "complete" }; },
      onUpdated: { addListener() {}, removeListener() {} }
    },
    scripting: { async executeScript() { return [{ result: null }]; } }
  };
}

/**
 * A stand-in for GoTrue + PostgREST + the two edge functions.
 *
 * `plan` lets each test say what the server does. Every request is recorded in
 * `calls` so the assertions can look at the headers and the body — which is
 * where the interesting claims live (an Authorization header on the session
 * path, a token in the body on the legacy path, and NEVER a tenant id in
 * either).
 */
function makeFetch(plan, calls) {
  return async function fetchStub(url, init) {
    const u = String(url);
    const headers = (init && init.headers) || {};
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method: (init && init.method) || "GET", headers, body });

    if (u.includes("/auth/v1/token?grant_type=password")) {
      const r = plan.password;
      if (typeof r === "function") return r(body);
      return r;
    }
    if (u.includes("/auth/v1/token?grant_type=refresh_token")) {
      const r = plan.refresh;
      if (typeof r === "function") return r(body);
      return r;
    }
    if (u.includes("/auth/v1/logout")) return jsonRes(200, {});
    if (u.includes("/rest/v1/app_users")) {
      const r = plan.appUsers;
      if (typeof r === "function") return r();
      return r;
    }
    if (u.includes("/rest/v1/tenants")) {
      return plan.tenants || jsonRes(200, [{ slug: "acme", company_name: "Acme Rentals" }]);
    }
    if (u.includes("turo-bridge-reconcile")) return jsonRes(200, { ok: true });
    if (u.includes("turo-bridge-ingest")) {
      return plan.ingest || jsonRes(200, { ok: true, action: "created", job_id: "job-1" });
    }
    throw new Error("unexpected fetch: " + u);
  };
}

function jsonRes(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

const TOKENS = (suffix) => ({
  access_token: "access-" + suffix,
  refresh_token: "refresh-" + suffix,
  expires_in: 3600,
  user: { id: "auth-user-1" }
});

const STAFF = (over) => Object.assign({
  id: "app-user-1",
  tenant_id: "tenant-A",
  is_active: true,
  is_super_admin: false,
  must_change_password: false,
  name: "Dana Okafor",
  email: "dana@acme.test",
  role: "admin"
}, over || {});

function boot(store, plan, calls) {
  for (const f of ["fixture.js", "turo-read-contract.js", "content-turo.js", "background.js"]) {
    delete require.cache[path.join(DIR, f)];
  }
  globalThis.chrome = makeChrome(store);
  globalThis.importScripts = (...files) => files.forEach((f) => require(path.join(DIR, f)));
  globalThis.fetch = makeFetch(plan, calls);
  require(path.join(DIR, "background.js"));
  return globalThis.chrome.runtime.onMessage._fn;
}

/** Send a message the way the popup does, and await the reply. */
function send(listen, msg, sender) {
  return new Promise((resolve) => {
    const handled = listen(msg, sender === undefined ? {} : sender, resolve);
    if (!handled) resolve(undefined);
  });
}

// ================================================================== tests ===

async function main() {
  console.log("\nTuro Bridge — Drive247 sign-in\n");

  // -----------------------------------------------------------------------
  console.log("A tenant signs in and the extension knows who they are");
  {
    const store = {}, calls = [];
    const listen = boot(store, {
      password: jsonRes(200, TOKENS("1")),
      appUsers: jsonRes(200, [STAFF()])
    }, calls);

    const r = await send(listen, { type: "AUTH_SIGN_IN", email: "dana@acme.test", password: "hunter2" });
    eq("sign-in succeeded", r.ok, true);
    eq("the tenant was resolved from app_users, not from anything typed", r.identity.tenantId, "tenant-A");
    eq("and it has a name a human recognises", r.identity.tenantName, "Acme Rentals");

    ok("the session is stored", !!store.d247Session && !!store.d247Session.access_token);
    ok("the refresh token is stored, so tomorrow still works", !!store.d247Session.refresh_token);
    ok("an expiry is derived and stored", store.d247Session.expires_at_ms > Date.now());

    /* THE POPUP MUST NEVER NEED THE SECRET HALF. These two keys are separate so
       that everything the popup reads is safe for it to read. */
    ok("the identity key carries no access token", !("access_token" in store.d247Identity));
    ok("the identity key carries no refresh token", !("refresh_token" in store.d247Identity));

    /* THE PASSWORD IS USED ONCE. Anything that persisted it — storage, a log,
       an echo back to the caller — would outlive the one call that needed it. */
    const stored = JSON.stringify(store);
    ok("the password was never written to storage", !stored.includes("hunter2"));
    ok("...and never handed back to the popup", !JSON.stringify(r).includes("hunter2"));

    const state = await send(listen, { type: "AUTH_STATE" });
    eq("AUTH_STATE reports signed in", state.signedIn, true);
    ok("...and carries no credential to the popup", !JSON.stringify(state).includes("access-1"));
  }

  // -----------------------------------------------------------------------
  console.log("\nA wrong password is refused, and says nothing useful to a prober");
  {
    const store = {}, calls = [];
    const listen = boot(store, {
      password: jsonRes(400, { error: "invalid_grant", error_description: "Invalid login credentials" })
    }, calls);

    const r = await send(listen, { type: "AUTH_SIGN_IN", email: "dana@acme.test", password: "wrong" });
    eq("refused", r.ok, false);
    eq("one message for every rejection", r.reason, "Email or password is incorrect.");
    ok("nothing was stored", !store.d247Session && !store.d247Identity);
    ok("app_users was never consulted", !calls.some((c) => c.url.includes("app_users")));
  }

  // -----------------------------------------------------------------------
  console.log("\nA valid password on an account that may not use this extension");
  {
    // ---- deactivated ----
    {
      const store = {}, calls = [];
      const listen = boot(store, {
        password: jsonRes(200, TOKENS("2")),
        appUsers: jsonRes(200, [STAFF({ is_active: false })])
      }, calls);
      const r = await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });
      eq("a deactivated account is refused", r.ok, false);
      ok("in words that name the reason", /deactivated/i.test(r.reason), r.reason);
      ok("no session survives the refusal", !store.d247Session);
      /* The password WAS correct, so a session now exists server-side. Leaving
         it there would mean a usable refresh token for an account we just
         decided may not sync. */
      ok("...and the server-side session was revoked too", calls.some((c) => c.url.includes("/auth/v1/logout")));
    }

    // ---- no staff row at all ----
    {
      const store = {}, calls = [];
      const listen = boot(store, { password: jsonRes(200, TOKENS("3")), appUsers: jsonRes(200, []) }, calls);
      const r = await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });
      eq("an account with no portal access is refused", r.ok, false);
      ok("nothing stored", !store.d247Session);
    }

    // ---- a super admin, who belongs to no single tenant ----
    {
      const store = {}, calls = [];
      const listen = boot(store, {
        password: jsonRes(200, TOKENS("4")),
        appUsers: jsonRes(200, [STAFF({ tenant_id: null, is_super_admin: true })])
      }, calls);
      const r = await send(listen, { type: "AUTH_SIGN_IN", email: "root@drive247.test", password: "p" });
      /* THE CROSS-TENANT CASE, caught at the door. A super admin has
         tenant_id NULL by design, so there is no account a scraped Turo trip
         could belong to — and guessing one is exactly the write this whole
         feature is built to make impossible. */
      eq("a super admin cannot sync", r.ok, false);
      ok("and is told which account to use instead", /owns the vehicles/i.test(r.reason), r.reason);
      ok("no session stored", !store.d247Session);
    }

    // ---- the profile read could not be MADE, which is not a refusal ----
    {
      const store = {}, calls = [];
      const listen = boot(store, {
        password: jsonRes(200, TOKENS("5b")),
        appUsers: () => { throw new Error("net::ERR_INTERNET_DISCONNECTED"); }
      }, calls);
      const r = await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });
      eq("sign-in does not complete", r.ok, false);
      ok("but it blames the connection, not the tenant", /could not be reached/i.test(r.reason), r.reason);
      /* The password WAS right. Revoking here would make four seconds of bad
         wifi cost them their password again — the same mistake the refresh path
         is careful not to make. */
      ok("and the server-side session is left alone to retry with",
         !calls.some((c) => c.url.includes("/auth/v1/logout")));
    }

    // ---- must change password ----
    {
      const store = {}, calls = [];
      const listen = boot(store, {
        password: jsonRes(200, TOKENS("5")),
        appUsers: jsonRes(200, [STAFF({ must_change_password: true })])
      }, calls);
      const r = await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });
      eq("a forced password change blocks the extension too", r.ok, false);
      ok("and points at the portal, where it can be done", /portal/i.test(r.reason), r.reason);
    }
  }

  // -----------------------------------------------------------------------
  console.log("\nAn expired access token is refreshed without the tenant noticing");
  {
    const store = {}, calls = [];
    const listen = boot(store, {
      password: jsonRes(200, TOKENS("6")),
      appUsers: jsonRes(200, [STAFF()]),
      refresh: jsonRes(200, { access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600 })
    }, calls);
    await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });

    // Age the session past the refresh skew.
    store.d247Session.expires_at_ms = Date.now() - 1000;

    const state = await send(listen, { type: "AUTH_STATE" });
    eq("still signed in", state.signedIn, true);
    eq("on a NEW access token", store.d247Session.access_token, "access-new");
    /* GoTrue rotates the refresh token on every use. Keeping the old one would
       work exactly once more and then lock the tenant out for good. */
    eq("and the rotated refresh token was kept", store.d247Session.refresh_token, "refresh-new");
    eq("the identity survived the refresh", store.d247Identity.tenantId, "tenant-A");
  }

  // -----------------------------------------------------------------------
  console.log("\nA REJECTED refresh signs the tenant out; a FAILED one does not");
  {
    // ---- rejected: the session is genuinely gone ----
    {
      const store = {}, calls = [];
      const listen = boot(store, {
        password: jsonRes(200, TOKENS("7")),
        appUsers: jsonRes(200, [STAFF()]),
        refresh: jsonRes(400, { error: "invalid_grant" })
      }, calls);
      await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });
      store.d247Session.expires_at_ms = Date.now() - 1000;

      const state = await send(listen, { type: "AUTH_STATE" });
      eq("reported as signed out", state.signedIn, false);
      eq("...and specifically as EXPIRED, which is different advice", state.expired, true);
      ok("the session is gone from storage", !store.d247Session);
      ok("and so is the identity", !store.d247Identity);
    }

    // ---- failed: the network dropped ----
    {
      const store = {}, calls = [];
      const listen = boot(store, {
        password: jsonRes(200, TOKENS("8")),
        appUsers: jsonRes(200, [STAFF()]),
        refresh: () => { throw new Error("net::ERR_INTERNET_DISCONNECTED"); }
      }, calls);
      await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });
      store.d247Session.expires_at_ms = Date.now() - 1000;

      const state = await send(listen, { type: "AUTH_STATE" });
      eq("not signed in RIGHT NOW", state.signedIn, false);
      /* THE DISTINCTION THAT MATTERS. Four seconds of bad wifi is not a
         logout. Clearing the session here would throw away a half-finished
         sync and tell the tenant to retype a password that was never wrong. */
      eq("but NOT declared expired", state.expired, false);
      ok("and the session is still there to retry with", !!store.d247Session);
    }
  }

  // -----------------------------------------------------------------------
  console.log("\nSigning out leaves nothing behind for the next person at this machine");
  {
    const store = {}, calls = [];
    const listen = boot(store, {
      password: jsonRes(200, TOKENS("9")),
      appUsers: jsonRes(200, [STAFF()])
    }, calls);
    await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });

    // A finished run's artefacts, which carry guest names and trip ids.
    Object.assign(store, {
      turoCursor: { runId: "r1" },
      syncState: { phase: "done" },
      syncPending: { records: [{ guest: "someone" }] },
      syncSummary: { rows: [{ guest: "someone" }] },
      syncManifest: { seenReservationIds: ["t-1"] },
      lastRun: { at: 1 },
      lastSyncAt: { at: "2026-01-01T00:00:00.000Z" }
    });

    const r = await send(listen, { type: "AUTH_SIGN_OUT" });
    eq("sign-out reports success", r.ok, true);
    ok("the session is gone", !store.d247Session);
    ok("the identity is gone", !store.d247Identity);
    /* A RUN IS THE PROPERTY OF THE ACCOUNT THAT STARTED IT. Leaving a cursor
       behind would let the next sign-in on this machine resume someone else's
       sync; leaving the summary behind would show them someone else's guests. */
    for (const k of ["turoCursor", "syncState", "syncPending", "syncSummary", "syncManifest", "lastRun", "lastSyncAt"]) {
      ok("...and so is " + k, !(k in store));
    }
    ok("the server-side session was revoked, locally scoped", calls.some((c) => c.url.includes("/auth/v1/logout?scope=local")));
  }

  // -----------------------------------------------------------------------
  console.log("\nThe credential reaches Drive247 in the right place, and names no tenant");
  {
    const store = {}, calls = [];
    const listen = boot(store, {
      password: jsonRes(200, TOKENS("10")),
      appUsers: jsonRes(200, [STAFF()])
    }, calls);
    await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });

    await send(listen, { type: "SYNC_ONE" });

    const ingest = calls.filter((c) => c.url.includes("turo-bridge-ingest"));
    ok("the ingest was called", ingest.length > 0);
    const call = ingest[ingest.length - 1];
    eq("the Drive247 session travels as a Bearer token", call.headers.Authorization, "Bearer access-10");
    ok("the anon key is still sent, as the gateway requires", !!call.headers.apikey);
    ok("no pairing token is invented on the session path", call.body.token === undefined);

    /* THE INVARIANT THE WHOLE FEATURE RESTS ON. The extension sends a
       credential; the server resolves the tenant. If a tenant id ever appears
       in this body, a forged tenant becomes expressible on the wire. */
    const wire = JSON.stringify(call.body);
    ok("the body names no tenant id", !/tenant_id|tenantId/.test(wire));
    ok("...and does not smuggle one in a slug either", !wire.includes("tenant-A"));
  }

  // -----------------------------------------------------------------------
  console.log("\nA pasted pairing token still works, in the body, where it belongs");
  {
    const store = { pairingToken: "d247_turo_" + "c".repeat(40) };
    const calls = [];
    const listen = boot(store, {}, calls);

    await send(listen, { type: "SYNC_ONE" });

    const ingest = calls.filter((c) => c.url.includes("turo-bridge-ingest"));
    ok("the ingest was called", ingest.length > 0);
    const call = ingest[ingest.length - 1];
    eq("the token is in the body", call.body.token, store.pairingToken);
    /* It is not a JWT. The gateway may try to parse the Authorization header as
       one even with verify_jwt off, and the resulting 401 never reaches the
       function — it surfaces as an unexplained CORS failure. */
    ok("and NOT in the Authorization header", !("Authorization" in call.headers));
  }

  // -----------------------------------------------------------------------
  console.log("\nA content script cannot touch the session");
  {
    const store = {}, calls = [];
    const listen = boot(store, {
      password: jsonRes(200, TOKENS("11")),
      appUsers: jsonRes(200, [STAFF()])
    }, calls);

    /* A message that arrives with a `tab` came from a page — turo.com. That
       context has no business signing anyone in or asking who is signed in, and
       it is the one context an attacker could plausibly influence. */
    const fromPage = { id: "d247-test-extension", tab: { id: 9, url: "https://turo.com/us/en/trips/booked" } };

    const signIn = await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" }, fromPage);
    eq("a page-context sign-in is not handled at all", signIn, undefined);
    ok("and nothing was stored", !store.d247Session);
    ok("...and GoTrue was never called", !calls.some((c) => c.url.includes("grant_type=password")));

    const state = await send(listen, { type: "AUTH_STATE" }, fromPage);
    eq("a page cannot read the auth state either", state, undefined);

    // A message from another extension is refused whatever it says.
    const alien = await send(listen, { type: "AUTH_STATE" }, { id: "some-other-extension" });
    eq("nor can another extension", alien, undefined);
  }

  // -----------------------------------------------------------------------
  console.log("\nSyncing without a credential asks for one instead of failing obscurely");
  {
    const store = {}, calls = [];
    const listen = boot(store, {}, calls);

    await send(listen, { type: "SYNC_ONE" });
    ok("the one-click path refuses", store.lastRun && store.lastRun.phase === "error");
    ok("in words that say what to do", /sign in/i.test(store.lastRun.detail || ""), store.lastRun.detail);
    ok("and never reached Drive247", !calls.some((c) => c.url.includes("turo-bridge-ingest")));

    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    /* errorState() parks rather than errors — a run that never started is not a
       run that broke, and "parked" is the phase the popup already knows how to
       paint with an advice line. */
    ok("the full sync refuses too", !!store.syncState && store.syncState.phase === "parked");
    ok("with the same instruction", /sign in/i.test(store.syncState.lastError || ""), store.syncState.lastError);
  }

  // -----------------------------------------------------------------------
  console.log("\nThe run's tenant guard follows the TENANT, not the access token");
  {
    const store = {}, calls = [];
    const listen = boot(store, {
      password: jsonRes(200, TOKENS("12")),
      appUsers: jsonRes(200, [STAFF()]),
      refresh: jsonRes(200, { access_token: "access-rotated", refresh_token: "refresh-rotated", expires_in: 3600 })
    }, calls);
    await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });

    const R = globalThis.__d247TuroRead;
    const before = (await R.fingerprint("tenant:" + store.d247Identity.tenantId)).slice(0, 16);

    // An hour passes; the access token rotates.
    store.d247Session.expires_at_ms = Date.now() - 1000;
    await send(listen, { type: "AUTH_STATE" });
    eq("the access token really did change", store.d247Session.access_token, "access-rotated");

    const after = (await R.fingerprint("tenant:" + store.d247Identity.tenantId)).slice(0, 16);
    /* Fingerprinting the ACCESS TOKEN would have abandoned a healthy run here,
       roughly once an hour, and blamed the operator for switching accounts. */
    eq("but the guard's fingerprint did not", after, before);

    const other = (await R.fingerprint("tenant:tenant-B")).slice(0, 16);
    ok("while a different tenant still fingerprints differently", other !== before);
  }

  // -----------------------------------------------------------------------
  console.log("\nA 401 from Drive247 mid-sync ends the session rather than looping");
  {
    const store = {}, calls = [];
    const listen = boot(store, {
      password: jsonRes(200, TOKENS("13")),
      appUsers: jsonRes(200, [STAFF()]),
      ingest: jsonRes(401, { error: "Your Drive247 sign-in is no longer valid. Sign in again." })
    }, calls);
    await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });

    await send(listen, { type: "SYNC_ONE" });

    /* The refresh check passed a moment ago, so the token died between then and
       the request — revoked, or the user deactivated. Retrying cannot succeed,
       and leaving the popup on "Signed in as…" hides that from the tenant. */
    ok("the session was cleared", !store.d247Session);
    const state = await send(listen, { type: "AUTH_STATE" });
    eq("so the popup shows the sign-in screen", state.signedIn, false);
  }

  // -----------------------------------------------------------------------
  console.log("\nNothing in this flow writes to Turo");
  {
    const store = {}, calls = [];
    const listen = boot(store, {
      password: jsonRes(200, TOKENS("14")),
      appUsers: jsonRes(200, [STAFF()])
    }, calls);
    await send(listen, { type: "AUTH_SIGN_IN", email: "x@y.z", password: "p" });
    await send(listen, { type: "SYNC_ONE" });

    const turo = calls.filter((c) => /(^|\/\/)([a-z]+\.)?turo\.com/.test(c.url));
    const writes = turo.filter((c) => c.method && c.method.toUpperCase() !== "GET");
    eq("no non-GET request was ever aimed at turo.com", writes.length, 0);
    ok("and no Turo password was asked for or stored", !JSON.stringify(store).toLowerCase().includes("turopassword"));
  }

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
