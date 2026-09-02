/**
 * turo-read-contract.js — the runtime half of the Turo read contract.
 * Types and the full rationale live next door in turo-contract.d.ts.
 *
 * =====================================================================
 * INJECTION CONTRACT — identical to content-turo.js, and for the same reasons.
 * =====================================================================
 * Loaded in THREE contexts and must work in all of them, so: plain script, no
 * module syntax, no DOM, NO chrome.* API anywhere.
 *   1. the MV3 service worker, via importScripts()   — orchestration + pure fns
 *   2. the ISOLATED world of a turo.com tab          — the default read path
 *   3. the MAIN world of a turo.com tab              — the retry path
 *
 * WHY THE FETCH LIVES IN THE TAB. A fetch from the service worker goes out with
 * `Origin: chrome-extension://<id>`, `Sec-Fetch-Site: cross-site` and no
 * Referer — a textbook non-browser-page fingerprint, and exactly what an edge
 * rule blocks. Worse, PerimeterX's `_px*` cookies are re-minted by sensor JS
 * running ON THE PAGE; a request made outside the page never joins that refresh
 * loop and eventually presents a stale token. Inside the tab the request is
 * byte-for-byte what Turo's own web app issues. See content-turo.js:16-38.
 *
 * WHAT WE NEVER DO. We never ask for, store or transmit Turo credentials. We
 * read the session already open in the operator's browser. There is no login
 * form in this extension by design — Turo's terms forbid disclosing a password
 * to a third party.
 *
 * This file EXTENDS content-turo.js and does not replace it. `__d247TuroBridge`
 * and its one-reservation `collectOneReservation()` path are untouched; this
 * attaches a sibling namespace `__d247TuroRead`.
 */

(function () {
  "use strict";

  var VERSION = 1;
  if (globalThis.__d247TuroRead && globalThis.__d247TuroRead.__version === VERSION) return;

  // =========================================================================
  // 0. ENDPOINTS
  //
  // RELATIVE on purpose: resolved against the tab's own origin, which is what
  // keeps an Origin header off the wire. Both paths are CONFIRMED; the response
  // SHAPES are not confirmed by anything, and nothing below assumes them.
  // =========================================================================

  var TRIPS_PATH = "/api/v2/feeds/upcoming-trips?appMode=HOST";
  var VEHICLES_PATH = "/api/vehicles/me";
  var TIMEOUT_MS = 9000;
  var MAX_BYTES = 8 * 1024 * 1024;

  // =========================================================================
  // 1. OUTCOMES AND THE SAFETY TABLE
  //
  // The first values keep the exact spelling content-turo.js emits, because
  // background.js:64 keys a Set and background.js:67 an advice map off them.
  // =========================================================================

  var OUTCOME = {
    OK: "OK",
    NO_TRIPS_CONFIRMED: "NO_TRIPS_CONFIRMED",
    EMPTY_UNCONFIRMED: "EMPTY_UNCONFIRMED",
    NOT_LOGGED_IN: "NOT_LOGGED_IN",
    BOT_BLOCKED: "BOT_BLOCKED",
    RATE_LIMITED: "RATE_LIMITED",
    UNREACHABLE: "UNREACHABLE",
    SHAPE_CHANGED: "SHAPE_CHANGED",
    TRUNCATED: "TRUNCATED",
    PAGINATION_STALLED: "PAGINATION_STALLED",
    UNPARSEABLE: "UNPARSEABLE", // legacy single-record verdict
    NO_TRIPS: "NO_TRIPS",       // legacy alias, content-turo.js:559
    UNKNOWN: "UNKNOWN"
  };

  /**
   * THE LOAD-BEARING TABLE OF THIS ENTIRE FILE.
   *
   * `writeSafe` and `releaseSafe` are TWO INDEPENDENT BITS and collapsing them
   * into one is the bug this whole contract exists to prevent. A truncated read
   * is perfectly safe to write (upserting trips we did see is idempotent and
   * harmless) and catastrophic to release from (the trips we did NOT see are
   * still real, and releasing their blocks double-sells the car).
   *
   * releaseSafe is true for exactly TWO outcomes, and even then the caller must
   * ALSO check coverage.complete and session.liveSession — see finaliseRun().
   */
  var POLICY = {
    OK: {
      writeSafe: true, releaseSafe: true, halt: false, parkAndResume: false, retryInMainWorld: false,
      advice: "Read the Turo feed."
    },
    NO_TRIPS_CONFIRMED: {
      writeSafe: true, releaseSafe: true, halt: false, parkAndResume: false, retryInMainWorld: false,
      advice: "You're signed in to Turo and have no upcoming host trips."
    },
    EMPTY_UNCONFIRMED: {
      // The WAF-returns-200-with-an-empty-body case. It looks EXACTLY like a
      // genuinely empty calendar and must never be treated as one.
      writeSafe: false, releaseSafe: false, halt: true, parkAndResume: true, retryInMainWorld: true,
      advice: "Turo returned an empty response we could not verify. Nothing was changed. Open turo.com, check you're signed in as the host, then sync again."
    },
    NOT_LOGGED_IN: {
      writeSafe: false, releaseSafe: false, halt: true, parkAndResume: false, retryInMainWorld: false,
      advice: "Sign in to turo.com in this browser, then sync again."
    },
    BOT_BLOCKED: {
      // ZERO further requests. Retrying into a live challenge is what turns a
      // soft check into a hard block on the operator's own account.
      writeSafe: false, releaseSafe: false, halt: true, parkAndResume: true, retryInMainWorld: true,
      advice: "Turo's bot protection challenged the request. Open turo.com in a tab, clear the check it shows you, then sync again."
    },
    RATE_LIMITED: {
      writeSafe: true, releaseSafe: false, halt: true, parkAndResume: true, retryInMainWorld: false,
      advice: "Turo is rate-limiting us. The sync paused where it was and will pick up from there."
    },
    UNREACHABLE: {
      writeSafe: true, releaseSafe: false, halt: true, parkAndResume: true, retryInMainWorld: false,
      advice: "Could not reach Turo. Check the connection and sync again."
    },
    SHAPE_CHANGED: {
      // Our bug, not the operator's. Say so.
      writeSafe: false, releaseSafe: false, halt: true, parkAndResume: false, retryInMainWorld: true,
      advice: "Turo changed the shape of its data and this extension needs an update. Nothing was changed. Please report this."
    },
    TRUNCATED: {
      writeSafe: true, releaseSafe: false, halt: false, parkAndResume: true, retryInMainWorld: false,
      advice: "Only part of the Turo calendar could be read. What was read is saved; nothing was released."
    },
    PAGINATION_STALLED: {
      writeSafe: true, releaseSafe: false, halt: true, parkAndResume: false, retryInMainWorld: false,
      advice: "Turo stopped returning new pages. What was read is saved; nothing was released."
    },
    UNPARSEABLE: {
      writeSafe: false, releaseSafe: false, halt: true, parkAndResume: false, retryInMainWorld: true,
      advice: "Turo returned data we could not read."
    },
    NO_TRIPS: {
      // Legacy alias. Deliberately NOT releaseSafe: the legacy single-record
      // path has no session probe behind it, so its "empty" is unverified.
      writeSafe: true, releaseSafe: false, halt: false, parkAndResume: false, retryInMainWorld: false,
      advice: "No upcoming host trips were returned."
    },
    UNKNOWN: {
      writeSafe: false, releaseSafe: false, halt: true, parkAndResume: true, retryInMainWorld: true,
      advice: "Turo returned something we did not recognise. Nothing was changed."
    }
  };

  /** Worse-is-lower. Used to reduce a run's page outcomes to one verdict. */
  var SEVERITY = {
    OK: 100, NO_TRIPS_CONFIRMED: 95, NO_TRIPS: 90, TRUNCATED: 60,
    PAGINATION_STALLED: 55, RATE_LIMITED: 50, UNREACHABLE: 40,
    EMPTY_UNCONFIRMED: 30, UNKNOWN: 25, SHAPE_CHANGED: 20,
    UNPARSEABLE: 20, BOT_BLOCKED: 10, NOT_LOGGED_IN: 5
  };

  function policyFor(outcome) {
    var p = POLICY[outcome] || POLICY.UNKNOWN;
    return {
      outcome: outcome, writeSafe: p.writeSafe, releaseSafe: p.releaseSafe,
      halt: p.halt, parkAndResume: p.parkAndResume,
      retryInMainWorld: p.retryInMainWorld, advice: p.advice
    };
  }

  function worstOutcome(list) {
    var worst = OUTCOME.OK;
    for (var i = 0; i < list.length; i++) {
      if ((SEVERITY[list[i]] || 0) < (SEVERITY[worst] || 0)) worst = list[i];
    }
    return worst;
  }

  // =========================================================================
  // 2. TINY HELPERS
  // =========================================================================

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function normKey(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function clip(s, n) { return s === null || s === undefined ? null : String(s).slice(0, n); }

  /**
   * Case- and separator-insensitive lookup that ALSO reports which real key
   * matched. `matchedKey` is the whole point: on the first live run its
   * histogram IS the real Turo schema, recovered empirically instead of guessed.
   * @returns {{value:*, key:string|null}}
   */
  function pickE(obj, aliases) {
    if (!isObj(obj)) return { value: undefined, key: null };
    var index = Object.create(null);
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var n = normKey(keys[i]);
      if (!(n in index)) index[n] = keys[i];
    }
    for (var j = 0; j < aliases.length; j++) {
      var real = index[normKey(aliases[j])];
      if (real === undefined) continue;
      var v = obj[real];
      if (v !== undefined && v !== null && v !== "") return { value: v, key: real };
    }
    return { value: undefined, key: null };
  }

  function pick(obj, aliases) { return pickE(obj, aliases).value; }

  /** pick(), then a bounded breadth-first sweep. A `deep` hit is trusted less. */
  function pickDeepE(obj, aliases, maxDepth, budget) {
    maxDepth = maxDepth || 3;
    budget = budget || 800;
    var direct = pickE(obj, aliases);
    if (direct.value !== undefined) return { value: direct.value, key: direct.key, route: "direct" };
    var seen = 0, queue = [[obj, 0]];
    while (queue.length) {
      var e = queue.shift(), node = e[0], d = e[1];
      if (++seen > budget || d >= maxDepth) continue;
      if (Array.isArray(node)) {
        for (var a = 0; a < node.length && a < 25; a++) {
          if (node[a] && typeof node[a] === "object") queue.push([node[a], d + 1]);
        }
        continue;
      }
      if (!isObj(node)) continue;
      if (d > 0) {
        var hit = pickE(node, aliases);
        if (hit.value !== undefined) return { value: hit.value, key: hit.key, route: "deep" };
      }
      var ks = Object.keys(node);
      for (var b = 0; b < ks.length; b++) {
        var val = node[ks[b]];
        if (val && typeof val === "object") queue.push([val, d + 1]);
      }
    }
    return { value: undefined, key: null, route: "absent" };
  }

  /**
   * THE ONE PLACE THIS FILE IS DELIBERATELY STRICT.
   *
   * Accepts ISO-8601, MM/DD/YYYY, epoch seconds, epoch millis and the common
   * wrapper objects. It REJECTS display strings, and that rejection is
   * load-bearing:
   *
   *     new Date("Sep 14") returns a VALID Date in the current year.
   *
   * The `/feeds/` segment in the trips URL is the real worry — feed endpoints
   * typically return rendered cards ("Sep 14 - Sep 18") rather than domain
   * objects. Letting those through would import a confidently wrong booking
   * date. Returning null instead surfaces `ends_at` as a reported unknown and
   * rejects the record. A visible refusal beats a plausible lie.
   */
  function toIso(value, depth) {
    depth = depth || 0;
    if (value === null || value === undefined || depth > 3) return null;

    if (typeof value === "number" && isFinite(value)) {
      // 1e11 sits between plausible epoch seconds (~1.7e9) and plausible epoch
      // millis (~1.7e12), separating them without hardcoding a year.
      var ms = value > 1e11 ? value : (value > 1e9 ? value * 1000 : null);
      if (ms === null) return null;
      var dn = new Date(ms);
      return isNaN(dn.getTime()) ? null : dn.toISOString();
    }

    if (typeof value === "string") {
      var s = value.trim();
      if (!s) return null;
      if (/^\d{10,13}$/.test(s)) return toIso(Number(s), depth + 1);
      var iso = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s);
      var us = /^\d{1,2}\/\d{1,2}\/\d{4}([T ]\d{1,2}:\d{2}(:\d{2})?\s*([AaPp][Mm])?)?$/.test(s);
      if (!iso && !us) return null; // display text — refuse to guess
      var ds = new Date(iso && !/[T ]/.test(s) ? s + "T00:00:00Z" : s);
      return isNaN(ds.getTime()) ? null : ds.toISOString();
    }

    if (isObj(value)) {
      var dPart = pick(value, ["date", "localDate"]);
      var tPart = pick(value, ["time", "localTime"]);
      if (typeof dPart === "string" && typeof tPart === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(dPart.trim())) {
        var t = tPart.trim();
        var joined = toIso(dPart.trim() + "T" + (t.length === 5 ? t : t.slice(0, 5)) + ":00Z", depth + 1);
        if (joined) return joined;
      }
      var wrappers = ["dateTime", "datetime", "iso", "isoString", "utc", "utcDateTime",
        "epochMillis", "epochMilliseconds", "epochSeconds", "timestamp", "instant", "value", "date"];
      for (var w = 0; w < wrappers.length; w++) {
        var inner = pick(value, [wrappers[w]]);
        if (inner !== undefined) {
          var got = toIso(inner, depth + 1);
          if (got) return got;
        }
      }
    }
    return null;
  }

  /** Non-reversible, stable, short. Used for the tenant and Turo-account guards. */
  async function fingerprint(input) {
    if (!input) return null;
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(input)));
    var bytes = new Uint8Array(buf), out = "";
    for (var i = 0; i < 8; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }

  // =========================================================================
  // 3. BODY CLASSIFICATION  —  degraded-read detection, part 1
  //
  // Runs on ONE HTTP response and answers "what kind of thing is this".
  // A challenge interstitial frequently arrives as HTTP 200 with an HTML body,
  // so res.ok alone proves nothing and is never consulted alone.
  // =========================================================================

  // Inline literals on purpose: anything hoisted out of the injected function
  // would be undefined in the page if this is ever passed through
  // Function.prototype.toString rather than injected as a file.
  var BOT_RE = /perimeterx|_px(?:hd|3|2|Captcha)?\b|px-captcha|Access to this page has been denied|cf-chl|challenge-platform|Just a moment|Attention Required|Checking your browser|hsprotect|cf_chl_opt|__cf_bm/i;
  var LOGIN_RE = /<title>[^<]*(log ?in|sign ?in)|name=["']password["']|Log in to Turo|id=["']loginForm["']/i;

  /**
   * @returns {{outcome:string, message:string, json:*, snippet:string|null}}
   */
  function classifyBody(ctx) {
    var status = ctx.status, ctype = (ctx.contentType || "").toLowerCase();
    var body = ctx.body || "", finalUrl = ctx.finalUrl || "";
    var head = body.slice(0, 3000);

    // 1. Redirected off the API surface -> the session is gone. Settles it
    //    without having to interpret a body at all.
    if (/\/(login|signin|sign-in|account\/login)\b/i.test(finalUrl)) {
      return c(OUTCOME.NOT_LOGGED_IN, "Turo redirected to its login page.", null, null);
    }

    // 2. Unambiguous status codes.
    if (status === 401) return c(OUTCOME.NOT_LOGGED_IN, "Turo answered 401 — no host session in this browser.", null, null);
    if (status === 429) return c(OUTCOME.RATE_LIMITED, "Turo answered 429 — too many requests.", null, null);

    // 3. Not JSON.
    var looksJson = ctype.indexOf("json") !== -1 || /^[\s﻿]*[{[]/.test(body);
    if (!looksJson) {
      if (BOT_RE.test(head)) {
        return c(OUTCOME.BOT_BLOCKED, "Turo's bot protection served a challenge page instead of data.", null, head.slice(0, 300));
      }
      if (LOGIN_RE.test(head) || ctx.pageLooksLoggedOut) {
        return c(OUTCOME.NOT_LOGGED_IN, "Turo served its login page — sign in to turo.com in this browser first.", null, head.slice(0, 300));
      }
      if (status === 403) {
        // A 403 with unattributable HTML is overwhelmingly a challenge. We say
        // so, but keep the snippet so the first operator with a real Turo
        // account can tell us whether this default is wrong.
        return c(OUTCOME.BOT_BLOCKED, "Turo answered 403 with a non-JSON page (most likely bot protection).", null, head.slice(0, 300));
      }
      return c(OUTCOME.UNKNOWN, "Turo answered HTTP " + status + " with " + (ctype || "an unknown content type") + ", not JSON.", null, head.slice(0, 300));
    }

    // 4. JSON.
    var json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      // A body that starts like JSON and does not parse is the clearest
      // TRUNCATION signal we get — a proxy cut the stream mid-object.
      return c(OUTCOME.TRUNCATED, "Turo returned a JSON content type with an unparseable body — the response looks cut short.", null, head.slice(0, 300));
    }

    if (status < 200 || status >= 300) {
      var asText = JSON.stringify(json).slice(0, 600); // PerimeterX has a JSON mode too
      if (BOT_RE.test(asText)) return c(OUTCOME.BOT_BLOCKED, "Turo's bot protection rejected the request.", null, asText.slice(0, 300));
      if (/unauthori[sz]ed|not.?authenticated|session|token|expired/i.test(asText)) {
        return c(OUTCOME.NOT_LOGGED_IN, "Turo answered HTTP " + status + " with an auth error.", null, asText.slice(0, 300));
      }
      return c(OUTCOME.UNKNOWN, "Turo answered HTTP " + status + ".", null, asText.slice(0, 300));
    }

    if (body.length > MAX_BYTES) {
      return c(OUTCOME.UNKNOWN, "Turo returned " + body.length + " bytes, over the " + MAX_BYTES + " byte cap.", null, null);
    }

    // A 200 JSON body that carries a challenge payload. Rare, and lethal if
    // missed, because it would otherwise read as "zero trips".
    var probe = JSON.stringify(json).slice(0, 1200);
    if (BOT_RE.test(probe)) {
      return c(OUTCOME.BOT_BLOCKED, "Turo answered 200 with a bot-protection payload.", null, probe.slice(0, 300));
    }

    return c(OUTCOME.OK, "Read a JSON response.", json, null);

    function c(outcome, message, j, snippet) {
      return { outcome: outcome, message: message, json: j === undefined ? null : j, snippet: snippet };
    }
  }

  // =========================================================================
  // 4. ITEM EXTRACTION  —  degraded-read detection, part 2
  //
  // Where is the list? The answer distinguishes "explicitly empty" (a container
  // we found, holding nothing) from "we have no idea" (no container at all).
  // Collapsing those two is how a renamed envelope key silently reports
  // "no upcoming trips" — the single most misleading thing this extension
  // could say, because it is indistinguishable from the truth.
  // =========================================================================

  var CONTAINER_KEYS = ["trips", "reservations", "results", "items", "data", "content",
    "feed", "elements", "records", "list", "bookings", "upcomingTrips", "hostTrips",
    "entries", "edges", "nodes", "vehicles", "listings"];

  /**
   * @returns {{items:Array, containerKey:string|null, found:boolean, envelopeKeys:string[]}}
   *   found=false means NO array-shaped container was located anywhere. That is
   *   NOT emptiness — it is an unrecognised envelope.
   */
  function extractItems(json) {
    var envelopeKeys = isObj(json) ? Object.keys(json).slice(0, 40) : [];

    if (Array.isArray(json)) {
      return { items: json, containerKey: "<root>", found: true, envelopeKeys: envelopeKeys };
    }
    if (!isObj(json)) return { items: [], containerKey: null, found: false, envelopeKeys: envelopeKeys };

    // Named containers first, at the top level, then one level down.
    var direct = pickE(json, CONTAINER_KEYS);
    if (Array.isArray(direct.value)) {
      return { items: direct.value, containerKey: direct.key, found: true, envelopeKeys: envelopeKeys };
    }
    if (isObj(direct.value)) {
      var nested = pickE(direct.value, CONTAINER_KEYS);
      if (Array.isArray(nested.value)) {
        return { items: nested.value, containerKey: direct.key + "." + nested.key, found: true, envelopeKeys: envelopeKeys };
      }
    }

    // Fall back to the biggest trip-shaped array anywhere shallow. A container
    // we located by SHAPE still counts as found — the envelope was renamed, but
    // the data is there and we can read it.
    var best = null, bestKey = null, bestScore = -1;
    var stack = [[json, 0, ""]];
    while (stack.length) {
      var e = stack.pop(), node = e[0], d = e[1], path = e[2];
      if (d > 4 || !isObj(node)) continue;
      var ks = Object.keys(node);
      for (var i = 0; i < ks.length; i++) {
        var val = node[ks[i]], p = path ? path + "." + ks[i] : ks[i];
        if (Array.isArray(val)) {
          var s = arrayTripScore(val);
          if (s > bestScore) { bestScore = s; best = val; bestKey = p; }
        } else if (val && typeof val === "object") {
          stack.push([val, d + 1, p]);
        }
      }
    }
    if (best && bestScore > 0) {
      return { items: best, containerKey: bestKey, found: true, envelopeKeys: envelopeKeys };
    }
    // An EMPTY array found by name is still "found"; an empty one found only by
    // shape scores 0 and is not, because we cannot tell an empty trips list
    // from an empty list of anything else.
    if (best && best.length === 0 && bestScore === 0) {
      return { items: [], containerKey: bestKey, found: false, envelopeKeys: envelopeKeys };
    }
    return { items: [], containerKey: null, found: false, envelopeKeys: envelopeKeys };
  }

  function arrayTripScore(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    var n = Math.min(arr.length, 5), total = 0;
    for (var i = 0; i < n; i++) total += scoreCandidate(arr[i]);
    return total / n;
  }

  // =========================================================================
  // 5. PAGINATION  —  detected, never assumed
  //
  // Turo returns ~200 results per search page. The pagination shape of the HOST
  // TRIPS feed is UNCONFIRMED. All four plausible shapes are supported; the
  // shape is detected from the FIRST envelope and LOCKED for the rest of the
  // run (a mid-run style change is a stall, not an adaptation).
  //
  // WHEN WE FINALLY SEE A REAL RESPONSE, exactly one thing changes: the alias
  // lists below. Nothing else in the codebase moves.
  // =========================================================================

  var HINTS = {
    // A full next URL is the best case — it means we never have to guess the
    // REQUEST parameter name, which is a completely separate unknown from the
    // RESPONSE key name.
    nextUrl: ["nextUrl", "nextPageUrl", "next", "nextHref", "nextLink"],
    nextUrlNested: [["links", "next"], ["_links", "next"], ["paging", "next"], ["pagination", "next"], ["meta", "next"]],
    cursor: ["nextCursor", "cursor", "nextPageToken", "pageToken", "continuationToken",
      "continuation", "afterCursor", "endCursor", "nextToken", "scrollId", "searchAfter"],
    cursorNested: [["paging", "nextCursor"], ["pagination", "nextCursor"], ["pageInfo", "endCursor"],
      ["meta", "nextCursor"], ["paging", "cursor"], ["pagination", "cursor"]],
    hasMore: ["hasMore", "hasNextPage", "hasNext", "moreAvailable", "isLastPage", "last"],
    offset: ["offset", "skip", "start", "startIndex", "from"],
    limit: ["limit", "pageSize", "perPage", "size", "count", "take"],
    page: ["page", "pageNumber", "currentPage", "pageIndex"],
    totalPages: ["totalPages", "pageCount", "numPages", "lastPage"],
    total: ["total", "totalCount", "totalResults", "totalElements", "resultCount", "recordCount", "totalItems"]
  };

  /** Guessed REQUEST parameter names, used only when no next URL was given. */
  var PARAM = { cursor: "cursor", offset: "offset", limit: "limit", page: "page" };

  function pickNested(json, pairs) {
    for (var i = 0; i < pairs.length; i++) {
      var outer = pick(json, [pairs[i][0]]);
      if (!isObj(outer)) continue;
      var hit = pickE(outer, [pairs[i][1]]);
      if (hit.value !== undefined) return { value: hit.value, key: pairs[i][0] + "." + hit.key };
    }
    return { value: undefined, key: null };
  }

  /**
   * @param {*} json          the envelope
   * @param {Array} items     items extracted from it
   * @param {object|null} prev  the plan locked on page 0, if any
   * @returns {{plan:object, nextToken:*, nextUrl:string|null, explicitEnd:boolean}}
   */
  function detectPagination(json, items, prev) {
    var matched = [];
    var declaredTotal = null;
    var t = pickE(json, HINTS.total);
    if (typeof t.value === "number" && isFinite(t.value)) { declaredTotal = t.value; matched.push(t.key); }

    var observed = prev && prev.observedPageSize
      ? Math.max(prev.observedPageSize, items.length)
      : (items.length || null);

    // --- explicit end-of-feed signals, checked before any style ------------
    var explicitEnd = false;
    var hm = pickE(json, HINTS.hasMore);
    if (hm.key) {
      matched.push(hm.key);
      var isNegated = /^(islastpage|last)$/i.test(normKey(hm.key));
      if (hm.value === false && !isNegated) explicitEnd = true;
      if (hm.value === true && isNegated) explicitEnd = true;
    }

    // --- 1. a full next URL: the cleanest possible case ---------------------
    var nu = pickE(json, HINTS.nextUrl);
    if (typeof nu.value !== "string") {
      var nested = pickNested(json, HINTS.nextUrlNested);
      if (typeof nested.value === "string") nu = { value: nested.value, key: nested.key };
      else if (isObj(nested.value)) {
        var href = pickE(nested.value, ["href", "url"]);
        if (typeof href.value === "string") nu = { value: href.value, key: nested.key + ".href" };
      }
    }
    if (typeof nu.value === "string" && nu.value.trim()) {
      matched.push(nu.key);
      return done("cursor", "high", null, relativise(nu.value.trim()));
    }

    // --- 2. cursor token ----------------------------------------------------
    var cur = pickE(json, HINTS.cursor);
    if (cur.value === undefined) {
      var cn = pickNested(json, HINTS.cursorNested);
      if (cn.value !== undefined) cur = cn;
    }
    if (cur.value !== undefined && cur.value !== null && cur.value !== "") {
      matched.push(cur.key);
      return done("cursor", "high", cur.value, null);
    }

    // --- 3. offset window ---------------------------------------------------
    var off = pickE(json, HINTS.offset), lim = pickE(json, HINTS.limit);
    if (typeof off.value === "number" && typeof lim.value === "number") {
      matched.push(off.key); matched.push(lim.key);
      return done("offset", "medium", { offset: off.value + lim.value, limit: lim.value }, null);
    }

    // --- 4. ordinal page ----------------------------------------------------
    var pg = pickE(json, HINTS.page), tp = pickE(json, HINTS.totalPages);
    if (typeof pg.value === "number") {
      matched.push(pg.key);
      if (tp.key) matched.push(tp.key);
      var isLast = typeof tp.value === "number" && pg.value >= tp.value - (pg.value === 0 ? 1 : 0);
      return done("page", tp.key ? "high" : "medium", isLast ? null : { page: pg.value + 1 }, null);
    }

    // --- 5. no affordance at all -------------------------------------------
    // THE CRITICAL BRANCH. A SHORT batch with no next-link is genuinely one
    // shot. A FULL batch with no next-link is the classic silent truncation,
    // and calling that "none" is exactly how a sync shows 8/8 green while
    // holding half the calendar. It is "unknown", and "unknown" never completes.
    //
    // "Full" is only knowable once we have a PRIOR page to compare against. On
    // page 0 there is no observed page size yet — comparing a batch against
    // itself makes every first page look full, which would mark a real 3-trip
    // fleet permanently incomplete. So page 0 falls back to a size heuristic:
    // a large first batch is treated as possibly capped, a small one as the
    // whole feed. SUSPECT_FIRST_PAGE is a guess (Turo returns ~200 per search
    // page), and it is a SAFE guess in both directions: too low only costs us
    // an unnecessary "there may be more", never a wrong release.
    var SUSPECT_FIRST_PAGE = 50;
    var full = prev && prev.observedPageSize
      ? (items.length >= prev.observedPageSize && items.length > 0)
      : (items.length >= SUSPECT_FIRST_PAGE);
    if (full && !explicitEnd) return done("unknown", "low", null, null);
    return done("none", explicitEnd ? "high" : "medium", null, null);

    function done(style, confidence, token, url) {
      var lockedStyle = prev && prev.style && prev.style !== "unknown" ? prev.style : style;
      return {
        plan: {
          style: lockedStyle,
          matchedKeys: matched.filter(Boolean),
          observedPageSize: observed,
          declaredTotal: declaredTotal,
          confidence: confidence
        },
        nextToken: token,
        nextUrl: url,
        explicitEnd: explicitEnd
      };
    }
  }

  /** Keep next-page URLs same-origin and relative; refuse anything off turo.com. */
  function relativise(u) {
    try {
      if (u.charAt(0) === "/") return u;
      var parsed = new URL(u, "https://turo.com/");
      if (!/(^|\.)turo\.com$/i.test(parsed.hostname)) return null;
      return parsed.pathname + parsed.search;
    } catch (e) { return null; }
  }

  /** Build the next PageRequest, or null when the walk terminated. */
  function buildNextRequest(basePath, detection, index) {
    if (detection.explicitEnd) return null;
    if (detection.nextUrl) {
      return { pageKey: "url:" + detection.nextUrl, path: detection.nextUrl, index: index + 1 };
    }
    var tok = detection.nextToken;
    if (tok === null || tok === undefined) return null;
    var style = detection.plan.style;
    if (style === "cursor") {
      return req(addParam(basePath, PARAM.cursor, String(tok)), "cursor:" + String(tok));
    }
    if (style === "offset" && isObj(tok)) {
      var p = addParam(addParam(basePath, PARAM.offset, String(tok.offset)), PARAM.limit, String(tok.limit));
      return req(p, "offset:" + tok.offset);
    }
    if (style === "page" && isObj(tok)) {
      return req(addParam(basePath, PARAM.page, String(tok.page)), "page:" + tok.page);
    }
    return null;

    function req(path, key) { return { pageKey: key, path: path, index: index + 1 }; }
  }

  function addParam(path, name, value) {
    var clean = path.replace(new RegExp("([?&])" + name + "=[^&]*"), "$1").replace(/[?&]$/, "");
    return clean + (clean.indexOf("?") === -1 ? "?" : "&") + name + "=" + encodeURIComponent(value);
  }

  /**
   * PAGINATION STALL DETECTION.
   *
   * Two ways a paginated walk goes wrong without ever failing:
   *   1. the cursor stops advancing — Turo hands back the same token, or an
   *      offset that does not move, and we request the identical page forever;
   *   2. the page advances but the CONTENT repeats — a feed that ignores the
   *      cursor and re-serves page 1.
   *
   * Both look like progress from the inside. Left undetected, (1) walks
   * straight into a rate limit and then a challenge on the operator's own Turo
   * account, and (2) inflates the record count so a truncated read looks
   * abundant. Either way the run must STOP and report PAGINATION_STALLED, which
   * is writeSafe (what we read is real) and never releaseSafe.
   *
   * @param {object|null} next      the next PageRequest we are about to issue
   * @param {string[]} seenPageKeys page keys already requested this run
   * @param {string[]} pageIds      reservation ids on the page just read
   * @param {string[]} seenIds      reservation ids seen earlier this run
   * @returns {{stalled:boolean, reason:string|null}}
   */
  function detectStall(next, seenPageKeys, pageIds, seenIds) {
    if (next && seenPageKeys.indexOf(next.pageKey) !== -1) {
      return { stalled: true, reason: "Turo returned the same page cursor twice." };
    }
    if (pageIds.length > 0 && seenIds.length > 0) {
      var fresh = 0;
      for (var i = 0; i < pageIds.length; i++) {
        if (seenIds.indexOf(pageIds[i]) === -1) fresh++;
      }
      // Zero new records on a non-empty page means the feed is re-serving
      // content it already gave us, whatever the cursor claims.
      if (fresh === 0) {
        return { stalled: true, reason: "A new page returned only trips we already had." };
      }
    }
    return { stalled: false, reason: null };
  }

  /**
   * Merge a page's normalised records into the run, deduplicating on
   * reservationId. LAST WRITE WINS, which is correct: later pages are read
   * later, so on a feed that shifts under a paginated walk (a trip cancelled
   * mid-sync) the fresher observation is the one to keep.
   *
   * @returns {{added:string[], duplicates:number}}
   */
  function mergeRecords(into, records) {
    var index = Object.create(null);
    var i;
    for (i = 0; i < into.length; i++) index[into[i].reservationId] = i;
    var added = [], duplicates = 0;
    for (i = 0; i < records.length; i++) {
      var r = records[i];
      var at = index[r.reservationId];
      if (at === undefined) {
        index[r.reservationId] = into.length;
        into.push(r);
        added.push(r.reservationId);
      } else {
        into[at] = r;
        duplicates++;
      }
    }
    return { added: added, duplicates: duplicates };
  }

  // =========================================================================
  // 6. COVERAGE  —  "complete" is a POSITIVE CLAIM, never a default
  // =========================================================================

  /**
   * The defence against "8/8 green on a truncated read".
   *
   * `declaredTotal` is NEVER the denominator of a progress bar: it arrives over
   * the same connection, from the same possibly-degraded surface, as the
   * records themselves. A WAF that truncates a list can equally well report
   * `total: 8`. So it corroborates and never suffices.
   */
  function coverageVerdict(state) {
    var pages = state.pagesRead, seen = state.recordsSeen;
    var plan = state.plan || {};
    var v;

    if (state.pageFailed)            v = ["page_failed", false];
    else if (state.stalled)          v = ["stalled", false];
    else if (pages >= state.maxPages) v = ["page_cap_reached", false];
    else if (state.explicitEnd)      v = ["terminator_absent_next", true];
    else if (plan.style === "unknown") v = ["full_page_no_affordance", false];
    else if (state.lastPageShort && pages > 1) v = ["short_final_page", true];
    // Style "none" is only ever reached by a batch small enough that it cannot
    // be a truncated page, so a one-page run in that style IS the whole feed.
    else if (pages === 1 && plan.style === "none") v = ["single_short_page", true];
    else if (plan.declaredTotal !== null && plan.declaredTotal !== undefined && seen >= plan.declaredTotal) {
      // Corroborating only. Deliberately NOT complete on its own.
      v = ["matched_declared_total", false];
    }
    else v = ["full_page_no_affordance", false];

    var complete = v[1];
    return {
      complete: complete,
      evidence: v[0],
      pagesRead: pages,
      recordsSeen: seen,
      declaredTotal: plan.declaredTotal === undefined ? null : plan.declaredTotal,
      // The wording matters as much as the flag. An incomplete run must never
      // render "8 of 8".
      display: complete
        ? ("read all " + seen + " trip" + (seen === 1 ? "" : "s"))
        : ("read " + seen + " trip" + (seen === 1 ? "" : "s") + " (there may be more — " + v[0].replace(/_/g, " ") + ")")
    };
  }

  // =========================================================================
  // 7. TOLERANT NORMALISATION
  // =========================================================================

  // Every name below is a GUESS. Turo retired its public API and publishes no
  // schema. These are treated as HINTS: the parser scores candidate objects
  // rather than trusting any single key, and refuses to emit a date it is not
  // sure about. Being wrong here costs a reported unknown, never a wrong booking.
  var ID_KEYS = ["reservationId", "reservationCode", "reservation", "tripId", "trip",
    "bookingId", "booking", "code", "reference", "referenceNumber", "publicId", "uuid", "id"];
  var SUPERSEDE_KEYS = ["previousReservationId", "priorReservationId", "replacesReservationId",
    "originalReservationId", "rebookedFromId", "supersedesId", "parentReservationId"];
  var START_KEYS = ["startsAt", "startAt", "startDate", "startDateTime", "startTime", "start",
    "tripStart", "tripStartDate", "tripStartsAt", "pickup", "pickupAt", "pickupDate",
    "pickupDateTime", "checkInAt", "from", "fromDate", "beginsAt"];
  var END_KEYS = ["endsAt", "endAt", "endDate", "endDateTime", "endTime", "end",
    "tripEnd", "tripEndDate", "tripEndsAt", "return", "dropoff", "dropoffAt", "dropoffDate",
    "dropoffDateTime", "returnAt", "checkOutAt", "to", "toDate", "untilAt"];
  var TZ_KEYS = ["timeZone", "timezone", "tz", "ianaTimeZone", "zoneId", "timeZoneId"];
  var VEHICLE_KEYS = ["vehicle", "car", "listing", "vehicleDetails", "vehicleSummary"];
  var GUEST_KEYS = ["renter", "guest", "driver", "customer", "traveler", "traveller",
    "renterProfile", "guestProfile", "bookedBy", "user"];
  var MONEY_KEYS = ["total", "totalCost", "totalPrice", "cost", "price", "tripPrice",
    "earnings", "totalEarnings", "amount"];
  var STATUS_KEYS = ["status", "tripStatus", "reservationStatus", "state"];
  var PLATE_KEYS = ["licensePlate", "plate", "registration", "licensePlateNumber", "reg", "tag"];
  var VIN_KEYS = ["vin", "vehicleIdentificationNumber", "chassisNumber"];

  /**
   * Threshold 4 stops a stray {id, name} in a nav menu or a promo card from
   * winning. An id alone scores 2; an id plus one date scores 5.
   */
  var THRESHOLD = 4;

  function scoreCandidate(node) {
    if (!isObj(node)) return 0;
    var s = 0;
    if (pick(node, ID_KEYS) !== undefined) s += 2;
    if (toIso(pick(node, START_KEYS)) !== null) s += 3;
    if (toIso(pick(node, END_KEYS)) !== null) s += 3;
    if (isObj(pick(node, VEHICLE_KEYS))) s += 2;
    if (isObj(pick(node, GUEST_KEYS))) s += 2;
    var st = pick(node, STATUS_KEYS);
    if (typeof st === "string" && /book|confirm|upcoming|active|schedul|accept|progress|complet|cancel/i.test(st)) s += 1;
    return s;
  }

  /**
   * Breadth-first, so SHALLOWER candidates win ties — correct, because a trip
   * object always sits above its own vehicle/renter sub-objects.
   */
  function findBestCandidate(blob) {
    var best = null, bestScore = 0, visited = 0, queue = [blob];
    while (queue.length && visited < 5000) {
      var node = queue.shift();
      visited++;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length && i < 200; i++) {
          if (node[i] && typeof node[i] === "object") queue.push(node[i]);
        }
        continue;
      }
      if (!isObj(node)) continue;
      var s = scoreCandidate(node);
      if (s > bestScore) { bestScore = s; best = node; }
      var ks = Object.keys(node);
      for (var j = 0; j < ks.length; j++) {
        var v = node[ks[j]];
        if (v && typeof v === "object") queue.push(v);
      }
    }
    return { node: best, score: bestScore, visited: visited };
  }

  function unknown(field, reason, tried, sample, fatal) {
    return {
      field: field, reason: reason, candidatesTried: tried.slice(0, 12),
      sample: sample === null || sample === undefined ? null
        : clip(typeof sample === "string" ? sample : JSON.stringify(sample), 160),
      fatal: !!fatal
    };
  }

  function ev(route, key, confidence) {
    return { route: route, matchedKey: key || null, confidence: confidence };
  }

  /**
   * VEHICLE IDENTITY IS THE HARD PART.
   *
   * In OUR database `vehicles.reg` is globally unique (453/453 distinct) while
   * `vehicles.vin` is NOT (322 distinct across 396 rows). A VIN is therefore a
   * HINT and never a join key, however authoritative it looks — and this
   * function refuses to promote one into an identity.
   *
   * Older Turo exports carry nothing but a display string like
   * "Owner 1 Wagoneer (Jon) (CA #9DUC203)". We mine a plate out of the
   * "(XX #PLATE)" tail when it is there, and mark the result low-confidence and
   * review-required when it is not.
   */
  function readVehicle(node, claim) {
    var out = {
      turoVehicleId: null, plateNormalised: null, plateRaw: null, vinHint: null,
      label: null, year: null, make: null, model: null,
      evidence: "unbound", confidence: "low", requiresReview: true, raw: null
    };
    if (!isObj(node)) return out;
    out.raw = node;

    var idHit = pickE(node, ["vehicleId", "id", "listingId", "carId"]);
    if (idHit.value !== undefined) { out.turoVehicleId = String(idHit.value).trim(); if (claim) claim(idHit.key); }

    var plateHit = pickE(node, PLATE_KEYS);
    if (typeof plateHit.value === "string" && plateHit.value.trim()) {
      out.plateRaw = plateHit.value.trim();
      out.plateNormalised = out.plateRaw.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
      if (claim) claim(plateHit.key);
    }

    var vinHit = pickE(node, VIN_KEYS);
    if (typeof vinHit.value === "string" && /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(vinHit.value.trim())) {
      out.vinHint = vinHit.value.trim().toUpperCase();
      if (claim) claim(vinHit.key);
    }

    var yr = pick(node, ["year", "modelYear"]);
    var mk = pick(node, ["make", "brand", "manufacturer"]);
    var md = pick(node, ["model", "modelName"]);
    if (typeof yr === "number" || (typeof yr === "string" && /^\d{4}$/.test(yr))) out.year = Number(yr);
    if (typeof mk === "string" && mk.trim()) out.make = mk.trim();
    if (typeof md === "string" && md.trim()) out.model = md.trim();

    var parts = [out.year, out.make, out.model].filter(function (p) { return p !== null && String(p).trim(); });
    if (parts.length) out.label = parts.join(" ").trim();
    if (!out.label) {
      var lab = pickE(node, ["label", "name", "title", "displayName", "vehicleName", "headline", "description"]);
      if (typeof lab.value === "string" && lab.value.trim()) {
        out.label = lab.value.trim();
        if (claim) claim(lab.key);
        // "Owner 1 Wagoneer (Jon) (CA #9DUC203)" -> 9DUC203
        var m = out.label.match(/\(\s*[A-Z]{2}\s*#\s*([A-Z0-9-]{4,10})\s*\)\s*$/i);
        if (m && !out.plateNormalised) {
          out.plateRaw = m[1];
          out.plateNormalised = m[1].toUpperCase().replace(/[^A-Z0-9]/g, "");
          out.evidence = "label_plate_parsed";
        }
      }
    }
    if (!out.label && out.plateRaw) out.label = out.plateRaw;

    // Evidence ladder, strongest first. Never silently upgraded.
    if (out.turoVehicleId) { out.evidence = "turo_vehicle_id"; out.confidence = "high"; out.requiresReview = false; }
    else if (out.plateNormalised && out.evidence !== "label_plate_parsed") { out.evidence = "plate_exact"; out.confidence = "high"; out.requiresReview = false; }
    else if (out.evidence === "label_plate_parsed") { out.confidence = "medium"; out.requiresReview = true; }
    else if (out.vinHint) {
      // Deliberately capped at medium and review-required. Our own vin column
      // is not unique, so a VIN can never settle identity on its own.
      out.evidence = "vin_unique"; out.confidence = "medium"; out.requiresReview = true;
    }
    else if (out.label) { out.evidence = "label_fuzzy"; out.confidence = "low"; out.requiresReview = true; }
    return out;
  }

  function readGuest(node, claim) {
    if (!isObj(node)) return { name: null, id: null };
    var whole = pickE(node, ["name", "fullName", "displayName", "guestName", "renterName"]);
    var idHit = pickE(node, ["id", "userId", "renterId", "guestId"]);
    var id = idHit.value === undefined ? null : String(idHit.value).trim();
    if (claim && idHit.key) claim(idHit.key);
    if (typeof whole.value === "string" && whole.value.trim()) {
      if (claim) claim(whole.key);
      return { name: whole.value.trim(), id: id };
    }
    // Turo shows guests as "Marcus D." — first name plus an initial IS complete.
    var f = pick(node, ["firstName", "givenName", "first"]);
    var l = pick(node, ["lastName", "familyName", "surname", "last", "lastInitial", "lastNameInitial"]);
    var parts = [f, l].filter(function (p) { return typeof p === "string" && p.trim(); })
      .map(function (p) { return p.trim(); });
    return { name: parts.length ? parts.join(" ") : null, id: id };
  }

  function readMoney(node) {
    var out = { amount: null, currency: null };
    if (!isObj(node)) return out;
    var raw = pick(node, MONEY_KEYS), amount = null;
    if (typeof raw === "number" && isFinite(raw)) amount = raw;
    else if (isObj(raw)) {
      var inner = pick(raw, ["amount", "value", "total", "tripPrice", "cents"]);
      if (typeof inner === "number" && isFinite(inner)) amount = inner;
      else if (typeof inner === "string" && /^-?\d+(\.\d+)?$/.test(inner.trim())) amount = Number(inner.trim());
      var cur = pick(raw, ["currency", "currencyCode", "currencyIsoCode", "iso"]);
      if (typeof cur === "string" && cur.trim()) out.currency = cur.trim().slice(0, 8).toUpperCase();
    } else if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw.trim())) amount = Number(raw.trim());
    if (!out.currency) {
      var c2 = pick(node, ["currency", "currencyCode", "currencyIsoCode"]);
      if (typeof c2 === "string" && c2.trim()) out.currency = c2.trim().slice(0, 8).toUpperCase();
    }
    out.amount = (typeof amount === "number" && isFinite(amount)) ? amount : null;
    return out;
  }

  /**
   * `completed` IS NOT TERMINAL. Guests can extend a trip up to 24 hours AFTER
   * it ends and Turo auto-accepts, so a trip reading "completed" can become
   * active again. It maps to `completed_provisional`, never `completed`, and
   * the record carries `holdUntil = endsAt + 48h`. 48 not 24, because the
   * extension window is measured against Turo's clock, not ours.
   */
  var HOLD_MS = 48 * 60 * 60 * 1000;

  function lifecycleFrom(statusRaw) {
    if (typeof statusRaw !== "string" || !statusRaw.trim()) return "unknown";
    var s = statusRaw.toLowerCase();
    if (/cancel|declin|reject|withdraw|expire/.test(s)) return "cancelled";
    if (/progress|active|ongoing|started|pickedup|picked_up|checkedin/.test(s)) return "active";
    if (/complet|ended|finish|returned|checkedout/.test(s)) return "completed_provisional";
    if (/book|confirm|upcoming|schedul|accept|reserv|pending/.test(s)) return "upcoming";
    return "unknown";
  }

  /**
   * Unknown-shaped object -> ONE reservation with per-field provenance, a
   * confidence signal, a reported list of everything it could not find, and a
   * verbatim overflow of every key no extractor claimed.
   *
   * NOTHING IS EVER SILENTLY DEFAULTED. A field we cannot confidently read
   * becomes an entry in `unknowns` and lands in `rawOverflow`; it never becomes
   * a plausible-looking value. reservationId/startsAt/endsAt are REQUIRED —
   * a trip without dates is not a trip — and their absence rejects the record
   * rather than half-importing it.
   *
   * @returns {{record:object|null, rejected:object|null}}
   */
  function normalizeRecord(item) {
    try {
      if (!item || typeof item !== "object") {
        return { record: null, rejected: { reason: "below_threshold", unknowns: [], observedKeys: [], rawSample: null } };
      }
      var found = findBestCandidate(item);
      var best = found.node;
      var observedKeys = isObj(item) ? Object.keys(item).slice(0, 40) : [];
      if (!best || found.score < THRESHOLD) {
        return { record: null, rejected: { reason: "below_threshold", unknowns: [], observedKeys: observedKeys, rawSample: sample(item) } };
      }

      var claimed = Object.create(null);
      function claim(k) { if (k) claimed[normKey(k)] = true; }

      var unknowns = [], evidence = {};

      // --- id ---------------------------------------------------------------
      // Prefer a reservation-flavoured key over a bare `id`: on a feed card,
      // `id` is as likely to be the CARD's id as the booking's.
      var idAliases = ID_KEYS.filter(function (k) { return k !== "id"; });
      var idHit = pickE(best, idAliases);
      var idRoute = "direct";
      if (idHit.value === undefined) { idHit = pickE(best, ["id"]); idRoute = idHit.value === undefined ? "absent" : "derived"; }
      var reservationId = (typeof idHit.value === "string" || typeof idHit.value === "number")
        ? String(idHit.value).trim() : null;
      claim(idHit.key);
      evidence.reservationId = ev(reservationId ? idRoute : "absent", idHit.key, reservationId ? (idRoute === "direct" ? "high" : "medium") : "rejected");
      if (!reservationId) unknowns.push(unknown("reservation_id", "no_key_matched", ID_KEYS, null, true));

      // --- dates ------------------------------------------------------------
      var startD = pickDeepE(best, START_KEYS, 3);
      var endD = pickDeepE(best, END_KEYS, 3);
      var startsAt = toIso(startD.value);
      var endsAt = toIso(endD.value);
      claim(startD.key); claim(endD.key);

      if (!startsAt) {
        unknowns.push(unknown("starts_at",
          startD.value === undefined ? "no_key_matched" : "display_string_refused",
          START_KEYS, startD.value, true));
      }
      if (!endsAt) {
        unknowns.push(unknown("ends_at",
          endD.value === undefined ? "no_key_matched" : "display_string_refused",
          END_KEYS, endD.value, true));
      }
      evidence.startsAt = ev(startsAt ? startD.route : "absent", startD.key, startsAt ? (startD.route === "direct" ? "high" : "medium") : "rejected");
      evidence.endsAt = ev(endsAt ? endD.route : "absent", endD.key, endsAt ? (endD.route === "direct" ? "high" : "medium") : "rejected");

      if (!reservationId || !startsAt || !endsAt) {
        return { record: null, rejected: {
          reason: !reservationId ? "missing_id" : "missing_dates",
          unknowns: unknowns, observedKeys: Object.keys(best).slice(0, 40), rawSample: sample(best)
        } };
      }
      if (new Date(endsAt) <= new Date(startsAt)) {
        unknowns.push(unknown("ends_at", "value_ambiguous", END_KEYS, endsAt, true));
        return { record: null, rejected: { reason: "impossible_dates", unknowns: unknowns, observedKeys: Object.keys(best).slice(0, 40), rawSample: sample(best) } };
      }

      // --- timezone ---------------------------------------------------------
      // `blocked_dates` is DATE-only with an INCLUSIVE end while Turo trips are
      // timestamps. Converting a timestamp to a calendar date in the wrong zone
      // is how a same-day turnaround becomes a double-booking, so an absent
      // zone is REPORTED rather than assumed to be UTC or the browser's.
      var tzHit = pickDeepE(best, TZ_KEYS, 3);
      var timezone = typeof tzHit.value === "string" && tzHit.value.trim() ? tzHit.value.trim() : null;
      claim(tzHit.key);
      evidence.timezone = ev(timezone ? tzHit.route : "absent", tzHit.key, timezone ? "medium" : "low");
      if (!timezone) unknowns.push(unknown("timezone", "no_key_matched", TZ_KEYS, null, false));

      // --- vehicle ----------------------------------------------------------
      var vHit = pickE(best, VEHICLE_KEYS);
      claim(vHit.key);
      var vehicle = readVehicle(isObj(vHit.value) ? vHit.value : best, claim);
      evidence.vehicle = ev(isObj(vHit.value) ? "direct" : "derived", vHit.key, vehicle.confidence);
      if (vehicle.evidence === "unbound") {
        unknowns.push(unknown("vehicle", "no_key_matched", VEHICLE_KEYS.concat(PLATE_KEYS), null, false));
      }

      // --- guest ------------------------------------------------------------
      var gHit = pickE(best, GUEST_KEYS);
      claim(gHit.key);
      var guest = readGuest(isObj(gHit.value) ? gHit.value : null, claim);
      evidence.guestName = ev(guest.name ? "direct" : "absent", gHit.key, guest.name ? "high" : "low");
      if (!guest.name) unknowns.push(unknown("guest_name", "no_key_matched", GUEST_KEYS, null, false));

      // --- status / money / supersede --------------------------------------
      var stHit = pickE(best, STATUS_KEYS);
      claim(stHit.key);
      var statusRaw = null;
      if (typeof stHit.value === "string") statusRaw = stHit.value.trim().slice(0, 40);
      else if (isObj(stHit.value)) {
        var inner = pick(stHit.value, ["value", "code", "name", "label"]);
        if (typeof inner === "string") statusRaw = inner.trim().slice(0, 40);
      }
      var lifecycle = lifecycleFrom(statusRaw);
      evidence.turoStatusRaw = ev(statusRaw ? "direct" : "absent", stHit.key, statusRaw ? "high" : "low");
      if (!statusRaw) unknowns.push(unknown("turo_status", "no_key_matched", STATUS_KEYS, null, false));

      var money = readMoney(best);
      var mHit = pickE(best, MONEY_KEYS);
      claim(mHit.key);
      evidence.totalAmount = ev(money.amount === null ? "absent" : "direct", mHit.key, money.amount === null ? "low" : "high");

      // A trip can be MOVED to a different vehicle or reissued under a new id by
      // a Turo agent. When the feed volunteers the prior id we keep it, so a
      // reconciler can follow the move instead of seeing one trip vanish and an
      // unrelated one appear — which, without this, reads as a disappearance.
      var supHit = pickE(best, SUPERSEDE_KEYS);
      claim(supHit.key);
      var supersedes = supHit.value === undefined ? null : String(supHit.value).trim();

      // --- confidence -------------------------------------------------------
      var confidence = "high";
      if (startD.route !== "direct" || endD.route !== "direct" || idRoute !== "direct") confidence = "medium";
      if (vehicle.confidence === "low") confidence = confidence === "high" ? "medium" : "low";
      var softUnknowns = unknowns.filter(function (u) { return !u.fatal; }).length;
      if (softUnknowns >= 3) confidence = "low";

      // --- overflow ---------------------------------------------------------
      // Every top-level key no extractor claimed, verbatim. This is what makes
      // being wrong survivable: when Turo renames `endsAt` to `tripEndTs`, the
      // value is still here, `ends_at` is reported as an unknown, the record is
      // rejected rather than guessed, and the fix is a one-line alias addition
      // informed by a payload we actually kept.
      var rawOverflow = {};
      var bk = Object.keys(best);
      for (var i = 0; i < bk.length; i++) {
        if (!claimed[normKey(bk[i])]) rawOverflow[bk[i]] = best[bk[i]];
      }

      return {
        record: {
          reservationId: reservationId,
          supersedesReservationId: supersedes,
          startsAt: startsAt,
          endsAt: endsAt,
          timezone: timezone,
          holdUntil: new Date(new Date(endsAt).getTime() + HOLD_MS).toISOString(),
          vehicle: vehicle,
          guestName: guest.name,
          guestId: guest.id,
          lifecycle: lifecycle,
          turoStatusRaw: statusRaw,
          totalAmount: money.amount,
          currency: money.currency,
          confidence: confidence,
          requiresReview: confidence !== "high",
          evidence: evidence,
          unknowns: unknowns,
          raw: best,
          rawOverflow: rawOverflow
        },
        rejected: null
      };
    } catch (e) {
      // An unrecognised shape must never throw inside a service worker that is
      // about to be recycled anyway.
      return { record: null, rejected: { reason: "below_threshold", unknowns: [], observedKeys: [], rawSample: null } };
    }
  }

  function sample(o) {
    try { return JSON.parse(JSON.stringify(o).slice(0, 2000) + (JSON.stringify(o).length > 2000 ? "" : "")); }
    catch (e) { return null; }
  }

  // =========================================================================
  // 8. SESSION PROBE  —  how "empty" is told apart from "blocked"
  // =========================================================================

  /**
   * An empty trips list means NOTHING on its own. Not-logged-in, a WAF 200, a
   * renamed envelope key and a genuinely empty calendar produce identical
   * bytes. So an empty read is only ever promoted to NO_TRIPS_CONFIRMED when a
   * SECOND, INDEPENDENT endpoint says the session is healthy.
   *
   * /api/vehicles/me is the right probe: we want it anyway for vehicle binding,
   * and a non-empty vehicle list proves the cookie jar, the WAF and the JSON
   * surface are all working at the moment we read zero trips.
   *
   * `vehicles_empty` deliberately does NOT set liveSession: an operator we are
   * migrating OFF Turo owns cars by definition, so zero vehicles AND zero trips
   * is far likelier a degraded surface than a real state.
   */
  /**
   * NOTE ON `turoAccountFingerprint`: this function is synchronous and hashing
   * is not, so it always returns null here. The orchestrator must fill it in
   * with `await fingerprint(probe.turoHostId)` before persisting the cursor —
   * without that, resumeDecision()'s Turo-account guard has nothing to compare
   * and silently degrades to a no-op.
   */
  function buildSessionProbe(vehiclesRead, sawTripsThisRun) {
    var now = new Date().toISOString();
    if (sawTripsThisRun) {
      return { liveSession: true, evidence: "trips_seen_this_run", turoHostId: null, turoAccountFingerprint: null, probeOutcome: OUTCOME.OK, probedAt: now };
    }
    if (!vehiclesRead || vehiclesRead.outcome !== OUTCOME.OK) {
      return { liveSession: false, evidence: "none", turoHostId: null, turoAccountFingerprint: null, probeOutcome: vehiclesRead ? vehiclesRead.outcome : OUTCOME.UNREACHABLE, probedAt: now };
    }
    var hostId = vehiclesRead.turoHostId || null;
    if (vehiclesRead.items && vehiclesRead.items.length > 0) {
      return { liveSession: true, evidence: "vehicles_nonempty", turoHostId: hostId, turoAccountFingerprint: null, probeOutcome: OUTCOME.OK, probedAt: now };
    }
    if (hostId) {
      return { liveSession: true, evidence: "host_id_in_envelope", turoHostId: hostId, turoAccountFingerprint: null, probeOutcome: OUTCOME.OK, probedAt: now };
    }
    return { liveSession: false, evidence: "vehicles_empty", turoHostId: null, turoAccountFingerprint: null, probeOutcome: OUTCOME.OK, probedAt: now };
  }

  // =========================================================================
  // 9. ABSENCE LEDGER  —  absence must never delete
  // =========================================================================

  /**
   * Compare this run's ids against the previous run's manifest.
   *
   * `absent_only` — "it just was not in the response" — is NOT evidence of
   * anything and never sets releaseAllowed, no matter how many consecutive runs
   * repeat it. Repeating an unreliable observation does not make it reliable;
   * a WAF that returns 200-with-nothing does so every time.
   *
   * Releasing a block requires POSITIVE evidence: a record we READ that says
   * cancelled, a targeted 404 on that one reservation, or a supersede pointer
   * to a reservation we DID see this run.
   */
  function diffAbsences(previousManifest, thisRun) {
    var prevIds = (previousManifest && previousManifest.seenReservationIds) || [];
    if (!prevIds.length) return [];

    var seenNow = Object.create(null);
    var cancelledNow = Object.create(null);
    var supersedeTargets = Object.create(null);
    var i;
    for (i = 0; i < thisRun.reservations.length; i++) {
      var r = thisRun.reservations[i];
      seenNow[r.reservationId] = true;
      if (r.lifecycle === "cancelled") cancelledNow[r.reservationId] = true;
      if (r.supersedesReservationId) supersedeTargets[r.supersedesReservationId] = r.reservationId;
    }

    var priorCounts = (previousManifest && previousManifest.absentRunCounts) || {};
    var out = [];
    for (i = 0; i < prevIds.length; i++) {
      var id = prevIds[i];
      if (seenNow[id] && !cancelledNow[id]) continue;

      var evidence, allowed;
      if (cancelledNow[id])           { evidence = "explicit_cancelled_status"; allowed = true; }
      else if (supersedeTargets[id])  { evidence = "superseded"; allowed = false; }
      else if (thisRun.targeted404 && thisRun.targeted404[id]) { evidence = "targeted_404"; allowed = true; }
      else                            { evidence = "absent_only"; allowed = false; }

      out.push({
        reservationId: id,
        evidence: evidence,
        // Belt and braces: even positive evidence cannot release from a run
        // whose coverage is incomplete or whose session is uncorroborated.
        releaseAllowed: allowed && thisRun.mayRelease,
        consecutiveAbsentRuns: evidence === "absent_only" ? ((priorCounts[id] || 0) + 1) : 0,
        lastSeenAt: (previousManifest && previousManifest.finishedAt) || previousManifest.startedAt || null
      });
    }
    return out;
  }

  // =========================================================================
  // 10. THE TWO GATES
  // =========================================================================

  /**
   * `mayRelease` is the conjunction of THREE independent facts and nothing less
   * will do:
   *   1. the outcome itself permits release (OK or NO_TRIPS_CONFIRMED)
   *   2. the walk demonstrably covered the whole feed
   *   3. the session was independently corroborated
   *
   * A clean OK on a truncated walk does not release. A complete walk on an
   * uncorroborated session does not release. Any one of these failing is enough
   * to leave every existing block exactly where it is — which is always the
   * safe direction, because a stale block costs one manual unblock while a
   * wrongly-released block double-sells a car that is physically out on rent.
   */
  function finaliseRun(run) {
    var policy = policyFor(run.outcome);
    var mayWrite = policy.writeSafe;
    var coverageOk = !!(run.coverage && run.coverage.complete);
    var sessionOk = !!(run.session && run.session.liveSession);
    var mayRelease = policy.releaseSafe && coverageOk && sessionOk;

    var reason;
    if (mayRelease) reason = "Full, corroborated read — absences can be trusted.";
    else if (!policy.releaseSafe) reason = "Outcome " + run.outcome + " cannot be trusted to prove a trip ended; nothing was released.";
    else if (!coverageOk) reason = "The read was incomplete (" + run.coverage.evidence.replace(/_/g, " ") + "); nothing was released.";
    else reason = "Could not independently confirm the Turo session was healthy; nothing was released.";

    run.policy = policy;
    run.mayWrite = mayWrite;
    run.mayRelease = mayRelease;
    run.gateReason = reason;
    return run;
  }

  // =========================================================================
  // 11. RATE DISCIPLINE
  // =========================================================================

  var LIMITS = {
    concurrency: 1,          // serial only; concurrency against a WAF is never an option
    baseDelayMs: 1200,
    jitterMs: 400,           // uniform pacing is itself a bot signal
    backoffLadderMs: [5000, 15000, 45000],
    maxThrottleStrikes: 3,
    maxPages: 60,            // 60 * ~200 = 12k trips, far beyond any real fleet
    maxRunMs: 5 * 60 * 1000,
    challengeCooldownMs: 15 * 60 * 1000
  };

  function pacingDelayMs() {
    return LIMITS.baseDelayMs + Math.floor((Math.random() * 2 - 1) * LIMITS.jitterMs);
  }

  /**
   * What to do after a throttle or a challenge.
   *
   * On BOT_BLOCKED we issue ZERO further requests and park for a full
   * cool-down. Retrying into a live challenge is what escalates a soft check
   * into a hard block on the OPERATOR'S OWN Turo account — the one asset in
   * this integration we cannot replace.
   */
  function throttleDecision(outcome, strikes, retryAfterSeconds) {
    if (outcome === OUTCOME.BOT_BLOCKED) {
      return { action: "park", waitMs: LIMITS.challengeCooldownMs, strikes: strikes + 1,
        reason: "Bot challenge — stopping immediately and cooling down." };
    }
    if (outcome === OUTCOME.RATE_LIMITED) {
      var next = strikes + 1;
      if (next > LIMITS.maxThrottleStrikes) {
        return { action: "park", waitMs: LIMITS.backoffLadderMs[LIMITS.backoffLadderMs.length - 1], strikes: next,
          reason: "Rate limited repeatedly — parking with the cursor intact." };
      }
      // Retry-After, when the edge sends one, always wins over our ladder.
      var ladder = LIMITS.backoffLadderMs[Math.min(next - 1, LIMITS.backoffLadderMs.length - 1)];
      var waitMs = (typeof retryAfterSeconds === "number" && retryAfterSeconds > 0)
        ? Math.max(retryAfterSeconds * 1000, ladder) : ladder;
      return { action: "retry", waitMs: waitMs, strikes: next, reason: "Backing off before retrying the same page." };
    }
    return { action: "continue", waitMs: pacingDelayMs(), strikes: 0, reason: "" };
  }

  // =========================================================================
  // 12. RESUMABILITY
  //
  // MV3 kills the service worker at any time, and nothing runs at all while
  // Chrome is quit. The worker therefore holds NO run state in memory — memory
  // does not survive, and a design that pretends otherwise silently restarts
  // (or half-writes) every time Chrome reclaims the worker.
  //
  // These are PURE functions over the cursor object. Persisting it is the
  // caller's job (chrome.storage.local), because chrome.* cannot be referenced
  // from this file — it must also run in the MAIN world, where chrome.* does
  // not exist at all.
  // =========================================================================

  function newCursor(runId, tokenFingerprint, firstPage) {
    var now = new Date().toISOString();
    return {
      runId: runId, phase: "probing_session", seq: 1,
      tokenFingerprint: tokenFingerprint, turoAccountFingerprint: null,
      pending: firstPage || null, receipts: [], pagination: null, session: null,
      flushedIds: [], throttleStrikes: 0, nextAllowedAt: null,
      startedAt: now, updatedAt: now, parkedReason: null
    };
  }

  /**
   * Advance the cursor. Call this and PERSIST THE RESULT BEFORE the await it
   * describes — the whole point is that the intent is durable before the thing
   * it intends can be interrupted.
   */
  function advanceCursor(cursor, patch) {
    var next = {};
    var ks = Object.keys(cursor);
    for (var i = 0; i < ks.length; i++) next[ks[i]] = cursor[ks[i]];
    var pk = Object.keys(patch || {});
    for (var j = 0; j < pk.length; j++) next[pk[j]] = patch[pk[j]];
    next.seq = cursor.seq + 1;
    next.updatedAt = new Date().toISOString();
    return next;
  }

  /**
   * A receipt is written only AFTER the page's records have been acknowledged
   * by the ingest — never before. Resume replays from the last RECEIPT, not the
   * last fetch, so a worker killed between "fetch returned" and "ingest acked"
   * simply re-does that one page. At-least-once, which is safe because the
   * ingest upserts on (tenant_id, reservation_id): see
   * supabase/functions/turo-bridge-ingest/index.ts and the
   * turo_bridge_reservations_tenant_reservation_key unique constraint.
   */
  function commitReceipt(cursor, pageRequest, reservationIds) {
    var receipts = cursor.receipts.slice();
    receipts.push({
      pageKey: pageRequest.pageKey, index: pageRequest.index,
      recordCount: reservationIds.length, reservationIds: reservationIds.slice(0, 500),
      committedAt: new Date().toISOString()
    });
    var flushed = cursor.flushedIds.slice();
    for (var i = 0; i < reservationIds.length; i++) {
      if (flushed.indexOf(reservationIds[i]) === -1) flushed.push(reservationIds[i]);
    }
    return advanceCursor(cursor, { receipts: receipts, flushedIds: flushed, pending: null });
  }

  /**
   * Decide what a stored cursor is good for. Called on every worker wake-up.
   *
   * THE TENANT GUARD IS THE POINT. One Chrome profile holds ONE Turo cookie jar
   * and can be paired to TWO different Drive247 tenants over its life. If the
   * pairing token no longer fingerprints to the cursor's value, the operator
   * re-paired to a different tenant and this run is ABANDONED, not resumed.
   * Flushing tenant A's pages under tenant B's token is the worst outcome
   * available in this system, and it is unrecoverable once written.
   *
   * The same guard applies to the Turo side: switching Turo accounts mid-run
   * abandons the run rather than mixing two hosts' fleets into one tenant.
   */
  function resumeDecision(cursor, ctx) {
    if (!cursor || !cursor.runId) return no("no_run", "Nothing to resume.");
    if (cursor.phase === "done") return no("already_done", "That run already finished.");
    if (cursor.tokenFingerprint !== ctx.tokenFingerprint) {
      return no("tenant_changed",
        "The pairing token changed since that run started — it belonged to a different Drive247 tenant. Abandoning it rather than risking a cross-tenant write.");
    }
    if (cursor.turoAccountFingerprint && ctx.turoAccountFingerprint &&
        cursor.turoAccountFingerprint !== ctx.turoAccountFingerprint) {
      return no("turo_account_changed",
        "A different Turo account is signed in now. Abandoning the paused run rather than mixing two hosts' trips.");
    }
    var age = Date.now() - new Date(cursor.startedAt).getTime();
    if (age > 24 * 60 * 60 * 1000) {
      return no("stale", "That paused run is over a day old; starting fresh so the data is current.");
    }
    if (cursor.nextAllowedAt && new Date(cursor.nextAllowedAt).getTime() > Date.now()) {
      return { resume: false, restart: false, wait: true,
        waitMs: new Date(cursor.nextAllowedAt).getTime() - Date.now(),
        reason: "still_cooling_down", message: "Waiting out a Turo rate limit before continuing." };
    }
    // A pending page with no receipt is simply re-requested. Deterministic
    // pageKey + idempotent ingest makes that a no-op if it had in fact landed.
    return { resume: true, restart: false, wait: false, waitMs: 0,
      reason: "resumable",
      message: "Continuing from page " + (cursor.receipts.length) + " of the paused sync." };

    function no(reason, message) {
      return { resume: false, restart: true, wait: false, waitMs: 0, reason: reason, message: message };
    }
  }

  // =========================================================================
  // 13. THE LIVE READ  —  one HTTP request, TAB CONTEXT ONLY
  // =========================================================================

  /**
   * Fetch ONE page from inside this tab and classify what came back. Returns a
   * plain, structured-cloneable object: it crosses the executeScript bridge, so
   * no Errors, no functions, no cycles.
   *
   * @param {{pageKey:string, path:string, index:number}} pageRequest
   * @param {object|null} prevPlan  the pagination plan locked on page 0
   */
  async function readPage(pageRequest, prevPlan) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    // Captured BEFORE the fetch: if Turo already bounced this tab to /login,
    // that settles "not logged in" without guessing from a response body.
    var pageUrl = String(location.href);
    var pageLooksLoggedOut = /\/(login|signin|sign-in)\b/i.test(location.pathname);

    var base = {
      pageKey: pageRequest.pageKey, world: worldName(), httpStatus: null,
      finalUrl: null, bytes: null, envelopeKeys: [], snippet: null,
      retryAfterSeconds: null, items: [], next: null,
      plan: prevPlan || { style: "unknown", matchedKeys: [], observedPageSize: null, declaredTotal: null, confidence: "low" }
    };

    try {
      var res = await fetch(pageRequest.path, {
        // Same-origin, so cookies ride along anyway; explicit because this is
        // the property that matters if the path ever stops being relative.
        credentials: "include",
        // ONLY this header. User-Agent / Referer / Origin / Cookie are
        // forbidden headers that fetch silently drops, and a PARTIAL imitation
        // fingerprints WORSE than none — it produces a header set no real
        // browser emits. "no-cors" is likewise wrong: it would make the body
        // opaque and unreadable.
        headers: { accept: "application/json" },
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal
      });

      base.httpStatus = res.status;
      base.finalUrl = res.url || pageRequest.path;
      var ra = res.headers.get("retry-after");
      if (ra) {
        var n = Number(ra);
        base.retryAfterSeconds = isFinite(n) ? n : null;
      }
      var declaredLength = Number(res.headers.get("content-length"));
      var body = await res.text();
      base.bytes = body.length;

      var verdict = classifyBody({
        status: res.status, contentType: res.headers.get("content-type"),
        body: body, finalUrl: base.finalUrl, pageLooksLoggedOut: pageLooksLoggedOut
      });
      base.snippet = verdict.snippet;

      if (verdict.outcome !== OUTCOME.OK) {
        return fin(verdict.outcome, verdict.message);
      }

      // A body shorter than the Content-Length the edge promised is a truncated
      // stream that happened to still parse. Rare, and it is precisely the
      // failure that produces "fewer records" with no other symptom.
      if (isFinite(declaredLength) && declaredLength > 0 && body.length < declaredLength) {
        return fin(OUTCOME.TRUNCATED,
          "Turo's response was cut short (" + body.length + " of " + declaredLength + " bytes).");
      }

      var ex = extractItems(verdict.json);
      base.envelopeKeys = ex.envelopeKeys;
      base.items = ex.items;

      // NO CONTAINER AT ALL is not emptiness — it is an envelope we do not
      // recognise. Collapsing the two is how a renamed key silently reports
      // "no upcoming trips", which is indistinguishable from the truth and
      // therefore the most misleading thing this extension could say.
      if (!ex.found) {
        return fin(OUTCOME.UNKNOWN,
          "Turo returned JSON we did not recognise (keys: " + ex.envelopeKeys.join(", ") + ").");
      }

      var det = detectPagination(verdict.json, ex.items, prevPlan);
      base.plan = det.plan;
      base.next = buildNextRequest(pageRequest.path, det, pageRequest.index);

      if (ex.items.length === 0) {
        // Explicitly empty CONTAINER. Still not "no trips" — that verdict needs
        // a corroborating session probe, which only the orchestrator can do.
        return fin(OUTCOME.EMPTY_UNCONFIRMED,
          "Turo returned an empty list. Confirming the session before trusting it.");
      }
      return fin(OUTCOME.OK, "Read " + ex.items.length + " item(s) from " + (ex.containerKey || "the feed") + ".");
    } catch (e) {
      var aborted = e && e.name === "AbortError";
      return fin(OUTCOME.UNREACHABLE,
        aborted ? "The request to Turo timed out." : "Could not reach Turo: " + String((e && e.message) || e));
    } finally {
      clearTimeout(timer);
    }

    function fin(outcome, message) {
      base.outcome = outcome;
      base.message = message;
      return base;
    }
  }

  /**
   * GET /api/vehicles/me — the host's own fleet.
   *
   * Serves TWO purposes and both matter:
   *   1. the vehicle identity material a trip binds to
   *   2. the independent session probe that lets an empty trips list be told
   *      apart from a blocked one (section 8)
   */
  async function readVehicles() {
    var page = { pageKey: "vehicles", path: VEHICLES_PATH, index: 0 };
    var r = await readPage(page, null);
    var out = {
      outcome: r.outcome, message: r.message, httpStatus: r.httpStatus,
      envelopeKeys: r.envelopeKeys, items: [], vehicles: [], turoHostId: null
    };
    if (r.outcome !== OUTCOME.OK) return out;
    out.items = r.items;
    for (var i = 0; i < r.items.length; i++) {
      out.vehicles.push(readVehicle(r.items[i], null));
    }
    // Turo's own id for the signed-in host. Two jobs: it is a session signal in
    // its own right (`host_id_in_envelope`), and hashed it becomes the guard
    // that abandons a resumed run when the operator has switched Turo accounts
    // between the crash and the resume — see resumeDecision().
    for (var j = 0; j < r.items.length && !out.turoHostId; j++) {
      var owner = pick(r.items[j], ["owner", "host", "ownerProfile", "hostProfile"]);
      var hid = isObj(owner) ? pick(owner, ["id", "userId", "hostId", "ownerId"])
                             : pick(r.items[j], ["ownerId", "hostId"]);
      if (hid !== undefined && hid !== null && String(hid).trim()) out.turoHostId = String(hid).trim();
    }
    return out;
  }

  /** Best-effort label for the log line. `chrome` is undefined in MAIN. */
  function worldName() {
    try {
      return (typeof chrome !== "undefined" && chrome && chrome.runtime && chrome.runtime.id) ? "ISOLATED" : "MAIN";
    } catch (e) { return "MAIN"; }
  }

  // =========================================================================
  // 14. EXPORTS
  // =========================================================================

  globalThis.__d247TuroRead = {
    __version: VERSION,
    OUTCOME: OUTCOME,
    POLICY: POLICY,
    LIMITS: LIMITS,
    TRIPS_PATH: TRIPS_PATH,
    VEHICLES_PATH: VEHICLES_PATH,

    // tab context only (they touch fetch/location)
    readPage: readPage,
    readVehicles: readVehicles,

    // pure — safe in the worker, the tab, or a unit test
    policyFor: policyFor,
    worstOutcome: worstOutcome,
    classifyBody: classifyBody,
    extractItems: extractItems,
    detectPagination: detectPagination,
    buildNextRequest: buildNextRequest,
    coverageVerdict: coverageVerdict,
    detectStall: detectStall,
    mergeRecords: mergeRecords,
    normalizeRecord: normalizeRecord,
    readVehicle: readVehicle,
    buildSessionProbe: buildSessionProbe,
    diffAbsences: diffAbsences,
    finaliseRun: finaliseRun,
    throttleDecision: throttleDecision,
    pacingDelayMs: pacingDelayMs,
    newCursor: newCursor,
    advanceCursor: advanceCursor,
    commitReceipt: commitReceipt,
    resumeDecision: resumeDecision,
    fingerprint: fingerprint,

    _internals: { toIso: toIso, pickE: pickE, pickDeepE: pickDeepE, scoreCandidate: scoreCandidate, findBestCandidate: findBestCandidate, lifecycleFrom: lifecycleFrom }
  };
})();
