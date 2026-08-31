// extensions/turo-bridge/lib/turo-read.js
//
// The half that runs INSIDE a turo.com tab.
//
// WHY NOT THE SERVICE WORKER
// --------------------------
// A `fetch("https://turo.com/api/v2/feeds/upcoming-trips?appMode=HOST")` issued
// from background.js is a cross-origin request whose initiator is
// `chrome-extension://<id>`. host_permissions exempt it from CORS *enforcement*,
// but they do not change what goes on the wire:
//
//   Origin: chrome-extension://abcdef...      <- page fetches send no Origin on
//   Sec-Fetch-Site: cross-site                   a same-origin GET
//   Sec-Fetch-Mode: cors                      <- page sends same-origin
//   (no Referer)                              <- page sends the trips URL
//
// Turo fronts this with Cloudflare at the edge and PerimeterX in-app. Three
// separate things go wrong from the worker, and only one of them is CORS:
//
//   1. The header signature above is a textbook non-browser-page fingerprint.
//      It is exactly what an edge rule blocks.
//   2. PerimeterX's `_px*` cookies are short-lived and are re-minted by the
//      sensor JS running on the page. A request made outside the page never
//      participates in that refresh loop, so it eventually presents a stale
//      token and gets a 403.
//   3. When the edge does challenge, it answers with an HTML interstitial. A
//      service worker cannot solve one. A tab can — its own sensor JS is
//      already running.
//
// Running the identical fetch inside the tab via
// `chrome.scripting.executeScript` makes it same-origin: same document, same
// cookie jar, same Referer, `Sec-Fetch-Site: same-origin`, no Origin header —
// byte-for-byte what Turo's own web app issues.
//
// ISOLATED world is sufficient and MAIN is not needed: we need the tab's
// *origin and cookies*, not its JS globals. ISOLATED is also the safer default
// (no page-visible footprint, not subject to the page's CSP for our own code).
// The one thing that would force MAIN is if Turo started requiring a header
// minted by page JS (a CSRF or `x-px-authorization` value held in a JS global).
// See "If Turo starts requiring a page-minted header" at the bottom.
//
// SELF-CONTAINED BY CONTRACT: chrome.scripting serialises this function with
// Function.prototype.toString and re-evaluates it in the tab. Importing it as a
// module here is fine; closing over anything in this file is NOT. Every value
// it needs arrives through `args`, and its return value must be JSON-safe.

/** Outcomes the reader can report. The caller branches on these. */
export const READ = {
  OK: "OK",                       // JSON, and it contained at least one trip
  NO_TRIPS: "NO_TRIPS",           // JSON, well-formed, but the list is empty
  NOT_LOGGED_IN: "NOT_LOGGED_IN", // no host session in this browser
  BOT_BLOCKED: "BOT_BLOCKED",     // Cloudflare / PerimeterX interstitial
  RATE_LIMITED: "RATE_LIMITED",   // 429
  UNREACHABLE: "UNREACHABLE",     // network error / timeout
  UNKNOWN: "UNKNOWN",             // 2xx-but-unrecognised, or an HTML page we
};                                // could not attribute to either cause

/**
 * Injected into the turo.com tab. Returns a JSON-safe verdict; never throws.
 *
 * @param {string} url        TURO_TRIPS_URL
 * @param {number} timeoutMs
 * @param {number} maxBytes   refuse to ship an absurd feed blob back over the
 *                            executeScript bridge
 */
export async function readUpcomingTrips(url, timeoutMs, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Captured before the fetch: if Turo already bounced this tab to the login
  // page, that alone settles "not logged in" without guessing at a body.
  const pageUrl = location.href;
  const pageLooksLoggedOut = /\/(login|signin|sign-in)\b/i.test(location.pathname);

  try {
    const res = await fetch(url, {
      // Same-origin here, so cookies would ride along under "same-origin" too.
      // "include" is explicit because it is the property that matters and it
      // must survive anyone later moving this call.
      credentials: "include",
      // Only what Turo's own XHR would carry. Do NOT hand-set User-Agent,
      // Referer, Origin or Cookie: they are forbidden headers, silently
      // dropped, and a partial imitation is a worse fingerprint than none.
      headers: { accept: "application/json" },
      // "cors" (the default) is correct even same-origin; "no-cors" would make
      // the body opaque and unreadable.
      mode: "cors",
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });

    const finalUrl = res.url || url;
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const body = await res.text();
    const head = body.slice(0, 3000);

    // ---- 1. Redirected out of the API surface -> session is gone. ---------
    if (/\/(login|signin|sign-in|account\/login)\b/i.test(finalUrl)) {
      return v(READ.NOT_LOGGED_IN, "Turo redirected to its login page.", { finalUrl, pageUrl });
    }

    // ---- 2. Explicit status codes. ---------------------------------------
    if (res.status === 401) {
      return v(READ.NOT_LOGGED_IN, "Turo answered 401 — no host session in this browser.", { finalUrl, pageUrl });
    }
    if (res.status === 429) {
      return v(READ.RATE_LIMITED, "Turo answered 429 — too many requests.", { finalUrl, pageUrl });
    }

    // ---- 3. Not JSON. Attribute the HTML before falling back. ------------
    const looksJson = ctype.includes("json") || /^[\s﻿]*[{[]/.test(body);
    if (!looksJson) {
      if (/perimeterx|_px(?:hd|3|2|Captcha)?\b|px-captcha|Access to this page has been denied|blocked by|cf-chl|challenge-platform|Just a moment|Attention Required|Checking your browser|hsprotect/i.test(head)) {
        return v(READ.BOT_BLOCKED, "Turo's bot protection served a challenge page instead of data.", { status: res.status, finalUrl, snippet: head.slice(0, 300) });
      }
      if (/<title>[^<]*(log ?in|sign ?in)|name=["']password["']|Log in to Turo|id=["']loginForm["']/i.test(head) || pageLooksLoggedOut) {
        return v(READ.NOT_LOGGED_IN, "Turo served its login page — sign in to turo.com in this browser first.", { status: res.status, finalUrl, snippet: head.slice(0, 300) });
      }
      // 403 with unattributable HTML is overwhelmingly a challenge; say so, but
      // keep the snippet so a real operator can tell us what it actually was.
      if (res.status === 403) {
        return v(READ.BOT_BLOCKED, "Turo answered 403 with a non-JSON page (most likely bot protection).", { status: res.status, finalUrl, snippet: head.slice(0, 300) });
      }
      return v(READ.UNKNOWN, `Turo answered HTTP ${res.status} with ${ctype || "an unknown content type"}, not JSON.`, { status: res.status, finalUrl, snippet: head.slice(0, 300) });
    }

    // ---- 4. JSON. ---------------------------------------------------------
    let json;
    try {
      json = JSON.parse(body);
    } catch {
      return v(READ.UNKNOWN, "Turo returned a JSON content-type with an unparseable body.", { status: res.status, finalUrl, snippet: head.slice(0, 300) });
    }

    if (!res.ok) {
      // A JSON error envelope. PerimeterX also has a JSON mode.
      const asText = JSON.stringify(json).slice(0, 600);
      if (/perimeterx|_px(?:hd|3|2|Captcha)?\b|px-captcha|Access to this page has been denied|blocked by|cf-chl|challenge-platform|Just a moment|Attention Required|Checking your browser|hsprotect/i.test(asText)) {
        return v(READ.BOT_BLOCKED, "Turo's bot protection rejected the request.", { status: res.status, finalUrl, snippet: asText.slice(0, 300) });
      }
      if (/unauthori[sz]ed|not.?authenticated|session|token/i.test(asText)) {
        return v(READ.NOT_LOGGED_IN, `Turo answered HTTP ${res.status} with an auth error.`, { status: res.status, finalUrl, snippet: asText.slice(0, 300) });
      }
      return v(READ.UNKNOWN, `Turo answered HTTP ${res.status}.`, { status: res.status, finalUrl, snippet: asText.slice(0, 300) });
    }

    if (body.length > maxBytes) {
      return v(READ.UNKNOWN, `Turo returned ${body.length} bytes, over the ${maxBytes} cap.`, { status: res.status, finalUrl });
    }

    // Emptiness is decided HERE, on the raw envelope, and it is deliberately
    // conservative: only an explicitly-empty container counts as "no trips".
    // An envelope we do not recognise is NOT emptiness — it is UNKNOWN, and
    // the worker's parser gets a crack at it before we give up.
    const empty = looksExplicitlyEmpty(json);
    if (empty === true) {
      return v(READ.NO_TRIPS, "You're signed in to Turo, but there are no upcoming host trips.", { status: res.status, finalUrl, envelopeKeys: keysOf(json) });
    }

    return v(READ.OK, "Read the upcoming-trips feed.", {
      status: res.status,
      finalUrl,
      envelopeKeys: keysOf(json),
      bytes: body.length,
      json, // raw. The worker owns interpretation; see turo-parse.js.
    });
  } catch (e) {
    const aborted = e && e.name === "AbortError";
    return v(
      aborted ? READ.UNREACHABLE : READ.UNREACHABLE,
      aborted ? "The request to Turo timed out." : `Could not reach Turo: ${String((e && e.message) || e)}`,
      { pageUrl }
    );
  } finally {
    clearTimeout(timer);
  }

  // --- helpers, inlined so the function stays self-contained ---------------

  function v(outcome, message, extra) { return Object.assign({ outcome, message }, extra || {}); }
  function keysOf(o) { return o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).slice(0, 30) : []; }

  function looksExplicitlyEmpty(root) {
    if (Array.isArray(root)) return root.length === 0;
    if (!root || typeof root !== "object") return null;
    // Any array anywhere shallow that has items => not empty.
    let sawArray = false;
    const stack = [[root, 0]];
    while (stack.length) {
      const [node, d] = stack.pop();
      if (d > 4 || !node || typeof node !== "object") continue;
      for (const k of Object.keys(node)) {
        const val = node[k];
        if (Array.isArray(val)) { sawArray = true; if (val.length > 0) return false; }
        else if (val && typeof val === "object") stack.push([val, d + 1]);
      }
    }
    // Explicit zero counters are the other trustworthy emptiness signal.
    for (const k of Object.keys(root)) {
      if (/^(total|count|totalcount|resultcount|size)$/i.test(k) && root[k] === 0) return true;
    }
    return sawArray ? true : null; // no arrays at all => we simply don't know
  }
}
