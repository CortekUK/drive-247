/**
 * content-turo.js — reads ONE upcoming reservation out of the operator's own
 * logged-in Turo session, normalises it, and falls back to the bundled fixture
 * whenever real data is not available.
 *
 * =====================================================================
 * INJECTION CONTRACT — read this before changing anything in here.
 * =====================================================================
 * This file is injected into a turo.com tab by background.js with
 * chrome.scripting.executeScript({ files: [...] }), and then invoked by a
 * SECOND executeScript call whose `func` is the bare arrow
 *     () => globalThis.__d247TuroBridge.collectOneReservation()
 * whose resolved value comes back in result[0].result.
 *
 * It must therefore be safe in THREE contexts and it uses NO chrome.* API, so
 * that it is:
 *   - ISOLATED world  (the default attempt)
 *   - MAIN world      (the retry, where chrome.* does not exist at all)
 *   - the service worker (importScripts, for the normaliser only — the worker
 *     never calls collectOneReservation(), which touches location/fetch)
 *
 * WHY ISOLATED FIRST, MAIN SECOND
 * The trips URL is requested as a RELATIVE path, so from a turo.com tab it is
 * definitionally same-origin. A same-origin fetch from the isolated world sends
 * no Origin header, Sec-Fetch-Site: same-origin, and the page's first-party
 * cookies — indistinguishable on the wire from Turo's own XHR, with no
 * page-visible footprint and no exposure to the page's own globals or CSP.
 * A fetch from the SERVICE WORKER would instead send
 * Origin: chrome-extension://<id>, Sec-Fetch-Site: cross-site and no Referer,
 * which is a textbook non-browser-page fingerprint; that is why the read never
 * happens there.
 * The one thing the isolated world cannot do is see a header minted by the
 * page's own JS (a CSRF value or an x-px-authorization held in a window global,
 * attached by a fetch wrapper the SPA installed). If Turo ever requires that,
 * the isolated attempt comes back BOT_BLOCKED / NOT_LOGGED_IN and background.js
 * retries the identical code in the MAIN world, where the page's fetch wrapper
 * runs. That is the entire reason both worlds exist; nothing else differs.
 *
 * WHAT WE NEVER DO
 * We never ask for, store, or transmit Turo credentials. We read the session
 * that is already open in the operator's browser and nothing else. There is no
 * login form anywhere in this extension by design — Turo's terms forbid
 * disclosing a password to a third party.
 */

(function () {
  "use strict";

  // Re-injection is normal (click Sync twice and the files are injected twice).
  // Bail out early so we do not clobber an in-flight call's closures.
  if (globalThis.__d247TuroBridge && globalThis.__d247TuroBridge.__version === 2) return;

  // ------------------------------------------------------------------ config

  /* RELATIVE on purpose: resolved against the tab's own origin, which is what
     makes the request same-origin and keeps an Origin header off the wire.
     Confirmed endpoint (recovered from an unminified shipping bridge script);
     the response SHAPE is not confirmed by anything. */
  var TRIPS_PATH = "/api/v2/feeds/upcoming-trips?appMode=HOST";
  var TIMEOUT_MS = 9000;
  var MAX_BYTES = 4 * 1024 * 1024;

  var OUTCOME = {
    OK: "OK",                       // JSON, and it held at least one trip
    NO_TRIPS: "NO_TRIPS",           // JSON, well formed, explicitly empty
    NOT_LOGGED_IN: "NOT_LOGGED_IN", // no host session in this browser
    BOT_BLOCKED: "BOT_BLOCKED",     // Cloudflare / PerimeterX interstitial
    RATE_LIMITED: "RATE_LIMITED",   // 429
    UNREACHABLE: "UNREACHABLE",     // network error or timeout
    UNPARSEABLE: "UNPARSEABLE",     // 200 JSON, but no reservation we can trust
    UNKNOWN: "UNKNOWN"              // 2xx-but-unrecognised, or unattributable HTML
  };

  // ------------------------------------------------- field-name candidates --
  // Turo retired its public API and publishes no schema for this endpoint, so
  // every name below is a guess. The parser treats them as HINTS: it scores
  // candidate objects instead of trusting any single key, and it refuses to
  // produce a date it is not sure about. Being wrong here costs a fixture
  // fallback with an honest reason, never a wrong booking.

  var ID_KEYS = ["reservationId", "reservationCode", "reservation", "tripId", "trip",
    "bookingId", "booking", "code", "reference", "referenceNumber", "publicId", "uuid", "id"];
  var START_KEYS = ["startsAt", "startAt", "startDate", "startDateTime", "startTime", "start",
    "tripStart", "tripStartDate", "tripStartsAt", "pickup", "pickupAt", "pickupDate",
    "pickupDateTime", "checkInAt", "from", "fromDate", "beginsAt"];
  var END_KEYS = ["endsAt", "endAt", "endDate", "endDateTime", "endTime", "end",
    "tripEnd", "tripEndDate", "tripEndsAt", "return", "dropoff", "dropoffAt", "dropoffDate",
    "dropoffDateTime", "returnAt", "checkOutAt", "to", "toDate", "untilAt"];
  var VEHICLE_KEYS = ["vehicle", "car", "listing", "vehicleDetails", "vehicleSummary"];
  var GUEST_KEYS = ["renter", "guest", "driver", "customer", "traveler", "traveller",
    "renterProfile", "guestProfile", "bookedBy", "user"];
  var MONEY_KEYS = ["total", "totalCost", "totalPrice", "cost", "price", "tripPrice",
    "earnings", "totalEarnings", "amount"];
  var STATUS_KEYS = ["status", "tripStatus", "reservationStatus", "state"];

  // ----------------------------------------------------------- tiny helpers

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function normKey(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  /** Case- and separator-insensitive lookup: reservationId == reservation_id == RESERVATION-ID. */
  function pick(obj, aliases) {
    if (!isObj(obj)) return undefined;
    var index = Object.create(null);
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var n = normKey(keys[i]);
      if (!(n in index)) index[n] = obj[keys[i]];
    }
    for (var j = 0; j < aliases.length; j++) {
      var v = index[normKey(aliases[j])];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  }

  /** pick(), then a shallow breadth-first sweep of nested objects. */
  function pickDeep(obj, aliases, maxDepth, budget) {
    maxDepth = maxDepth || 2;
    budget = budget || 500;
    var direct = pick(obj, aliases);
    if (direct !== undefined) return direct;
    var seen = 0;
    var queue = [[obj, 0]];
    while (queue.length) {
      var entry = queue.shift();
      var node = entry[0], d = entry[1];
      if (++seen > budget || d >= maxDepth) continue;
      if (Array.isArray(node)) {
        for (var a = 0; a < node.length && a < 25; a++) {
          if (node[a] && typeof node[a] === "object") queue.push([node[a], d + 1]);
        }
        continue;
      }
      if (!isObj(node)) continue;
      if (d > 0) {
        var hit = pick(node, aliases);
        if (hit !== undefined) return hit;
      }
      var ks = Object.keys(node);
      for (var b = 0; b < ks.length; b++) {
        var val = node[ks[b]];
        if (val && typeof val === "object") queue.push([val, d + 1]);
      }
    }
    return undefined;
  }

  /**
   * The one place this file is deliberately strict.
   *
   * Accepts ISO-8601, MM/DD/YYYY, epoch seconds, epoch millis, and the common
   * wrapper objects ({date,time}, {dateTime}, {iso}, ...). It REJECTS display
   * strings, and that rejection is load-bearing:
   *
   *   new Date("Sep 14") returns a VALID Date in the current year.
   *
   * The `/feeds/` segment in the URL is the real worry — feed endpoints
   * typically return rendered cards with strings like "Sep 14 - Sep 18" rather
   * than domain objects. If we let those through, the demo would import a
   * confidently wrong booking date. Returning null instead routes the run to
   * the fixture, which is visibly labelled. A visible fallback beats a
   * plausible wrong date every time.
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
      if (/^\d{10,13}$/.test(s)) return toIso(Number(s), depth + 1); // epoch in string clothing
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

  function vehicleLabelFrom(node) {
    if (!isObj(node)) return null;
    var year = pick(node, ["year", "modelYear"]);
    var make = pick(node, ["make", "brand", "manufacturer"]);
    var model = pick(node, ["model", "modelName"]);
    if (make || model) {
      var parts = [year, make, model].filter(function (p) {
        return p !== undefined && p !== null && String(p).trim();
      }).map(String);
      var composed = parts.join(" ").trim();
      if (composed) return composed;
    }
    var explicit = pick(node, ["label", "name", "title", "displayName", "vehicleName", "headline"]);
    if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
    var plate = pick(node, ["licensePlate", "plate", "registration", "licensePlateNumber"]);
    if (typeof plate === "string" && plate.trim()) return plate.trim();
    return null;
  }

  function plateFrom(node) {
    if (!isObj(node)) return null;
    var plate = pick(node, ["licensePlate", "plate", "registration", "licensePlateNumber"]);
    return typeof plate === "string" && plate.trim() ? plate.trim() : null;
  }

  /** Turo shows guests as "Marcus D." — a first name plus an initial is a COMPLETE answer. */
  function guestNameFrom(node) {
    if (!isObj(node)) return null;
    var whole = pick(node, ["name", "fullName", "displayName", "guestName", "renterName"]);
    if (typeof whole === "string" && whole.trim()) return whole.trim();
    var first = pick(node, ["firstName", "givenName", "first"]);
    var last = pick(node, ["lastName", "familyName", "surname", "last", "lastInitial", "lastNameInitial"]);
    var parts = [first, last].filter(function (p) { return typeof p === "string" && p.trim(); })
      .map(function (p) { return p.trim(); });
    return parts.length ? parts.join(" ") : null;
  }

  /** @returns {{amount:number|null, currency:string|null}} */
  function moneyFrom(node) {
    var out = { amount: null, currency: null };
    if (!isObj(node)) return out;
    var raw = pick(node, MONEY_KEYS);
    var amount = null;
    if (typeof raw === "number" && isFinite(raw)) {
      amount = raw;
    } else if (isObj(raw)) {
      var inner = pick(raw, ["amount", "value", "total", "tripPrice", "cents"]);
      if (typeof inner === "number" && isFinite(inner)) amount = inner;
      else if (typeof inner === "string" && /^-?\d+(\.\d+)?$/.test(inner.trim())) amount = Number(inner.trim());
      var cur = pick(raw, ["currency", "currencyCode", "currencyIsoCode", "iso"]);
      if (typeof cur === "string" && cur.trim()) out.currency = cur.trim().slice(0, 8).toUpperCase();
    } else if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
      amount = Number(raw.trim());
    }
    if (!out.currency) {
      var c2 = pick(node, ["currency", "currencyCode", "currencyIsoCode"]);
      if (typeof c2 === "string" && c2.trim()) out.currency = c2.trim().slice(0, 8).toUpperCase();
    }
    out.amount = (typeof amount === "number" && isFinite(amount)) ? amount : null;
    return out;
  }

  function statusFrom(node) {
    var st = pick(node, STATUS_KEYS);
    if (typeof st === "string" && st.trim()) return st.trim().slice(0, 40);
    if (isObj(st)) {
      var inner = pick(st, ["value", "code", "name", "label"]);
      if (typeof inner === "string" && inner.trim()) return inner.trim().slice(0, 40);
    }
    return null;
  }

  // ------------------------------------------------------ candidate scoring

  /* Threshold 4 is what stops a stray {id, name} in a nav menu or a promo card
     from winning. An id alone scores 2; an id plus one date scores 5. */
  var THRESHOLD = 4;

  function score(node) {
    if (!isObj(node)) return 0;
    var s = 0;
    if (pick(node, ID_KEYS) !== undefined) s += 2;
    if (toIso(pick(node, START_KEYS)) !== null) s += 3;
    if (toIso(pick(node, END_KEYS)) !== null) s += 3;
    if (isObj(pick(node, VEHICLE_KEYS))) s += 2;
    if (isObj(pick(node, GUEST_KEYS))) s += 2;
    var st = statusFrom(node);
    if (st && /book|confirm|upcoming|active|schedul|accept|progress/i.test(st)) s += 1;
    return s;
  }

  /**
   * Breadth-first, so SHALLOWER candidates win ties — which is correct, because
   * a trip object always sits above its own vehicle/renter sub-objects.
   * Budgets are PoC guards, not hard bounds.
   */
  function findBestCandidate(blob) {
    var best = null, bestScore = 0, visited = 0;
    var queue = [blob];
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
      var s = score(node);
      if (s > bestScore) { bestScore = s; best = node; }
      var ks = Object.keys(node);
      for (var j = 0; j < ks.length; j++) {
        var v = node[ks[j]];
        if (v && typeof v === "object") queue.push(v);
      }
    }
    return { node: best, score: bestScore, visited: visited };
  }

  /**
   * Unknown blob -> ONE reservation in the wire shape the edge function reads,
   * or null. Never throws: an unrecognised shape must produce a labelled
   * fixture fallback, not an exception inside a service worker that is about to
   * be recycled anyway.
   *
   * reservation_id / starts_at / ends_at are REQUIRED. guest_name and
   * vehicle_label are nullable by design — a trip whose id and dates we trust is
   * still worth importing — but a missing date means there is no reservation.
   *
   * @param {*} blob   raw Turo JSON (or the fixture's raw entry)
   * @param {"turo"|"fixture"} source
   * @returns {object|null}
   */
  function normalize(blob, source) {
    try {
      if (blob === null || typeof blob !== "object") return null;

      var found = findBestCandidate(blob);
      var best = found.node;
      if (!best || found.score < THRESHOLD) return null;

      var startsAt = toIso(pick(best, START_KEYS));
      if (!startsAt) startsAt = toIso(pickDeep(best, START_KEYS, 2));
      var endsAt = toIso(pick(best, END_KEYS));
      if (!endsAt) endsAt = toIso(pickDeep(best, END_KEYS, 2));

      /* Prefer a reservation-flavoured key over a bare `id`: on a feed card,
         `id` is as likely to be the CARD's id as the booking's. */
      var idAliases = ID_KEYS.filter(function (k) { return k !== "id"; });
      var rawId = pick(best, idAliases);
      if (rawId === undefined) rawId = pick(best, ["id"]);
      var reservationId = (typeof rawId === "string" || typeof rawId === "number")
        ? String(rawId).trim() : null;

      if (!reservationId || !startsAt || !endsAt) return null;
      if (new Date(endsAt) <= new Date(startsAt)) return null; // nonsense pair

      var vehicleNode = pick(best, VEHICLE_KEYS);
      var guestNode = pick(best, GUEST_KEYS);
      var money = moneyFrom(best);

      return {
        reservation_id: reservationId,
        source: source === "fixture" ? "fixture" : "turo",
        guest_name: guestNameFrom(guestNode) || null,
        vehicle_label: vehicleLabelFrom(vehicleNode) || vehicleLabelFrom(best) || null,
        vehicle_plate: plateFrom(vehicleNode) || plateFrom(best) || null,
        starts_at: startsAt,
        ends_at: endsAt,
        total_amount: money.amount,
        currency: money.currency,
        turo_status: statusFrom(best),
        raw: best
      };
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------ emptiness verdict

  /**
   * THREE-STATE on purpose: true / false / null, where null means "we do not
   * know", NOT "empty". Anyone tightening this must keep all three — collapsing
   * null to true would make a changed envelope silently report "no upcoming
   * trips", which is the single most misleading thing this extension could say.
   * Only an EXPLICITLY empty container counts as empty.
   */
  function looksExplicitlyEmpty(root) {
    if (Array.isArray(root)) return root.length === 0;
    if (!isObj(root)) return null;
    var sawArray = false;
    var stack = [[root, 0]];
    while (stack.length) {
      var entry = stack.pop();
      var node = entry[0], d = entry[1];
      if (d > 4 || !isObj(node)) continue;
      var ks = Object.keys(node);
      for (var i = 0; i < ks.length; i++) {
        var val = node[ks[i]];
        if (Array.isArray(val)) {
          sawArray = true;
          if (val.length > 0) return false;
        } else if (val && typeof val === "object") {
          stack.push([val, d + 1]);
        }
      }
    }
    var rk = Object.keys(root);
    for (var j = 0; j < rk.length; j++) {
      if (/^(total|count|totalcount|resultcount|size)$/i.test(rk[j]) && root[rk[j]] === 0) return true;
    }
    return sawArray ? true : null; // no arrays at all => we simply do not know
  }

  // ---------------------------------------------------------- the live read

  /**
   * Fetch the upcoming-trips feed from inside this tab and classify what came
   * back. Returns a plain, structured-cloneable object — it crosses the
   * executeScript bridge, so no Errors, no functions, no cycles.
   */
  async function readFeed() {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    // Captured BEFORE the fetch: if Turo already bounced this tab to /login,
    // that settles "not logged in" without guessing from a response body.
    var pageUrl = String(location.href);
    var pageLooksLoggedOut = /\/(login|signin|sign-in)\b/i.test(location.pathname);

    try {
      var res = await fetch(TRIPS_PATH, {
        // Same-origin, so cookies ride along anyway; explicit because this is
        // the property that matters if the URL ever stops being relative.
        credentials: "include",
        // ONLY this header. User-Agent / Referer / Origin / Cookie are
        // forbidden headers that fetch silently drops, and a partial imitation
        // fingerprints WORSE than none — it produces a header set no real
        // browser emits. "no-cors" is likewise wrong: it would make the body
        // opaque and unreadable.
        headers: { accept: "application/json" },
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal
      });

      var finalUrl = res.url || TRIPS_PATH;
      var ctype = (res.headers.get("content-type") || "").toLowerCase();
      var body = await res.text();
      var head = body.slice(0, 3000);

      // Inline literals on purpose. Anything hoisted to module scope would be
      // undefined in the page if this function is ever passed through
      // Function.prototype.toString instead of injected as a file.
      var BOT = /perimeterx|_px(?:hd|3|2|Captcha)?\b|px-captcha|Access to this page has been denied|cf-chl|challenge-platform|Just a moment|Attention Required|Checking your browser|hsprotect/i;
      var LOGIN = /<title>[^<]*(log ?in|sign ?in)|name=["']password["']|Log in to Turo|id=["']loginForm["']/i;

      // 1. Redirected off the API surface -> the session is gone.
      if (/\/(login|signin|sign-in|account\/login)\b/i.test(finalUrl)) {
        return verdict(OUTCOME.NOT_LOGGED_IN, "Turo redirected to its login page.",
          { finalUrl: finalUrl, pageUrl: pageUrl });
      }

      // 2. Unambiguous status codes.
      if (res.status === 401) {
        return verdict(OUTCOME.NOT_LOGGED_IN, "Turo answered 401 — no host session in this browser.",
          { status: 401, finalUrl: finalUrl });
      }
      if (res.status === 429) {
        return verdict(OUTCOME.RATE_LIMITED, "Turo answered 429 — too many requests.",
          { status: 429, finalUrl: finalUrl });
      }

      // 3. Not JSON. A PerimeterX/Cloudflare interstitial frequently arrives as
      //    HTTP 200 with an HTML body, so res.ok alone proves nothing.
      var looksJson = ctype.indexOf("json") !== -1 || /^[\s﻿]*[{[]/.test(body);
      if (!looksJson) {
        if (BOT.test(head)) {
          return verdict(OUTCOME.BOT_BLOCKED,
            "Turo's bot protection served a challenge page instead of data.",
            { status: res.status, finalUrl: finalUrl, snippet: head.slice(0, 300) });
        }
        if (LOGIN.test(head) || pageLooksLoggedOut) {
          return verdict(OUTCOME.NOT_LOGGED_IN,
            "Turo served its login page — sign in to turo.com in this browser first.",
            { status: res.status, finalUrl: finalUrl, snippet: head.slice(0, 300) });
        }
        if (res.status === 403) {
          // A 403 with unattributable HTML is overwhelmingly a challenge. We
          // say so, but keep the snippet so the first operator with a real Turo
          // account can tell us whether this default is wrong.
          return verdict(OUTCOME.BOT_BLOCKED,
            "Turo answered 403 with a non-JSON page (most likely bot protection).",
            { status: 403, finalUrl: finalUrl, snippet: head.slice(0, 300) });
        }
        return verdict(OUTCOME.UNKNOWN,
          "Turo answered HTTP " + res.status + " with " + (ctype || "an unknown content type") + ", not JSON.",
          { status: res.status, finalUrl: finalUrl, snippet: head.slice(0, 300) });
      }

      // 4. JSON.
      var json;
      try {
        json = JSON.parse(body);
      } catch (parseErr) {
        return verdict(OUTCOME.UNKNOWN, "Turo returned a JSON content type with an unparseable body.",
          { status: res.status, finalUrl: finalUrl, snippet: head.slice(0, 300) });
      }

      if (!res.ok) {
        var asText = JSON.stringify(json).slice(0, 600); // PerimeterX has a JSON mode too
        if (BOT.test(asText)) {
          return verdict(OUTCOME.BOT_BLOCKED, "Turo's bot protection rejected the request.",
            { status: res.status, finalUrl: finalUrl, snippet: asText.slice(0, 300) });
        }
        if (/unauthori[sz]ed|not.?authenticated|session|token/i.test(asText)) {
          return verdict(OUTCOME.NOT_LOGGED_IN, "Turo answered HTTP " + res.status + " with an auth error.",
            { status: res.status, finalUrl: finalUrl, snippet: asText.slice(0, 300) });
        }
        return verdict(OUTCOME.UNKNOWN, "Turo answered HTTP " + res.status + ".",
          { status: res.status, finalUrl: finalUrl, snippet: asText.slice(0, 300) });
      }

      if (body.length > MAX_BYTES) {
        return verdict(OUTCOME.UNKNOWN,
          "Turo returned " + body.length + " bytes, over the " + MAX_BYTES + " byte cap.",
          { status: res.status, finalUrl: finalUrl });
      }

      if (looksExplicitlyEmpty(json) === true) {
        return verdict(OUTCOME.NO_TRIPS,
          "You are signed in to Turo, but there are no upcoming host trips.",
          { status: res.status, finalUrl: finalUrl, envelopeKeys: envelopeKeys(json) });
      }

      return verdict(OUTCOME.OK, "Read the upcoming-trips feed.", {
        status: res.status,
        finalUrl: finalUrl,
        envelopeKeys: envelopeKeys(json),
        bytes: body.length,
        json: json
      });
    } catch (e) {
      var aborted = e && e.name === "AbortError";
      return verdict(OUTCOME.UNREACHABLE,
        aborted ? "The request to Turo timed out." : "Could not reach Turo: " + String((e && e.message) || e),
        { pageUrl: pageUrl });
    } finally {
      clearTimeout(timer);
    }
  }

  function verdict(outcome, message, extra) {
    var out = { outcome: outcome, message: message };
    if (extra) {
      var ks = Object.keys(extra);
      for (var i = 0; i < ks.length; i++) out[ks[i]] = extra[ks[i]];
    }
    return out;
  }

  function envelopeKeys(o) {
    return isObj(o) ? Object.keys(o).slice(0, 30) : [];
  }

  // ------------------------------------------------------- fixture fallback

  /**
   * The fixture is routed through the SAME normalize() as live data, so the
   * demo path exercises the real code rather than bypassing it.
   */
  function fixtureReservation(reason, detail) {
    var fx = globalThis.D247_TURO_FIXTURE;
    if (!fx || !fx.raw) {
      return {
        ok: false,
        source: null,
        reason: "no_fixture",
        detail: (detail ? detail + "; " : "") + "fixture.js did not load in this context",
        reservation: null,
        diagnostics: {}
      };
    }
    var reservation = normalize(fx.raw, "fixture");
    if (!reservation) {
      return {
        ok: false,
        source: null,
        reason: "fixture_unparseable",
        detail: (detail ? detail + "; " : "") + "the bundled fixture did not survive its own normaliser",
        reservation: null,
        diagnostics: {}
      };
    }
    return {
      ok: true,
      source: "fixture",
      reason: reason || "unknown",
      detail: detail || null,
      reservation: reservation,
      diagnostics: { path: "fixture" }
    };
  }

  // ------------------------------------------------------------- entrypoint

  /**
   * @returns {Promise<{ok:boolean, source:"turo"|"fixture"|null, reason:string,
   *                    detail:string|null, reservation:object|null, diagnostics:object}>}
   *
   * Resolves — never rejects. The caller in background.js reads the resolved
   * value out of result[0].result, which is the whole reason this returns a
   * promise instead of messaging: the MAIN world has no chrome.* at all.
   */
  async function collectOneReservation() {
    var read;
    try {
      read = await readFeed();
    } catch (e) {
      read = verdict(OUTCOME.UNREACHABLE, "Could not reach Turo: " + String((e && e.message) || e), {});
    }

    if (read.outcome !== OUTCOME.OK) {
      var fb = fixtureReservation(read.outcome, read.message);
      fb.diagnostics = {
        path: "fixture",
        world: worldName(),
        outcome: read.outcome,
        status: read.status || null,
        finalUrl: read.finalUrl || null,
        snippet: read.snippet || null,
        envelopeKeys: read.envelopeKeys || null
      };
      return fb;
    }

    // Live JSON in hand. The parser is the LAST gate: a shape we cannot read is
    // not a live import, it is a fixture fallback with an honest reason.
    var reservation = normalize(read.json, "turo");
    if (!reservation) {
      var fb2 = fixtureReservation(OUTCOME.UNPARSEABLE,
        "Turo returned data, but no reservation we could read from it — its response shape has changed.");
      fb2.diagnostics = {
        path: "fixture",
        world: worldName(),
        outcome: OUTCOME.UNPARSEABLE,
        status: read.status || null,
        envelopeKeys: read.envelopeKeys || null,
        bytes: read.bytes || null
      };
      return fb2;
    }

    return {
      ok: true,
      source: "turo",
      reason: OUTCOME.OK,
      detail: null,
      reservation: reservation,
      diagnostics: {
        path: "live",
        world: worldName(),
        status: read.status || null,
        envelopeKeys: read.envelopeKeys || null,
        bytes: read.bytes || null
      }
    };
  }

  /** Best-effort label for the log line. `chrome` is undefined in MAIN. */
  function worldName() {
    try {
      return (typeof chrome !== "undefined" && chrome && chrome.runtime && chrome.runtime.id)
        ? "ISOLATED" : "MAIN";
    } catch (e) {
      return "MAIN";
    }
  }

  globalThis.__d247TuroBridge = {
    __version: 2,
    OUTCOME: OUTCOME,
    collectOneReservation: collectOneReservation,
    readFeed: readFeed,
    fixtureReservation: fixtureReservation,
    _internals: {
      normalize: normalize,
      findBestCandidate: findBestCandidate,
      looksExplicitlyEmpty: looksExplicitlyEmpty,
      toIso: toIso,
      pick: pick,
      score: score
    }
  };
})();
