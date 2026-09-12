/**
 * fixture.js — the bundled sample data.
 *
 * WHY THIS EXISTS
 * ---------------
 * Turo does not operate in every country and this project has no Turo host
 * account to test against. That is a HARD constraint, not a temporary one. The
 * extension must still complete the whole round trip — read -> paginate ->
 * normalise -> POST -> rows in the Drive247 portal — on a machine that cannot
 * reach real Turo data. This file is that stand-in.
 *
 * It is loaded in THREE places and must work in all of them, so it attaches to
 * `globalThis` and uses no module syntax, no DOM and no chrome.* API:
 *   1. the MV3 service worker, via importScripts("fixture.js")
 *   2. the ISOLATED world of a turo.com tab, via chrome.scripting.executeScript
 *   3. the MAIN world of a turo.com tab (the retry path), same mechanism
 *
 * HONESTY RULE — do not weaken this.
 * Anything produced from this file is stamped source: "fixture" all the way to
 * the database, whose column carries CHECK (source IN ('turo','fixture')). The
 * popup says "sample data" out loud on this path. A demo that cannot tell you
 * which of the two things it just did is worse than no demo.
 *
 * SHAPE CAVEAT. The objects below are shaped like Turo's
 * GET /api/v2/feeds/upcoming-trips?appMode=HOST response. The URL and the
 * appMode=HOST parameter are confirmed; Turo publishes no schema, and we have
 * never observed a live response, so every FIELD NAME here is a reconstruction.
 * That is deliberately fine — in fact it is the point. The normaliser
 * DISCOVERS fields rather than assuming them, so the fixture's job is not to be
 * right, it is to be AWKWARD: several records below are deliberately malformed,
 * renamed, or under-specified so that the tolerant paths are exercised on every
 * single run rather than only on the day Turo changes something.
 *
 * WHAT IS DELIBERATELY WRONG IN HERE (all of it load-bearing):
 *   FX-3   no end date at all              -> rejected, `ends_at` reported unknown
 *   FX-4   vehicle is a legacy display     -> plate mined from the string, review required
 *          string only, no vehicle object
 *   FX-5   `return` renamed to `tripEndTs` -> rejected, and the NEW KEY is reported,
 *                                             which is how a Turo rename gets diagnosed
 *   FX-6   cancelled                       -> the only kind of absence that may release
 *   FX-7   supersedes an id from the        -> a trip that MOVED, which must never be
 *          previous run's manifest             read as a disappearance
 *   FX-8   same-day turnaround with FX-2   -> two real blocks on one calendar date
 *   FX-9   ends in the past, "COMPLETED"   -> completed_provisional + a 48h hold
 *   FX-10  no timezone, no guest           -> soft unknowns, record still lands
 *   FX-11  VIN but no plate                -> a hint, never a join key
 *   FX-2   spans a month boundary          -> Sep 28 -> Oct 3
 *
 * Nothing here is ever silently repaired. Every one of those produces either a
 * REJECTED record naming the field it could not read, or a landed record
 * carrying an `unknowns` list. Silence is the one outcome this file is designed
 * to make impossible.
 */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ dates
     Fixed absolute dates, NOT offsets from now(). A fixture that drifts with
     the clock cannot be reasoned about, and "spans a month boundary" stops
     being true in November. FX-9 is deliberately in the past relative to those
     so the 48h completion hold is exercised; if you are reading this after
     2026 the hold will simply have expired, which is itself correct. */
  var SEP = "2026-09";
  var OCT = "2026-10";

  // ------------------------------------------------------------- vehicles --

  /* One entry per car, in the shape /api/vehicles/me is GUESSED to return.
     Two of them are deliberately identity-poor. */
  var VEHICLE_TESLA = {
    id: 77712345,
    year: 2023, make: "Tesla", model: "Model 3", trim: "Long Range",
    licensePlate: "SAMPLE-001",
    vin: "5YJ3E1EA7PF000001"
  };
  var VEHICLE_TRANSIT = {
    id: 77712346,
    year: 2022, make: "Ford", model: "Transit", trim: "350 HD",
    licensePlate: "SAMPLE-002",
    vin: "1FTBW3XG0NKA00002"
  };
  /* No plate, no VIN, no id — the worst realistic case. */
  var VEHICLE_THIN = {
    year: 2021, make: "Toyota", model: "Sienna"
  };

  // ---------------------------------------------------------------- trips --

  var TRIPS = [

    /* FX-1 — the clean one. This is the SAME object the single-reservation PoC
       demo has always used; `D247_TURO_FIXTURE.raw` still points at it and the
       PoC path is unchanged. Do not reshape it without checking that path. */
    {
      id: 900000001,
      reservationId: "R-900000001",
      status: "BOOKED",
      /* NO timeZone, exactly as the original PoC record had it. That absence is
         load-bearing in two places: turo-read-contract.test.js asserts this
         record reports `timezone` as an unknown, and it keeps the
         "absent is REPORTED, never assumed" path on the demo route rather than
         only on the awkward records further down. */
      renter: {
        id: 55512345,
        firstName: "Sample", lastName: "Guest",
        name: "Sample Guest (fixture)",
        email: "sample.guest@example.invalid"
      },
      vehicle: VEHICLE_TESLA,
      pickup: {
        dateTime: SEP + "-12T15:00:00.000Z",
        location: { address: "San Francisco International Airport (SFO)" }
      },
      return: {
        dateTime: SEP + "-16T11:00:00.000Z",
        location: { address: "San Francisco International Airport (SFO)" }
      },
      total: { amount: 486.5, currencyCode: "USD" },
      __drive247_fixture: true,
      __drive247_note:
        "Bundled sample reservation shipped with the Drive247 Turo Bridge extension. NOT real Turo data."
    },

    /* FX-2 — SPANS A MONTH BOUNDARY (28 Sep -> 3 Oct).
       A block written from this trip covers dates in two different months, and
       any date-arithmetic that works month-at-a-time gets this wrong. */
    {
      id: 900000002,
      reservationId: "R-900000002",
      status: "BOOKED",
      timeZone: "America/Los_Angeles",
      renter: { id: 55512346, firstName: "Marcus", lastName: "D." },
      vehicle: VEHICLE_TRANSIT,
      pickup: { dateTime: SEP + "-28T09:30:00.000Z" },
      return: { dateTime: OCT + "-03T10:00:00.000Z" },
      total: { amount: 1290.0, currencyCode: "USD" },
      __drive247_fixture: true
    },

    /* FX-3 — NO END DATE. Not null, not empty: the key is simply not there.
       This is the shape of a Turo rename we have not learned about yet. The
       record MUST be rejected with `ends_at` named — importing it with a
       guessed end date would block the wrong range, and importing it with no
       end date would block nothing while looking like a success. */
    {
      id: 900000003,
      reservationId: "R-900000003",
      status: "BOOKED",
      timeZone: "America/Los_Angeles",
      renter: { id: 55512347, name: "Priya S." },
      vehicle: VEHICLE_TESLA,
      pickup: { dateTime: OCT + "-06T14:00:00.000Z" },
      total: { amount: 210.0, currencyCode: "USD" },
      __drive247_fixture: true
    },

    /* FX-4 — UNMAPPED VEHICLE. No vehicle object at all; the car exists only as
       the legacy export display string. The plate has to be mined out of the
       text, and even when it is, the match is REVIEW-REQUIRED — a string that
       merely looks like a plate is not an identity. */
    {
      id: 900000004,
      reservationId: "R-900000004",
      status: "BOOKED",
      timeZone: "America/Los_Angeles",
      renter: { id: 55512348, name: "Jon W." },
      vehicleLabel: "Owner 1 Wagoneer (Jon) (CA #9DUC203)",
      pickup: { dateTime: OCT + "-08T16:00:00.000Z" },
      return: { dateTime: OCT + "-11T16:00:00.000Z" },
      total: { amount: 640.0, currencyCode: "USD" },
      __drive247_fixture: true
    },

    /* FX-5 — A RENAMED FIELD. `return` has become `tripEndTs`. Everything else
       is perfectly readable, which is exactly what makes this dangerous: a
       parser that shrugged would import a trip with no end.
       Expected: REJECTED, `ends_at` in unknowns, and `tripEndTs` visible in the
       rejection's observedKeys / the run's key histogram — that histogram is
       how the alias list gets fixed in one line instead of an investigation. */
    {
      id: 900000005,
      reservationId: "R-900000005",
      status: "BOOKED",
      timeZone: "America/Los_Angeles",
      renter: { id: 55512349, name: "Dana R." },
      vehicle: VEHICLE_TRANSIT,
      pickup: { dateTime: OCT + "-12T11:00:00.000Z" },
      tripEndTs: OCT + "-15T11:00:00.000Z",
      total: { amount: 545.0, currencyCode: "USD" },
      __drive247_fixture: true
    },

    /* FX-6 — CANCELLED. The ONLY class of evidence that can release a block,
       because it is something we POSITIVELY READ rather than something that
       failed to appear. */
    {
      id: 900000006,
      reservationId: "R-900000006",
      status: "CANCELLED",
      timeZone: "America/Los_Angeles",
      renter: { id: 55512350, name: "Ade O." },
      vehicle: VEHICLE_TESLA,
      pickup: { dateTime: OCT + "-18T09:00:00.000Z" },
      return: { dateTime: OCT + "-20T09:00:00.000Z" },
      total: { amount: 0, currencyCode: "USD" },
      __drive247_fixture: true
    },

    /* FX-7 — A TRIP THAT MOVED. It carries a pointer to the reservation id it
       replaces. `R-900000099` is in PREVIOUS_MANIFEST below, so on the second
       fixture run that old id goes absent AND is claimed by this one — which
       must be classified `superseded` (positive, the trip moved) and NOT
       released. A trip that moved has not ended. */
    {
      id: 900000007,
      reservationId: "R-900000007",
      previousReservationId: "R-900000099",
      status: "BOOKED",
      timeZone: "America/Los_Angeles",
      renter: { id: 55512351, name: "Lena K." },
      vehicle: VEHICLE_THIN,
      pickup: { dateTime: OCT + "-21T13:00:00.000Z" },
      return: { dateTime: OCT + "-24T13:00:00.000Z" },
      total: { amount: 402.75, currencyCode: "USD" },
      __drive247_fixture: true
    },

    /* FX-8 — SAME-DAY TURNAROUND with FX-2. FX-2 hands the Transit back at
       10:00 on 3 Oct; this one takes it out at 16:00 the same day. Both are
       REAL and both must survive. Any overlap rule that compares calendar dates
       instead of timestamps rejects this one, and any EXCLUDE constraint on a
       DATE-only inclusive-end range rejects it too. */
    {
      id: 900000008,
      reservationId: "R-900000008",
      status: "BOOKED",
      timeZone: "America/Los_Angeles",
      renter: { id: 55512352, name: "Tom B." },
      vehicle: VEHICLE_TRANSIT,
      pickup: { dateTime: OCT + "-03T16:00:00.000Z" },
      return: { dateTime: OCT + "-05T16:00:00.000Z" },
      total: { amount: 388.0, currencyCode: "USD" },
      __drive247_fixture: true
    },

    /* FX-9 — COMPLETED, AND IN THE PAST. `completed` is NOT terminal: guests
       extend up to 24h after a trip ends and Turo auto-accepts. This one exists
       so that every run produces at least one record whose holdUntil
       (ends_at + 48h) is visible in the UI. */
    {
      id: 900000009,
      reservationId: "R-900000009",
      status: "COMPLETED",
      timeZone: "America/Los_Angeles",
      renter: { id: 55512353, name: "Ruth A." },
      vehicle: VEHICLE_TESLA,
      pickup: { dateTime: SEP + "-01T09:00:00.000Z" },
      return: { dateTime: SEP + "-04T09:00:00.000Z" },
      total: { amount: 301.25, currencyCode: "USD" },
      __drive247_fixture: true
    },

    /* FX-10 — NO TIMEZONE AND NO GUEST. Both are SOFT unknowns: the record
       still lands, because a trip whose id and dates we trust is worth having.
       The missing timezone matters more than it looks — blocked_dates is
       DATE-only with an inclusive end, so converting these timestamps to
       calendar dates in the wrong zone is precisely how a same-day turnaround
       becomes a double-booking. It is REPORTED, never assumed. */
    {
      id: 900000010,
      reservationId: "R-900000010",
      status: "BOOKED",
      vehicle: VEHICLE_TRANSIT,
      pickup: { dateTime: OCT + "-26T08:00:00.000Z" },
      return: { dateTime: OCT + "-28T08:00:00.000Z" },
      total: { amount: 275.0, currencyCode: "USD" },
      __drive247_fixture: true
    },

    /* FX-11 — VIN, NO PLATE. Live counts settle this: vehicles.reg is unique
       (461/461 distinct) and vehicles.vin is NOT (326 distinct across 400
       non-null). A VIN may raise confidence on a match reached another way; it
       may never BE the match. Expect review-required. */
    {
      id: 900000011,
      reservationId: "R-900000011",
      status: "BOOKED",
      timeZone: "America/Los_Angeles",
      renter: { id: 55512354, name: "Sam Q." },
      /* NO vehicle id and NO plate on purpose — this is the only rung of the
         ladder where the VIN is reachable, and it must still come back
         review-required. */
      vehicle: { year: 2021, make: "Toyota", model: "Sienna", vin: "5TDKZ3DC0MS000011" },
      pickup: { dateTime: OCT + "-29T12:00:00.000Z" },
      return: { dateTime: OCT + "-31T12:00:00.000Z" },
      total: { amount: 356.0, currencyCode: "USD" },
      __drive247_fixture: true
    }
  ];

  // --------------------------------------------------------------- pages ---

  /* Three pages, cursor-paginated, with a SHORT final page and an explicit
     hasMore:false. That combination is what a genuinely complete walk looks
     like, and it is the only way the fixture run can legitimately reach
     coverage.complete — which in turn is the only way it can demonstrate the
     release gate opening.

     `total` is present ON PURPOSE and is WRONG-ADJACENT by design: it is
     captured as declaredTotal and then deliberately ignored as a progress
     denominator. If you ever see the UI render "N of 11", that is the bug this
     field exists to catch. */
  var PAGES = [
    {
      trips: TRIPS.slice(0, 4),
      pageInfo: { endCursor: "fx-cursor-p1", hasMore: true },
      total: TRIPS.length
    },
    {
      trips: TRIPS.slice(4, 9),
      pageInfo: { endCursor: "fx-cursor-p2", hasMore: true },
      total: TRIPS.length
    },
    {
      trips: TRIPS.slice(9),
      pageInfo: { endCursor: null, hasMore: false },
      total: TRIPS.length
    }
  ];

  var VEHICLES_ENVELOPE = {
    vehicles: [
      { id: VEHICLE_TESLA.id, year: VEHICLE_TESLA.year, make: VEHICLE_TESLA.make, model: VEHICLE_TESLA.model,
        licensePlate: VEHICLE_TESLA.licensePlate, vin: VEHICLE_TESLA.vin,
        owner: { id: "fixture-host-0001", firstName: "Sample", lastName: "Host" } },
      { id: VEHICLE_TRANSIT.id, year: VEHICLE_TRANSIT.year, make: VEHICLE_TRANSIT.make, model: VEHICLE_TRANSIT.model,
        licensePlate: VEHICLE_TRANSIT.licensePlate, vin: VEHICLE_TRANSIT.vin,
        owner: { id: "fixture-host-0001" } },
      { id: 77712347, year: 2021, make: "Toyota", model: "Sienna", vin: "5TDKZ3DC0MS000011",
        owner: { id: "fixture-host-0001" } }
    ],
    total: 3
  };

  /* What the PREVIOUS run saw. Used to exercise the absence ledger without
     needing two real runs: R-900000099 has vanished (and is claimed by FX-7 as
     superseded), and R-900000098 has simply gone quiet — `absent_only`, which
     must NEVER release, however many times it repeats. */
  var PREVIOUS_MANIFEST = {
    runId: "fixture-previous-run",
    startedAt: "2026-08-30T09:00:00.000Z",
    finishedAt: "2026-08-30T09:00:12.000Z",
    seenReservationIds: [
      "R-900000001", "R-900000002", "R-900000006", "R-900000098", "R-900000099"
    ],
    absentRunCounts: { "R-900000098": 2 },
    keyHistogram: {},
    envelopeKeys: ["trips", "pageInfo", "total"]
  };

  // ------------------------------------------------------------ scenarios --

  /* Deliberately broken responses, so the degraded-read gates can be exercised
     on a machine with no Turo access. Each is a full HTTP-ish envelope, because
     the fixture reader below runs them through the REAL classifyBody() — the
     same function a live response goes through. A scenario that bypassed the
     classifier would prove nothing. */
  var SCENARIOS = {

    /* THE WAF CASE, and the reason `EMPTY_UNCONFIRMED` exists. HTTP 200, valid
       JSON, correct content type, a container we recognise — and nothing in it.
       Byte-for-byte indistinguishable from a host with an empty calendar. */
    waf_empty_200: {
      label: "WAF returns HTTP 200 with an empty but valid body",
      http: { status: 200, contentType: "application/json", body: '{"trips":[],"total":0}' }
    },

    /* A bot challenge served as HTTP 200 with an HTML body. `res.ok` is true
       and proves nothing whatsoever. */
    bot_challenge: {
      label: "PerimeterX challenge served as HTTP 200 HTML",
      http: {
        status: 200, contentType: "text/html; charset=utf-8",
        body: '<!doctype html><html><head><title>Just a moment...</title></head>' +
              '<body><div id="px-captcha"></div><script>window._pxAppId="PXxxxxx";</script></body></html>'
      }
    },

    /* The session died between one page and the next. */
    session_expired: {
      label: "Turo redirected to its login page",
      http: {
        status: 200, contentType: "text/html; charset=utf-8",
        finalUrl: "https://turo.com/login?next=%2Fapi%2Fv2%2Ffeeds%2Fupcoming-trips",
        body: '<!doctype html><html><head><title>Log in to Turo</title></head>' +
              '<body><form id="loginForm"><input name="password" type="password"></form></body></html>'
      }
    },

    /* The envelope key moved. This must classify as UNKNOWN and NEVER as
       "no upcoming trips" — the two are indistinguishable to a careless reader
       and one of them is a lie that releases blocks. */
    renamed_envelope: {
      label: "Envelope key renamed — no container we recognise",
      http: {
        status: 200, contentType: "application/json",
        body: '{"payload":{"schemaVersion":9,"stuff":{"whatever":1}},"generatedAt":"2026-09-02T00:00:00Z"}'
      }
    },

    /* A stream cut mid-flight that still happens to parse is the nastiest
       degradation of all: fewer records, and no other symptom anywhere. */
    truncated_stream: {
      label: "Response cut short but still parseable",
      http: {
        status: 200, contentType: "application/json",
        contentLength: 99999,
        body: JSON.stringify({ trips: TRIPS.slice(0, 2), pageInfo: { endCursor: "fx-cursor-p1", hasMore: true } })
      }
    },

    rate_limited: {
      label: "HTTP 429 with a Retry-After",
      http: { status: 429, contentType: "application/json", retryAfterSeconds: 7, body: '{"error":"slow down"}' }
    },

    /* A FULL page with no next-affordance at all. Not "no pagination" — silent
       truncation. It must resolve to pagination style `unknown`, which can
       never reach coverage.complete, which is what stops an 8/8-green bar. */
    silent_truncation: {
      label: "A full page with no continuation marker",
      http: {
        status: 200, contentType: "application/json",
        body: JSON.stringify({ trips: padTo(TRIPS, 60) })
      }
    }
  };

  /** Repeat the trip list, re-keying ids, until it is at least `n` long. */
  function padTo(list, n) {
    var out = [];
    var i = 0;
    while (out.length < n) {
      var src = list[i % list.length];
      var copy = JSON.parse(JSON.stringify(src));
      copy.reservationId = "R-PAD-" + (1000 + out.length);
      copy.id = 990000000 + out.length;
      out.push(copy);
      i++;
    }
    return out;
  }

  // -------------------------------------------------------- fixture reader --

  /**
   * Read ONE fixture page and return the EXACT shape __d247TuroRead.readPage()
   * returns, by running the fixture body through the SAME classifier,
   * item extractor and pagination detector a live response goes through.
   *
   * This is the whole reason the fixture is worth having. It is not a shortcut
   * around the read layer, it is a substitute NETWORK underneath the real one:
   * classifyBody, extractItems, detectPagination and buildNextRequest all run
   * for real, so the fixture run exercises the code that will one day meet
   * Turo, rather than a parallel happy path that proves nothing.
   *
   * @param {{pageKey:string, path:string, index:number}} pageRequest
   * @param {object|null} prevPlan       the plan locked on page 0
   * @param {string|null} scenarioName   force a degraded response
   * @returns {object} a PageReadResult
   */
  function readFixturePage(pageRequest, prevPlan, scenarioName) {
    var R = globalThis.__d247TuroRead;
    if (!R) {
      return {
        outcome: "UNKNOWN",
        message: "turo-read-contract.js is not loaded in this context, so the fixture cannot be read through the real parser.",
        pageKey: pageRequest.pageKey, world: "unknown", httpStatus: null, finalUrl: null,
        bytes: null, envelopeKeys: [], snippet: null, retryAfterSeconds: null,
        items: [], next: null,
        plan: prevPlan || { style: "unknown", matchedKeys: [], observedPageSize: null, declaredTotal: null, confidence: "low" }
      };
    }

    var isVehicles = pageRequest.path.indexOf("vehicles") !== -1;
    var http;

    if (scenarioName && SCENARIOS[scenarioName]) {
      http = SCENARIOS[scenarioName].http;
    } else if (isVehicles) {
      http = { status: 200, contentType: "application/json", body: JSON.stringify(VEHICLES_ENVELOPE) };
    } else {
      var page = PAGES[pageRequest.index];
      if (!page) {
        // Walked past the end. An honest "empty, and we said so".
        http = { status: 200, contentType: "application/json", body: '{"trips":[],"pageInfo":{"hasMore":false},"total":' + TRIPS.length + '}' };
      } else {
        http = { status: 200, contentType: "application/json", body: JSON.stringify(page) };
      }
    }

    var finalUrl = http.finalUrl || ("https://turo.com" + pageRequest.path);
    var base = {
      pageKey: pageRequest.pageKey,
      world: "fixture",
      httpStatus: http.status,
      finalUrl: finalUrl,
      bytes: http.body.length,
      envelopeKeys: [],
      snippet: null,
      retryAfterSeconds: http.retryAfterSeconds || null,
      items: [],
      next: null,
      plan: prevPlan || { style: "unknown", matchedKeys: [], observedPageSize: null, declaredTotal: null, confidence: "low" }
    };

    // THE REAL CLASSIFIER. Not a fixture-flavoured imitation of one.
    var verdict = R.classifyBody({
      status: http.status,
      contentType: http.contentType,
      body: http.body,
      finalUrl: finalUrl,
      pageLooksLoggedOut: false
    });
    base.snippet = verdict.snippet;
    if (verdict.outcome !== R.OUTCOME.OK) {
      base.outcome = verdict.outcome;
      base.message = verdict.message;
      return base;
    }

    // The truncated-stream check, mirrored from readPage(). A body shorter than
    // the Content-Length the edge promised is a cut stream that still parsed.
    if (http.contentLength && http.body.length < http.contentLength) {
      base.outcome = R.OUTCOME.TRUNCATED;
      base.message = "The sample response was cut short (" + http.body.length + " of " + http.contentLength + " bytes).";
      return base;
    }

    var ex = R.extractItems(verdict.json);
    base.envelopeKeys = ex.envelopeKeys;
    base.items = ex.items;
    if (!ex.found) {
      base.outcome = R.OUTCOME.UNKNOWN;
      base.message = "The sample response used an envelope we do not recognise (keys: " + ex.envelopeKeys.join(", ") + ").";
      return base;
    }

    var det = R.detectPagination(verdict.json, ex.items, prevPlan);
    base.plan = det.plan;
    base.next = R.buildNextRequest(pageRequest.path, det, pageRequest.index);

    if (ex.items.length === 0) {
      base.outcome = R.OUTCOME.EMPTY_UNCONFIRMED;
      base.message = "The sample response was empty. Confirming the session before trusting it.";
      return base;
    }
    base.outcome = R.OUTCOME.OK;
    base.message = "Read " + ex.items.length + " sample record(s) from " + (ex.containerKey || "the feed") + ".";
    return base;
  }

  /** The vehicles read, in the shape __d247TuroRead.readVehicles() returns. */
  function readFixtureVehicles(scenarioName) {
    var R = globalThis.__d247TuroRead;
    var req = { pageKey: "vehicles", path: "/api/vehicles/me", index: 0 };
    var r = readFixturePage(req, null, scenarioName);
    var out = {
      outcome: r.outcome, message: r.message, httpStatus: r.httpStatus,
      envelopeKeys: r.envelopeKeys, items: [], vehicles: [], turoHostId: null
    };
    if (!R || r.outcome !== R.OUTCOME.OK) return out;
    out.items = r.items;
    for (var i = 0; i < r.items.length; i++) out.vehicles.push(R.readVehicle(r.items[i], null));
    for (var j = 0; j < r.items.length && !out.turoHostId; j++) {
      var owner = r.items[j] && r.items[j].owner;
      if (owner && owner.id) out.turoHostId = String(owner.id);
    }
    return out;
  }

  // -------------------------------------------------------------- exports --

  globalThis.D247_TURO_FIXTURE = {
    __version: 2,

    /* UNCHANGED CONTRACT. content-turo.js's single-reservation demo path reads
       exactly this, and background.js's worker fallback reads it through the
       same normalise(). Keep it pointing at FX-1. */
    raw: TRIPS[0],

    trips: TRIPS,
    pages: PAGES,
    pageCount: PAGES.length,
    vehicles: VEHICLES_ENVELOPE,
    previousManifest: PREVIOUS_MANIFEST,
    scenarios: SCENARIOS,
    scenarioNames: Object.keys(SCENARIOS),

    readPage: readFixturePage,
    readVehicles: readFixtureVehicles,

    /* What a correct run over this fixture should produce. Not used by the
       extension at runtime — it is here so a human (or a test) can check the
       run against a stated expectation instead of against their memory. */
    expectation: {
      pages: 3,
      recordsOffered: TRIPS.length,
      recordsAccepted: 9,
      recordsRejected: 2,
      rejectedIds: ["R-900000003 (no end date)", "R-900000005 (return renamed to tripEndTs)"],
      coverageComplete: true,
      reviewRequired: ["R-900000004 (label-only vehicle)", "R-900000011 (VIN, no plate)"],
      cancelled: ["R-900000006"],
      supersedes: { "R-900000007": "R-900000099" },
      absentOnlyNeverReleases: ["R-900000098"]
    }
  };
})();
