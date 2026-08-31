// Drive247 Turo Bridge — MV3 service worker.
//
// LIFECYCLE: this worker is disposable. Chrome kills it after ~30s idle and we
// must assume it can die between any two lines. We do not fight that; the whole
// design sidesteps it:
//
//   * Exactly ONE user click drives exactly ONE short round trip. No alarms,
//     no polling, no long-lived chrome.runtime.connect port, no retry timers.
//   * Zero state lives in this file's globals. The pairing token and the last
//     status live in chrome.storage.local, so a restarted worker (or a popup
//     that was closed and reopened) reads the same truth.
//   * Every network leg is AbortController-bounded, so the run is a handful of
//     seconds start to finish and cannot hang the worker in a pending await.
//   * The run is idempotent: it re-POSTs the same Turo reservation id, and the
//     edge function upserts on it. So the recovery story for "worker died
//     mid-run" is simply: click the button again.

const TURO_TRIPS_URL = "https://turo.com/api/v2/feeds/upcoming-trips?appMode=HOST";
const TURO_TAB_MATCH = "https://*.turo.com/*";
const TURO_BOOT_URL = "https://turo.com/us/en/trips/booked";

// verify_jwt = false on this function (see supabase/config.toml) — the pairing
// token in the body is the credential, so we ship NO Supabase anon key. Every
// byte of an unpacked extension is readable by anyone who installs it.
const EDGE_URL =
  "https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/turo-bridge-import";

const TAB_LOAD_TIMEOUT_MS = 15000;
const EDGE_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------- status ----

/** Single writer for user-visible state. Storage is the source of truth; the
 *  sendMessage is a best-effort live nudge that no-ops when the popup is shut. */
async function setStatus(phase, text, extra = {}) {
  const status = { phase, text, at: Date.now(), ...extra };
  await chrome.storage.local.set({ lastStatus: status });
  chrome.runtime.sendMessage({ type: "STATUS", status }).catch(() => {});
  return status;
}

// ------------------------------------------------- injected into the tab ----

/**
 * Runs INSIDE the turo.com tab, in the ISOLATED world.
 *
 * Isolated is the right world here and MAIN is not needed: an isolated-world
 * script shares the tab's document, origin and cookie jar, so this fetch is
 * same-origin against turo.com and carries the operator's session cookies
 * (including the PerimeterX _px cookies) exactly as the Turo web app's own
 * fetches do. A fetch from the service worker instead presents
 * Origin: chrome-extension://<id> and is what gets challenged at the edge.
 *
 * MUST be self-contained — it is serialised and re-evaluated in the page, so it
 * closes over nothing from this file. Its return value must be JSON-safe.
 */
async function readFirstUpcomingTrip(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      credentials: "include",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const body = await res.text();

    if (!res.ok) {
      return { ok: false, reason: `Turo returned HTTP ${res.status}`, snippet: body.slice(0, 200) };
    }

    let json;
    try {
      json = JSON.parse(body);
    } catch {
      // An HTML body here is the tell-tale of a Cloudflare / PerimeterX
      // interstitial, or of a logged-out session bounced to the login page.
      return { ok: false, reason: "Turo returned HTML, not JSON (bot challenge or logged out)", snippet: body.slice(0, 200) };
    }

    const list = Array.isArray(json)
      ? json
      : json.trips || json.results || json.items || json.data || null;

    if (!Array.isArray(list) || list.length === 0) {
      return { ok: false, reason: "No upcoming host trips on this account", envelopeKeys: Object.keys(json || {}) };
    }

    // Deliberately return the RAW first trip. We have no Turo account to verify
    // the schema against, so no field mapping is baked into the shipped
    // extension — normalisation happens in the edge function, where it can be
    // corrected by a redeploy instead of a reinstall.
    return { ok: true, trip: list[0], count: list.length, envelopeKeys: Object.keys(json || {}) };
  } catch (e) {
    return { ok: false, reason: e && e.name === "AbortError" ? "Turo request timed out" : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ tabs ----

/** Reuse a turo.com tab if one is open, else open one in the background.
 *  Note: tabs.query with a url filter needs EITHER the "tabs" permission or a
 *  matching host permission. We have the host permission, so "tabs" stays off
 *  the manifest — it would grant URL visibility across every tab. */
async function getTuroTab() {
  const [existing] = await chrome.tabs.query({ url: TURO_TAB_MATCH });
  if (existing) return { tab: existing, opened: false };
  const tab = await chrome.tabs.create({ url: TURO_BOOT_URL, active: false });
  await waitForTabComplete(tab.id, TAB_LOAD_TIMEOUT_MS);
  return { tab: await chrome.tabs.get(tab.id), opened: true };
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const done = (err) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => done(new Error("Turo tab did not finish loading")), timeoutMs);
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") done(); }).catch(() => {});
  });
}

// --------------------------------------------------------------- fixture ----

/** The demo must run on a machine with no Turo account. Always stamped
 *  source:"fixture" so nothing downstream can mistake it for real data. */
async function loadFixture() {
  const res = await fetch(chrome.runtime.getURL("fixtures/turo-trip.json"));
  return await res.json();
}

// -------------------------------------------------------------- the run ----

async function syncOneReservation() {
  const { pairingToken } = await chrome.storage.local.get("pairingToken");
  if (!pairingToken) {
    return setStatus("error", "Paste your pairing token from the Drive247 portal first.");
  }

  let source = "live";
  let trip = null;
  let note = "";

  await setStatus("working", "Looking for a turo.com tab…");
  try {
    const { tab, opened } = await getTuroTab();
    await setStatus("working", opened ? "Opened turo.com, reading trips…" : "Reading trips from your Turo tab…");

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "ISOLATED",
      func: readFirstUpcomingTrip,
      args: [TURO_TRIPS_URL],
    });

    // executeScript awaits a promise returned by `func` and hands back its
    // resolved value on .result — so no content-script messaging is needed.
    const out = injection && injection.result;
    if (out && out.ok) {
      trip = out.trip;
      note = `Turo returned ${out.count} upcoming trip(s).`;
    } else {
      source = "fixture";
      note = (out && out.reason) || "Could not read Turo.";
    }
  } catch (e) {
    source = "fixture";
    note = String((e && e.message) || e);
  }

  if (source === "fixture") {
    await setStatus("working", `Turo unavailable (${note}) — using bundled demo reservation.`);
    trip = await loadFixture();
  }

  await setStatus("working", "Sending to Drive247…");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EDGE_TIMEOUT_MS);
  try {
    const res = await fetch(EDGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairingToken,
        source,          // "live" | "fixture" — never hidden from the server
        extensionVersion: chrome.runtime.getManifest().version,
        trip,
      }),
      signal: controller.signal,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return setStatus("error", payload.error || `Drive247 returned HTTP ${res.status}`);
    }
    return setStatus(
      "done",
      source === "fixture"
        ? `Imported DEMO reservation ${payload.rentalNumber || ""} (Turo not reachable: ${note})`
        : `Imported reservation ${payload.rentalNumber || ""} from Turo.`,
      { rentalId: payload.rentalId, source }
    );
  } catch (e) {
    return setStatus("error", e && e.name === "AbortError" ? "Drive247 timed out." : String((e && e.message) || e));
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------- entry point ----

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "SYNC_ONE") {
    // The pending response keeps the worker alive for this short run; if it is
    // torn down anyway, the final status was already written to storage by
    // setStatus and the popup picks it up on next open.
    syncOneReservation().then(sendResponse, (e) =>
      sendResponse({ phase: "error", text: String((e && e.message) || e) })
    );
    return true; // async response
  }
});
