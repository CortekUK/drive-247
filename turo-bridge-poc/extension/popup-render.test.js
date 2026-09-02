/**
 * popup-render.test.js — render the popup against REAL orchestrator output.
 *
 *     node turo-bridge-poc/extension/popup-render.test.js
 *
 * (Uses jsdom, which is already a dev dependency of this monorepo. If it is not
 *  installed the script says so and exits 0 rather than failing a build.)
 *
 * WHY THIS EXISTS. The most dangerous thing this extension can do is not crash
 * — it is to look finished when it is not. A progress readout of "8 of 8" over
 * a truncated calendar is a confident lie, and it is the easiest possible bug
 * to write: `processed / total` where `total` came from the same degraded
 * response as `processed`.
 *
 * So the states below are not hand-written fixtures of what the UI "should"
 * get. They are the actual `syncState` objects the orchestrator produced in
 * background-orchestrator.test.js, replayed through the actual popup.html and
 * popup.js, and then read back out of the rendered DOM as TEXT. If the wrong
 * sentence ever reaches the screen, it fails here.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const DIR = __dirname;

let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch (_) {
  console.log("jsdom is not installed here — skipping the popup render tests.");
  process.exit(0);
}

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.log("  ✗ " + name + (extra ? "  -> " + extra : "")); }
}

// ---------------------------------------------------------------------------
// Produce REAL states by running the orchestrator, exactly as the worker does.
// ---------------------------------------------------------------------------

function fakeChrome(store) {
  const alarms = new Map();
  return {
    runtime: {
      onMessage: { addListener(fn) { this._fn = fn; } },
      onStartup: { addListener() {} }, onInstalled: { addListener() {} },
      getManifest: () => ({ version: "0.2.0-test" })
    },
    storage: {
      local: {
        async get(key) {
          const o = {};
          for (const k of (typeof key === "string" ? [key] : key)) if (k in store) o[k] = store[k];
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
    tabs: { async query() { return [{ id: 1, status: "complete" }]; }, async create() { return { id: 1 }; },
      async get() { return { id: 1, status: "complete" }; },
      onUpdated: { addListener() {}, removeListener() {} } },
    scripting: { async executeScript() { return [{ result: null }]; } }
  };
}

async function runOrchestrator(scenario) {
  const store = { pairingToken: "d247_turo_" + "x".repeat(40) };
  for (const f of ["fixture.js", "turo-read-contract.js", "content-turo.js", "background.js"]) {
    delete require.cache[path.join(DIR, f)];
  }
  globalThis.chrome = fakeChrome(store);
  globalThis.importScripts = (...fs2) => fs2.forEach((f) => require(path.join(DIR, f)));
  globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return { action: "created" }; } });
  require(path.join(DIR, "background.js"));
  globalThis.__d247TuroRead.pacingDelayMs = () => 1;

  const listen = globalThis.chrome.runtime.onMessage._fn;
  await new Promise((r) => listen({ type: "SYNC_ALL", mode: "fixture", scenario }, {}, r));

  const deadline = Date.now() + 20000;
  let lastSeq = -1, still = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15));
    const c = store.turoCursor;
    if (c && c.phase === "done") break;
    if (c && c.seq === lastSeq) { if (++still > 25) break; } else if (c) { still = 0; lastSeq = c.seq; }
  }
  return store.syncState;
}

// ---------------------------------------------------------------------------
// Render a state through the real popup.
// ---------------------------------------------------------------------------

function renderInPopup(state, lastRun) {
  const html = fs.readFileSync(path.join(DIR, "popup.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const w = dom.window;

  const store = { syncState: state, lastRun: lastRun || null, pairingToken: "d247_turo_" + "x".repeat(40) };
  w.chrome = {
    storage: {
      local: {
        async get(keys) { const o = {}; for (const k of [].concat(keys)) if (k in store) o[k] = store[k]; return o; },
        async set() {}, async remove() {}
      },
      onChanged: { addListener() {} }
    },
    runtime: { async sendMessage() {} }
  };

  w.eval(fs.readFileSync(path.join(DIR, "popup.js"), "utf8"));
  return { dom, w, doc: w.document };
}

const text = (doc, id) => (doc.getElementById(id).textContent || "").trim();
const shown = (doc, id) => !doc.getElementById(id).hidden;

// ================================================================== tests ===

async function main() {
  console.log("\nTuro Bridge — popup render\n");

  // ------------------------------------------------------------------
  console.log("A complete walk may state a total");
  {
    const state = await runOrchestrator(null);
    const { doc } = renderInPopup(state);
    await new Promise((r) => setTimeout(r, 20));

    const batch = text(doc, "runBatch");
    const cov = text(doc, "runCoverage");
    ok("the batch line names a denominator", /Batch 3 of 3/.test(batch), batch);
    ok("...and the record count is final, not 'so far'", !/so far/.test(batch), batch);
    ok("coverage says it read everything", /read all 9 trips/i.test(cov), cov);
    ok("the two gates are shown separately", shown(doc, "runGates"));
    ok("saving is allowed", text(doc, "gWrite") === "Yes", text(doc, "gWrite"));
    ok("releasing is allowed on a proven-complete corroborated read",
      text(doc, "gRelease") === "Allowed", text(doc, "gRelease"));
    ok("the sample-data badge is unmissable", /sample/i.test(text(doc, "runSource")), text(doc, "runSource"));

    const unknowns = text(doc, "unknownList");
    ok("the fields Turo did not give us are named on screen",
      /timezone/.test(unknowns) && /vehicle id/.test(unknowns), unknowns.slice(0, 160));
    const rejects = text(doc, "rejectList");
    ok("the trips we refused are shown WITH the key names Turo actually sent",
      /tripEndTs/.test(rejects), rejects.slice(0, 200));
    ok("a review-required trip is marked as such",
      doc.querySelectorAll("li.trip.needs-review").length >= 2,
      String(doc.querySelectorAll("li.trip.needs-review").length));
  }

  // ------------------------------------------------------------------
  console.log("\nA truncated walk may NOT state a total  (the 8-of-8 bug)");
  {
    const state = await runOrchestrator("silent_truncation");
    const { doc } = renderInPopup(state);
    await new Promise((r) => setTimeout(r, 20));

    const batch = text(doc, "runBatch");
    const cov = text(doc, "runCoverage");
    const whole = doc.getElementById("run").textContent;

    ok("no denominator anywhere in the batch line", !/ of \d/.test(batch), batch);
    ok("it says the count is provisional", /so far/.test(batch), batch);
    ok("coverage warns there may be more", /there may be more/i.test(cov), cov);
    ok("the whole panel never renders 'N of N'", !/\b(\d+) of \1\b/.test(whole));
    ok("releasing is refused, in words the operator can act on",
      /dates stay blocked/i.test(text(doc, "gRelease")), text(doc, "gRelease"));
    ok("but what WAS read is still saved", text(doc, "gWrite") === "Yes", text(doc, "gWrite"));
    ok("and the reason names the gate that shut",
      /incomplete/i.test(text(doc, "gReason")), text(doc, "gReason"));
  }

  // ------------------------------------------------------------------
  console.log("\nA WAF's empty 200 is never rendered as 'no trips'");
  {
    const state = await runOrchestrator("waf_empty_200");
    const { doc } = renderInPopup(state);
    await new Promise((r) => setTimeout(r, 20));

    const whole = doc.getElementById("run").textContent;
    ok("it does NOT say the calendar is empty", !/no upcoming trips/i.test(whole), whole.slice(0, 200));
    ok("it says the answer could not be trusted",
      /could not trust|not trust|nothing we could trust/i.test(text(doc, "alertKind")), text(doc, "alertKind"));
    ok("the advice is actionable", /sign(ed)? in|turo\.com/i.test(text(doc, "alertAdvice")), text(doc, "alertAdvice"));
    ok("zero trips are shown as saved", /^0$/.test(doc.querySelector(".tile strong").textContent));
  }

  // ------------------------------------------------------------------
  console.log("\nA bot challenge offers a human something to do");
  {
    const state = await runOrchestrator("bot_challenge");
    const { doc } = renderInPopup(state);
    await new Promise((r) => setTimeout(r, 20));

    ok("the alert is shown", shown(doc, "runAlert"));
    ok("named as bot protection", /bot protection/i.test(text(doc, "alertKind")), text(doc, "alertKind"));
    ok("the advice says to clear the check", /clear the check/i.test(text(doc, "alertAdvice")), text(doc, "alertAdvice"));
    ok("Continue is offered, so a human decides when to retry", shown(doc, "continueBtn"));
    ok("the panel is marked as paused", doc.getElementById("run").dataset.phase === "parked");
  }

  // ------------------------------------------------------------------
  console.log("\nThe one-reservation demo still renders");
  {
    const lastRun = {
      phase: "done", title: "Synced using bundled sample data",
      detail: "Sample data used — Turo was unreachable.", source: "fixture",
      reservation: { reservation_id: "R-900000001", guest_name: "Sample Guest (fixture)",
        vehicle_label: "2023 Tesla Model 3", starts_at: "2026-09-12T15:00:00.000Z",
        ends_at: "2026-09-16T11:00:00.000Z" }
    };
    const { doc } = renderInPopup(null, lastRun);
    await new Promise((r) => setTimeout(r, 20));
    ok("the result table appears", shown(doc, "result"));
    ok("with the reservation id", text(doc, "rTrip") === "R-900000001", text(doc, "rTrip"));
    ok("and says 'sample' out loud", /sample/i.test(text(doc, "badge")), text(doc, "badge"));
    ok("the run panel stays hidden when no full sync has happened", !shown(doc, "run"));
  }

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
