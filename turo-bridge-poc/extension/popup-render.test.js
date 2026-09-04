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

/* The signed-in tenant every run test renders as. Not a credential — this is
   the shape of d247Identity, which is deliberately the only auth data the popup
   is given. */
const SIGNED_IN = {
  signedIn: true, expired: false,
  identity: { userId: "u1", tenantId: "tenant-A", tenantName: "Acme Rentals", name: "Dana Okafor", email: "dana@acme.test" }
};

function renderInPopup(state, lastRun, opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(DIR, "popup.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const w = dom.window;

  const auth = opts.auth === undefined ? SIGNED_IN : opts.auth;
  const store = Object.assign(
    { syncState: state, lastRun: lastRun || null, lastSyncAt: opts.lastSyncAt || null },
    opts.store || {},
  );
  const sent = [];
  /* A sign-in verdict the test controls, and a promise the test can resolve
     itself — which is how the "still loading" assertions get to look at the
     form MID-REQUEST rather than after it. */
  let releaseSignIn = null;
  w.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") { const o = {}; if (keys in store) o[keys] = store[keys]; return o; }
          const o = {}; for (const k of [].concat(keys)) if (k in store) o[k] = store[k]; return o;
        },
        async set(patch) { Object.assign(store, patch); },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k]; }
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      async sendMessage(msg) {
        sent.push(msg);
        if (msg && msg.type === "AUTH_STATE") return auth;
        if (msg && msg.type === "AUTH_SIGN_IN") {
          if (opts.hold) return await new Promise((r) => { releaseSignIn = r; });
          return opts.signInResult || { ok: false, code: "bad_credentials", reason: "Email or password is incorrect." };
        }
        return undefined;
      }
    }
  };

  w.eval(fs.readFileSync(path.join(DIR, "popup.js"), "utf8"));
  return { dom, w, doc: w.document, store, sent, release: (v) => releaseSignIn && releaseSignIn(v) };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));

/** Fill the form and submit it the way a person does. */
function submitForm(doc, w, email, password) {
  doc.getElementById("email").value = email;
  doc.getElementById("password").value = password;
  doc.getElementById("authForm").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
}

const text = (doc, id) => (doc.getElementById(id).textContent || "").trim();
const eq = (name, actual, expected) =>
  ok(name, actual === expected, "got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
const eqText = (doc, name, id, expected) =>
  ok(name, text(doc, id) === expected, "got " + JSON.stringify(text(doc, id)));
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

  // ------------------------------------------------------------------
  console.log("\nThe popup is a sign-in screen until the tenant signs in");
  {
    const { doc } = renderInPopup(null, null, { auth: { signedIn: false, expired: false, identity: null } });
    await new Promise((r) => setTimeout(r, 20));

    ok("the sign-in form is on screen", !doc.getElementById("authForm").hidden);
    /* ABSENT, not disabled. A greyed-out sync button invites a tenant to work
       out how to enable it; there is nothing to work out except signing in. */
    ok("and the sync UI is not merely disabled but gone", doc.getElementById("work").hidden);
    ok("no account is claimed", doc.getElementById("acct").hidden);

    const whole = doc.body.textContent;
    /* THE THINGS A TENANT MAY NEVER SEE HERE. Each of these leaked from the
       screen this one replaced. */
    ok("no pairing token field", !doc.getElementById("token"));
    ok("no backend URL", !/supabase|functions\/v1/i.test(whole), whole.slice(0, 120));
    ok("no sample-data or scenario controls", !doc.getElementById("useSample") && !doc.getElementById("scenario"));
    ok("and it says the Turo password is not wanted", /never asks for your Turo password/i.test(whole));
  }

  // ------------------------------------------------------------------
  console.log("\nAn expired session says so, rather than just failing");
  {
    const { doc } = renderInPopup(null, null, { auth: { signedIn: false, expired: true, identity: null } });
    await new Promise((r) => setTimeout(r, 20));

    ok("the error line is shown", !doc.getElementById("authError").hidden);
    ok("...and says the sign-in expired", /expired/i.test(text(doc, "authError")), text(doc, "authError"));
    ok("...and says what to do about it", /sign in again/i.test(text(doc, "authError")));
  }

  // ------------------------------------------------------------------
  console.log("\nA signed-in tenant sees which account they are syncing into");
  {
    const state = await runOrchestrator(null);
    const { doc } = renderInPopup(state, null, {
      lastSyncAt: { at: "2026-03-01T09:30:00.000Z", records: 11, complete: true }
    });
    await new Promise((r) => setTimeout(r, 20));

    ok("the sign-in form is gone", doc.getElementById("authForm").hidden);
    ok("the sync UI is available", !doc.getElementById("work").hidden);
    ok("the account bar is shown", !doc.getElementById("acct").hidden);
    /* WHICH ACCOUNT, in the tenant's own words. This is the answer to "am I
       about to sync into the right place?", and it is the one question the
       pairing-token screen could never answer. */
    eqText(doc, "names the tenant, not an id", "acctTenant", "Acme Rentals");
    ok("and the person signed in", /Dana Okafor/.test(text(doc, "acctEmail")), text(doc, "acctEmail"));
    ok("a way out is offered", !!doc.getElementById("signOut"));

    const last = text(doc, "lastSync");
    ok("the last successful sync is dated", /Last synced/.test(last), last);
    ok("...and counts what it saved", /11 bookings/.test(last), last);
    ok("...with no caveat, because that read was complete", !/part of your calendar/i.test(last), last);

    /* Still nothing technical, now that there IS a screen behind the gate. */
    const whole = doc.body.textContent;
    ok("no tenant id is ever printed", !/tenant-A/.test(whole));
    ok("no endpoint is ever printed", !/supabase|functions\/v1/i.test(whole));
  }

  // ------------------------------------------------------------------
  console.log("\nA partial read never claims a clean 'last synced'");
  {
    const { doc } = renderInPopup(null, null, {
      lastSyncAt: { at: "2026-03-01T09:30:00.000Z", records: 4, complete: false }
    });
    await new Promise((r) => setTimeout(r, 20));
    const last = text(doc, "lastSync");
    ok("it says the calendar was only partly read", /part of your calendar only/i.test(last), last);
  }

  // ------------------------------------------------------------------
  console.log("\nA failed sign-in keeps BOTH fields, so nothing has to be retyped");
  {
    const { doc, w } = renderInPopup(null, null, { auth: { signedIn: false, expired: false, identity: null } });
    await tick();

    submitForm(doc, w, "dana@acme.test", "hunter2");
    await tick(40);

    /* THE BUG THIS REPLACES. The password used to be wiped on every rejection,
       so a tenant whose real problem was a typo'd email domain retyped a
       correct password over and over and got the same sentence each time. */
    eq("the email survived", doc.getElementById("email").value, "dana@acme.test");
    eq("and so did the password", doc.getElementById("password").value, "hunter2");
    ok("the error is shown", !doc.getElementById("authError").hidden);
    ok("...and the form was not replaced", !!doc.getElementById("authForm"));
  }

  // ------------------------------------------------------------------
  console.log("\nThe email is remembered across popup closes; the password is not");
  {
    const { doc, w, store } = renderInPopup(null, null, { auth: { signedIn: false, expired: false, identity: null } });
    await tick();
    submitForm(doc, w, "dana@acme.test", "hunter2");
    await tick(40);

    eq("the email was saved", store.lastEmail, "dana@acme.test");
    /* THE LINE THAT MATTERS. A password in chrome.storage is a password on
       disk, for the benefit of saving one field of typing. */
    const persisted = JSON.stringify(store);
    ok("the password was NOT saved anywhere", !persisted.includes("hunter2"), persisted.slice(0, 200));
    ok("...under any key at all", !Object.keys(store).some((k) => /pass/i.test(k)));

    // Reopen the popup against that same storage.
    const second = renderInPopup(null, null, {
      auth: { signedIn: false, expired: false, identity: null },
      store: { lastEmail: "dana@acme.test" }
    });
    await tick();
    eq("a reopened popup restores the email", second.doc.getElementById("email").value, "dana@acme.test");
    eq("and leaves the password empty", second.doc.getElementById("password").value, "");
  }

  // ------------------------------------------------------------------
  console.log("\nThe eye reveals the password without losing it or submitting");
  {
    const { doc, w, sent } = renderInPopup(null, null, { auth: { signedIn: false, expired: false, identity: null } });
    await tick();

    const pw = doc.getElementById("password");
    const eye = doc.getElementById("reveal");
    pw.value = "hunter2";

    /* type="button" is what stops this submitting: inside a <form>, a button
       with no type IS a submit button. */
    eq("the toggle is not a submit button", eye.getAttribute("type"), "button");
    eq("it starts masked", pw.type, "password");
    eq("and says what it will do", eye.getAttribute("aria-label"), "Show password");
    eq("...as a pressed-state too", eye.getAttribute("aria-pressed"), "false");

    const before = sent.length;
    eye.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await tick();

    eq("clicking reveals it", pw.type, "text");
    eq("the value is untouched", pw.value, "hunter2");
    eq("the label flips", eye.getAttribute("aria-label"), "Hide password");
    eq("...and so does the pressed state", eye.getAttribute("aria-pressed"), "true");
    eq("nothing was submitted", sent.length, before);

    eye.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await tick();
    eq("clicking again hides it", pw.type, "password");
    eq("still untouched", pw.value, "hunter2");
    eq("and the label is back", eye.getAttribute("aria-label"), "Show password");
    eq("still nothing submitted", sent.length, before);
  }

  // ------------------------------------------------------------------
  console.log("\nThe loading state is visible, blocks a second attempt, and clears nothing");
  {
    const { doc, w, sent } = renderInPopup(null, null, {
      auth: { signedIn: false, expired: false, identity: null },
      hold: true
    });
    await tick();

    submitForm(doc, w, "dana@acme.test", "hunter2");
    await tick(30);   // mid-request: the harness is holding the reply

    eq("the button says what is happening", text(doc, "signInLabel"), "Signing in…");
    ok("the spinner is up", !doc.getElementById("spinnerAuth").hidden);
    ok("the button is disabled", doc.getElementById("signIn").disabled);

    /* A disabled input keeps its value; a RECREATED one does not. The loading
       state must never rebuild the form. */
    eq("the email is still there", doc.getElementById("email").value, "dana@acme.test");
    eq("the password is still there", doc.getElementById("password").value, "hunter2");

    const during = sent.filter((m) => m.type === "AUTH_SIGN_IN").length;
    doc.getElementById("authForm").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    eq("a second submit while in flight is ignored", sent.filter((m) => m.type === "AUTH_SIGN_IN").length, during);
  }

  // ------------------------------------------------------------------
  console.log("\nAn error does not move the Sign in button");
  {
    const { doc, w } = renderInPopup(null, null, { auth: { signedIn: false, expired: false, identity: null } });
    await tick();

    /* The slot is in the layout whether or not it holds anything, so the
       button does not jump downward at the exact moment a tenant is reaching
       for it. jsdom reports no geometry, so the structural guarantee is what is
       asserted: the slot exists, is always present, and only its CONTENTS are
       toggled. */
    const slot = doc.querySelector(".auth-error-slot");
    ok("the error has a reserved slot", !!slot);
    ok("the slot itself is never hidden", !slot.hidden);
    ok("only the message inside it is", doc.getElementById("authError").hidden);

    submitForm(doc, w, "dana@acme.test", "hunter2");
    await tick(40);

    ok("the slot is still the same element", doc.querySelector(".auth-error-slot") === slot);
    ok("now holding the message", !doc.getElementById("authError").hidden);
    ok("and the button is still its child-order sibling",
       slot.nextElementSibling && slot.nextElementSibling.id === "signIn");
  }

  // ------------------------------------------------------------------
  console.log("\nEmpty fields are caught before a request is made");
  {
    const { doc, w, sent } = renderInPopup(null, null, { auth: { signedIn: false, expired: false, identity: null } });
    await tick();

    submitForm(doc, w, "", "hunter2");
    await tick();
    eq("no sign-in was attempted", sent.filter((m) => m.type === "AUTH_SIGN_IN").length, 0);
    ok("and it says which field", /email/i.test(text(doc, "authError")), text(doc, "authError"));
    eq("the password was not cleared by that", doc.getElementById("password").value, "hunter2");

    submitForm(doc, w, "dana@acme.test", "");
    await tick();
    eq("still no request", sent.filter((m) => m.type === "AUTH_SIGN_IN").length, 0);
    ok("and now it names the password", /password/i.test(text(doc, "authError")), text(doc, "authError"));
  }

  // ------------------------------------------------------------------
  console.log("\nA successful sign-in clears the password and shows the account");
  {
    const { doc, w } = renderInPopup(null, null, {
      auth: SIGNED_IN,
      signInResult: { ok: true, identity: SIGNED_IN.identity }
    });
    await tick();

    doc.getElementById("email").value = "dana@acme.test";
    doc.getElementById("password").value = "hunter2";
    doc.getElementById("authForm").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await tick(40);

    /* Cleared only HERE, where the form is about to be hidden anyway and the
       value has served its purpose. */
    eq("the password is cleared on success", doc.getElementById("password").value, "");
    ok("the form is hidden", doc.getElementById("authForm").hidden);
    ok("and the account bar is up", !doc.getElementById("acct").hidden);
  }

  // ------------------------------------------------------------------
  console.log("\nThe popup shows the real reason, not a blanket password error");
  {
    const reasons = [
      ["misconfigured", "This extension is not set up correctly and cannot reach Drive247."],
      ["offline", "Could not reach Drive247. Check your internet connection and try again."],
      ["no_tenant", "This Drive247 account is not linked to a rental account, so there is nothing to sync into."],
      ["inactive", "This Drive247 account has been deactivated."],
    ];
    for (const [code, reason] of reasons) {
      const { doc, w } = renderInPopup(null, null, {
        auth: { signedIn: false, expired: false, identity: null },
        signInResult: { ok: false, code, reason }
      });
      await tick();
      submitForm(doc, w, "dana@acme.test", "hunter2");
      await tick(40);
      eq("shows the " + code + " message", text(doc, "authError"), reason);
      ok("  ...and both fields survive it", doc.getElementById("email").value === "dana@acme.test" &&
                                            doc.getElementById("password").value === "hunter2");
    }
  }

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
