/**
 * background.js — the MV3 service worker.
 *
 * It orchestrates TWO things, and keeping them separate is deliberate:
 *
 *   1. SYNC_ONE — the original proof of concept. One click:
 *          read a Turo tab -> normalise ONE reservation -> POST to Drive247
 *      Unchanged, still the demo path, still works with no Turo account.
 *
 *   2. SYNC_ALL — the real read. A resumable, multi-page walk:
 *          probe the session -> read page -> normalise -> flush -> next page
 *      with every step persisted BEFORE the await that performs it.
 *
 * =====================================================================
 * MV3 LIFECYCLE STANCE — the reason this file looks the way it does
 * =====================================================================
 * The service worker is killed at any moment: after ~30s idle, after ~5min of
 * work, when Chrome feels like it, and completely while Chrome is quit. A
 * long-running `for` loop holding progress in a local variable is therefore not
 * a design, it is a bug that only shows up on someone else's machine.
 *
 * So this file obeys three rules without exception:
 *
 *   R1. NO MODULE-SCOPE STATE HOLDS PROGRESS. The only module-scope mutable is
 *       `pumping`, a re-entrancy latch, and losing it to a worker death is
 *       exactly right — a dead worker has no concurrent pump to guard against.
 *       Everything else lives in chrome.storage.local.
 *
 *   R2. THE INTENT IS PERSISTED BEFORE THE AWAIT THAT FULFILS IT. The cursor
 *       records "I am about to read page N" and is written to storage BEFORE
 *       the fetch. A worker killed mid-read wakes up knowing precisely what it
 *       was doing. The receipt is written only AFTER the ingest acknowledges,
 *       so a death between "read" and "acked" replays one page — which is safe
 *       because the ingest upserts on (tenant_id, reservation_id).
 *
 *   R3. A DEAD WORKER MUST BE ABLE TO WAKE ITSELF. setTimeout does not keep an
 *       MV3 worker alive and does not survive its death. chrome.alarms is the
 *       only thing that can revive one, so an active run keeps a 1-minute
 *       backstop alarm running. setTimeout still handles the sub-second pacing
 *       when the worker happens to be alive, because a 1-minute floor between
 *       pages would make a 3-page sync take 3 minutes.
 *
 * WHAT IS NOT AUTOMATED, ON PURPOSE
 * A run parked by a BOT CHALLENGE is never auto-resumed. Retrying into a live
 * challenge is what escalates a soft check into a hard block on the operator's
 * OWN Turo account — the single asset in this integration we cannot replace.
 * The alarm is cancelled and a human has to clear the check and click again.
 *
 * DEBUGGING: worker logs do NOT appear in the page's DevTools. Open them from
 * the "service worker" link on the extension's chrome://extensions card.
 */

"use strict";

/* Classic (non-module) worker on purpose: importScripts() does not exist in a
   module worker, and we need it to load the SAME parser the page uses. One
   parser, never two.
   GUARDED: a throwing top-level importScripts aborts worker REGISTRATION, and
   the extension then looks completely dead with only a red "Errors" button on
   the chrome://extensions card to explain it. */
var IMPORT_ERROR = null;
try {
  importScripts("fixture.js", "turo-read-contract.js", "content-turo.js");
} catch (e) {
  IMPORT_ERROR = String((e && e.message) || e);
  console.error("[TuroBridge] reader files failed to load in the worker:", e);
}

// ============================================================== constants ==

const SUPABASE_URL = "https://hviqoaokxvlancmftwuo.supabase.co";

/* The PUBLIC anon key. It is already shipped to every browser that loads the
   portal (apps/portal/src/integrations/supabase/client.ts), so embedding it
   here leaks nothing new. It is NOT what authorises this call — the pairing
   token in the body is. turo-bridge-ingest runs with verify_jwt = false and
   resolves the tenant from the token, so the extension can never name a tenant
   and a copied key alone buys nothing. */
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q";

/* The function DIRECTORY is supabase/functions/turo-bridge-ingest/. If you ever
   see a 404 here, that name is the first thing to check — an earlier scaffold
   in this repo pointed at "turo-bridge-import", which does not exist. */
const INGEST_URL = `${SUPABASE_URL}/functions/v1/turo-bridge-ingest`;

const TURO_TAB_URL = "https://turo.com/us/en/trips/booked";
const TAB_LOAD_TIMEOUT_MS = 20000;
const POST_TIMEOUT_MS = 15000;
const INJECT_TIMEOUT_MS = 25000;

/* THE INGEST TAKES ONE RESERVATION PER CALL.
   supabase/functions/turo-bridge-ingest/index.ts reads `body.reservation` — a
   single object — and upserts one row. There is no batch endpoint and this
   agent does not own that function, so a page of N trips becomes N sequential
   POSTs. That is why the flush phase is its own resumable step rather than a
   single call: a worker death partway through a page must not lose the trips
   that already landed, and must not double-write the ones that did. Both are
   handled by flushing one record at a time and shrinking the pending list in
   storage as each is acknowledged. */
/* TWO SEPARATE BUDGETS, because they protect against two different failures.

   PER RECORD: the server refuses a `raw` payload over 64KB
   (turo-bridge-ingest MAX_RAW_BYTES). We stay well under it — 8KB is ample for
   one trip object, and the part that actually matters (`__d247`, which records
   what we did and did not understand) is small and is NEVER the part trimmed.

   PER PAGE: chrome.storage.local is capped at roughly 10MB. A live page could
   carry ~200 trips, and 200 fat raw payloads would blow that — at which point
   `set()` rejects and the sync stalls in a re-read loop. So a whole page is
   measured before it is stored and progressively slimmed until it fits.

   NOTHING IS EVER DROPPED TO MAKE ROOM. Trimming removes the feed's own verbose
   payload from the largest records first, keeping every reservation and all of
   its metadata. If even the fully-slimmed page will not fit, the run PARKS with
   an honest message rather than quietly syncing a subset — a page that silently
   lost half its trips is the same failure as a truncated read, arriving from
   our own side instead of Turo's. */
const INGEST_MAX_RAW_BYTES = 8 * 1024;
const PAGE_STORAGE_BUDGET_BYTES = 4 * 1024 * 1024;

/* Alarms are the ONLY mechanism that can revive a dead MV3 worker. Chrome
   clamps alarm periods to a 30-second floor for packed extensions, so this is a
   BACKSTOP, not the pacing mechanism — pacing is setTimeout, which is faster
   and works whenever the worker happens to still be alive. */
const PUMP_ALARM = "d247-turo-pump";
const PUMP_ALARM_MINUTES = 1;

/* Retry the identical read in the MAIN world only for outcomes where a header
   minted by the page's own JS could plausibly be the difference. A 401, an
   explicitly empty feed, a timeout or a 429 will answer the same in either
   world, so retrying those just doubles the traffic against a WAF. */
const RETRY_IN_MAIN = new Set(["BOT_BLOCKED", "UNKNOWN", "UNPARSEABLE"]);

/* One message per outcome for the PoC single-reservation path: what happened,
   AND what to do about it. The multi-page path takes its advice from
   POLICY[outcome].advice in turo-read-contract.js instead, so there is exactly
   one place each of those sentences is written. */
const ADVICE = {
  NOT_LOGGED_IN: "You are not signed in to Turo in this browser. Open turo.com, log in as a host, then click Sync again.",
  NO_TRIPS: "Signed in to Turo, but there are no upcoming host trips to import.",
  BOT_BLOCKED: "Turo's bot protection challenged the request. Open turo.com in a tab, clear any check it shows you, then click Sync again.",
  RATE_LIMITED: "Turo is rate-limiting this browser. Wait a minute and click Sync again.",
  UNREACHABLE: "Could not reach Turo — offline, or the request timed out.",
  UNPARSEABLE: "Turo answered, but its response held no reservation we could read. Its API shape has changed.",
  UNKNOWN: "Turo answered in a shape we do not recognise. Its API may have changed.",
  no_tab: "Could not open a turo.com tab to read from.",
  no_fixture: "The bundled sample data failed to load, so there was nothing to fall back to.",
  fixture_unparseable: "The bundled sample data failed its own normaliser — this is a bug in the extension."
};

/**
 * WHICH PARKED RUNS MAY RESUME THEMSELVES.
 *
 * The split is not about severity, it is about whether another request is SAFE
 * TO ISSUE UNATTENDED. A rate limit clears on its own and retrying is expected
 * behaviour. A bot challenge clears only when a HUMAN solves it, and retrying
 * into it is what turns a soft check into a hard block on the operator's own
 * account. A logged-out session likewise cannot fix itself.
 */
const AUTO_RESUMABLE = new Set(["RATE_LIMITED", "UNREACHABLE", "TRUNCATED", "PAGINATION_STALLED"]);

/* Storage keys. Every one of these is the durable half of a rule above. */
const K = {
  /* THE CREDENTIAL, and the durable half of the sign-in. `session` holds the
     Drive247 access + refresh tokens and is read ONLY by this worker;
     `identity` holds the name, email and tenant the popup paints and carries
     no credential at all, so the popup never has to touch the secret half. */
  session: "d247Session",
  identity: "d247Identity",
  /* Legacy. No UI writes this any more — kept because installed extensions
     still hold a pasted token and turo-bridge-ingest still honours it. */
  token: "pairingToken",
  lastRun: "lastRun",        // the PoC single-click status (unchanged shape)
  cursor: "turoCursor",      // RunCursor + our run-scoped counters
  state: "syncState",        // the popup's view model
  pending: "syncPending",    // records read but not yet acknowledged by ingest
  summary: "syncSummary",    // light per-record rows + diagnostics for the UI
  manifest: "syncManifest",  // the LAST run's ids, for the absence ledger
  lastSync: "lastSyncAt",    // the one date the tenant is shown, see below
  digests: "syncDigests",    // reservation_id -> digest of what we last sent
  turo: "turoStatus"         // the Turo half of the two-connection display
};

/* Resets to false if the worker is killed, which is exactly right: a dead
   worker has no in-flight pump to guard against. THIS IS THE ONLY MUTABLE AT
   MODULE SCOPE AND IT HOLDS NO PROGRESS. */
let pumping = false;

// ========================================================= DRIVE247 SIGN-IN ==
//
// The tenant signs into DRIVE247 here, inside the extension. That is the whole
// change: the credential used to be a pairing token pasted into the popup, and
// it is now a real Drive247 session belonging to a real person.
//
// WHAT THIS BUYS, beyond convenience. A pairing token proves WHICH TENANT and
// never WHICH PERSON, cannot be deactivated by deactivating the employee who
// holds it, and is a bearer string that survives being pasted into a chat
// window. A Supabase session is attributable, expires, and dies the moment
// app_users.is_active goes false. turo-bridge-ingest enforces all three.
//
// WHAT DID NOT CHANGE, and must not: THE EXTENSION STILL NEVER NAMES A TENANT.
// It sends a credential; the server resolves the tenant from it. `tenant_id`
// appears nowhere in any request body this file builds. The sign-in swaps one
// credential for a better one — it does not move the trust boundary.
//
// WHERE THE SECRETS LIVE. chrome.storage.local, which is readable only by this
// extension's own contexts — never by turo.com, never by any injected script,
// never by the DOM. The tokens are deliberately NOT in chrome.storage.session
// (which would be memory-only and strictly safer) because the requirement is
// that a tenant who closes Chrome and comes back tomorrow is still signed in,
// and that needs a refresh token that outlives the browser process. The
// mitigation is that the popup never reads this key: it reads K.identity, which
// holds a name, an email and a tenant, and no credential at all.
//
// TURO CREDENTIALS ARE NOT INVOLVED. This extension has never asked for a Turo
// password and still does not. It reads the turo.com session the operator's own
// browser already holds, and it writes nothing back there.

const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const AUTH_TIMEOUT_MS = 15000;

/* Refresh this far BEFORE the stated expiry. A token that is valid for another
   four seconds when we check it is not valid by the time a slow batch POST
   reaches the gateway, and the failure mode is a 401 in the middle of a run
   that was otherwise going fine. */
const REFRESH_SKEW_MS = 60 * 1000;

/* A second module-scope mutable, held to the same rule as `pumping`: IT HOLDS
   NO PROGRESS. It exists because a run's flush loop can ask for the access
   token several times in the same tick, and two concurrent refreshes race to
   spend the same single-use refresh token — the loser gets a 400 and signs the
   operator out mid-sync. Resets to null when the worker dies, which is correct:
   a dead worker has no in-flight refresh to join. */
let refreshInFlight = null;

/* ── WHY THIS FILE HAS AN ERROR TAXONOMY AT ALL ─────────────────────────────
   The first version of this module answered EVERY non-2xx from the password
   grant with "Email or password is incorrect.". The reasoning was sound —
   distinguishing a wrong password from an unknown email turns a login form into
   an oracle for which accounts exist — but it was applied one level too wide,
   and it swallowed things that are not credential problems at all:

     401 "Invalid API key"        -> the extension is misconfigured
     400 validation_failed        -> we sent a malformed body; our bug
     400 unsupported_grant_type   -> ALSO reported as error_code
                                     "invalid_credentials", which is the trap
                                     that makes naive status-code matching wrong
     5xx                          -> Supabase is down
     a thrown fetch               -> the tenant is offline

   All five rendered as "your password is wrong", so a typo'd email domain and a
   dead deployment produced identical, equally unactionable screens. THE
   ENUMERATION DEFENCE SURVIVES: exactly one condition below yields the
   credentials message, and it covers wrong password, unknown email and
   unconfirmed account alike. Everything else is a different question, and
   answering it honestly reveals nothing about who has an account.

   Each failure carries a stable `code` as well as a sentence. Tests assert on
   the code; only humans read the sentence. */
const AUTH_ERRORS = {
  offline:        "Could not reach Drive247. Check your internet connection and try again.",
  timeout:        "Drive247 did not respond in time. Try again in a moment.",
  unavailable:    "Drive247's sign-in service is temporarily unavailable. Try again shortly.",
  misconfigured:  "This extension is not set up correctly and cannot reach Drive247. Reinstall it, or contact Drive247 support.",
  bad_credentials:"Email or password is incorrect.",
  unconfirmed:    "This email address has not been confirmed yet. Check your inbox for the Drive247 confirmation link.",
  rate_limited:   "Too many sign-in attempts. Wait a minute and try again.",
  unexpected:     "Drive247 sent a response this extension did not understand. Try again, or contact Drive247 support.",
  no_profile:     "This account exists, but it has no Drive247 portal access. Ask your administrator to add you.",
  inactive:       "This Drive247 account has been deactivated. Ask your administrator to reactivate it.",
  must_change_password:
                  "You need to set a new password before signing in. Open the Drive247 portal, change your password there, then come back.",
  no_tenant:      "This Drive247 account is not linked to a rental account, so there is nothing to sync into.",
  super_admin:    "Super admin accounts are not tied to a single rental account. Sign in with the account that owns the vehicles.",
  profile_lookup: "Signed in, but Drive247 would not return your account details. Try again, or contact Drive247 support.",
};

const fail = (code, extra) => ({ ok: false, code, reason: AUTH_ERRORS[code] + (extra ? " " + extra : "") });

/**
 * Is this build pointed at a real Supabase project?
 *
 * A missing or truncated constant is a build mistake, not a tenant mistake, and
 * it must never reach the screen as "your password is wrong". Checked before
 * the first request rather than inferred from its failure.
 */
function authConfigProblem(url, key) {
  url = url === undefined ? SUPABASE_URL : url;
  key = key === undefined ? SUPABASE_ANON_KEY : key;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url || "")) return "url";
  // A JWT is three dot-separated segments; the anon key is a long one.
  if (!key || key.split(".").length !== 3 || key.length < 100) return "key";
  return null;
}

/* A test seam, following the convention turo-read-contract.js already sets with
   globalThis.__d247TuroRead. PURE FUNCTIONS ONLY — a classifier and a config
   check. Nothing here reads storage, holds a credential, or can sign anyone in,
   so exposing it costs nothing even though the popup could reach it. */
globalThis.__d247Auth = { authConfigProblem, classifyGoTrue, AUTH_ERRORS };

/**
 * Turn one GoTrue failure response into a code.
 *
 * `body` is whatever parsed out of the response, which may be nothing.
 */
function classifyGoTrue(status, body) {
  const errorCode = (body && (body.error_code || body.error)) || "";
  const msg = String((body && (body.msg || body.message || body.error_description)) || "");

  /* 401 here is never the tenant's password. GoTrue answers a bad password with
     400; a 401 means the gateway rejected our API key before GoTrue saw the
     request at all. */
  if (status === 401 || status === 403) return "misconfigured";
  if (status === 404) return "misconfigured";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";

  if (status === 400 || status === 422) {
    if (errorCode === "validation_failed") return "misconfigured";
    /* THE TRAP: an unsupported grant_type comes back as
       error_code "invalid_credentials" with msg "unsupported_grant_type".
       Matching on the code alone would report a broken request as a bad
       password — the exact confusion this taxonomy exists to end. */
    if (/grant/i.test(msg)) return "misconfigured";
    if (/email.?not.?confirmed/i.test(errorCode) || /not confirmed/i.test(msg)) return "unconfirmed";
    if (errorCode === "invalid_credentials" || errorCode === "invalid_grant" || /invalid login/i.test(msg)) {
      return "bad_credentials";
    }
    return "unexpected";
  }
  return "unexpected";
}

/** Timed fetch. Never logs the body — these are all credential exchanges. */
async function authFetch(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the tenant's own staff row, then their account's display name.
 *
 * Read AS THE USER (their access token in the Authorization header), not with
 * any elevated key — so RLS is the thing deciding what comes back, exactly as
 * it does for the portal. If a policy ever tightens, this tightens with it
 * rather than quietly retaining access the portal no longer grants.
 *
 * The gates below are copied from apps/portal/src/stores/auth-store.ts on
 * purpose. Two places that decide "may this person act for this tenant" must
 * not drift, and the portal's answer is the canonical one.
 */
async function loadProfile(accessToken, userId) {
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` };

  let res;
  try {
    res = await authFetch(
      `${REST_URL}/app_users?select=id,tenant_id,is_active,is_super_admin,must_change_password,name,email,role` +
        `&auth_user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      { headers },
    );
  } catch (_) {
    // Offline or timed out. Same answer as a non-2xx below: unknown, retryable.
    return { ...fail("offline"), retryable: true };
  }
  if (!res.ok) {
    /* A transport failure is NOT a denial. auth-store.ts calls this
       `profileUnavailable` and treats it as "unknown" for the same reason: a
       network blip must not read as "you are not allowed", because the user's
       only available response to that message is to stop trying.

       Nor is it a credential problem: the password has already been accepted by
       this point, so whatever went wrong here is ours or the server's. */
    return { ...fail(res.status >= 500 ? "unavailable" : "profile_lookup"), retryable: true };
  }
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return { ...fail("unexpected"), retryable: true };
  const user = rows.length ? rows[0] : null;

  if (!user) return fail("no_profile");
  /* Super admins bypass is_active, matching auth-store.ts:183. They do not
     bypass the tenant check below, and that is the point. */
  if (!user.is_super_admin && user.is_active === false) return fail("inactive");
  if (user.must_change_password && !user.is_super_admin) return fail("must_change_password");
  if (!user.tenant_id) {
    /* Super admins carry tenant_id NULL by design. There is no single account
       a scraped Turo trip could belong to, so there is nothing this extension
       could safely do for them. turo-bridge-ingest refuses the same case with
       the same reasoning; refusing here too means the tenant finds out at
       sign-in rather than at the end of their first sync. */
    /* Two different accounts land here and they need different sentences: a
       super admin has no tenant BY DESIGN and should use a different login,
       while an ordinary staff row with a null tenant is a data problem their
       administrator has to fix. */
    return fail(user.is_super_admin ? "super_admin" : "no_tenant");
  }

  /* `tenants` has no `name` column — company_name is the display name
     (turo-bridge-ingest/index.ts reads the same two columns). Failure here is
     cosmetic: a missing display name must never block a valid sign-in. */
  let tenantName = null;
  try {
    const tRes = await authFetch(
      `${REST_URL}/tenants?select=slug,company_name&id=eq.${encodeURIComponent(user.tenant_id)}&limit=1`,
      { headers },
    );
    if (tRes.ok) {
      const tRows = await tRes.json().catch(() => []);
      const t = Array.isArray(tRows) && tRows.length ? tRows[0] : null;
      tenantName = (t && (t.company_name || t.slug)) || null;
    }
  } catch (_) { /* cosmetic only */ }

  return {
    ok: true,
    identity: {
      userId: String(userId),
      appUserId: user.id,
      email: user.email || null,
      name: user.name || null,
      role: user.role || null,
      tenantId: user.tenant_id,
      tenantName: tenantName || "your Drive247 account",
      signedInAt: new Date().toISOString(),
    },
  };
}

/** Persist a GoTrue token response plus the resolved identity. */
async function storeSession(tokens, identity) {
  await chrome.storage.local.set({
    [K.session]: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      /* Epoch MILLISECONDS. GoTrue sends expires_in (seconds) and, on newer
         versions, expires_at (epoch seconds). Deriving it from expires_in is
         the one form present in every version. */
      expires_at_ms: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
      user_id: identity.userId,
    },
    [K.identity]: identity,
  });
}

/**
 * Sign in with a Drive247 email and password.
 *
 * The password is used once, in this call, and is never stored, never logged
 * and never written to storage. Neither is the Turo password — this extension
 * has never had one.
 */
async function authSignIn(email, password) {
  const mail = String(email || "").trim();
  const pass = String(password || "");
  if (!mail) return { ok: false, code: "no_email", reason: "Enter your Drive247 email address." };
  if (!pass) return { ok: false, code: "no_password", reason: "Enter your Drive247 password." };

  /* Checked here, not at load, so a broken build fails at the moment someone
     tries to use it and says so in the one place they are looking. */
  const configProblem = authConfigProblem();
  if (configProblem) {
    console.error("[TuroBridge] auth is misconfigured: the Supabase " + configProblem + " constant is missing or malformed.");
    return fail("misconfigured");
  }

  let res;
  try {
    res = await authFetch(`${AUTH_URL}/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: mail, password: pass }),
    });
  } catch (e) {
    return fail(e && e.name === "AbortError" ? "timeout" : "offline");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const code = classifyGoTrue(res.status, body);
    /* Sanitised: a status and OUR classification. Never the email, never the
       password, never the response body — GoTrue echoes neither today, and a
       log line is the wrong place to find out that it started to. */
    console.warn("[TuroBridge] sign-in refused: HTTP " + res.status + " -> " + code);
    return fail(code);
  }

  const tokens = await res.json().catch(() => null);
  if (!tokens || !tokens.access_token || !tokens.refresh_token || !tokens.user || !tokens.user.id) {
    console.error("[TuroBridge] sign-in succeeded but the token response was missing required fields.");
    return fail("unexpected");
  }

  const profile = await loadProfile(tokens.access_token, tokens.user.id);
  if (!profile.ok) {
    /* A REFUSAL IS NOT THE SAME AS A FAILURE TO ASK.

       Refused (deactivated, no staff row, super admin, forced password change):
       a session now exists server-side for an account we have just decided may
       not use this extension, so revoke it rather than leave a usable refresh
       token behind.

       Could not ask (the profile read timed out or the connection dropped):
       revoking would make a network blip cost the tenant their password again,
       which is the same mistake refreshSession() is careful not to make. Leave
       the session alone and let them press the button once more. */
    if (!profile.retryable) await revokeRemote(tokens.access_token);
    return { ok: false, code: profile.code, reason: profile.reason };
  }

  await storeSession(tokens, profile.identity);
  return { ok: true, identity: profile.identity };
}

/** Best effort, local scope only. */
async function revokeRemote(accessToken) {
  if (!accessToken) return;
  try {
    /* scope=local revokes THIS session's refresh token and nothing else. A
       global logout would also end the tenant's portal session in another tab,
       which is not what "sign out of the extension" means to anyone. */
    await authFetch(`${AUTH_URL}/logout?scope=local`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
  } catch (_) { /* the local clear below is what actually matters */ }
}

/** Drop every trace of the session, and every run that belonged to it. */
async function clearSession() {
  const stale = await get(K.session);
  await chrome.storage.local.remove([
    K.session, K.identity,
    /* A run is the property of the account that started it. Leaving a cursor,
       a pending flush queue or a summary behind would let the NEXT person to
       sign in on this machine resume someone else's sync and see someone
       else's guest names. */
    K.cursor, K.state, K.pending, K.summary, K.manifest, K.lastRun, K.lastSync,
    /* The digests belong to the account too. Keeping them across a sign-out
       would let a new tenant's identical reservation id be skipped as
       "unchanged" against a row it has never had. */
    K.digests,
  ]);
  await clearAlarm().catch(() => {});
  return stale;
}

/**
 * A usable access token, refreshing when it is close to expiry.
 *
 * @returns {Promise<{token: string|null, expired: boolean}>} `expired` is true
 *   only when there WAS a session and it could not be renewed — the one case
 *   where the honest thing to tell the tenant is "sign in again" rather than
 *   "sign in".
 */
async function currentAccessToken() {
  const s = await get(K.session);
  if (!s || !s.access_token || !s.refresh_token) return { token: null, expired: false };
  if (Date.now() < (s.expires_at_ms || 0) - REFRESH_SKEW_MS) return { token: s.access_token, expired: false };

  if (!refreshInFlight) refreshInFlight = refreshSession(s.refresh_token).finally(() => { refreshInFlight = null; });
  const refreshed = await refreshInFlight;
  /* `gone` is the whole point of the distinction: only a session the SERVER
     rejected is reported as expired. A refresh we could not even deliver
     leaves `expired` false, so the tenant is not told to sign in again over
     what was actually a dropped connection. */
  return { token: refreshed.token, expired: refreshed.gone };
}

/**
 * @returns {Promise<{token: string|null, gone: boolean}>} `gone` is true ONLY
 *   when the server told us the session is finished. Every other failure —
 *   offline, timeout, a 500 — leaves it false and leaves the session in place
 *   to retry with.
 */
async function refreshSession(refreshToken) {
  let res;
  try {
    res = await authFetch(`${AUTH_URL}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (_) {
    /* NETWORK FAILURE IS NOT EXPIRY. Signing the tenant out because their wifi
       dropped for four seconds — losing a half-finished run in the process —
       is the worst possible reading of a timeout. Keep the session, report not
       gone, let the caller park the run and retry. */
    return { token: null, gone: false };
  }
  if (!res.ok) {
    /* 400/401/403 from the refresh endpoint IS the end of a session — expired,
       revoked, or the user deactivated. This is the only path that ends a
       session on its own. A 5xx is Supabase having a bad minute and must not. */
    const gone = res.status === 400 || res.status === 401 || res.status === 403;
    if (gone) await clearSession();
    return { token: null, gone };
  }
  const tokens = await res.json().catch(() => null);
  if (!tokens || !tokens.access_token) return { token: null, gone: false };

  const identity = await get(K.identity);
  const prior = await get(K.session);
  await chrome.storage.local.set({
    [K.session]: {
      access_token: tokens.access_token,
      /* GoTrue rotates the refresh token on every use; keeping the old one
         would work exactly once more and then lock the tenant out. */
      refresh_token: tokens.refresh_token || refreshToken,
      expires_at_ms: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
      user_id: (identity && identity.userId) || (prior && prior.user_id) || null,
    },
  });
  return { token: tokens.access_token, gone: false };
}

/**
 * Is this access token still good? Asked of GoTrue, which is the only component
 * entitled to answer.
 *
 * THIS EXISTS BECAUSE OF A REAL BUG. postReservation() used to treat any 401
 * from the ingest as proof the sign-in had expired, and clear the session. Then
 * a deployed-but-outdated turo-bridge-ingest — one that predates session auth
 * and only understands pairing tokens — answered
 * "401 Missing or malformed pairing token", and the extension logged the tenant
 * out on every single sync. They signed in, pressed Sync, and were thrown back
 * to the sign-in screen, over and over, with nothing wrong with their account.
 *
 * A 401 means "I am not accepting this request". It does NOT say whether the
 * credential is bad or whether the SERVER does not understand the credential,
 * and those call for opposite responses: sign them out, or leave them alone and
 * report a server problem. Guessing picked the destructive one.
 *
 * @returns {Promise<boolean|null>} true / false, or null when we could not ask
 *   — which must never be read as false.
 */
async function sessionStillValid(accessToken) {
  if (!accessToken) return false;
  try {
    const res = await authFetch(`${AUTH_URL}/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) return true;
    // GoTrue rejecting its own token is the one authoritative "this is dead".
    if (res.status === 401 || res.status === 403) return false;
    return null;
  } catch (_) {
    // Offline. Unknown, and unknown is not dead.
    return null;
  }
}

async function authSignOut() {
  const s = await get(K.session);
  await revokeRemote(s && s.access_token);
  await clearSession();
  return { ok: true };
}

/** What the popup is allowed to know. Contains no credential. */
async function authState() {
  const identity = await get(K.identity);
  if (!identity) return { signedIn: false, expired: false, identity: null };
  const { token, expired } = await currentAccessToken();
  if (!token) return { signedIn: false, expired, identity: expired ? null : identity };
  return { signedIn: true, expired: false, identity };
}

/**
 * THE CREDENTIAL FOR ONE REQUEST — the single place the rest of this file asks
 * "who are we, and may we sync?".
 *
 * `identity` is what the run's tenant guard fingerprints. For a session it is
 * the TENANT ID and not the access token, which matters: access tokens rotate
 * on every refresh, so fingerprinting one would abandon a healthy run roughly
 * once an hour and blame it on the operator switching accounts. The tenant is
 * the thing whose change actually endangers a run, and it is stable.
 */
async function credential() {
  const { token: accessToken, expired } = await currentAccessToken();
  const identity = await get(K.identity);
  if (accessToken && identity && identity.tenantId) {
    return {
      ok: true,
      kind: "session",
      accessToken,
      pairingToken: null,
      identity: "tenant:" + identity.tenantId,
      tenantName: identity.tenantName || null,
      reason: null,
    };
  }

  /* The legacy door, kept working. Installed extensions still hold pasted
     tokens, and turo-bridge-ingest still accepts them. There is no UI to enter
     one any more; this only ever fires for an install that already had one. */
  const pairingToken = (await get(K.token) || "").trim();
  if (pairingToken) {
    return { ok: true, kind: "token", accessToken: null, pairingToken, identity: pairingToken, tenantName: null, reason: null };
  }

  return {
    ok: false,
    kind: null,
    accessToken: null,
    pairingToken: null,
    identity: null,
    tenantName: null,
    reason: expired
      ? "Your Drive247 sign-in has expired. Sign in again to continue."
      : "Sign in with your Drive247 account to start a sync.",
  };
}

// ======================================================== TURO CONNECTION ==
//
// TWO ACCOUNTS, TWO STATUSES, AND THEY ARE NOT INTERCHANGEABLE.
//
//   Turo      — the operator's own session, already in this browser. We never
//               ask for that password and never store it. We only READ.
//   Drive247  — an email and password the operator types here, which resolves
//               to a tenant server-side.
//
// Conflating them is the confusion this whole display exists to remove: a
// tenant staring at "not connected" needs to know WHICH account to go and fix,
// and the two fixes have nothing in common.
//
// The probe reuses the reader the sync already uses (collectVehicles ->
// buildSessionProbe). It does not re-implement session detection, because two
// implementations of "is Turo signed in?" would drift and the sync's answer is
// the one that matters.

/**
 * An existing, loaded turo.com tab — or nothing.
 *
 * DELIBERATELY NOT getTuroTab(): that one CREATES a tab when none exists, which
 * is right for a sync the operator asked for and wrong for a status line that
 * paints itself every time the popup opens. Opening a turo.com tab because
 * someone glanced at the popup is the kind of thing that gets an extension
 * uninstalled.
 */
async function findTuroTab() {
  try {
    const tabs = await chrome.tabs.query({ url: ["https://turo.com/*", "https://*.turo.com/*"] });
    return tabs.find((t) => t.status === "complete" && !t.discarded) || null;
  } catch (_) {
    return null;
  }
}

/* What the popup is told, and the only vocabulary it renders. Kept here so the
   sentences live next to the conditions that produce them. */
const TURO_REASONS = {
  no_tab:      "Open turo.com in a tab and sign in as the host.",
  not_signed_in: "You are not signed in to Turo. Open turo.com and sign in as the host.",
  challenge:   "Turo is showing a security check. Open turo.com, clear it, then check again.",
  unreachable: "Could not reach Turo just now. Check your connection and try again.",
  no_vehicles: "Signed in to Turo, but no vehicles were found on this account. Check you are signed in as the host.",
  unreadable:  "Turo answered in a shape this extension does not recognise. It may need an update.",
  ok:          null,
};

/**
 * Is the operator's Turo session usable right now?
 *
 * Read-only in the strictest sense: one GET of the host's own fleet, through
 * the tab they already have open. Nothing is written to Turo here or anywhere
 * else in this extension.
 */
async function probeTuroStatus() {
  const R = reader();
  if (!R) {
    return await writeTuroStatus({ connected: false, reason: "unreadable" });
  }

  const tab = await findTuroTab();
  if (!tab) return await writeTuroStatus({ connected: false, reason: "no_tab" });

  let read;
  try {
    read = await callInTab(tab.id, "ISOLATED", "collectVehicles", [], null);
  } catch (e) {
    return await writeTuroStatus({ connected: false, reason: "unreachable" });
  }
  if (!read || read.__tabError) {
    return await writeTuroStatus({ connected: false, reason: "unreachable" });
  }

  if (read.outcome !== R.OUTCOME.OK) {
    /* Map the reader's vocabulary onto the four things a person can DO about
       it. The full taxonomy belongs in the run panel, not in a status line. */
    const reason =
      read.outcome === R.OUTCOME.NOT_LOGGED_IN ? "not_signed_in" :
      read.outcome === R.OUTCOME.BOT_BLOCKED ? "challenge" :
      read.outcome === R.OUTCOME.UNREACHABLE || read.outcome === R.OUTCOME.RATE_LIMITED ? "unreachable" :
      "unreadable";
    return await writeTuroStatus({ connected: false, reason });
  }

  /* THE SAME JUDGEMENT THE SYNC USES. buildSessionProbe refuses to call a
     session live on zero vehicles — "an operator we are migrating OFF Turo owns
     cars by definition" — and the status line must not be more optimistic than
     the thing it is gating, or the button lights up and the sync then refuses. */
  const probe = R.buildSessionProbe(read, false);
  if (!probe.liveSession) {
    return await writeTuroStatus({ connected: false, reason: "no_vehicles" });
  }

  return await writeTuroStatus({
    connected: true,
    reason: "ok",
    vehicles: typeof read.itemCount === "number" ? read.itemCount : null,
    /* A FINGERPRINT, never the id. The popup only needs to know the account
       changed, and a hashed value cannot be read off a shared screen. */
    account: probe.turoHostId ? (await R.fingerprint(probe.turoHostId)).slice(0, 8) : null,
  });
}

async function writeTuroStatus(status) {
  const full = Object.assign({ checkedAt: new Date().toISOString() }, status);
  await set(K.turo, full);
  return full;
}

// ================================================================= wiring ==

// Registered at the top level so they survive every worker revival.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  /* SENDER VALIDATION. `externally_connectable` is absent from the manifest, so
     a web page cannot reach this listener at all — but "cannot today" is not a
     reason to omit the check, and content scripts CAN reach it, from inside
     turo.com. So: same extension id, and for anything that touches the session,
     no tab behind it either. content-turo.js runs in a page and has no business
     signing anyone in or reading who is signed in; it returns scraped rows and
     nothing else. */
  const sameExtension = !sender || !sender.id || sender.id === chrome.runtime.id;
  if (!sameExtension) return false;
  const fromExtensionPage = !sender || !sender.tab;

  if (msg.type === "TURO_STATUS") {
    if (!fromExtensionPage) return false;
    /* `cached` paints instantly on open; the popup then asks for a fresh one.
       A status line that blocks the whole popup on a network round trip is a
       status line people learn to ignore. */
    (msg.cached ? get(K.turo).then((v) => v || null) : probeTuroStatus())
      .then((r) => reply(sendResponse, r))
      .catch(() => reply(sendResponse, { connected: false, reason: "unreachable", checkedAt: new Date().toISOString() }));
    return true;
  }

  if (msg.type === "AUTH_STATE") {
    if (!fromExtensionPage) return false;
    authState().then((r) => reply(sendResponse, r)).catch(() => reply(sendResponse, { signedIn: false, expired: false, identity: null }));
    return true;
  }
  if (msg.type === "AUTH_SIGN_IN") {
    if (!fromExtensionPage) return false;
    authSignIn(msg.email, msg.password)
      .then((r) => reply(sendResponse, r))
      .catch(() => reply(sendResponse, { ok: false, reason: "Sign-in failed unexpectedly. Try again." }));
    return true;
  }
  if (msg.type === "AUTH_SIGN_OUT") {
    if (!fromExtensionPage) return false;
    authSignOut().then((r) => reply(sendResponse, r)).catch(() => reply(sendResponse, { ok: true }));
    return true;
  }

  if (msg.type === "SYNC_ONE") {
    syncOne()
      .then((r) => reply(sendResponse, r))
      .catch((e) => reply(sendResponse, { phase: "error", title: String((e && e.message) || e) }));
    return true;
  }
  if (msg.type === "SYNC_ALL") {
    startRun(msg.mode === "fixture" ? "fixture" : "live", msg.scenario || null)
      .then((s) => reply(sendResponse, s))
      .catch((e) => reply(sendResponse, { phase: "error", lastError: String((e && e.message) || e) }));
    return true;
  }
  if (msg.type === "SYNC_RESUME") {
    resumeRun().then((s) => reply(sendResponse, s)).catch(() => reply(sendResponse, null));
    return true;
  }
  if (msg.type === "SYNC_CANCEL") {
    cancelRun().then((s) => reply(sendResponse, s)).catch(() => reply(sendResponse, null));
    return true;
  }
  if (msg.type === "SYNC_STATE") {
    get(K.state).then((s) => reply(sendResponse, s || null)).catch(() => reply(sendResponse, null));
    return true;
  }
  return false;
});

/* The popup can be closed between our reply and its arrival, which rejects with
   "Receiving end does not exist". Storage is the truth; this is best effort. */
function reply(sendResponse, value) {
  try { sendResponse(value); } catch (_) { /* popup closed */ }
}

/* R3: the only thing that can revive a dead worker.
   GUARDED. If the "alarms" permission is ever stripped from the manifest,
   chrome.alarms is undefined and an unguarded addListener here throws during
   worker REGISTRATION — which kills SYNC_ONE too, and presents as an extension
   that does nothing at all with one red "Errors" button to explain it. */
if (typeof chrome !== "undefined" && chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== PUMP_ALARM) return;
    pump("alarm").catch((e) => console.error("[TuroBridge] pump from alarm failed:", e));
  });
} else {
  console.warn('[TuroBridge] no "alarms" permission — a sync interrupted by the worker being killed will need a manual Continue.');
}

/* Chrome was quit mid-run. Nothing ran while it was closed; pick up where the
   cursor says we were, subject to resumeDecision()'s guards. */
chrome.runtime.onStartup.addListener(() => {
  pump("startup").catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  // A reload replaces the code but not the alarms, and an alarm pointing at a
  // run from a previous version of this file is a debugging trap.
  clearAlarm().catch(() => {});
});

// ============================================== PART 1 — THE POC ONE CLICK ==
//
// Everything in this section is the original proof of concept and is
// deliberately byte-for-byte in behaviour. It is the path that works with no
// Turo account, it is what gets demonstrated, and nothing in PART 2 may change
// how it behaves.

let inFlight = false; // PoC-only latch; same rationale as `pumping`.

async function syncOne() {
  if (inFlight) return await setStatus({ phase: "running", title: "Already syncing…" });
  inFlight = true;
  try {
    const cred = await credential();
    if (!cred.ok) {
      return await setStatus({ phase: "error", title: "Not signed in", detail: cred.reason });
    }

    await setStatus({ phase: "running", title: "Reading your Turo session…" });
    const read = await readOneReservation();

    if (!read.ok || !read.reservation) {
      return await setStatus({
        phase: "error",
        title: "Could not read a reservation",
        detail: ADVICE[read.reason] || read.detail || "Unknown failure."
      });
    }

    const live = read.source === "turo";
    await setStatus({
      phase: "running",
      title: live ? "Sending to Drive247…" : "Sending sample data to Drive247…",
      source: read.source
    });

    const response = await postReservation(cred, read.reservation, {
      source: read.source, reason: read.reason, detail: read.detail, diagnostics: read.diagnostics
    });

    if (!response.ok) {
      return await setStatus({
        phase: "error",
        title: "Drive247 rejected the import",
        detail: response.detail,
        source: read.source
      });
    }

    const r = read.reservation;
    return await setStatus({
      phase: "done",
      title: response.action === "updated"
        ? "Already synced — reservation updated"
        : (live ? "Synced from your live Turo session" : "Synced using bundled sample data"),
      detail: live
        ? "Open Drive247 → Turo Import to see it."
        : `Sample data used — ${ADVICE[read.reason] || read.detail || "live Turo data was unavailable."}`,
      source: read.source,
      action: response.action,
      reservation: {
        reservation_id: r.reservation_id,
        guest_name: r.guest_name,
        vehicle_label: r.vehicle_label,
        starts_at: r.starts_at,
        ends_at: r.ends_at
      }
    });
  } catch (e) {
    return await setStatus({ phase: "error", title: "Sync failed", detail: String((e && e.message) || e) });
  } finally {
    inFlight = false;
  }
}

/**
 * Runs the single-reservation reader inside a real turo.com tab. ISOLATED
 * world first (same-origin, page cookies, no page-visible footprint); the exact
 * same code is retried in the MAIN world only when the failure is one a
 * page-minted header could explain. See the header comment in content-turo.js.
 */
async function readOneReservation() {
  let tab;
  try {
    tab = await getTuroTab();
  } catch (e) {
    return fixtureFromWorker("no_tab", String((e && e.message) || e));
  }

  let first;
  try {
    first = await callInTab(tab.id, "ISOLATED", "collectOneReservation", []);
  } catch (e) {
    return fixtureFromWorker("UNREACHABLE", `Injection failed: ${String((e && e.message) || e)}`);
  }

  if (first.ok && first.source === "turo") return first;

  if (first.source === "fixture" && RETRY_IN_MAIN.has(first.reason)) {
    console.log(`[TuroBridge] ISOLATED read returned ${first.reason}; retrying in MAIN world.`);
    try {
      const second = await callInTab(tab.id, "MAIN", "collectOneReservation", []);
      if (second.ok && second.source === "turo") return second;
      first.diagnostics = Object.assign({}, first.diagnostics, { retriedInMain: true, mainReason: second.reason });
    } catch (e) {
      first.diagnostics = Object.assign({}, first.diagnostics, { retriedInMain: true, mainError: String((e && e.message) || e) });
    }
  }
  return first;
}

/**
 * Last-resort fallback when we could not run anything in a tab at all.
 * Uses the SAME normalize() the page uses (loaded via importScripts above), so
 * this path and the in-page fixture path produce byte-identical reservations.
 */
function fixtureFromWorker(reason, detail) {
  const bridge = globalThis.__d247TuroBridge;
  if (!bridge || !bridge.fixtureReservation) {
    return {
      ok: false, source: null, reason: "no_fixture",
      detail: `${detail}; content-turo.js did not load in the service worker${IMPORT_ERROR ? " (" + IMPORT_ERROR + ")" : ""}`,
      reservation: null, diagnostics: {}
    };
  }
  const out = bridge.fixtureReservation(reason, detail);
  out.diagnostics = Object.assign({}, out.diagnostics, { loadedIn: "service-worker" });
  return out;
}

// ==================================== PART 2 — THE RESUMABLE MULTI-PAGE RUN ==

/**
 * Start a fresh run. Writes the cursor BEFORE anything else happens, so even a
 * worker killed one millisecond later leaves a run that can be reasoned about.
 *
 * @param {"live"|"fixture"} mode
 * @param {string|null} scenario  a fixture degraded scenario to force
 */
async function startRun(mode, scenario) {
  const R = reader();
  if (!R) return await writeState(errorState("The reader did not load in the service worker" + (IMPORT_ERROR ? ": " + IMPORT_ERROR : ".")));

  const cred = await credential();
  if (!cred.ok) return await writeState(errorState(cred.reason));

  const runId = "run-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

  /* THE TENANT GUARD, planted at the start of the run.
     One Chrome profile holds ONE Turo cookie jar and can be signed into TWO
     Drive247 tenants over its life. Every later step re-checks the live
     credential against this fingerprint and ABANDONS rather than resumes on a
     mismatch. Flushing tenant A's pages under tenant B's credential is the
     worst outcome available in this system and it is unrecoverable once
     written.

     What is fingerprinted is cred.identity — the TENANT ID on the session path,
     not the access token. Access tokens rotate on every refresh, so hashing one
     would abandon a perfectly healthy run about once an hour and blame it on an
     account switch that never happened. The tenant is the thing whose change is
     actually dangerous, and it is stable for as long as the sign-in lasts. */
  const tokenFingerprint = (await R.fingerprint(cred.identity)).slice(0, 16);

  const firstPage = { pageKey: "p0", path: R.TRIPS_PATH, index: 0 };
  let cursor = R.newCursor(runId, tokenFingerprint, firstPage);

  // Run-scoped observations. All of them are DERIVED FROM WHAT WE READ, never
  // from anything the feed declares about itself.
  cursor = R.advanceCursor(cursor, {
    mode: mode,
    scenario: scenario,
    phase: "probing_session",
    world: "ISOLATED",
    mainRetryUsed: false,
    seenPageKeys: [],
    outcomes: [],
    pagesRead: 0,
    recordsOffered: 0,
    recordsAccepted: 0,
    recordsRejected: 0,
    recordsFlushed: 0,
    ingestFailures: 0,
    explicitEnd: false,
    lastPageShort: false,
    stalled: false,
    stallReason: null,
    pageFailed: false,
    sawTrips: false,
    lastError: null,
    /* THE SERVER-SIDE RUN. turo-bridge-ingest opens a turo_sync_jobs row on the
       first POST and returns its id; every later POST of this run carries it
       back so the whole sync is ONE run rather than one run per reservation.
       Persisted in the cursor (never in module scope) so an MV3 kill does not
       orphan it — R1. */
    ingestJobId: null,
    /* is_authoritative in 03-foundation-schema.sql:223 requires
       http_error_count = 0, so this has to be counted rather than assumed. */
    httpErrors: 0,
    /* Whatever the feed CLAIMED the total was. Captured, sent, and never used
       as a denominator by anything — see the column comment at 03:163. */
    feedReportedTotal: null
  });

  await set(K.cursor, cursor);
  await set(K.pending, null);
  await set(K.summary, {
    ids: [], rows: [], rejected: [], keyHistogram: {},
    unknownCounts: {}, envelopeKeys: [], vehicles: []
  });
  await writeState(projectState(cursor, await get(K.summary), null));
  await ensureAlarm();

  pump("start").catch((e) => console.error("[TuroBridge] pump failed:", e));
  return await get(K.state);
}

/**
 * The operator clicked Continue.
 *
 * This is the ONLY thing that may restart a run parked by a bot challenge or by
 * the operator themselves. `manualResume` is a one-shot flag consumed by
 * decideResume(), so an alarm or a browser restart can never stand in for the
 * human who was supposed to clear the challenge.
 */
async function resumeRun() {
  const R = reader();
  let cursor = await get(K.cursor);
  if (cursor && R && cursor.phase === "parked") {
    cursor = R.advanceCursor(cursor, { manualResume: true, nextAllowedAt: null });
    await set(K.cursor, cursor);
  }
  await ensureAlarm();
  pump("manual-resume").catch(() => {});
  return await get(K.state);
}

async function cancelRun() {
  const R = reader();
  let cursor = await get(K.cursor);
  if (!cursor || !R) return await get(K.state);
  cursor = R.advanceCursor(cursor, {
    phase: "parked", parkedReason: "USER_CANCELLED",
    lastError: "Stopped by you. Nothing that was already read has been undone."
  });
  await set(K.cursor, cursor);
  await clearAlarm();
  return await writeState(projectState(cursor, await get(K.summary), null));
}

/**
 * THE PUMP.
 *
 * Runs steps until it must wait, and every step is individually durable. If the
 * worker dies inside `stepOnce`, the next wake-up re-reads the cursor from
 * storage and continues from the last thing that was actually written down.
 *
 * The loop exists purely as an optimisation for the case where the worker
 * happens to stay alive; correctness never depends on it going round twice.
 */
async function pump(trigger) {
  if (pumping) return;
  pumping = true;
  try {
    for (let guard = 0; guard < 200; guard++) {
      const R = reader();
      if (!R) return;

      let cursor = await get(K.cursor);
      if (!cursor || !cursor.runId) { await clearAlarm(); return; }
      if (cursor.phase === "done") { await clearAlarm(); return; }

      if (cursor.phase === "parked") {
        const decision = await decideResume(cursor);
        if (decision.wait) {
          // Cooling down. The alarm stays armed; the operator sees a countdown.
          await writeState(projectState(cursor, await get(K.summary), decision.message));
          return;
        }
        if (!decision.resume) {
          // Not resumable — a different tenant, a different Turo account, or
          // too old to be current. Say which, and stop.
          await clearAlarm();
          await writeState(projectState(cursor, await get(K.summary), decision.message));
          return;
        }
        /* `reprobe` is the resumed run's obligation to prove WHOSE Turo account
           it is about to read, before it reads anything.

           A parked run keeps cursor.pending, so it used to resume straight into
           reading_trips — skipping stepProbeSession(), which is the only place
           the Turo-account guard lives. The hole was live and automatic: park on
           a 429 (RATE_LIMITED is auto-resumable), let the operator sign out of
           host A and into host B, and the alarm would fire, resume, and flush
           host B's trips into tenant A under the unchanged pairing token. The
           token guard in stepOnce() cannot see this — the Drive247 token never
           changed; only the Turo cookie jar did.

           The phase itself is preserved (a run parked mid-flush still has records
           in K.pending and must go back to flushing, not re-read the page), so
           this costs one /api/vehicles/me request and loses no work. */
        cursor = R.advanceCursor(cursor, {
          phase: cursor.pending ? "reading_trips" : (cursor.session ? "reading_trips" : "probing_session"),
          reprobe: true,
          parkedReason: null, nextAllowedAt: null, lastError: null,
          manualResume: false   // one shot, consumed here
        });
        await set(K.cursor, cursor);
      }

      /* THE RUN-LENGTH CAP. A run that has been going for longer than
         LIMITS.maxRunMs is parked, not failed: what it read is real and stays,
         and the coverage verdict simply never reaches "complete". */
      const age = Date.now() - new Date(cursor.startedAt).getTime();
      if (age > R.LIMITS.maxRunMs && cursor.phase !== "flushing") {
        await parkRun(cursor, "TRUNCATED",
          "This sync has been running for a while, so it paused. What was read is saved; nothing was released. Continue when you are ready.");
        return;
      }

      const step = await stepOnce(cursor);
      if (step.stop) return;
      if (step.waitMs > 0) {
        await scheduleWake(step.waitMs);
        return;
      }
    }
    console.warn("[TuroBridge] pump hit its iteration guard; rescheduling.");
    await scheduleWake(1000);
  } finally {
    pumping = false;
  }
}

/**
 * Exactly ONE durable step. Returns {stop, waitMs}.
 *
 * Read this alongside R2 in the header: in every branch below, the cursor is
 * written to storage describing what is ABOUT to happen, and only then is the
 * awaited operation performed.
 */
async function stepOnce(cursor) {
  const R = reader();

  // The tenant guard, re-checked on EVERY step and not just on resume. The
  // operator can sign out and into a different Drive247 account mid-run.
  //
  // PARKED, NOT ABANDONED, when the credential merely goes away: a sign-out or
  // an expiry is recoverable by signing back in, and the run's progress is
  // still true. Only a credential that resolves to a DIFFERENT TENANT abandons,
  // because that progress can no longer be attributed to anyone safely.
  const cred = await credential();
  if (!cred.ok) {
    await parkRun(cursor, "NOT_LOGGED_IN", cred.reason, null, "Signed out of Drive247");
    return { stop: true, waitMs: 0 };
  }
  const fp = (await R.fingerprint(cred.identity)).slice(0, 16);
  if (fp !== cursor.tokenFingerprint) {
    await abandonRun(cursor,
      "The signed-in account changed while this sync was running — it belongs to a different Drive247 tenant. The sync was abandoned rather than risk writing one operator's trips into another's account.");
    return { stop: true, waitMs: 0 };
  }

  /* THE RESUMED-RUN ACCOUNT GUARD. Ordered before the phase dispatch so that
     NOTHING — not a page read, not a flush — happens on a resumed run until the
     signed-in Turo host has been re-observed and matched. stepProbeSession does
     its own equivalent check, so it is allowed through to avoid a double probe. */
  if (cursor.reprobe && cursor.phase !== "probing_session") {
    return await stepReverifyAccount(cursor);
  }

  if (cursor.phase === "probing_session") return await stepProbeSession(cursor);
  if (cursor.phase === "reading_trips")   return await stepReadPage(cursor);
  if (cursor.phase === "flushing")        return await stepFlush(cursor);

  await parkRun(cursor, "UNKNOWN", `The sync reached an unexpected state (${cursor.phase}).`);
  return { stop: true, waitMs: 0 };
}

// ------------------------------------------------- step 1: the session probe

/**
 * Read /api/vehicles/me. This is BOTH the fleet read and the independent
 * session probe.
 *
 * WHY THIS RUNS FIRST AND WHY IT MATTERS MORE THAN IT LOOKS.
 * `{"trips":[]}` from a WAF, an expired session, a renamed envelope key and a
 * host with an empty calendar are IDENTICAL BYTES. An empty trips list can
 * therefore never, on its own, mean "there are no trips" — it means
 * EMPTY_UNCONFIRMED, which writes nothing and releases nothing. The only thing
 * that can promote it to a confirmed empty is a SECOND, INDEPENDENT endpoint
 * saying the session is healthy, and this is that endpoint. We want it anyway
 * for vehicle identity, so it costs one request and buys the whole distinction.
 */
async function stepProbeSession(cursor) {
  const R = reader();

  cursor = R.advanceCursor(cursor, { phase: "probing_session", pending: null });
  await set(K.cursor, cursor);                       // <-- R2: intent, then act

  const read = await withTab(cursor, (tabId, world, shim) => callInTab(tabId, world, "collectVehicles", [], shim));
  if (read.__tabError) {
    await parkRun(cursor, "UNREACHABLE", read.__tabError);
    return { stop: true, waitMs: 0 };
  }

  const policy = R.policyFor(read.outcome);
  if (read.outcome !== R.OUTCOME.OK && policy.halt) {
    // A challenge or a dead session at the FIRST request. Stop here: there is
    // no value in also hammering the trips feed with the same broken session,
    // and on BOT_BLOCKED there is real harm in it.
    await parkRun(cursor, read.outcome, policy.advice, read.message);
    return { stop: true, waitMs: 0 };
  }

  /* sawTripsThisRun = false ON PURPOSE. buildSessionProbe short-circuits on a
     true here and returns a probe with turoHostId null — which would silently
     disable the Turo-account guard below. We ask the vehicles endpoint what it
     knows first, and only fall back to "we saw trips, so the session is
     obviously alive" at the end of the run. */
  const probe = R.buildSessionProbe(read.outcome === R.OUTCOME.OK ? read : null, false);

  /* THE TURO-ACCOUNT GUARD. buildSessionProbe() cannot fill this in — hashing
     is async and that function is not — so the orchestrator MUST. Without it,
     resumeDecision()'s "did the operator switch Turo accounts?" check compares
     null to null and silently degrades to a no-op, and a resumed run could mix
     two hosts' fleets into one tenant. */
  probe.turoAccountFingerprint = probe.turoHostId ? await R.fingerprint(probe.turoHostId) : null;

  if (cursor.turoAccountFingerprint && probe.turoAccountFingerprint &&
      cursor.turoAccountFingerprint !== probe.turoAccountFingerprint) {
    await abandonRun(cursor,
      "A different Turo account is signed in now. The sync was abandoned rather than mix two hosts' trips into one Drive247 account.");
    return { stop: true, waitMs: 0 };
  }

  const summary = await get(K.summary);
  summary.vehicles = (read.vehicles || []).map(lightVehicle);
  await set(K.summary, summary);

  cursor = R.advanceCursor(cursor, {
    phase: "reading_trips",
    session: probe,
    // This step performs the same comparison stepReverifyAccount() does, so a
    // resumed run routed through here has discharged its obligation.
    reprobe: false,
    turoAccountFingerprint: probe.turoAccountFingerprint,
    pending: { pageKey: "p0", path: R.TRIPS_PATH, index: 0 },
    outcomes: cursor.outcomes.concat(read.outcome === R.OUTCOME.OK ? [] : [read.outcome])
  });
  await set(K.cursor, cursor);
  await writeState(projectState(cursor, summary, null));
  return { stop: false, waitMs: R.pacingDelayMs() };
}

/**
 * RE-VERIFY WHOSE TURO ACCOUNT THIS IS, on a resumed run, before reading again.
 *
 * WHY THIS EXISTS AS A SEPARATE STEP. The account guard used to live only in
 * stepProbeSession(), which runs once at the START of a run. But a parked run
 * keeps cursor.pending and resumes directly into reading_trips (or flushing),
 * so the guard was skipped on every resume — and resumeDecision()'s copy of it
 * was a tautology (see decideResume). The net effect was that the ONE defence
 * against mixing two Turo hosts' fleets into a single Drive247 tenant could not
 * fire on the exact path where it was needed, and that path is automatic: a 429
 * parks the run, the alarm resumes it unattended, and whichever host is signed
 * in at that moment is the one that gets read.
 *
 * This does NOT change the phase. A run parked mid-flush still has records in
 * K.pending and must return to flushing; a run parked mid-walk must return to
 * its page. The only thing this step buys is the right to continue.
 *
 * A probe that cannot name a host (turoHostId null) does not abandon the run —
 * it simply fails to confirm, and we carry on with whatever the cursor already
 * knew. Refusing on an unnameable host would make the feature unusable the
 * moment /api/vehicles/me changes shape, and the value here is a POSITIVE
 * mismatch, never an absence. Absence is not evidence on this side either.
 */
async function stepReverifyAccount(cursor) {
  const R = reader();

  cursor = R.advanceCursor(cursor, { phase: cursor.phase });
  await set(K.cursor, cursor);                       // <-- R2: intent, then act

  const read = await withTab(cursor, (tabId, world, shim) =>
    callInTab(tabId, world, "collectVehicles", [], shim));

  if (read.__tabError) {
    await parkRun(cursor, "UNREACHABLE", read.__tabError);
    return { stop: true, waitMs: 0 };
  }

  const policy = R.policyFor(read.outcome);
  if (read.outcome !== R.OUTCOME.OK && policy.halt) {
    // Same reasoning as the opening probe: do not push a broken session on to
    // the trips feed, and on BOT_BLOCKED do not issue another request at all.
    await parkRun(cursor, read.outcome, policy.advice, read.message);
    return { stop: true, waitMs: 0 };
  }

  const probe = R.buildSessionProbe(read.outcome === R.OUTCOME.OK ? read : null, false);
  probe.turoAccountFingerprint = probe.turoHostId ? await R.fingerprint(probe.turoHostId) : null;

  /* THE MISMATCH. Only a positive, named disagreement abandons the run. */
  if (cursor.turoAccountFingerprint && probe.turoAccountFingerprint &&
      cursor.turoAccountFingerprint !== probe.turoAccountFingerprint) {
    await abandonRun(cursor,
      "A different Turo account is signed in now, so the paused sync was abandoned rather than continue reading one host's trips into another operator's Drive247 account. Start a fresh sync when the right account is signed in.");
    return { stop: true, waitMs: 0 };
  }

  cursor = R.advanceCursor(cursor, {
    reprobe: false,
    // Learn the fingerprint if the opening probe never managed to. Never
    // OVERWRITE one: the stored value is what every later comparison is against.
    turoAccountFingerprint: cursor.turoAccountFingerprint || probe.turoAccountFingerprint,
    session: probe.liveSession ? probe : cursor.session
  });
  await set(K.cursor, cursor);
  await writeState(projectState(cursor, await get(K.summary), null));
  return { stop: false, waitMs: R.pacingDelayMs() };
}

// ------------------------------------------------------ step 2: read a page

async function stepReadPage(cursor) {
  const R = reader();
  const pageRequest = cursor.pending;
  if (!pageRequest) return await finishRun(cursor);

  // R2. The intent — "I am about to request THIS page" — is durable before the
  // request exists. A worker killed inside the fetch wakes up knowing it.
  cursor = R.advanceCursor(cursor, { phase: "reading_trips", pending: pageRequest });
  await set(K.cursor, cursor);

  const read = await withTab(cursor, (tabId, world, shim) =>
    callInTab(tabId, world, "collectPage", [pageRequest, cursor.pagination], shim));

  if (read.__tabError) {
    await parkRun(cursor, "UNREACHABLE", read.__tabError);
    return { stop: true, waitMs: 0 };
  }

  const outcomes = cursor.outcomes.concat([read.outcome]);

  /* is_authoritative (03:223) requires http_error_count = 0, so an HTTP failure
     has to be COUNTED rather than merely reacted to — otherwise a run that hit
     a 500 on page 2 and recovered would still present as a clean read. Captured
     here, before any branch, so a park cannot skip it. */
  if (typeof read.httpStatus === "number" && read.httpStatus >= 400) {
    cursor = R.advanceCursor(cursor, { httpErrors: (cursor.httpErrors || 0) + 1 });
  }
  /* Whatever the feed CLAIMED the total was. Recorded so a human can compare it
     against what we actually read; never used as a denominator by anything. */
  if (read.plan && typeof read.plan.declaredTotal === "number") {
    cursor = R.advanceCursor(cursor, { feedReportedTotal: read.plan.declaredTotal });
  }

  // ---- not OK: throttle, retry in the other world, or park -----------------
  if (read.outcome !== R.OUTCOME.OK) {
    const policy = R.policyFor(read.outcome);

    // One MAIN-world retry per run, and only where a page-minted header could
    // plausibly be the difference. Retrying everything doubles our traffic
    // against a WAF for nothing.
    if (policy.retryInMainWorld && !cursor.mainRetryUsed && cursor.mode === "live") {
      cursor = R.advanceCursor(cursor, { mainRetryUsed: true, world: "MAIN", outcomes: outcomes });
      await set(K.cursor, cursor);
      await writeState(projectState(cursor, await get(K.summary), "Retrying that page from inside the page itself…"));
      return { stop: false, waitMs: R.pacingDelayMs() };
    }

    const decision = R.throttleDecision(read.outcome, cursor.throttleStrikes, read.retryAfterSeconds);
    if (decision.action === "retry") {
      cursor = R.advanceCursor(cursor, {
        throttleStrikes: decision.strikes,
        nextAllowedAt: new Date(Date.now() + decision.waitMs).toISOString(),
        outcomes: outcomes,
        lastError: policy.advice
      });
      await set(K.cursor, cursor);
      await writeState(projectState(cursor, await get(K.summary), decision.reason));
      return { stop: false, waitMs: decision.waitMs };
    }

    // Park. The cursor keeps `pending`, so continuing re-requests exactly this
    // page — deterministic pageKey plus an idempotent ingest makes a replay a
    // no-op if it had in fact landed.
    cursor = R.advanceCursor(cursor, {
      throttleStrikes: decision.strikes,
      outcomes: outcomes,
      pageFailed: true,
      nextAllowedAt: decision.waitMs ? new Date(Date.now() + decision.waitMs).toISOString() : null
    });
    await parkRun(cursor, read.outcome, policy.advice, read.message);
    return { stop: true, waitMs: 0 };
  }

  // ---- OK -----------------------------------------------------------------
  const summary = await get(K.summary);
  const seenIds = summary.ids.slice();
  const pageIds = read.records.map((r) => r.reservationId);

  /* STALL DETECTION. Two ways a paginated walk goes wrong without ever failing:
     the cursor stops advancing, or the page advances and the CONTENT repeats.
     Both look like progress from the inside. The first walks into a rate limit
     and then a challenge; the second inflates the count so a truncated read
     looks abundant. */
  const stall = R.detectStall(read.next, cursor.seenPageKeys, pageIds, seenIds);

  // Merge diagnostics. These are the parts that make being wrong survivable.
  for (const k of Object.keys(read.keyHistogram || {})) {
    summary.keyHistogram[k] = (summary.keyHistogram[k] || 0) + read.keyHistogram[k];
  }
  for (const ek of read.envelopeKeys || []) {
    if (summary.envelopeKeys.indexOf(ek) === -1) summary.envelopeKeys.push(ek);
  }
  for (const rej of read.rejected || []) {
    if (summary.rejected.length < 50) summary.rejected.push(lightRejection(rej));
  }
  for (const rec of read.records) {
    for (const u of rec.unknowns || []) {
      const slot = summary.unknownCounts[u.field] || { count: 0, reason: u.reason, sample: null, tried: u.candidatesTried || [] };
      slot.count += 1;
      if (slot.sample === null && u.sample !== null && u.sample !== undefined) slot.sample = String(u.sample).slice(0, 120);
      summary.unknownCounts[u.field] = slot;
    }
  }
  await set(K.summary, summary);

  /* The page's records go to storage BEFORE the flush begins, so a worker death
     between reading and posting loses nothing. They are the ONLY bulky thing we
     persist, they are bounded to one page, and each one is removed as it is
     acknowledged — so the stored blob shrinks as the flush proceeds. */
  const pendingBlob = {
    pageKey: pageRequest.pageKey,
    index: pageRequest.index,
    records: read.records.map((r) => toWire(r, cursor)),
    nextPage: stall.stalled ? null : read.next
  };
  const fitted = fitToStorage(pendingBlob);
  if (!fitted.ok) {
    await parkRun(cursor, "UNKNOWN",
      "That batch was too large for this browser to hold safely, so the sync paused rather than save only part of it.",
      fitted.detail);
    return { stop: true, waitMs: 0 };
  }
  try {
    await set(K.pending, pendingBlob);
  } catch (e) {
    /* Almost always the storage quota. Park rather than fall through: the
       cursor is still on this page, so continuing simply re-reads it, and a
       silent throw here would spin that re-read forever. */
    await parkRun(cursor, "UNKNOWN",
      "This browser refused to store that batch, so the sync paused. Nothing was lost.",
      String((e && e.message) || e));
    return { stop: true, waitMs: 0 };
  }

  const observed = (read.plan && read.plan.observedPageSize) || null;
  cursor = R.advanceCursor(cursor, {
    phase: "flushing",
    pagination: read.plan,
    seenPageKeys: cursor.seenPageKeys.concat([pageRequest.pageKey]),
    pagesRead: cursor.pagesRead + 1,
    recordsOffered: cursor.recordsOffered + read.itemCount,
    recordsAccepted: cursor.recordsAccepted + read.records.length,
    recordsRejected: cursor.recordsRejected + (read.rejected || []).length,
    outcomes: outcomes,
    sawTrips: cursor.sawTrips || read.records.length > 0,
    /* NOT `!read.next`. A walk that simply could not build a next request has
       not been told it ended — see the derivation in content-turo.js. */
    explicitEnd: !!read.explicitEnd,
    lastPageShort: observed !== null && read.itemCount < observed,
    stalled: stall.stalled,
    stallReason: stall.reason
  });
  await set(K.cursor, cursor);
  await writeState(projectState(cursor, summary, null));
  return { stop: false, waitMs: 0 };
}

// -------------------------------------------- step 3: flush the page's records

/**
 * POST the current page's records to Drive247, ONE AT A TIME.
 *
 * The ingest takes one reservation per call, so this is a loop of POSTs rather
 * than one batch. That is not a workaround for a missing batch endpoint — it is
 * what makes a partial page survivable. Each acknowledged record is removed
 * from the stored pending list immediately, so:
 *
 *   worker dies after the POST landed, before the removal
 *       -> the record is re-POSTed, and the ingest upserts on
 *          (tenant_id, reservation_id). One row, not two.
 *   worker dies before the POST
 *       -> the record is still in the pending list and is simply sent.
 *
 * At-least-once delivery over an idempotent sink, which is the only delivery
 * guarantee an MV3 worker can honestly offer.
 */
async function stepFlush(cursor) {
  const R = reader();
  const pending = await get(K.pending);
  if (!pending) {
    cursor = R.advanceCursor(cursor, { phase: "reading_trips" });
    await set(K.cursor, cursor);
    return { stop: false, waitMs: 0 };
  }

  const cred = await credential();

  if (pending.records.length > 0) {
    const record = pending.records[0];

    /* UNCHANGED? Then report the id at finalisation and send nothing else.
       The digest map is only ever written from an ACKNOWLEDGED write, so
       "unchanged" always means "identical to something Drive247 confirmed it
       holds" — never "identical to something we tried to send". */
    const digests = (await get(K.digests)) || {};
    const digest = await recordDigest(record);
    const carried = (cursor.unchangedIds || []).length;
    if (digest && digests[record.reservation_id] === digest && carried < MAX_UNCHANGED_IDS) {
      pending.records = pending.records.slice(1);
      await set(K.pending, pending);

      const summaryU = await get(K.summary);
      /* Counted as seen, because it WAS seen. Leaving it out would make the
         coverage arithmetic — and therefore the release gate — read a full
         calendar as a partial one. */
      if (summaryU.ids.indexOf(record.reservation_id) === -1) summaryU.ids.push(record.reservation_id);
      if (summaryU.rows.length < 500) summaryU.rows.push(lightRow(record, "unchanged"));
      await set(K.summary, summaryU);

      cursor = R.advanceCursor(cursor, {
        recordsFlushed: cursor.recordsFlushed + 1,
        unchangedIds: (cursor.unchangedIds || []).concat(record.reservation_id)
      });
      await set(K.cursor, cursor);
      await writeState(projectState(cursor, summaryU, null));
      return { stop: false, waitMs: 0 };
    }

    const summaryNow = await get(K.summary);
    /* THE REASON WE SEND MUST BE THE ONE WE ACTUALLY HAVE.
       This was a hardcoded "OK", so every record a run flushed claimed a clean
       read — including records read on page 1 of a run that went on to be rate
       limited, truncated or challenged. The run's real verdict does reach the
       server at finalize (`job.reader_outcome`), but until then this is the
       only signal on the wire, and an operator reading a per-record diagnostic
       that says OK about a degraded run is being told something we do not know.
       worstOutcome() over what has been seen SO FAR is the honest answer: true
       at the moment of the write, and it can only get worse. */
    const soFar = R.worstOutcome(cursor.outcomes && cursor.outcomes.length ? cursor.outcomes : ["OK"]);
    const res = await postReservation(cred, null, {
      source: cursor.mode === "fixture" ? "fixture" : "turo",
      reason: soFar,
      detail: soFar === "OK"
        ? null
        : "This record parsed cleanly, but the run has already degraded (" + cursor.outcomes.join(", ") + ").",
      /* BATCH SHAPE, deliberately, even for one record. The ingest's legacy
         single-`reservation` path defaults job.finalize to TRUE
         (index.ts:717), which closed the run after the first trip and turned
         every later POST into a 409. */
      reservations: [record],
      job: buildJobEnvelope(cursor, summaryNow, { finalize: false }),
      diagnostics: { runId: cursor.runId, pageKey: pending.pageKey, world: cursor.world, mode: cursor.mode }
    });

    /* The server opened the run on the first POST and told us its id. Persist
       it BEFORE anything else can fail (R2): a worker killed here wakes up
       still attached to the same run rather than opening a second one, which
       the turo_sync_jobs_one_running_per_kind index would refuse anyway. */
    if (res.jobId && res.jobId !== cursor.ingestJobId) {
      cursor = R.advanceCursor(cursor, { ingestJobId: res.jobId });
      await set(K.cursor, cursor);
    }

    /* 200 + write_safe:false is Drive247 reading the run and REFUSING it. It
       has already finalised the job as failed, so the id we hold is spent —
       drop it, or a resume would 409 forever against a closed run. */
    if (res.ok && res.writeSafe === false) {
      cursor = R.advanceCursor(cursor, { ingestJobId: null });
      await parkRun(cursor, "UNKNOWN",
        "Drive247 read this sync and did not trust it, so nothing was written and nothing was released. Your existing availability is untouched.",
        res.wroteNothingBecause);
      return { stop: true, waitMs: 0 };
    }

    if (!res.ok) {
      /* A REJECTED WRITE IS NOT A REJECTED READ. The Turo side is fine; our own
         side refused. Park with the record still pending so nothing is lost,
         and say plainly that this is a Drive247 problem so the operator does
         not go hunting on turo.com. */
      cursor = R.advanceCursor(cursor, { ingestFailures: cursor.ingestFailures + 1 });
      await parkRun(cursor, "INGEST_FAILED",
        "Drive247 would not accept a reservation, so the sync paused. Nothing was lost — continuing will resend it.",
        res.detail);
      return { stop: true, waitMs: 0 };
    }

    // Acked. Shrink the pending list and record it. R2's second half: the
    // receipt exists only after the acknowledgement.
    pending.records = pending.records.slice(1);
    await set(K.pending, pending);

    /* THE RECEIPT THAT LICENSES A FUTURE SKIP. Written here and nowhere else:
       after the server said it took this exact payload. A rejected record
       leaves no digest, so it is re-sent in full next time — which is the
       whole point, since a rejection is precisely the case where Drive247 does
       NOT hold what we think it does. */
    if (digest && !res.rejected) {
      const bag = (await get(K.digests)) || {};
      bag[record.reservation_id] = digest;
      await set(K.digests, bag);
    }

    const summary = await get(K.summary);
    if (summary.ids.indexOf(record.reservation_id) === -1) summary.ids.push(record.reservation_id);
    if (summary.rows.length < 500) summary.rows.push(lightRow(record, res.action));
    await set(K.summary, summary);

    cursor = R.advanceCursor(cursor, { recordsFlushed: cursor.recordsFlushed + 1 });
    await set(K.cursor, cursor);
    await writeState(projectState(cursor, summary, null));
    return { stop: false, waitMs: 0 };
  }

  // Page fully acknowledged.
  const flushedIds = (await get(K.summary)).ids;
  cursor = R.commitReceipt(cursor, { pageKey: pending.pageKey, index: pending.index }, flushedIds);

  if (cursor.stalled) {
    cursor = R.advanceCursor(cursor, { outcomes: cursor.outcomes.concat(["PAGINATION_STALLED"]), pending: null });
    await set(K.pending, null);
    await set(K.cursor, cursor);
    return await finishRun(cursor);
  }

  if (cursor.pagesRead >= R.LIMITS.maxPages) {
    cursor = R.advanceCursor(cursor, { outcomes: cursor.outcomes.concat(["TRUNCATED"]), pending: null });
    await set(K.pending, null);
    await set(K.cursor, cursor);
    return await finishRun(cursor);
  }

  const next = pending.nextPage;
  await set(K.pending, null);

  if (!next) {
    cursor = R.advanceCursor(cursor, { pending: null });
    await set(K.cursor, cursor);
    return await finishRun(cursor);
  }

  cursor = R.advanceCursor(cursor, { phase: "reading_trips", pending: next });
  await set(K.cursor, cursor);
  await writeState(projectState(cursor, await get(K.summary), null));
  return { stop: false, waitMs: R.pacingDelayMs() };
}

// ------------------------------------------------------------ finishing up

/**
 * Reduce the run to its two gates and write the manifest.
 *
 * `mayRelease` is the conjunction of THREE independent facts (the outcome, a
 * demonstrably complete walk, and an independently corroborated session) and
 * finaliseRun() is the only thing allowed to compute it.
 */
async function finishRun(cursor) {
  const R = reader();
  const summary = await get(K.summary);

  const outcome = cursor.recordsAccepted > 0
    ? R.worstOutcome(cursor.outcomes.length ? cursor.outcomes : ["OK"])
    : emptyRunOutcome(cursor, R);

  const coverage = R.coverageVerdict({
    pagesRead: cursor.pagesRead,
    recordsSeen: cursor.recordsAccepted,
    plan: cursor.pagination,
    pageFailed: cursor.pageFailed,
    stalled: cursor.stalled,
    maxPages: R.LIMITS.maxPages,
    explicitEnd: cursor.explicitEnd,
    lastPageShort: cursor.lastPageShort
  });

  /* If the vehicles probe could not corroborate the session but we went on to
     read real trips, the trips themselves ARE the corroboration. This is the
     only place `sawTripsThisRun` is allowed to be true, and it deliberately
     comes last so the hostId-bearing probe wins whenever it exists. */
  let session = cursor.session;
  if ((!session || !session.liveSession) && cursor.sawTrips) {
    session = R.buildSessionProbe(null, true);
    session.turoAccountFingerprint = cursor.turoAccountFingerprint || null;
  }

  const previous = (await get(K.manifest)) || null;
  const run = {
    runId: cursor.runId,
    outcome: outcome,
    coverage: coverage,
    session: session,
    reservations: summary.rows.map((r) => ({
      reservationId: r.id, lifecycle: r.lifecycle, supersedesReservationId: r.supersedes || null
    })),
    targeted404: {}
  };
  R.finaliseRun(run);

  const absences = previous ? R.diffAbsences(previous, run) : [];

  /* THE MANIFEST IS UNIONED, NOT REPLACED — unless the run earned the right to
     forget something. An id dropped from the manifest can never be diffed
     again, so a degraded run overwriting it would quietly erase our own memory
     of trips that are still real. Only an id with POSITIVE release evidence in
     a run that mayRelease is allowed to fall out. */
  const released = {};
  const absentCounts = {};
  for (const a of absences) {
    if (a.releaseAllowed) released[a.reservationId] = true;
    else if (a.evidence === "absent_only") absentCounts[a.reservationId] = a.consecutiveAbsentRuns;
  }

  const keep = {};
  for (const id of summary.ids) keep[id] = true;          // everything read this run
  for (const a of absences) if (!a.releaseAllowed) keep[a.reservationId] = true;

  /* THE RELEASE WINS OVER "WE SAW IT". A trip READ WITH A CANCELLED STATUS is
     both seen this run and positively released, and it must fall out of the
     ledger — otherwise it reappears next run as `absent_only`, which never
     releases, and we would hold a block forever for a trip we have positively
     been told is cancelled. This is the ONLY circumstance in which the bridge
     forgets an id, and it requires evidence we READ, never evidence we failed
     to read. */
  for (const id of Object.keys(released)) delete keep[id];
  await set(K.manifest, {
    runId: cursor.runId,
    startedAt: cursor.startedAt,
    finishedAt: new Date().toISOString(),
    seenReservationIds: Object.keys(keep),
    absentRunCounts: absentCounts,
    keyHistogram: summary.keyHistogram,
    envelopeKeys: summary.envelopeKeys
  });

  /* CLOSE THE SERVER-SIDE RUN. Until this existed the ingest never learned a
     run had ended, so every turo_sync_jobs row sat 'running' until the reaper
     retired it as heartbeat_lost — and `completeness`, `is_authoritative` and
     `progress_denominator` (all GENERATED from state='succeeded') could never
     be anything but 'in_progress' / false / NULL. Nothing could ever be
     released, and the portal's sync history could never show a finished read.

     Sent even when the run went badly: a degradation nobody can see is a
     degradation nobody fixes. */
  const finalised = await finaliseIngestRun(cursor, summary, outcome, coverage, run.mayWrite);

  /* AND THEN ASK FOR A CONCLUSION. Only after a finalisation the server accepted
     and did not refuse as unsafe: reconciling a run Drive247 has just told us it
     did not believe would be asking it to draw conclusions from a read it has
     already rejected.

     dry_run is forced on for fixture runs. Bundled demo data is inert
     everywhere else in this system and it must be inert here too — a sample
     trip must never be able to move a real row's presence state. */
  let reconcileNote = null;
  if (finalised && finalised.ok && finalised.writeSafe !== false) {
    const cred = await credential();
    const rec = await reconcileRun(cred, finalised.jobId || cursor.ingestJobId, cursor.mode);
    if (!rec.ok) {
      reconcileNote =
        "The bookings were saved, but Drive247 could not check them against the previous sync yet. " +
        "Nothing was released. (" + rec.detail + ")";
    }
  }

  const finished = R.advanceCursor(cursor, {
    reconcileNote: reconcileNote,
    phase: "done", pending: null, finishedAt: new Date().toISOString(),
    finalOutcome: outcome, coverage: coverage, ingestJobId: null, gates: {
      mayWrite: run.mayWrite, mayRelease: run.mayRelease, reason: run.gateReason
    },
    absences: absences
  });
  /* "LAST SUCCESSFUL SYNC" — the single date the popup shows a tenant, and the
     only claim in this UI that a person will act on without reading anything
     else. It is therefore written ONLY when Drive247 actually accepted the
     writes: a run the server refused (write_safe false), a parked run, and an
     abandoned run all leave the previous date standing rather than moving it
     forward on a sync that saved nothing. A stale-but-true date is recoverable;
     a fresh-but-false one means a tenant stops checking. */
  if (run.mayWrite && cursor.mode !== "fixture") {
    await set(K.lastSync, {
      at: new Date().toISOString(),
      records: (summary && summary.ids && summary.ids.length) || 0,
      complete: !!(coverage && coverage.complete)
    });
  }

  await set(K.cursor, finished);
  await set(K.pending, null);
  await clearAlarm();
  await writeState(projectState(finished, summary, null));
  return { stop: true, waitMs: 0 };
}

/**
 * A run that accepted zero records. Which of the several very different reasons
 * it was is the whole question, and it is answered by the session probe, never
 * by the emptiness itself.
 */
function emptyRunOutcome(cursor, R) {
  const worst = R.worstOutcome(cursor.outcomes.length ? cursor.outcomes : ["EMPTY_UNCONFIRMED"]);
  if (worst !== R.OUTCOME.OK && worst !== R.OUTCOME.EMPTY_UNCONFIRMED) return worst;
  // The ONLY promotion of "empty" to "confirmed empty", and it needs a second,
  // independent endpoint to have said the session is healthy.
  if (cursor.session && cursor.session.liveSession) return R.OUTCOME.NO_TRIPS_CONFIRMED;
  return R.OUTCOME.EMPTY_UNCONFIRMED;
}

/**
 * @param {string} [label] Overrides the popup's headline for this park.
 *   The outcome vocabulary is the READER's — it describes what Turo did — and
 *   `NOT_LOGGED_IN` therefore renders as "Not signed in to Turo". That is right
 *   almost always and wrong in exactly one case: a Drive247 session that ended
 *   mid-run. The server-side reason (`not_signed_in`) is true either way, so
 *   the outcome stays; only the sentence a human reads is corrected.
 */
async function parkRun(cursor, outcome, advice, detail, label) {
  const R = reader();
  let parked = R.advanceCursor(cursor, {
    phase: "parked", parkedReason: outcome, parkedLabel: label || null,
    lastError: detail ? advice + " (" + detail + ")" : advice,
    outcomes: cursor.outcomes.concat([outcome === "INGEST_FAILED" ? "UNREACHABLE" : outcome])
  });

  /* A park that will NOT retry itself is, from Drive247's point of view, the end
     of the run — so say so, rather than leaving a turo_sync_jobs row 'running'
     until the reaper calls it heartbeat_lost. A bot challenge or a dead session
     is exactly the thing an operator needs to see in the sync history, and it
     is exactly what never reached the server before.

     Skipped for INGEST_FAILED: Drive247 is the thing that just refused us, so
     another POST is not going to arrive either. */
  /* Deliberately NOT conditional on our already holding a run id. The failure
     that matters most — a bot challenge or a signed-out session on the very
     first page — happens BEFORE any record is flushed, so there is no run yet.
     Requiring one meant the single most important thing an operator needs to be
     told was the one thing that never reached Drive247. The ingest opens the
     turo_sync_jobs row for us and finalises it as failed in the same call. */
  if (!AUTO_RESUMABLE.has(outcome) && outcome !== "INGEST_FAILED") {
    await finaliseIngestRun(parked, await get(K.summary), outcome, null, false);
    // The id is spent: the ingest finalises a not-write-safe run as failed, and
    // a resume that reused it would 409 against a closed run forever.
    parked = R.advanceCursor(parked, { ingestJobId: null });
  }
  await set(K.cursor, parked);
  // A challenge or a dead session cannot fix itself, so no unattended retry.
  if (AUTO_RESUMABLE.has(outcome)) await ensureAlarm();
  else await clearAlarm();
  await writeState(projectState(parked, await get(K.summary), advice));
}

async function abandonRun(cursor, message) {
  const R = reader();
  const dead = R.advanceCursor(cursor, {
    phase: "done", finishedAt: new Date().toISOString(),
    parkedReason: "ABANDONED", finalOutcome: "UNKNOWN", lastError: message,
    gates: { mayWrite: false, mayRelease: false, reason: message }
  });
  await set(K.cursor, dead);
  await set(K.pending, null);
  await clearAlarm();
  await writeState(projectState(dead, await get(K.summary), message));
}

async function decideResume(cursor) {
  const R = reader();
  const cred = await credential();
  /* ⚠ turoAccountFingerprint is deliberately NULL here, and that is a FIX, not
     an omission. This used to pass `cursor.turoAccountFingerprint`, which made
     resumeDecision()'s Turo-account guard compare the cursor's own stored value
     against itself — a tautology that could never fire, so the documented
     "did the operator switch Turo accounts?" check was dead code.

     There is no fresh observation available at DECIDE time: naming the signed-in
     host costs a request to turo.com, and decideResume() must stay synchronous
     with respect to the network. So the guard is moved to where an observation
     actually exists — stepReverifyAccount(), which every resumed run is now
     forced through by the `reprobe` flag set in pump() before any further page
     is read. Passing null here makes resumeDecision skip a check it cannot
     honestly perform, rather than appearing to perform it. */
  const ctx = {
    tokenFingerprint: cred.ok ? (await R.fingerprint(cred.identity)).slice(0, 16) : null,
    turoAccountFingerprint: null
  };
  const d = R.resumeDecision(cursor, ctx);
  if (d.resume && cursor.parkedReason && !AUTO_RESUMABLE.has(cursor.parkedReason) && !cursor.manualResume) {
    // resumeDecision answers "is this cursor still valid?". It does NOT answer
    // "is it safe to issue another request?", and for a bot challenge the
    // answer to the second question is no until a human has cleared it. Zero
    // further requests is the whole point.
    return { resume: false, restart: false, wait: false, reason: cursor.parkedReason,
      message: cursor.parkedReason === "USER_CANCELLED"
        ? "This sync was stopped. Click Continue to pick it up where it left off."
        : R.policyFor(cursor.parkedReason).advice };
  }
  return d;
}

// ================================================= tab + injection plumbing ==

/**
 * Run a reader function inside a real turo.com tab, or against the bundled
 * fixture in the worker when the run is in sample mode.
 *
 * THE FETCH MUST HAPPEN IN THE TAB. A fetch from the service worker sends
 * Origin: chrome-extension://<id>, Sec-Fetch-Site: cross-site and no Referer —
 * a textbook non-browser-page fingerprint, and it never joins PerimeterX's
 * page-side token refresh. The rationale is documented at content-turo.js:22-38
 * and it is the reason this indirection exists at all.
 */
async function withTab(cursor, fn) {
  if (cursor.mode === "fixture") return await fixtureCall(cursor, fn);
  let tab;
  try {
    tab = await getTuroTab();
  } catch (e) {
    return { __tabError: "Could not open a turo.com tab to read from: " + String((e && e.message) || e) };
  }
  try {
    return await fn(tab.id, cursor.world === "MAIN" ? "MAIN" : "ISOLATED", null);
  } catch (e) {
    return { __tabError: "Could not run the reader in the Turo tab: " + String((e && e.message) || e) };
  }
}

/**
 * Sample mode runs entirely in the worker, against fixture.js — and it runs
 * through the SAME classifier, item extractor, pagination detector and
 * normaliser a live response goes through. It is a substitute NETWORK, not a
 * substitute pipeline. That distinction is what makes it worth having on a
 * machine that will never see a Turo response.
 */
async function fixtureCall(cursor, fn) {
  const F = globalThis.D247_TURO_FIXTURE;
  const B = globalThis.__d247TuroBridge;
  if (!F || !B) return { __tabError: "The bundled sample data did not load in the service worker." };

  // A tiny shim so the fixture path and the tab path call the same names.
  const shim = {
    collectVehicles: async () => {
      const v = F.readVehicles(cursor.scenario);
      return { outcome: v.outcome, message: v.message, httpStatus: v.httpStatus,
        envelopeKeys: v.envelopeKeys, vehicles: v.vehicles, itemCount: v.items.length, turoHostId: v.turoHostId };
    },
    collectPage: async (pageRequest, prevPlan) => {
      const page = F.readPage(pageRequest, prevPlan || null, cursor.scenario);
      const records = [], rejected = [], histogram = {};
      const R = reader();
      if (page.outcome === R.OUTCOME.OK) {
        for (const item of page.items) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            for (const k of Object.keys(item).slice(0, 60)) histogram[k] = (histogram[k] || 0) + 1;
          }
          const n = B.normalizeGuarded(item);
          if (n.record) records.push(n.record); else if (n.rejected) rejected.push(n.rejected);
        }
        if (page.items.length > 0 && records.length === 0) {
          page.outcome = R.OUTCOME.SHAPE_CHANGED;
          page.message = "The sample data produced " + page.items.length + " item(s) and none could be read.";
        }
      }
      return {
        outcome: page.outcome, message: page.message,
        explicitEnd: !page.next && page.plan && page.plan.style !== "unknown",
        pageKey: page.pageKey, world: "fixture",
        httpStatus: page.httpStatus, finalUrl: page.finalUrl, bytes: page.bytes,
        envelopeKeys: page.envelopeKeys, snippet: page.snippet, retryAfterSeconds: page.retryAfterSeconds,
        itemCount: page.items.length, plan: page.plan, next: page.next,
        records: records, rejected: rejected, keyHistogram: histogram
      };
    }
  };
  return await fn(null, null, shim);
}

/**
 * Two executeScript calls, both hitting the same tab AND the same world:
 *   1. `files:` loads the reader, defining the globals
 *   2. `func:` invokes the entrypoint and hands back its resolved value
 *
 * Why two: a `files:` injection's own completion value is a weak contract, and
 * `func` is serialised with Function.prototype.toString and re-evaluated in the
 * target context, so it CANNOT close over anything in this file. Hence the bare
 * arrow with no free variables — pass data via `args`, return only
 * structured-cloneable values.
 *
 * Returning the value through the awaited promise is also what makes the MAIN
 * world viable at all: chrome.* does not exist there, so messaging is not an
 * option. Anyone "fixing" this by adding chrome.runtime.sendMessage inside the
 * page will silently break the MAIN retry.
 */
async function callInTab(tabId, world, method, args, shim) {
  if (shim) return await shim[method].apply(null, args);

  await chrome.scripting.executeScript({
    target: { tabId },
    world,
    files: ["fixture.js", "turo-read-contract.js", "content-turo.js"]
  });

  const frames = await withTimeout(
    chrome.scripting.executeScript({
      target: { tabId },
      world,
      args: [method, args],
      func: (m, a) => globalThis.__d247TuroBridge[m].apply(null, a)
    }),
    INJECT_TIMEOUT_MS,
    "the Turo tab did not answer in time"
  );

  const result = frames && frames[0] && frames[0].result;
  if (!result) throw new Error("the reader returned nothing");
  return result;
}

/**
 * chrome.tabs.query({url}) needs EITHER the "tabs" permission or a matching
 * host permission. We have the host permission, so "tabs" stays off the
 * manifest — it would add a "Read your browsing history" warning to the install
 * prompt for zero functional gain. Removing the turo.com host permission would
 * break tab discovery in a decidedly non-obvious way.
 */
async function getTuroTab() {
  const existing = await chrome.tabs.query({ url: ["https://turo.com/*", "https://*.turo.com/*"] });
  const ready = existing.find((t) => t.status === "complete" && !t.discarded);
  if (ready) return ready;
  if (existing[0]) return await waitForLoad(existing[0].id);

  // active:false — never steal focus in the middle of a demo, or in the middle
  // of whatever the operator was actually doing.
  const created = await chrome.tabs.create({ url: TURO_TAB_URL, active: false });
  return await waitForLoad(created.id);
}

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    // Registered mid-run on purpose: this listener does not need to survive a
    // worker restart, because it lives entirely inside this one awaited call.
    const done = (tab) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve(tab);
    };
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("the turo.com tab took too long to load"));
    }, TAB_LOAD_TIMEOUT_MS);

    function onUpdated(id, info) {
      if (id !== tabId || info.status !== "complete") return;
      chrome.tabs.get(tabId).then(done).catch(() => {});
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId)
      .then((t) => { if (t && t.status === "complete") done(t); })
      .catch((e) => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timer);
        reject(e);
      });
  });
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// ================================================= unchanged-record skipping ==
//
// THE REQUIREMENT: do not send the same record over and over. THE TRAP: a
// booking that stops being SENT looks, to the server, exactly like a booking
// that stopped EXISTING — and turo-bridge-reconcile decides absence by
// `last_seen_job_id !== jobId`. Skipping the record while still reporting the
// id is safe. Skipping the id would walk every steady booking toward a released
// block, which is this system's one unrecoverable failure.
//
// So an unchanged record costs one string on the finalisation call and nothing
// else. It is not silence.

/* Bounded so the finalisation call can never exceed the ingest's own
   MAX_BATCH_RECORDS (500). Past this, records go back to being sent in full —
   slower, and correct. */
const MAX_UNCHANGED_IDS = 400;

/**
 * A digest of everything about a record that we actually transmit.
 *
 * Computed over the WIRE PAYLOAD, not the parsed reservation, so any field that
 * could reach a column is inside the hash by construction. A date shift, a
 * status change, a renamed guest, a re-matched vehicle — each changes the
 * payload and therefore the digest, and the record is sent in full. There is no
 * hand-maintained list of "fields that matter" to fall out of date.
 */
async function recordDigest(record) {
  const R = reader();
  if (!R) return null;
  /* Stable key order. JSON.stringify follows insertion order, and two runs that
     built the same object by different paths would otherwise hash differently
     and defeat the whole mechanism. */
  const stable = JSON.stringify(record, Object.keys(record).sort());
  return await R.fingerprint(stable);
}

// ================================================================= the POST ==

/**
 * POST /functions/v1/turo-bridge-ingest — ONE reservation.
 *
 * TWO CREDENTIAL SHAPES, and the header is chosen by which one we hold.
 *
 *   session — `Authorization: Bearer <supabase access token>`. A real JWT, in
 *     the header it belongs in, exactly as turo-bridge-reconcile has always
 *     accepted from the portal.
 *   token — the pairing token, in the BODY. It is not a JWT, and the gateway
 *     may try to parse the Authorization header as one even with
 *     verify_jwt = false, producing a 401 the function never sees. It cannot go
 *     in a custom header either: supabase/functions/_shared/cors.ts whitelists
 *     exactly `authorization, x-client-info, apikey, content-type,
 *     x-tenant-slug`, so an `x-turo-bridge-token` would fail the OPTIONS
 *     preflight and the function body would never run — the extension would see
 *     a bare network error with nothing in the server logs.
 *
 * Neither shape ever carries a tenant id. The server resolves the tenant from
 * whichever credential arrived, which is the whole security model.
 *
 * Note the deliberate absence of `credentials: "include"`: cors.ts answers
 * Access-Control-Allow-Origin: '*', which browsers reject for credentialed
 * requests. Leave credentials at the default.
 *
 * And the POST happens HERE, in the worker, not in the turo.com tab — a
 * cross-origin fetch from an injected script would be subject to CORS, while
 * the worker is exempt by host permission.
 */
async function postReservation(cred, reservation, meta) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
    if (cred && cred.accessToken) headers.Authorization = `Bearer ${cred.accessToken}`;
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        // The legacy credential, sent only when that is what we hold. Never a
        // tenant id — the server resolves the tenant from the credential, which
        // is the whole security model.
        token: (cred && cred.pairingToken) || undefined,
        // "turo" | "fixture". Stays on the wire, is persisted, and is never
        // merely inferable. It is the single thing preventing sample data from
        // being mistaken downstream for a real reservation.
        source: meta.source,
        reason: meta.reason || null,
        detail: meta.detail || null,
        extension_version: chrome.runtime.getManifest().version,
        diagnostics: meta.diagnostics || null,
        parser_version: "turo-read-contract@" + (reader().__version || "?"),
        /* THE RUN. Without this every POST opened, finalised and closed its own
           turo_sync_jobs row: an 11-trip sync produced 11 separate 'manual_single'
           runs, each claiming success, and the portal's sync history read as
           eleven complete syncs of one trip each. `job.job_id` (null on the first
           POST, the server's id thereafter) is what makes it ONE run. */
        job: meta.job || undefined,
        /* PRESENCE WITHOUT PAYLOAD. Ids the extension read this run and found
           unchanged. The server may move last_seen_job_id for them and nothing
           else — see the note on `seen_reservation_ids` in
           supabase/functions/turo-bridge-ingest/index.ts. */
        seen_reservation_ids:
          meta.seenReservationIds && meta.seenReservationIds.length ? meta.seenReservationIds : undefined,
        /* Batch shape. `reservations: []` is a legal finalisation call — it
           advances and closes the run without writing a reservation row. */
        reservation: reservation || undefined,
        reservations: reservation ? undefined : (meta.reservations || [])
      })
    });

    let body = {};
    try { body = await res.json(); } catch (_) {}

    if (!res.ok) {
      let detail = body && body.error
        ? body.error
        : `Drive247 answered HTTP ${res.status}.` +
          (res.status === 404 ? " The turo-bridge-ingest function is not deployed." : "");

      /* A 401 ON THE SESSION PATH IS TWO DIFFERENT PROBLEMS, and only one of
         them is the tenant's. So ask GoTrue rather than assume — see
         sessionStillValid(). 403 is never cleared either way: that means "this
         account may not do this", and signing them out would hide the reason. */
      if (res.status === 401 && cred && cred.kind === "session") {
        const valid = await sessionStillValid(cred.accessToken);
        if (valid === false) {
          // Genuinely expired or revoked. Clearing is the honest response.
          await clearSession();
        } else {
          /* The session is fine (or we could not check). Drive247 refused the
             credential for its own reasons — most likely a deployed ingest that
             predates session auth and still expects a pairing token. Logging
             the tenant out here is what produced "sign in, press Sync, get
             thrown back to the sign-in screen" on a loop. */
          console.error(
            "[TuroBridge] the ingest rejected a VALID Drive247 session with 401. " +
            "turo-bridge-ingest is most likely deployed at a version that predates " +
            "session auth and still requires a pairing token. Server said: " + detail);
          detail =
            "Drive247 would not accept this sign-in, but your account is fine — you have " +
            "not been signed out. The Drive247 server needs updating. Contact Drive247 support.";
        }
      }

      console.error("[TuroBridge] ingest failed:", res.status, detail);
      return { ok: false, detail, status: res.status, jobId: body.job_id || null };
    }

    /* write_safe === false is the server REFUSING the run, not the network
       failing: it answers 200 with `wrote_nothing_because` and finalises the
       job as failed. Surfaced as ok:true + writeSafe:false so the caller can
       tell "Drive247 is down" from "Drive247 read this and did not believe it". */
    /* The batch response reports per-record outcomes in `results[]`; only the
       legacy single-reservation shape carries a top-level `action`. Read both
       so the PoC path and the run path can share this function. */
    const firstResult = Array.isArray(body.results) && body.results.length ? body.results[0] : null;
    return {
      ok: true,
      action: body.action || (firstResult && firstResult.action) || "created",
      rejected: !!(firstResult && firstResult.action === "rejected"),
      rejectedReason: (firstResult && firstResult.reason) || null,
      id: body.id || (firstResult && firstResult.row_id) || null,
      jobId: body.job_id || null,
      writeSafe: body.write_safe !== false,
      wroteNothingBecause: body.wrote_nothing_because || null,
      /* What the SERVER concluded — completeness, is_authoritative and
         observed_complete are GENERATED columns, so this is the only honest
         source for them. We never recompute them here. */
      run: body.run || null
    };
  } catch (e) {
    const aborted = e && e.name === "AbortError";
    return {
      ok: false,
      detail: aborted ? "Drive247 did not respond in time." : `Could not reach Drive247: ${String((e && e.message) || e)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * THE RUN ENVELOPE — `job` on the ingest wire.
 *
 * Everything here is an OBSERVATION. Nothing in it is, or can be, a claim about
 * health: `completeness`, `is_authoritative`, `observed_complete` and
 * `progress_denominator` are GENERATED ALWAYS columns
 * (turo-bridge-poc/sql/03-foundation-schema.sql:208-244) and Postgres refuses a
 * write to them from anyone, service_role included. Authority is DERIVED from
 * these observations, never asserted by us.
 *
 * ⚠ window_start / window_end ARE NOT OPTIONAL. is_authoritative (03:223) is
 *   `... AND window_start IS NOT NULL AND window_end IS NOT NULL`, so a run that
 *   omits them can NEVER become authoritative — and a release can only ever
 *   cite an authoritative run. Omitting them silently disabled the entire
 *   release path. They are what we can VOUCH for having read, derived from the
 *   trips we actually parsed, never from anything the feed declared.
 *
 * ⚠ finalize is ALWAYS sent explicitly. The ingest defaults it to TRUE on the
 *   legacy single-reservation shape (index.ts:717), so leaving it off closed
 *   the run after the first record and made every later POST a 409.
 */
function buildJobEnvelope(cursor, summary, opts) {
  opts = opts || {};
  const rows = (summary && summary.rows) || [];

  // The window we can vouch for: the earliest start and latest end among trips
  // we actually PARSED. Not the requested window, not anything the feed said.
  let from = null, to = null;
  for (const r of rows) {
    if (r.startsAt && (from === null || r.startsAt < from)) from = r.startsAt;
    if (r.endsAt && (to === null || r.endsAt > to)) to = r.endsAt;
    // A trip that starts inside the window but ends outside it still widens
    // what we read; so does a start later than every end.
    if (r.startsAt && (to === null || r.startsAt > to)) to = r.startsAt;
    if (r.endsAt && (from === null || r.endsAt < from)) from = r.endsAt;
  }

  // Every Turo vehicle this run laid eyes on. A vehicle that never appeared
  // cannot have its trips released by this job — silence about a car is not a
  // statement about that car (03 §7, rule 3).
  const vehicles = {};
  for (const v of (summary && summary.vehicles) || []) {
    const id = typeof v === "string" ? v : (v && (v.turoVehicleId || v.id));
    if (id) vehicles[String(id)] = true;
  }
  for (const r of rows) if (r.turoVehicleId) vehicles[String(r.turoVehicleId)] = true;

  const env = {
    job_id: cursor.ingestJobId || null,
    kind: "trips",
    // Explicit on EVERY call. See the warning above.
    finalize: opts.finalize === true,
    parser_version: "turo-read-contract@" + (reader().__version || "?"),

    pages_fetched: cursor.pagesRead || 0,
    records_seen: cursor.recordsAccepted || 0,
    raw_item_count: cursor.recordsOffered || 0,
    // A record we could not understand is a PARSE FAILURE, and it costs the run
    // its authority. That is correct: we do not know what we did not read.
    parse_failure_count: cursor.recordsRejected || 0,
    http_error_count: cursor.httpErrors || 0,
    feed_reported_total: cursor.feedReportedTotal,

    window_start: from,
    window_end: to,
    observed_turo_vehicle_ids: Object.keys(vehicles),

    // Inert until the extension can see a real Turo host identity — the field
    // to hash is unconfirmed, and a guessed fingerprint is worse than none
    // because the §7 pin would then lock a tenant to a value that means nothing.
    turo_account_fingerprint: cursor.turoAccountFingerprint || null
  };

  if (opts.finalize) {
    env.reader_outcome = opts.outcome || "UNKNOWN";
    env.degraded_reason = degradedReasonFor(opts.outcome, cursor);
    // saw_end_of_feed is a POSITIVE claim and only `explicitEnd` earns it: a
    // walk that merely could not build a next request has not been told it
    // ended. Anything short of that leaves the run non-authoritative, which is
    // the direction that cannot release a block.
    env.saw_end_of_feed = !!(opts.coverage && opts.coverage.complete) && !!cursor.explicitEnd;
    // The client may only ever make the server's verdict STRICTER
    // (index.ts:resolveWriteSafety). Never more permissive.
    env.write_safe = opts.mayWrite !== false;
    env.pages = (cursor.receipts || []).slice(0, 100).map((r, i) => ({
      seq: typeof r.index === "number" ? r.index : i,
      // PATH ONLY. A session-bearing query string must never be persisted.
      url_path: String(reader().TRIPS_PATH || "").split("?")[0],
      record_count: r.recordCount,
      requested_at: r.committedAt,
      observed_keys: Object.keys((summary && summary.keyHistogram) || {}).slice(0, 200)
    }));
  }
  return env;
}

/**
 * Map our read outcome onto turo_sync_jobs.degraded_reason, whose CHECK list is
 * CLOSED (03:145-154). Returning null claims the run was clean, so only the two
 * genuinely clean outcomes get it.
 */
function degradedReasonFor(outcome, cursor) {
  switch (outcome) {
    case "OK":
    case "NO_TRIPS_CONFIRMED":
      return cursor && cursor.pageFailed ? "http_error" : null;
    case "TRUNCATED":          return "page_cap_reached";
    case "PAGINATION_STALLED": return "unknown";
    case "RATE_LIMITED":       return "http_error";
    case "UNREACHABLE":        return "http_error";
    case "BOT_BLOCKED":        return "waf_challenge";
    case "EMPTY_UNCONFIRMED":  return "waf_empty_200";
    case "NOT_LOGGED_IN":      return "not_signed_in";
    case "SHAPE_CHANGED":
    case "UNPARSEABLE":        return "shape_unrecognised";
    // A failure we cannot name is still a failure, and 'unknown' is not
    // authoritative either.
    default:                   return "unknown";
  }
}

/**
 * Close the server-side run. Sent with ZERO reservations: it advances and
 * finalises the turo_sync_jobs row and writes nothing else.
 *
 * This is also the ONLY way a degraded read ever reaches Drive247. Before it
 * existed, a bot challenge or an expired session parked the run locally and the
 * server heard nothing at all — so the ingest's degraded-run gate, the whole
 * point of which is that an operator who is told nothing learns nothing, could
 * never fire.
 */
async function finaliseIngestRun(cursor, summary, outcome, coverage, mayWrite) {
  const cred = await credential();
  if (!cred.ok) return { ok: false, detail: cred.reason };
  const res = await postReservation(cred, null, {
    source: cursor.mode === "fixture" ? "fixture" : "turo",
    reason: outcome,
    detail: null,
    reservations: [],
    /* The ids we read and did not re-send. They travel on the FINALISATION
       call, which is the last thing to happen before reconcile is asked to
       conclude anything — so either the whole run lands, ids included, or the
       run never finalises and reconcile is never called at all. An interrupted
       sync therefore cannot leave a live booking looking absent. */
    seenReservationIds: cursor.unchangedIds || [],
    job: buildJobEnvelope(cursor, summary, {
      finalize: true, outcome: outcome, coverage: coverage, mayWrite: mayWrite
    }),
    diagnostics: { runId: cursor.runId, world: cursor.world, mode: cursor.mode }
  });
  if (!res.ok) console.error("[TuroBridge] could not finalise the run:", res.detail);
  return res;
}

/**
 * Ask Drive247 to reconcile the run we just closed.
 *
 * ⚠ THIS IS THE STEP THAT WAS MISSING ENTIRELY. Ingest records what the feed
 *   SAID; turo-bridge-reconcile is the only thing that draws a conclusion from
 *   it. Without this call rows land and never leave presence_state OBSERVED:
 *   nothing is ever marked MISSING, no cancellation candidate is ever raised,
 *   and the portal's cancellation queue is permanently and misleadingly empty.
 *
 * Calling it unconditionally is safe by construction, and deliberately so:
 *   - a NON-QUALIFYING run writes nothing at all — not one presence transition,
 *     not one conflict, not one block;
 *   - qualification is READ from a GENERATED column, so neither this client nor
 *     service_role can assert it;
 *   - corroborated absence (E3) raises a REVIEW ITEM saying the car is still
 *     blocked; it never releases;
 *   - the only release that does not need a signed-in human is a status we
 *     positively READ as cancelled.
 * So the worst thing a spurious call here can do is nothing.
 *
 * Failure is non-fatal and never rewrites the run: the reservations already
 * landed, which is the valuable half. An unreconciled run means a stale block,
 * which ages out; a wrongly reconciled one means a double-sold car.
 */
async function reconcileRun(cred, jobId, mode) {
  if (!jobId) return { ok: false, detail: "No run id to reconcile." };
  if (!cred || !cred.ok) return { ok: false, detail: (cred && cred.reason) || "Not signed in." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
    if (cred.accessToken) headers.Authorization = `Bearer ${cred.accessToken}`;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/turo-bridge-reconcile`, {
      method: "POST",
      headers,
      signal: controller.signal,
      /* turo-bridge-reconcile already accepted both credentials (index.ts:258 —
         a pairing token in the body, or a portal JWT in the header) and 403s
         when the two name different tenants, so this needed no server change.
         The `reconcile` action makes no operator decision, which is why it is
         reachable with either. */
      body: JSON.stringify({
        token: cred.pairingToken || undefined,
        action: "reconcile", job_id: jobId, dry_run: mode === "fixture"
      })
    });
    let body = {};
    try { body = await res.json(); } catch (_) {}
    if (!res.ok) {
      const detail = (body && body.error) ||
        `Drive247 answered HTTP ${res.status}.` +
        (res.status === 404 ? " The turo-bridge-reconcile function is not deployed." : "");
      console.warn("[TuroBridge] reconcile skipped:", res.status, detail);
      return { ok: false, detail };
    }
    return { ok: true, report: body };
  } catch (e) {
    return { ok: false, detail: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A normalised TuroReservation -> the wire shape turo-bridge-ingest reads.
 *
 * TWO FIELDS ARE SENT THAT THE SERVER CURRENTLY DROPS, and they are sent
 * anyway: `vehicle_plate` and `turo_status`. The ingest's column map
 * (index.ts:240-256) has no entry for either and the table has no such columns,
 * so today they survive only inside `raw`. That is precisely why the `__d247`
 * block below duplicates them there — the plate is the ONLY safe vehicle join
 * key (vehicles.reg is unique 461/461; vehicles.vin is not, 326 distinct across
 * 400), and Turo's own trip status is what tells a reconciler that a trip was
 * cancelled. Losing either in transit would be silent and expensive. When the
 * columns are added, the top-level fields start landing with no extension
 * change at all.
 *
 * NOTHING IS INVENTED HERE. Every value either came from the feed or is null,
 * and `unknowns` names every field we could not read.
 */
function toWire(record, cursor) {
  const v = record.vehicle || {};
  const meta = {
    schema: 1,
    run_id: cursor.runId,
    mode: cursor.mode,
    parser: "turo-read-contract@" + (reader().__version || "?"),
    lifecycle: record.lifecycle,
    hold_until: record.holdUntil,
    timezone: record.timezone,
    supersedes_reservation_id: record.supersedesReservationId,
    confidence: record.confidence,
    requires_review: record.requiresReview,
    vehicle: {
      turo_vehicle_id: v.turoVehicleId || null,
      plate_normalised: v.plateNormalised || null,
      plate_raw: v.plateRaw || null,
      vin_hint: v.vinHint || null,          // A HINT. Never a join key.
      label: v.label || null,
      evidence: v.evidence,
      confidence: v.confidence,
      requires_review: v.requiresReview,
      rejected_vehicle_id: v.__rejectedVehicleId || null,
      rejected_vehicle_id_reason: v.__rejectedVehicleIdReason || null
    },
    // The two things that make being wrong survivable: what we could not read,
    // and everything no extractor claimed.
    unknowns: (record.unknowns || []).map((u) => ({
      field: u.field, reason: u.reason, sample: u.sample === null || u.sample === undefined ? null : String(u.sample).slice(0, 200)
    })),
    unmapped: record.rawOverflow || {},
    field_evidence: record.evidence || {}
  };

  let raw = Object.assign({}, record.raw || {}, { __d247: meta });
  if (JSON.stringify(raw).length > INGEST_MAX_RAW_BYTES) {
    // Trim the FEED payload, never the metadata: the metadata is the part that
    // says what we did and did not understand, and it is small.
    raw = {
      __d247: meta,
      __d247_raw_trimmed: true,
      __d247_raw_keys: Object.keys(record.raw || {}).slice(0, 60)
    };
  }

  return {
    reservation_id: record.reservationId,
    source: cursor.mode === "fixture" ? "fixture" : "turo",
    guest_name: record.guestName || null,
    vehicle_label: v.label || null,
    vehicle_plate: v.plateRaw || null,   // TIER 1 of the vehicle ladder
    starts_at: record.startsAt,
    ends_at: record.endsAt,
    status: "synced",                     // OUR import lane, not Turo's trip state
    turo_status: record.turoStatusRaw || null,  // TURO'S word, kept separate
    total_amount: record.totalAmount,
    currency: record.currency,

    /* ⚠ THESE FOUR MUST BE AT THE TOP LEVEL OR THEY ARE LOST.
       turo-bridge-ingest's pick() (index.ts:347) reads the TOP LEVEL of this
       object only — it never descends into `raw`. Sending them solely inside
       raw.__d247 left four real columns permanently NULL, and each one is
       load-bearing:
         turo_vehicle_id  — the identity the vehicle-mapping queue groups on,
                            and the value the release gate in 03 §7 checks
                            against turo_sync_jobs.observed_turo_vehicle_ids.
                            Without it NO trip can ever be released.
         turo_guest_id    — the only non-name guest identity; a display name
                            alone scores 0.25 in succession, deliberately.
         timezone         — reported, never assumed. blocked_dates is DATE-only
                            with an inclusive end, so a wrong zone IS the
                            same-day-turnaround double-booking.
         supersedes_...   — a trip that MOVED, not a trip that vanished. The
                            ingest stamps it on the PREDECESSOR (index.ts:1007).
       All four are still mirrored inside `raw.__d247` as well; a duplicate
       costs bytes, a silent NULL costs a car. */
    turo_vehicle_id: v.turoVehicleId || null,
    turo_guest_id: record.guestId || null,
    timezone: record.timezone || null,
    supersedes_reservation_id: record.supersedesReservationId || null,

    raw
  };
}

/**
 * Make one page's worth of records fit in chrome.storage.local WITHOUT losing
 * any of them.
 *
 * The order of sacrifice is deliberate: the feed's own verbose payload goes
 * first, largest record first, and `__d247` — which carries the plate, the
 * unknowns, the vehicle evidence and the overflow keys — is kept intact to the
 * very end. That metadata is the part that makes being wrong survivable; the
 * echo of Turo's own JSON is a diagnostic nicety.
 *
 * Mutates `blob` in place. Returns {ok:false} only when even the fully-slimmed
 * page will not fit, which the caller must treat as a failure and never as a
 * reason to store a subset.
 */
function fitToStorage(blob) {
  let size = JSON.stringify(blob).length;
  if (size <= PAGE_STORAGE_BUDGET_BYTES) return { ok: true, trimmed: 0 };

  const bySize = blob.records
    .map((r, i) => ({ i, n: JSON.stringify(r).length }))
    .sort((a, b) => b.n - a.n);

  let trimmed = 0;
  for (const { i } of bySize) {
    const rec = blob.records[i];
    if (!rec.raw || rec.raw.__d247_raw_trimmed) continue;
    rec.raw = {
      __d247: rec.raw.__d247,
      __d247_raw_trimmed: true,
      __d247_raw_keys: Object.keys(rec.raw).filter((k) => k !== "__d247").slice(0, 60)
    };
    trimmed++;
    size = JSON.stringify(blob).length;
    if (size <= PAGE_STORAGE_BUDGET_BYTES) return { ok: true, trimmed };
  }

  return {
    ok: false, trimmed,
    detail: `a single batch of ${blob.records.length} trips needs ${Math.round(size / 1024)}KB, over the ${Math.round(PAGE_STORAGE_BUDGET_BYTES / 1024)}KB this extension will hold`
  };
}

// ============================================================ the view model ==

/**
 * The popup renders THIS and nothing else. It is written on every step, so a
 * popup opened after the fact, or reopened halfway through, always shows the
 * truth rather than a half-finished animation.
 *
 * THE ONE RULE THIS FUNCTION ENFORCES: a denominator is only ever populated
 * when the walk is DEMONSTRABLY COMPLETE. `progressTotal` is null until then,
 * and the popup renders nothing where a "of N" would go. A progress bar whose
 * denominator comes from the same degraded response as its numerator reads 8/8
 * green on a truncated read, which is the most confidently wrong thing this UI
 * could do. `declaredTotal` is carried for diagnostics and is never that
 * denominator.
 */
function projectState(cursor, summary, note) {
  const R = reader();
  const s = summary || { ids: [], rows: [], rejected: [], keyHistogram: {}, unknownCounts: {}, envelopeKeys: [], vehicles: [] };
  const done = cursor.phase === "done";
  const parked = cursor.phase === "parked";
  const coverage = cursor.coverage || null;
  const gates = cursor.gates || null;

  const outcome = cursor.finalOutcome || cursor.parkedReason || (done ? "OK" : null);
  const policy = outcome && R ? R.policyFor(outcome === "INGEST_FAILED" ? "UNREACHABLE" : outcome) : null;

  const unknownFields = Object.keys(s.unknownCounts).map((f) => ({
    field: f, count: s.unknownCounts[f].count,
    reason: s.unknownCounts[f].reason, sample: s.unknownCounts[f].sample
  })).sort((a, b) => b.count - a.count);

  let review = 0, cancelled = 0, needVehicle = 0;
  for (const row of s.rows) {
    if (row.review) review++;
    if (row.lifecycle === "cancelled") cancelled++;
    if (row.vehicleEvidence === "unbound" || row.vehicleEvidence === "label_fuzzy") needVehicle++;
  }

  return {
    version: 1,
    runId: cursor.runId,
    mode: cursor.mode,
    scenario: cursor.scenario || null,
    phase: done ? "done" : parked ? "parked" : "running",
    stepLabel: stepLabel(cursor),
    note: note || null,
    startedAt: cursor.startedAt,
    updatedAt: new Date().toISOString(),

    /* BATCH COUNTING, HONESTLY.
       `batchesDone` is a fact — we read that many pages. `batchesTotal` is a
       CLAIM, and we only make it once the walk proved it ended. Until then the
       popup shows "Batch 3" with no denominator, which is the true statement. */
    batchesDone: cursor.pagesRead,
    batchesTotal: coverage && coverage.complete ? cursor.pagesRead : null,
    currentBatch: cursor.pending ? cursor.pending.index + 1 : cursor.pagesRead,

    counts: {
      offered: cursor.recordsOffered,
      accepted: cursor.recordsAccepted,
      rejected: cursor.recordsRejected,
      flushed: cursor.recordsFlushed,
      review: review,
      needVehicle: needVehicle,
      cancelled: cancelled,
      vehicles: (s.vehicles || []).length
    },
    // Only ever populated on a complete walk. See the block comment above.
    progressTotal: coverage && coverage.complete ? cursor.recordsAccepted : null,
    declaredTotal: (cursor.pagination && cursor.pagination.declaredTotal) || null,

    coverage: coverage ? { complete: coverage.complete, evidence: coverage.evidence, display: coverage.display } : null,
    session: cursor.session ? { liveSession: cursor.session.liveSession, evidence: cursor.session.evidence } : null,
    gates: gates,
    pagination: cursor.pagination ? { style: cursor.pagination.style, confidence: cursor.pagination.confidence, matchedKeys: cursor.pagination.matchedKeys } : null,

    outcome: outcome,
    /* The park's own headline, when it set one. Null everywhere else, so the
       popup falls back to the reader's vocabulary. */
    label: cursor.parkedLabel || null,
    /* A labelled park has already said the useful thing in `lastError`; the
       reader's policy advice would be about Turo, which is not what went wrong. */
    advice: cursor.parkedLabel ? (cursor.lastError || null) : (policy ? policy.advice : null),
    lastError: cursor.lastError || null,
    /* Said out loud rather than swallowed: the trips landed but Drive247 has not
       yet compared them against the previous sync, so nothing has been released
       and nothing has been marked missing. Silence here would read as "all
       done". */
    reconcileNote: cursor.reconcileNote || null,
    ingestFailures: cursor.ingestFailures || 0,
    canResume: parked,
    autoResumes: parked ? AUTO_RESUMABLE.has(cursor.parkedReason) : false,
    nextAllowedAt: cursor.nextAllowedAt || null,

    rows: s.rows.slice(-40),
    unknownFields: unknownFields,
    rejected: s.rejected.slice(0, 12),
    absences: cursor.absences || [],
    envelopeKeys: s.envelopeKeys,
    keyHistogram: s.keyHistogram
  };
}

function stepLabel(cursor) {
  if (cursor.phase === "probing_session") return "Checking your Turo session…";
  if (cursor.phase === "reading_trips") return "Reading batch " + ((cursor.pending ? cursor.pending.index : cursor.pagesRead) + 1) + "…";
  if (cursor.phase === "flushing") return "Saving batch " + cursor.pagesRead + " to Drive247…";
  if (cursor.phase === "parked") return "Paused";
  if (cursor.phase === "done") return "Finished";
  return "Working…";
}

function errorState(message) {
  return {
    version: 1, runId: null, mode: null, phase: "parked", stepLabel: "Cannot start",
    startedAt: null, updatedAt: new Date().toISOString(),
    batchesDone: 0, batchesTotal: null, currentBatch: 0,
    counts: { offered: 0, accepted: 0, rejected: 0, flushed: 0, review: 0, needVehicle: 0, cancelled: 0, vehicles: 0 },
    progressTotal: null, declaredTotal: null,
    coverage: null, session: null, gates: null, pagination: null,
    outcome: "UNKNOWN", label: null, advice: message, lastError: message, ingestFailures: 0,
    canResume: false, autoResumes: false, nextAllowedAt: null,
    rows: [], unknownFields: [], rejected: [], absences: [], envelopeKeys: [], keyHistogram: {}
  };
}

function lightRow(wire, action) {
  const meta = (wire.raw && wire.raw.__d247) || {};
  const veh = meta.vehicle || {};
  return {
    id: wire.reservation_id,
    guest: wire.guest_name,
    vehicle: wire.vehicle_label || veh.plate_raw || null,
    vehicleEvidence: veh.evidence || "unbound",
    plate: veh.plate_normalised || null,
    /* Carried so buildJobEnvelope can report observed_turo_vehicle_ids. A trip
       we positively read IS an observation of its vehicle, and without that the
       release gate in 03 §7 (rule 3) can never be satisfied on a feed that does
       not separately enumerate vehicles. */
    turoVehicleId: veh.turo_vehicle_id || null,
    startsAt: wire.starts_at,
    endsAt: wire.ends_at,
    lifecycle: meta.lifecycle || "unknown",
    holdUntil: meta.hold_until || null,
    supersedes: meta.supersedes_reservation_id || null,
    review: !!meta.requires_review,
    unknowns: (meta.unknowns || []).map((u) => u.field),
    action: action || "created"
  };
}

function lightRejection(rej) {
  return {
    reason: rej.reason,
    fields: (rej.unknowns || []).map((u) => u.field),
    keys: (rej.observedKeys || []).slice(0, 20)
  };
}

function lightVehicle(v) {
  return {
    turoVehicleId: v.turoVehicleId || null,
    plate: v.plateNormalised || null,
    vin: v.vinHint || null,
    label: v.label || null,
    evidence: v.evidence,
    requiresReview: v.requiresReview
  };
}

// ==================================================== storage + alarm helpers ==

function reader() { return globalThis.__d247TuroRead || null; }

async function get(key) {
  const bag = await chrome.storage.local.get(key);
  return bag[key];
}
async function set(key, value) {
  const patch = {};
  patch[key] = value;
  await chrome.storage.local.set(patch);
}

async function writeState(state) {
  await set(K.state, state);
  return state;
}

/**
 * The SINGLE writer of the PoC single-click state. Persist to storage first;
 * the popup renders storage on open and follows storage.onChanged, so a sync
 * that finishes after the popup was closed is still correct and still visible
 * when it is reopened. We deliberately never sendMessage the popup — a closed
 * popup rejects with "Receiving end does not exist", usually as an unhandled
 * rejection.
 */
async function setStatus(status) {
  const lastRun = Object.assign({ at: Date.now() }, status);
  await set(K.lastRun, lastRun);
  return lastRun;
}

/* Alarms may be absent if the permission was stripped from the manifest. The
   run still works while the worker happens to stay alive; it just cannot revive
   itself. Degrade, and say so in the log rather than throwing. */
function alarmsAvailable() {
  return typeof chrome !== "undefined" && chrome.alarms && typeof chrome.alarms.create === "function";
}

async function ensureAlarm() {
  if (!alarmsAvailable()) {
    console.warn('[TuroBridge] the "alarms" permission is missing; a sync interrupted by the worker being killed will need a manual Continue.');
    return;
  }
  const existing = await chrome.alarms.get(PUMP_ALARM);
  if (!existing) {
    chrome.alarms.create(PUMP_ALARM, { periodInMinutes: PUMP_ALARM_MINUTES, delayInMinutes: PUMP_ALARM_MINUTES });
  }
}

async function clearAlarm() {
  if (!alarmsAvailable()) return;
  try { await chrome.alarms.clear(PUMP_ALARM); } catch (_) {}
}

/**
 * Wait, and be ready to be killed while waiting.
 *
 * setTimeout is the FAST path and works only while the worker is alive; the
 * alarm is the BACKSTOP that revives it if it is not. Chrome clamps alarms to
 * roughly a 30-second floor, which is far too coarse for the ~1.2s pacing
 * between pages — hence both.
 */
async function scheduleWake(ms) {
  await ensureAlarm();
  if (ms <= 25000) {
    setTimeout(() => { pump("timer").catch(() => {}); }, ms);
  }
}
