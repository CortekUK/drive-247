/**
 * background.js — the MV3 service worker. It orchestrates one click:
 *
 *     read a Turo tab  ->  normalise ONE reservation  ->  POST to Drive247
 *
 * MV3 LIFECYCLE STANCE (the reason this file looks the way it does)
 * ----------------------------------------------------------------
 * The worker can be killed at ANY moment, including between the POST landing
 * and the status write. So:
 *   - zero durable state lives in worker globals; everything the popup needs is
 *     written to chrome.storage.local
 *   - one click is one short, awaited round trip — no alarms, no long-lived
 *     ports, no queues
 *   - the backend upserts on (tenant_id, reservation_id), so re-clicking after
 *     a worker death re-posts the SAME reservation and produces one row, not two
 *   - setStatus() is the single writer of user-visible state. It persists first
 *     and never messages the popup, because a closed popup rejects
 *     sendMessage with "Receiving end does not exist"
 *
 * DEBUGGING: worker logs do NOT appear in the page's DevTools. Open them from
 * the "service worker" link on the extension's chrome://extensions card.
 */

"use strict";

/* Classic (non-module) worker on purpose: importScripts() does not exist in a
   module worker, and we need it to load the SAME normaliser the page uses.
   One normaliser, never two.
   GUARDED: a throwing top-level importScripts aborts worker REGISTRATION, and
   the extension then looks completely dead with only a red "Errors" button on
   the chrome://extensions card to explain it. */
try {
  importScripts("fixture.js", "content-turo.js");
} catch (e) {
  console.error("[TuroBridge] fixture.js / content-turo.js failed to load in the worker:", e);
}

// ---------------------------------------------------------------- constants

const SUPABASE_URL = "https://hviqoaokxvlancmftwuo.supabase.co";

/* The PUBLIC anon key. It is already shipped to every browser that loads the
   portal (apps/portal/src/integrations/supabase/client.ts), so embedding it
   here leaks nothing new. It is NOT what authorises this call — the pairing
   token in the body is. turo-bridge-ingest runs with verify_jwt = false and
   resolves the tenant from the token's sha256 hash, so the extension can never
   name a tenant and a copied key alone buys nothing. */
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q";

/* The function DIRECTORY is supabase/functions/turo-bridge-ingest/. If you ever
   see a 404 here, that name is the first thing to check — an earlier scaffold
   in this repo pointed at "turo-bridge-import", which does not exist. */
const INGEST_URL = `${SUPABASE_URL}/functions/v1/turo-bridge-ingest`;

const TURO_TAB_URL = "https://turo.com/us/en/trips/booked";
const TAB_LOAD_TIMEOUT_MS = 20000;
const POST_TIMEOUT_MS = 15000;

/* Retry the identical read in the MAIN world only for outcomes where a header
   minted by the page's own JS could plausibly be the difference. A 401, an
   explicitly empty feed, a timeout or a 429 will answer the same in either
   world, so retrying those just doubles the traffic. */
const RETRY_IN_MAIN = new Set(["BOT_BLOCKED", "UNKNOWN", "UNPARSEABLE"]);

/* One message per outcome: what happened, AND what to do about it. */
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

/* Resets to false if the worker is killed, which is exactly right: a dead
   worker has no in-flight request to guard against. */
let inFlight = false;

// ------------------------------------------------------------------ wiring

// Registered at the top level so it survives every worker revival.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "SYNC_ONE") return false;
  syncOne()
    .then((r) => { try { sendResponse(r); } catch (_) {} })
    .catch((e) => { try { sendResponse({ phase: "error", title: String((e && e.message) || e) }); } catch (_) {} });
  return true; // keep the channel open; best effort only — storage is the truth
});

// ------------------------------------------------------------ the one click

async function syncOne() {
  if (inFlight) return await setStatus({ phase: "running", title: "Already syncing…" });
  inFlight = true;
  try {
    const { pairingToken } = await chrome.storage.local.get("pairingToken");
    const token = (pairingToken || "").trim();
    if (!token) {
      return await setStatus({
        phase: "error",
        title: "No pairing token",
        detail: "Paste the pairing token from your Drive247 portal, then click Sync."
      });
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

    const response = await postReservation(token, read);

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
    return await setStatus({
      phase: "error",
      title: "Sync failed",
      detail: String((e && e.message) || e)
    });
  } finally {
    inFlight = false;
  }
}

// ------------------------------------------------------------- reading Turo

/**
 * Runs the reader inside a real turo.com tab. Tries the ISOLATED world first
 * (same-origin, page cookies, no page-visible footprint) and retries the exact
 * same code in the MAIN world only when the failure is one that a page-minted
 * header could explain. See the header comment in content-turo.js.
 *
 * @returns {Promise<{ok:boolean, source:"turo"|"fixture"|null, reason:string,
 *                    detail:string|null, reservation:object|null, diagnostics:object}>}
 */
async function readOneReservation() {
  let tab;
  try {
    tab = await getTuroTab();
  } catch (e) {
    // We never even got a tab. Fall back in the worker, using the same
    // normaliser, so the demo still completes end to end.
    return fixtureFromWorker("no_tab", String((e && e.message) || e));
  }

  let first;
  try {
    first = await runReaderInWorld(tab.id, "ISOLATED");
  } catch (e) {
    return fixtureFromWorker("UNREACHABLE", `Injection failed: ${String((e && e.message) || e)}`);
  }

  if (first.ok && first.source === "turo") return first;

  if (first.source === "fixture" && RETRY_IN_MAIN.has(first.reason)) {
    console.log(`[TuroBridge] ISOLATED read returned ${first.reason}; retrying in MAIN world.`);
    try {
      const second = await runReaderInWorld(tab.id, "MAIN");
      if (second.ok && second.source === "turo") return second;
      // MAIN did no better. Keep the ISOLATED verdict — it is the cleaner
      // signal — but record that we tried both.
      first.diagnostics = Object.assign({}, first.diagnostics, {
        retriedInMain: true,
        mainReason: second.reason
      });
    } catch (e) {
      first.diagnostics = Object.assign({}, first.diagnostics, {
        retriedInMain: true,
        mainError: String((e && e.message) || e)
      });
    }
  }

  return first;
}

/**
 * Two executeScript calls, both hitting the same tab AND the same world:
 *   1. `files:` loads fixture.js + content-turo.js, defining the globals
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
async function runReaderInWorld(tabId, world) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world,
    files: ["fixture.js", "content-turo.js"]
  });

  const frames = await chrome.scripting.executeScript({
    target: { tabId },
    world,
    func: () => globalThis.__d247TuroBridge.collectOneReservation()
  });

  const result = frames && frames[0] && frames[0].result;
  if (!result) throw new Error("the reader returned nothing");
  return result;
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
      ok: false,
      source: null,
      reason: "no_fixture",
      detail: `${detail}; content-turo.js did not load in the service worker`,
      reservation: null,
      diagnostics: {}
    };
  }
  const out = bridge.fixtureReservation(reason, detail);
  out.diagnostics = Object.assign({}, out.diagnostics, { loadedIn: "service-worker" });
  return out;
}

// ------------------------------------------------------- finding/opening a tab

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

  // active:false — never steal focus in the middle of a demo.
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

// ------------------------------------------------------------ posting to us

/**
 * POST /functions/v1/turo-bridge-ingest
 *
 * Shape and headers follow the portal's own convention for calling an edge
 * function without a Supabase session: an `apikey` header plus the caller's
 * identity in the BODY.
 *
 * THE TOKEN MUST TRAVEL IN THE BODY. supabase/functions/_shared/cors.ts
 * whitelists exactly `authorization, x-client-info, apikey, content-type,
 * x-tenant-slug`, so a custom header would fail the OPTIONS preflight and the
 * function body would never run — the extension would see a bare network error
 * with nothing in the server logs.
 *
 * Note the deliberate absence of `credentials: "include"`: cors.ts answers
 * Access-Control-Allow-Origin: '*', which browsers reject for credentialed
 * requests. Leave credentials at the default.
 *
 * And the POST happens HERE, in the worker, not in the turo.com tab — a
 * cross-origin fetch from an injected script would be subject to CORS, while
 * the worker is exempt by host permission.
 */
async function postReservation(token, read) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      signal: controller.signal,
      body: JSON.stringify({
        // The credential. Never a tenant id — the server resolves the tenant
        // from this token's hash, which is the whole security model.
        token,
        // "turo" | "fixture". Stays on the wire, is persisted, and is never
        // merely inferable. It is the single thing preventing sample data from
        // being mistaken downstream for a real reservation.
        source: read.source,
        reason: read.reason || null,
        detail: read.detail || null,
        extension_version: chrome.runtime.getManifest().version,
        diagnostics: read.diagnostics || null,
        reservation: read.reservation
      })
    });

    let body = {};
    try { body = await res.json(); } catch (_) {}

    if (!res.ok) {
      const detail = body && body.error
        ? body.error
        : `Drive247 answered HTTP ${res.status}.` +
          (res.status === 404 ? " The turo-bridge-ingest function is not deployed." : "");
      console.error("[TuroBridge] ingest failed:", res.status, detail);
      return { ok: false, detail };
    }

    console.log(`[TuroBridge] ${body.action || "saved"} ${body.reservationId} (source=${body.source})`);
    return { ok: true, action: body.action || "created", id: body.id || null };
  } catch (e) {
    const aborted = e && e.name === "AbortError";
    return {
      ok: false,
      detail: aborted
        ? "Drive247 did not respond in time."
        : `Could not reach Drive247: ${String((e && e.message) || e)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ status

/**
 * The SINGLE writer of user-visible state. Persist to storage first; the popup
 * renders storage on open and follows storage.onChanged, so a sync that
 * finishes after the popup was closed is still correct and still visible when
 * it is reopened. We deliberately never sendMessage the popup — a closed popup
 * rejects with "Receiving end does not exist", usually as an unhandled
 * rejection.
 */
async function setStatus(status) {
  const lastRun = Object.assign({ at: Date.now() }, status);
  await chrome.storage.local.set({ lastRun });
  return lastRun;
}
