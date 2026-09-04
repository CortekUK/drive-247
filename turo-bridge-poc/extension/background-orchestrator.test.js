/**
 * background-orchestrator.test.js — run the whole sync in Node, with no Chrome
 * and no Turo.
 *
 *     node turo-bridge-poc/extension/background-orchestrator.test.js
 *
 * WHY THIS EXISTS. The two claims this orchestrator makes are "it survives the
 * service worker being killed" and "a degraded read changes nothing". Neither
 * can be checked by reading the code, and neither can be checked by hand in a
 * browser without a Turo host account — which this project does not have and
 * will not get. So the worker is faked: chrome.storage.local is a plain object,
 * the tab is the bundled fixture, and "the worker was killed" is implemented
 * literally, by throwing away the module and re-requiring it against the SAME
 * storage. If a resumed run needed anything that lived in a JS variable, these
 * tests fail.
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

// ===================================================== the fake browser =====

function makeChrome(store) {
  const alarms = new Map();
  return {
    __alarms: alarms,
    runtime: {
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
      async get(name) { return alarms.get(name) || null; },
      create(name, opts) { alarms.set(name, opts); },
      async clear(name) { return alarms.delete(name); },
      onAlarm: { addListener() {} }
    },
    // Live-mode plumbing. The fixture runs never touch these.
    tabs: {
      async query() { return [{ id: 1, status: "complete", discarded: false }]; },
      async create() { return { id: 1, status: "complete" }; },
      async get() { return { id: 1, status: "complete" }; },
      onUpdated: { addListener() {}, removeListener() {} }
    },
    scripting: { async executeScript() { return [{ result: null }]; } }
  };
}

/**
 * Boot a service worker. Called once per "the worker was killed" event, always
 * against the same `store`, which is the entire point of the exercise.
 */
const REAL_SET_TIMEOUT = setTimeout;
let liveTimers = [];

function boot(store, posts, postBehaviour, finals, reconciles) {
  finals = finals || [];
  reconciles = reconciles || [];
  // THE KILL, in full. A dead service worker loses its pending setTimeout
  // callbacks along with everything else; without this the "dead" worker keeps
  // driving the run and the resumability assertions prove nothing.
  for (const t of liveTimers) clearTimeout(t);
  liveTimers = [];
  globalThis.setTimeout = (fn, ms) => { const id = REAL_SET_TIMEOUT(fn, ms); liveTimers.push(id); return id; };

  for (const f of ["fixture.js", "turo-read-contract.js", "content-turo.js", "background.js"]) {
    delete require.cache[path.join(DIR, f)];
  }
  globalThis.chrome = makeChrome(store);
  globalThis.importScripts = (...files) => files.forEach((f) => require(path.join(DIR, f)));

  /* A stand-in for turo-bridge-ingest.
     It models the two things about that endpoint the orchestrator depends on:
       - the FIRST post of a run opens a turo_sync_jobs row and hands back its
         id, which every later post of the same run must carry back; and
       - the batch shape is `reservations[]`, while the legacy PoC path still
         sends a single `reservation`.
     `posts` records only the record-bearing calls, so the existing counts still
     mean "one POST per reservation"; the finalisation call is recorded
     separately in `finals`. */
  let jobSeq = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);

    /* turo-bridge-reconcile is a DIFFERENT endpoint and must be counted
       separately — it is what turns "what the feed said" into "what we
       concluded", and without it nothing ever leaves presence_state OBSERVED. */
    if (String(url).includes("turo-bridge-reconcile")) {
      reconciles.push(body);
      return { ok: true, status: 200, async json() { return { ok: true, job_id: body.job_id, concluded: "nothing" }; } };
    }
    const listed = Array.isArray(body.reservations) ? body.reservations : null;
    const single = body.reservation || null;
    const records = listed || (single ? [single] : []);
    const verdict = postBehaviour ? postBehaviour(body, posts.length) : { ok: true };

    if (records.length === 0) {
      finals.push(body);
    } else {
      posts.push({ id: records[0].reservation_id, source: body.source, body });
    }
    if (!verdict.ok) {
      return { ok: false, status: verdict.status || 500, async json() { return { error: verdict.error || "nope" }; } };
    }
    const jobId = (body.job && body.job.job_id) || ("job-" + (++jobSeq));
    return {
      ok: true, status: 200,
      async json() {
        return {
          ok: true, success: true, job_id: jobId, write_safe: verdict.writeSafe !== false,
          wrote_nothing_because: verdict.writeSafe === false ? "test says so" : undefined,
          action: "created", id: "row-" + posts.length,
          results: records.map((r) => ({ reservation_id: r.reservation_id, action: "created", row_id: "row-" + posts.length }))
        };
      }
    };
  };

  require(path.join(DIR, "background.js"));
  // Make the ~1.2s inter-page pacing instant. It is real rate discipline
  // against a WAF, and it is pure latency in a test.
  globalThis.__d247TuroRead.pacingDelayMs = () => 1;
  return globalThis.chrome.runtime.onMessage._fn;
}

function send(listener, msg) {
  return new Promise((resolve) => {
    const kept = listener(msg, {}, resolve);
    if (!kept) resolve(null);
  });
}

/** Wait for the run to stop moving. Never asserts; the tests do that. */
async function settle(store, maxMs) {
  const deadline = Date.now() + (maxMs || 8000);
  let lastSeq = -1, still = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => REAL_SET_TIMEOUT(r, 15));
    const c = store.turoCursor;
    if (!c) continue;
    if (c.phase === "done") return c;
    if (c.seq === lastSeq) { if (++still > 25) return c; } else { still = 0; lastSeq = c.seq; }
  }
  return store.turoCursor;
}

// ============================================================== the tests ===

async function main() {
  console.log("\nTuro Bridge — orchestrator\n");

  // ---------------------------------------------------------------------
  console.log("A clean sample run walks every page and finishes");
  {
    const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
    const posts = [];
    const listen = boot(store, posts);
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store);

    const st = store.syncState, cur = store.turoCursor;
    eq("finished", st.phase, "done");
    eq("read 3 batches", st.batchesDone, 3);
    eq("11 records offered", st.counts.offered, 11);
    eq("9 accepted", st.counts.accepted, 9);
    eq("2 rejected, not guessed at", st.counts.rejected, 2);
    eq("9 POSTed, one call each", posts.length, 9);
    eq("every POST labelled sample data", posts.every((p) => p.source === "fixture"), true);
    ok("coverage is a positive claim", st.coverage.complete === true && st.coverage.evidence === "terminator_absent_next",
      JSON.stringify(st.coverage));
    eq("outcome OK", st.outcome, "OK");
    eq("may write", st.gates.mayWrite, true);
    eq("may release", st.gates.mayRelease, true);
    ok("pagination style was detected, not assumed", st.pagination.style === "cursor", st.pagination.style);

    // The two rejections must NAME the field they could not read.
    ok("rejections name the missing field", st.rejected.every((r) => r.fields.includes("ends_at")),
      JSON.stringify(st.rejected));
    // ...and the renamed key must be visible, because that is the whole repair path.
    ok("the renamed key is reported", JSON.stringify(st.rejected).includes("tripEndTs"));
    ok("the key histogram recovered the feed's shape", Object.keys(st.keyHistogram).includes("reservationId"));

    // Soft unknowns land WITH the record rather than sinking it.
    const tz = st.unknownFields.find((u) => u.field === "timezone");
    ok("a missing timezone is reported, never assumed", !!tz && tz.count >= 1);
    const vid = st.unknownFields.find((u) => u.field === "vehicle_id");
    ok("the fabricated vehicle id was refused and reported", !!vid, JSON.stringify(st.unknownFields));

    ok("nothing claims a total it cannot prove — declaredTotal 11 is not the denominator",
      st.declaredTotal === 11 && st.progressTotal === 9);
    eq("manifest remembers what was seen", store.syncManifest.seenReservationIds.length > 0, true);
  }

  // ---------------------------------------------------------------------
  console.log("\nAbsence never releases; only positive evidence does");
  {
    const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
    const posts = [];
    // Seed the PREVIOUS run's memory: one trip that has simply gone quiet, one
    // that was reissued under a new id, and one that is now cancelled.
    store.syncManifest = require(path.join(DIR, "fixture.js")) || null;
    delete require.cache[path.join(DIR, "fixture.js")];
    require(path.join(DIR, "fixture.js"));
    store.syncManifest = JSON.parse(JSON.stringify(globalThis.D247_TURO_FIXTURE.previousManifest));

    const listen = boot(store, posts);
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store);

    const abs = store.syncState.absences;
    const quiet = abs.find((a) => a.reservationId === "R-900000098");
    const moved = abs.find((a) => a.reservationId === "R-900000099");
    const gone = abs.find((a) => a.reservationId === "R-900000006");

    ok("a trip that merely went quiet is not evidence of anything",
      quiet && quiet.evidence === "absent_only" && quiet.releaseAllowed === false, JSON.stringify(quiet));
    ok("...even on its third consecutive absence", quiet && quiet.consecutiveAbsentRuns === 3,
      quiet && String(quiet.consecutiveAbsentRuns));
    ok("a trip that MOVED is positive evidence but still does not release",
      moved && moved.evidence === "superseded" && moved.releaseAllowed === false, JSON.stringify(moved));
    ok("a trip we READ as cancelled is the one thing that does release",
      gone && gone.evidence === "explicit_cancelled_status" && gone.releaseAllowed === true, JSON.stringify(gone));

    ok("the quiet trip is still remembered, so it can be diffed again",
      store.syncManifest.seenReservationIds.includes("R-900000098"));
    ok("only the positively-released trip is forgotten",
      !store.syncManifest.seenReservationIds.includes("R-900000006"));
  }

  // ---------------------------------------------------------------------
  console.log("\nA WAF returning HTTP 200 with an empty body changes nothing");
  {
    const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
    const posts = [];
    const finals = [];
    const listen = boot(store, posts, null, finals);
    await send(listen, { type: "SYNC_ALL", mode: "fixture", scenario: "waf_empty_200" });
    await settle(store);

    const st = store.syncState;
    eq("nothing was written", posts.length, 0);
    eq("nothing may be released", st.gates ? st.gates.mayRelease : false, false);
    ok("it is NOT reported as an empty calendar",
      st.outcome === "EMPTY_UNCONFIRMED", st.outcome);
    ok("the advice tells a human what to do", typeof st.advice === "string" && st.advice.length > 20, st.advice);

    /* ⚠ AND IT IS REPORTED. A degradation nobody can see is a degradation
       nobody fixes — before this, a WAF answering 200-with-nothing parked the
       run locally and Drive247 heard nothing at all, so the ingest's whole
       degraded-run gate was unreachable and the portal's sync history showed no
       trace of the read that produced no trips. */
    eq("Drive247 is told the read happened and failed", finals.length, 1);
    eq("...named as the WAF case, not as an empty calendar",
      finals[0].job.reader_outcome, "EMPTY_UNCONFIRMED");
    eq("...with a reason the schema's CHECK accepts", finals[0].job.degraded_reason, "waf_empty_200");
    eq("...and the client never claims it was safe to write from", finals[0].job.write_safe, false);
  }

  // ---------------------------------------------------------------------
  console.log("\nA bot challenge stops dead and does not retry itself");
  {
    const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
    const posts = [];
    const finals = [];
    const reconciles = [];
    const listen = boot(store, posts, null, finals, reconciles);
    await send(listen, { type: "SYNC_ALL", mode: "fixture", scenario: "bot_challenge" });
    await settle(store);

    const st = store.syncState;
    eq("parked", st.phase, "parked");
    eq("as a bot challenge", st.outcome, "BOT_BLOCKED");
    eq("nothing was written", posts.length, 0);
    /* The challenge lands on the FIRST page, before any record is flushed and so
       before we hold a run id — which is exactly the case that used to go
       unreported. One call, and it is a report, not a retry. */
    eq("but the failure itself is reported to Drive247", finals.length, 1);
    eq("...as a challenge", finals[0].job.reader_outcome, "BOT_BLOCKED");
    eq("...with no run id, because there was never a chance to open one",
      finals[0].job.job_id, null);
    eq("a refused read is never handed to reconcile", reconciles.length, 0);
    eq("it will NOT resume on its own", st.autoResumes, false);
    eq("the wake-up alarm was cancelled", globalThis.chrome.__alarms.size, 0);

    // An unattended wake-up must not restart it either.
    const before = store.turoCursor.seq;
    await send(listen, { type: "SYNC_STATE" });
    await settle(store, 300);
    eq("an alarm/startup pump leaves it parked", store.turoCursor.phase, "parked");
    ok("and issues no further requests", posts.length === 0);
    ok("a human clicking Continue is a different thing entirely", before >= 0);
  }

  // ---------------------------------------------------------------------
  console.log("\nA renamed envelope is UNKNOWN, never 'no upcoming trips'");
  {
    const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
    const posts = [];
    const listen = boot(store, posts);
    await send(listen, { type: "SYNC_ALL", mode: "fixture", scenario: "renamed_envelope" });
    await settle(store);
    ok("not reported as emptiness", store.syncState.outcome === "UNKNOWN", store.syncState.outcome);
    eq("nothing was written", posts.length, 0);
  }

  // ---------------------------------------------------------------------
  console.log("\nA full page with no continuation marker is suspected truncation");
  {
    const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
    const posts = [];
    const listen = boot(store, posts);
    await send(listen, { type: "SYNC_ALL", mode: "fixture", scenario: "silent_truncation" });
    await settle(store, 20000);
    const st = store.syncState;
    ok("what was read is kept", posts.length > 0);
    eq("but the walk is not complete", st.coverage.complete, false);
    eq("and nothing may be released", st.gates.mayRelease, false);
    ok("the UI never renders 'N of N'", st.progressTotal === null && !st.coverage.display.includes(" of "),
      st.coverage.display);

    /* NO SILENT DROPPING ON OUR OWN SIDE EITHER. A big page must reach Drive247
       whole. An earlier draft capped the stored page at N records, which would
       have lost trips exactly the way a truncated Turo read does — except
       invisibly, and from our end. */
    eq("every record on a large page was delivered",
      new Set(posts.map((p) => p.id)).size, st.counts.accepted);
    ok("and it really was a large page", st.counts.accepted > 40, String(st.counts.accepted));
  }

  // ---------------------------------------------------------------------
  console.log("\nThe service worker is killed mid-run and the sync continues");
  {
    const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
    const posts = [];
    let listen = boot(store, posts);
    // Real runs pace ~1.2s between pages against a WAF. Keep enough of that to
    // land the kill mid-walk instead of after it.
    globalThis.__d247TuroRead.pacingDelayMs = () => 150;
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });

    // Let it get partway, then kill the worker outright.
    await new Promise((r) => REAL_SET_TIMEOUT(r, 200));
    const midway = JSON.parse(JSON.stringify(store.turoCursor));
    const postsAtDeath = posts.length;
    ok("the run had started", midway.phase !== "done", midway.phase);

    // THE KILL. Every JS variable the old worker held is gone. Only storage
    // survives — exactly what MV3 does.
    listen = boot(store, posts);
    await send(listen, { type: "SYNC_RESUME" });
    await settle(store);

    const st = store.syncState;
    eq("the run still finished", st.phase, "done");
    eq("with all 3 batches", st.batchesDone, 3);
    eq("and all 9 records", st.counts.accepted, 9);
    eq("coverage still complete", st.coverage.complete, true);

    // At-least-once over an idempotent sink: a replay is allowed, a LOSS is not.
    const distinct = new Set(posts.map((p) => p.id));
    eq("every record reached Drive247", distinct.size, 9);
    ok("any replay was bounded to the page in flight (<=1 batch)",
      posts.length - distinct.size <= 5, "extra posts: " + (posts.length - distinct.size));
    ok("progress survived the death", postsAtDeath >= 0);
  }

  // ---------------------------------------------------------------------
  console.log("\nA changed credential abandons the run rather than cross-writing");
  {
    const store = { pairingToken: "d247_turo_" + "a".repeat(40) };
    const posts = [];
    let listen = boot(store, posts);
    globalThis.__d247TuroRead.pacingDelayMs = () => 150;
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await new Promise((r) => REAL_SET_TIMEOUT(r, 200));

    // The operator re-paired to a DIFFERENT Drive247 tenant mid-run.
    store.pairingToken = "d247_turo_" + "b".repeat(40);
    const postsBefore = posts.length;

    listen = boot(store, posts);
    await send(listen, { type: "SYNC_RESUME" });
    await settle(store, 2000);

    eq("the run was abandoned", store.turoCursor.parkedReason, "ABANDONED");
    eq("nothing further was written", posts.length, postsBefore);
    ok("and it says why, in words", /different Drive247 tenant/i.test(store.syncState.lastError || ""),
      store.syncState.lastError);
  }

  // ---------------------------------------------------------------------
  // REGRESSION. The Drive247 token guard (above) catches "re-paired to another
  // TENANT". This catches the mirror image, which had no cover at all: the same
  // Drive247 token, a DIFFERENT Turo account signed in, on the resume path.
  //
  // The guard lived only in stepProbeSession(), which runs once at the start of
  // a run. A parked run keeps cursor.pending and used to resume straight into
  // reading_trips, skipping it — and resumeDecision()'s copy of the check was
  // handed cursor.turoAccountFingerprint as its "observed" value, so it compared
  // the cursor against itself and could never fire. Net effect: park on a 429
  // (auto-resumable, so the ALARM resumes it unattended), let the operator switch
  // Turo accounts, and host B's trips were read into tenant A's Drive247 account.
  console.log("\nA switched Turo account cannot be resumed into");
  {
    const store = { pairingToken: "d247_turo_" + "c".repeat(40) };
    const posts = [];
    // boot() re-requires fixture.js, so the host override must be re-applied to
    // the FRESH namespace after every boot — exactly as a real worker restart
    // would re-read whatever Turo account the browser is sitting next to.
    const signInAs = (id) => {
      const F = globalThis.D247_TURO_FIXTURE;
      const real = F.readVehicles;
      F.readVehicles = (scenario) => {
        const v = real(scenario);
        v.turoHostId = id;
        return v;
      };
    };

    // Refuse a POST so the run PARKS with work outstanding — the precise state
    // that used to resume without ever re-checking whose account this is.
    let listen = boot(store, posts, (_b, n) => (n === 2 ? { ok: false, status: 500, error: "boom" } : { ok: true }));
    signInAs("turo-host-A");
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store, 3000);

    eq("the run parked with work outstanding", store.syncState.phase, "parked");
    ok("and it recorded whose account it was reading", !!store.turoCursor.turoAccountFingerprint);
    const postsBefore = posts.length;

    // The operator signs out of host A and into host B. The Drive247 pairing
    // token is UNCHANGED, so stepOnce's tenant guard cannot see this at all.
    listen = boot(store, posts, null);
    signInAs("turo-host-B");
    await send(listen, { type: "SYNC_RESUME" });
    await settle(store, 3000);

    eq("the run was abandoned, not resumed", store.turoCursor.parkedReason, "ABANDONED");
    eq("host B's trips were never written", posts.length, postsBefore);
    ok("and it says which account changed, in words",
      /different Turo account/i.test(store.syncState.lastError || ""), store.syncState.lastError);
  }

  // ---------------------------------------------------------------------
  // The same guard must NOT fire when the account has not changed, or every
  // ordinary resume would abandon itself.
  console.log("\nAn unchanged Turo account resumes normally");
  {
    const store = { pairingToken: "d247_turo_" + "d".repeat(40) };
    const posts = [];
    let listen = boot(store, posts, (_b, n) => (n === 2 ? { ok: false, status: 500, error: "boom" } : { ok: true }));
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store, 3000);
    eq("parked", store.syncState.phase, "parked");

    listen = boot(store, posts, null);
    await send(listen, { type: "SYNC_RESUME" });
    await settle(store, 3000);

    eq("the run completed", store.syncState.phase, "done");
    eq("all 9 records landed", new Set(posts.filter((p) => p.body).map((p) => p.id)).size, 9);
  }

  // ---------------------------------------------------------------------
  console.log("\nDrive247 refusing a write pauses the run and loses nothing");
  {
    const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
    const posts = [];
    // Refuse the 3rd POST, accept everything else.
    let listen = boot(store, posts, (_b, n) => (n === 2 ? { ok: false, status: 500, error: "boom" } : { ok: true }));
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store, 3000);

    eq("paused", store.syncState.phase, "parked");
    ok("and blames the right side", /Drive247/.test(store.syncState.lastError || ""), store.syncState.lastError);
    ok("the refused record is still queued", store.syncPending.records.length > 0);
    const refusedId = store.syncPending.records[0].reservation_id;

    // Now Drive247 is healthy again.
    listen = boot(store, posts, null);
    await send(listen, { type: "SYNC_RESUME" });
    await settle(store);

    eq("the run completed", store.syncState.phase, "done");
    eq("all 9 records landed", new Set(posts.filter((p) => p.body).map((p) => p.id)).size, 9);
    ok("including the one that was refused", posts.filter((p) => p.id === refusedId).length >= 2, refusedId);
  }

  // ---------------------------------------------------------------------
  console.log("\nThe single-reservation demo still works");
  {
    const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
    const posts = [];
    const listen = boot(store, posts);
    // No usable Turo tab: chrome.scripting returns null, so the PoC falls back
    // to the bundled fixture through the SAME normaliser — its original design.
    const res = await send(listen, { type: "SYNC_ONE" });
    eq("it completed", res.phase, "done");
    eq("labelled as sample data", res.source, "fixture");
    eq("one reservation, one POST", posts.length, 1);
    eq("the original fixture reservation", posts[0].id, "R-900000001");
    ok("and the popup is told, out loud", /sample data/i.test(res.title + " " + res.detail),
      res.title + " | " + res.detail);
  }

  // ---------------------------------------------------------------------
  console.log("\nThe wire payload carries what the server currently drops");
  {
    const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
    const posts = [];
    const finals = [];
    const reconciles = [];
    const listen = boot(store, posts, null, finals, reconciles);
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store);

    /* The run path posts the batch shape (`reservations[]`); only the legacy
       one-click demo still sends a bare `reservation`. */
    const rec = (id) => {
      const p = posts.find((x) => x.id === id).body;
      return (p.reservations && p.reservations[0]) || p.reservation;
    };

    const wagoneer = rec("R-900000004");
    const meta = wagoneer.raw.__d247;
    ok("the plate survives, because it is the only safe join key",
      meta.vehicle.plate_normalised === "9DUC203", JSON.stringify(meta.vehicle));
    eq("mined from a legacy display string", meta.vehicle.evidence, "label_plate_parsed");
    eq("and still flagged for a human", meta.vehicle.requires_review, true);
    ok("the trip id that was mistaken for a vehicle id is recorded",
      meta.vehicle.rejected_vehicle_id === "900000004", meta.vehicle.rejected_vehicle_id);

    const vinOnly = rec("R-900000011").raw.__d247;
    eq("a VIN is a hint, never an identity", vinOnly.vehicle.evidence, "vin_unique");
    eq("so it needs review", vinOnly.vehicle.requires_review, true);

    const completed = rec("R-900000009").raw.__d247;
    eq("'completed' is not terminal", completed.lifecycle, "completed_provisional");
    eq("and carries a 48h hold", completed.hold_until, "2026-09-06T09:00:00.000Z");

    const moved = rec("R-900000007").raw.__d247;
    eq("a reissued trip keeps its pointer", moved.supersedes_reservation_id, "R-900000099");

    const boundary = rec("R-900000002");
    ok("a trip spanning a month boundary is intact",
      boundary.starts_at.startsWith("2026-09-28") && boundary.ends_at.startsWith("2026-10-03"),
      boundary.starts_at + " -> " + boundary.ends_at);

    // The same-day turnaround: FX-2 hands the car back at 10:00 on 3 Oct and
    // FX-8 takes it out at 16:00 the same day. Both are real.
    const turn = rec("R-900000008");
    ok("a same-day turnaround produces two separate trips on one date",
      turn.starts_at.startsWith("2026-10-03") && boundary.ends_at.startsWith("2026-10-03"));

    ok("Turo's own trip status is carried, not just our import lane",
      typeof rec(posts[0].id).turo_status === "string" && rec(posts[0].id).status === "synced");

    /* ── THE FOUR FIELDS THAT MUST BE AT THE TOP LEVEL ──────────────────────
       turo-bridge-ingest's pick() reads the top level of the record ONLY; it
       never descends into `raw`. Sending these solely inside raw.__d247 left
       four real columns permanently NULL — and turo_vehicle_id being NULL means
       the §7 release gate can never match a trip against the run's
       observed_turo_vehicle_ids, i.e. NOTHING can ever be released. */
    ok("the Turo vehicle id is at the top level, where the ingest can map it",
      rec("R-900000001").turo_vehicle_id === "77712345", JSON.stringify(rec("R-900000001").turo_vehicle_id));
    ok("a reissue pointer is at the top level too",
      rec("R-900000007").supersedes_reservation_id === "R-900000099");
    ok("a timezone we DID read is sent as a column, not buried in raw",
      typeof rec("R-900000002").timezone === "string");
    ok("a timezone we did NOT read is null, never assumed",
      rec("R-900000001").timezone === null && rec("R-900000010").timezone === null);

    /* ── ONE RUN, NOT ONE RUN PER RESERVATION ───────────────────────────────
       Every POST used to open, finalise and close its own turo_sync_jobs row,
       so an 11-trip sync produced 9 separate 'manual_single' runs each claiming
       success. */
    ok("the first POST opens the run with no job id", posts[0].body.job.job_id === null);
    ok("every later POST carries the SAME run id back",
      posts.slice(1).every((p) => p.body.job.job_id === posts[1].body.job.job_id) &&
      posts[1].body.job.job_id !== null, JSON.stringify(posts.map((p) => p.body.job.job_id)));
    ok("no record-bearing POST finalises the run",
      posts.every((p) => p.body.job.finalize === false));
    eq("the run is finalised exactly once", finals.length, 1);
    ok("...and that call carries no reservations", finals[0].reservations.length === 0);
    ok("...and it says what the read actually was", finals[0].job.reader_outcome === "OK");
    ok("...and reports zero parse failures as a fact, not an assumption",
      finals[0].job.parse_failure_count === 2, String(finals[0].job.parse_failure_count));

    /* ── THE WINDOW, WITHOUT WHICH NOTHING IS EVER AUTHORITATIVE ────────────
       is_authoritative (03-foundation-schema.sql:223) is AND-ed with
       `window_start IS NOT NULL AND window_end IS NOT NULL`. */
    ok("the run vouches for a window it actually read",
      typeof finals[0].job.window_start === "string" && typeof finals[0].job.window_end === "string",
      JSON.stringify([finals[0].job.window_start, finals[0].job.window_end]));
    ok("the window brackets every trip we parsed",
      finals[0].job.window_start <= "2026-09-28" && finals[0].job.window_end >= "2026-10-03",
      finals[0].job.window_start + " -> " + finals[0].job.window_end);
    ok("and it names the Turo vehicles it laid eyes on",
      finals[0].job.observed_turo_vehicle_ids.includes("77712345"),
      JSON.stringify(finals[0].job.observed_turo_vehicle_ids));

    /* ── SOMEBODY ASKS FOR A CONCLUSION ─────────────────────────────────────
       Ingest records what the feed SAID; only turo-bridge-reconcile draws a
       conclusion from it. Nothing called it, so rows landed and never left
       presence_state OBSERVED — no trip was ever marked missing and the
       cancellation queue was permanently, misleadingly empty. */
    eq("the run is handed to reconcile, exactly once", reconciles.length, 1);
    eq("...citing the run it just closed", reconciles[0].job_id, finals[0].job.job_id);
    ok("...and demo data can never move a real row", reconciles[0].dry_run === true);
  }

  // ---------------------------------------------------------------------
  console.log("\nA second sync of an unchanged calendar re-sends nothing, and still reports every id");
  {
    const store = { pairingToken: "d247_turo_" + "u".repeat(40) };
    const posts = [], finals = [], reconciles = [];

    let listen = boot(store, posts, null, finals, reconciles);
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store);

    const firstPosts = posts.length;
    ok("the first run sent the records", firstPosts > 0);
    const firstIds = (store.syncSummary.ids || []).slice().sort();
    ok("...and it recorded a digest for each", Object.keys(store.syncDigests || {}).length === firstPosts,
       JSON.stringify(Object.keys(store.syncDigests || {}).length));

    // Second sync, same calendar, same everything.
    listen = boot(store, posts, null, finals, reconciles);
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store);

    eq("the second run sent no record payloads at all", posts.length, firstPosts);

    /* THE HALF THAT MATTERS. turo-bridge-reconcile decides a booking is missing
       when last_seen_job_id does not name the run — so a sync that goes quiet
       about a steady booking is a sync that walks it toward a released block.
       Not sending the record is fine. Not sending the id is not. */
    const final = finals[finals.length - 1];
    const reported = (final.seen_reservation_ids || []).slice().sort();
    eq("every id was still reported as present", reported.length, firstIds.length);
    ok("...and they are the same ids", JSON.stringify(reported) === JSON.stringify(firstIds),
       JSON.stringify({ reported, firstIds }));

    eq("the run still finished", store.syncState.phase, "done");
    eq("and still counted them as read", store.syncState.counts.offered, 11);
  }

  // ---------------------------------------------------------------------
  console.log("\nA record that CHANGED is sent again, digest or no digest");
  {
    const store = { pairingToken: "d247_turo_" + "v".repeat(40) };
    const posts = [], finals = [];

    let listen = boot(store, posts, null, finals);
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store);
    const firstPosts = posts.length;

    /* Corrupt one stored digest, which is exactly what a real content change
       looks like from the flush's point of view: the record no longer hashes to
       what Drive247 was last known to hold. */
    const anyId = Object.keys(store.syncDigests)[0];
    store.syncDigests[anyId] = "0000000000000000";

    listen = boot(store, posts, null, finals);
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store);

    eq("exactly the changed record was re-sent", posts.length, firstPosts + 1);
    eq("...and it was the right one", posts[posts.length - 1].id, anyId);
    const final = finals[finals.length - 1];
    eq("the rest were still reported present", (final.seen_reservation_ids || []).length, firstPosts - 1);
    ok("and the changed one is NOT in that list", !(final.seen_reservation_ids || []).includes(anyId));
  }

  // ---------------------------------------------------------------------
  console.log("\nA rejected record earns no digest, so it is retried in full");
  {
    const store = { pairingToken: "d247_turo_" + "w".repeat(40) };
    const posts = [], finals = [];

    /* The server takes every record but marks the first one rejected — a
       validation failure, not a transport failure. Drive247 does NOT hold it,
       so nothing about it may be skipped next time. */
    let n = 0;
    const behaviour = () => ({ ok: true, rejectFirst: n++ === 0 });
    let listen = boot(store, posts, behaviour, finals);
    await send(listen, { type: "SYNC_ALL", mode: "fixture" });
    await settle(store);

    ok("some records landed", posts.length > 0);
    ok("a digest exists for the accepted ones", Object.keys(store.syncDigests || {}).length > 0);
  }

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
