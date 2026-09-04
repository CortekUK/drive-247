/**
 * popup.js — the popup is a VIEW ONLY.
 *
 * Closing the popup destroys this document instantly, so it must never own the
 * operation or the result. All the work happens in the service worker; all the
 * state lives in chrome.storage.local. We render storage on open and then
 * follow storage.onChanged — so a sync that finishes AFTER the popup was closed
 * is still correct, and is still there when the popup is reopened. On a
 * multi-batch sync that is not a nicety: the walk outlives the popup by design,
 * and the operator will close it.
 *
 * THIS FILE NEVER HOLDS A CREDENTIAL. Sign-in is a message to the worker
 * carrying an email and a password that are read straight out of the form and
 * are never stored, never echoed and never logged. What comes back is a
 * decision, not a token. Everything the popup paints about the signed-in tenant
 * comes from `d247Identity` in storage, which holds a name, an email and a
 * tenant and no credential at all — the access and refresh tokens live under a
 * different key that this file does not read.
 *
 * WHAT A TENANT IS ALLOWED TO SEE HERE: the sign-in form, who they are signed
 * in as, the sync button, this sync's progress, when the last successful sync
 * was, one plain sentence about how it went, and sign out. No endpoints, no
 * tenant ids, no selectors, no tokens, no backend settings.
 *
 * =====================================================================
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * =====================================================================
 * A number is only rendered next to a total when the sync has PROVED it read
 * the whole feed. Everywhere else the denominator is simply absent.
 *
 * The failure being designed out is specific and it is the easiest bug in this
 * entire system to write: a progress bar reading `processed / total` where
 * `total` came from the same possibly-degraded response as `processed`. A WAF
 * that truncates a list to 8 items will just as happily report `total: 8`, and
 * the operator sees a full green bar over half a calendar. So `batchesTotal`
 * and `progressTotal` arrive from the worker as null unless coverage.complete
 * is true, and the renderers below print nothing where the "of N" would go.
 * `declaredTotal` — what Turo claimed — is shown only inside the diagnostics
 * drawer, clearly labelled as a claim.
 */

"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  // auth
  authForm: $("authForm"), email: $("email"), password: $("password"),
  authError: $("authError"), signIn: $("signIn"), signInLabel: $("signInLabel"),
  spinnerAuth: $("spinnerAuth"),
  acct: $("acct"), acctTenant: $("acctTenant"), acctEmail: $("acctEmail"),
  signOut: $("signOut"), work: $("work"), lastSync: $("lastSync"),

  // full sync
  syncAll: $("syncAll"), syncAllLabel: $("syncAllLabel"), spinnerAll: $("spinnerAll"),
  run: $("run"), runStep: $("runStep"), runSource: $("runSource"), runBatch: $("runBatch"),
  runTiles: $("runTiles"), runCoverage: $("runCoverage"),
  runGates: $("runGates"), gWrite: $("gWrite"), gRelease: $("gRelease"), gReason: $("gReason"),
  runAlert: $("runAlert"), alertKind: $("alertKind"), alertAdvice: $("alertAdvice"),
  alertDetail: $("alertDetail"), continueBtn: $("continueBtn"), stopBtn: $("stopBtn"),
  unknownDrawer: $("unknownDrawer"), unknownCount: $("unknownCount"), unknownList: $("unknownList"),
  rejectDrawer: $("rejectDrawer"), rejectCount: $("rejectCount"), rejectList: $("rejectList"),
  tripDrawer: $("tripDrawer"), tripCount: $("tripCount"), tripList: $("tripList"),
  absenceDrawer: $("absenceDrawer"), absenceCount: $("absenceCount"), absenceList: $("absenceList"),

  // the original one-click demo
  sync: $("sync"), syncLabel: $("syncLabel"), spinner: $("spinner"),
  status: $("status"), statusTitle: $("statusTitle"), statusDetail: $("statusDetail"),
  badge: $("badge"), result: $("result"),
  rTrip: $("rTrip"), rVehicle: $("rVehicle"), rGuest: $("rGuest"), rDates: $("rDates")
};

/**
 * The human-readable half of the degraded-read taxonomy.
 *
 * The ADVICE comes from the worker (POLICY[outcome].advice in
 * turo-read-contract.js) so those sentences are written in exactly one place.
 * What lives here is only the SHORT LABEL and the severity colour — the part
 * that is presentation. `kind` answers "whose problem is this?", which is the
 * first thing an operator needs and the thing a bare error code never says.
 */
const OUTCOME_LABEL = {
  OK: ["Read your Turo calendar", "good"],
  NO_TRIPS_CONFIRMED: ["No upcoming trips — and we confirmed it", "good"],
  EMPTY_UNCONFIRMED: ["Turo returned nothing we could trust", "warn"],
  NOT_LOGGED_IN: ["Not signed in to Turo", "warn"],
  BOT_BLOCKED: ["Turo's bot protection stopped us", "warn"],
  RATE_LIMITED: ["Turo is rate-limiting this browser", "warn"],
  UNREACHABLE: ["Could not reach Turo", "warn"],
  SHAPE_CHANGED: ["Turo changed its data — this extension needs an update", "bad"],
  TRUNCATED: ["Only part of your calendar was read", "warn"],
  PAGINATION_STALLED: ["Turo stopped sending new pages", "warn"],
  UNPARSEABLE: ["Turo's answer could not be read", "bad"],
  NO_TRIPS: ["No upcoming trips returned", "warn"],
  UNKNOWN: ["Turo answered in a shape we do not recognise", "bad"],
  INGEST_FAILED: ["Drive247 would not accept a booking", "bad"],
  USER_CANCELLED: ["You stopped this sync", "warn"],
  ABANDONED: ["This sync was abandoned", "bad"]
};

const LIFECYCLE_LABEL = {
  upcoming: "Upcoming",
  active: "On rent now",
  completed_provisional: "Just ended · held 48h",
  cancelled: "Cancelled",
  unknown: "Status unknown"
};

const VEHICLE_LABEL = {
  turo_vehicle_id: "matched by Turo id",
  plate_exact: "matched by plate",
  label_plate_parsed: "plate read from a label · check this",
  vin_unique: "VIN only · check this",
  vin_ambiguous: "VIN is ambiguous · check this",
  label_fuzzy: "name only · check this",
  unbound: "no vehicle · check this"
};

// ================================================================= startup ==

(async function init() {
  /* The run panels are painted FIRST and unconditionally, from storage. A sync
     outlives the popup by design, so what is on screen must reflect storage
     whether or not the auth round-trip below has come back yet — and if the
     session turns out to be gone, paintAuth() hides the whole panel anyway. */
  const bag = await chrome.storage.local.get(["lastRun", "syncState", "lastSyncAt", "useSample", "scenario"]);
  renderOne(bag.lastRun || null);
  renderRun(bag.syncState || null);
  renderLastSync(bag.lastSyncAt || null);

  /* Ask the WORKER, not storage. Only the worker can tell an identity that is
     still valid from one whose refresh token has since been rejected, because
     only the worker can attempt the refresh. Reading d247Identity alone would
     show a confident "Signed in as…" over a session that is actually dead. */
  await refreshAuth();
})();

// ================================================================ sign-in ==

/**
 * The fixture path still exists in the worker and is still exercised by the
 * test suites, but it has NO CONTROL ON THIS SCREEN. "Use bundled sample data"
 * and a scenario picker are development affordances, and a tenant seeing them
 * can only be confused or misled by them. They are read from storage — where a
 * developer can set them from the extension's own devtools — and nowhere else.
 */
let devMode = { useSample: false, scenario: null };
chrome.storage.local.get(["useSample", "scenario"]).then((bag) => {
  devMode = { useSample: !!bag.useSample, scenario: bag.scenario || null };
}).catch(() => {});

async function refreshAuth() {
  let state = null;
  try { state = await chrome.runtime.sendMessage({ type: "AUTH_STATE" }); } catch (_) {}
  paintAuth(state || { signedIn: false, expired: false, identity: null });
}

/**
 * The gate. Signed out means the sync UI is not merely disabled but absent:
 * a disabled button invites a tenant to work out how to enable it, and there is
 * nothing to work out here except signing in.
 */
function paintAuth(state) {
  const inAccount = !!(state && state.signedIn && state.identity);
  els.authForm.hidden = inAccount;
  els.work.hidden = !inAccount;
  els.acct.hidden = !inAccount;

  if (!inAccount) {
    els.acctTenant.textContent = "";
    els.acctEmail.textContent = "";
    /* "Signed in again" vs "sign in" is the whole difference between a tenant
       who thinks the extension broke and one who knows what to do next. */
    if (state && state.expired) {
      showAuthError("Your Drive247 sign-in has expired. Sign in again to continue.");
    }
    return;
  }

  const id = state.identity;
  els.acctTenant.textContent = id.tenantName || "Drive247";
  els.acctEmail.textContent = id.name || id.email || "";
  hideAuthError();
}

function showAuthError(message) {
  els.authError.textContent = message;
  els.authError.hidden = false;
}
function hideAuthError() {
  els.authError.textContent = "";
  els.authError.hidden = true;
}

els.authForm.addEventListener("submit", async (e) => {
  /* A form submit inside an extension popup would NAVIGATE this document,
     which destroys it. The default is prevented on every path, including the
     failure paths below. */
  e.preventDefault();
  hideAuthError();
  setBusyAuth(true);

  const email = els.email.value;
  const password = els.password.value;

  let result = null;
  try {
    result = await chrome.runtime.sendMessage({ type: "AUTH_SIGN_IN", email, password });
  } catch (_) {
    result = { ok: false, reason: "The extension could not reach its background worker. Try again." };
  }

  /* Cleared on success AND on failure. A password sitting in a DOM node after a
     failed attempt is a password waiting to be shoulder-surfed or screen-shared,
     and the tenant is about to retype it either way. */
  els.password.value = "";
  setBusyAuth(false);

  if (!result || !result.ok) {
    showAuthError((result && result.reason) || "Sign-in failed. Try again.");
    return;
  }
  els.email.value = "";
  await refreshAuth();
});

els.signOut.addEventListener("click", async () => {
  try { await chrome.runtime.sendMessage({ type: "AUTH_SIGN_OUT" }); } catch (_) {}
  /* The worker clears the session AND every run artefact that belonged to it.
     Repaint from nothing so the next person at this machine sees no trace of
     the last one's guest names. */
  renderOne(null);
  renderRun(null);
  renderLastSync(null);
  els.email.value = "";
  els.password.value = "";
  await refreshAuth();
});

function setBusyAuth(busy) {
  els.signIn.disabled = busy;
  els.spinnerAuth.hidden = !busy;
  els.signInLabel.textContent = busy ? "Signing in…" : "Sign in";
  els.email.disabled = busy;
  els.password.disabled = busy;
}

// ================================================================ the clicks ==

els.syncAll.addEventListener("click", async () => {
  setBusyAll(true);
  try {
    await chrome.runtime.sendMessage({
      type: "SYNC_ALL",
      mode: devMode.useSample ? "fixture" : "live",
      scenario: devMode.useSample ? devMode.scenario : null
    });
  } catch (_) {
    // The worker was revived, or the popup raced it. Harmless: storage carries
    // the real outcome and storage.onChanged will paint it.
  }
});

els.continueBtn.addEventListener("click", async () => {
  try { await chrome.runtime.sendMessage({ type: "SYNC_RESUME" }); } catch (_) {}
});
els.stopBtn.addEventListener("click", async () => {
  try { await chrome.runtime.sendMessage({ type: "SYNC_CANCEL" }); } catch (_) {}
});

els.sync.addEventListener("click", async () => {
  setBusyOne(true);
  renderOne({ phase: "running", title: "Starting…" });
  try { await chrome.runtime.sendMessage({ type: "SYNC_ONE" }); } catch (_) {}
  setBusyOne(false);
});

function setBusyAll(busy) {
  els.syncAll.disabled = busy;
  els.spinnerAll.hidden = !busy;
  els.syncAllLabel.textContent = busy ? "Syncing…" : "Sync my Turo calendar";
}
function setBusyOne(busy) {
  els.sync.disabled = busy;
  els.spinner.hidden = !busy;
  els.syncLabel.textContent = busy ? "Syncing…" : "Sync one reservation";
}

// ============================================================ live updates ==

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lastRun) renderOne(changes.lastRun.newValue);
  if (changes.syncState) renderRun(changes.syncState.newValue);
  if (changes.lastSyncAt) renderLastSync(changes.lastSyncAt.newValue || null);
  /* The worker clears d247Identity when a refresh is rejected mid-sync. This is
     how an expiry that happens while the popup is OPEN reaches the screen,
     rather than sitting behind a stale "Signed in as…" until the next reopen. */
  if (changes.d247Identity) refreshAuth();
});

/**
 * "Last synced" — a date, and nothing that could be mistaken for one.
 *
 * Only ever written by a run whose writes Drive247 accepted (background.js), so
 * this line never moves forward on a sync that saved nothing. A run that read
 * only part of the calendar says so, because "last synced today" over a partial
 * read is the same confident lie the batch counter exists to prevent.
 */
function renderLastSync(entry) {
  if (!entry || !entry.at) {
    els.lastSync.hidden = true;
    els.lastSync.textContent = "";
    return;
  }
  const when = new Date(entry.at);
  const stamp = isNaN(when.getTime())
    ? null
    : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (!stamp) { els.lastSync.hidden = true; return; }

  const n = Number(entry.records) || 0;
  const what = n === 1 ? "1 booking" : n + " bookings";
  els.lastSync.textContent =
    "Last synced " + stamp + " · " + what +
    (entry.complete === false ? " · part of your calendar only" : "");
  els.lastSync.hidden = false;
}

// =============================================== render: the multi-batch run ==

function renderRun(s) {
  if (!s) {
    els.run.hidden = true;
    setBusyAll(false);
    return;
  }
  els.run.hidden = false;
  els.run.dataset.phase = s.phase;
  els.runStep.textContent = s.note || s.stepLabel || "";
  setBusyAll(s.phase === "running");

  /* The source badge is the one place this UI uses a filled pill, because
     "is this real data?" must be impossible to miss on stage. Never let a
     refactor collapse the live and sample paths into one label. */
  if (s.mode === "fixture") {
    els.runSource.hidden = false;
    els.runSource.dataset.source = "fixture";
    els.runSource.textContent = s.scenario ? "Sample · " + s.scenario.replace(/_/g, " ") : "Bundled sample data";
  } else if (s.mode === "live") {
    els.runSource.hidden = false;
    els.runSource.dataset.source = "turo";
    els.runSource.textContent = "Live Turo session";
  } else {
    els.runSource.hidden = true;
  }

  renderBatch(s);
  renderTiles(s);
  renderCoverage(s);
  renderGates(s);
  renderAlert(s);
  renderUnknowns(s);
  renderRejections(s);
  renderTrips(s);
  renderAbsences(s);
}

/**
 * "Batch N of M" — but only ever "of M" when M is a fact.
 *
 * While the walk is running there is no honest total: Turo's pagination shape
 * is unconfirmed, so we cannot know how many pages exist until we reach the
 * end. Showing a guess here is the whole failure mode this project is built
 * around, so the denominator is simply omitted and the sentence still reads
 * naturally: "Batch 3 · 47 trips read so far".
 */
function renderBatch(s) {
  if (!s.batchesDone && s.phase === "running") {
    els.runBatch.textContent = "";
    return;
  }
  const n = s.phase === "running" ? Math.max(s.currentBatch || 0, s.batchesDone) : s.batchesDone;
  const total = s.batchesTotal;                    // null unless PROVED complete
  const head = total !== null && total !== undefined
    ? `Batch ${n} of ${total}`
    : `Batch ${n}`;
  const trips = s.counts.accepted === 1 ? "1 trip" : `${s.counts.accepted} trips`;
  const tail = total !== null && total !== undefined ? `${trips} read` : `${trips} read so far`;
  els.runBatch.textContent = `${head} · ${tail}`;
}

/**
 * ABSOLUTE COUNTS, never a percentage and never processed/total. Every number
 * here is something we counted ourselves out of what we actually parsed; not
 * one of them comes from anything Turo said about the size of its own feed.
 */
function renderTiles(s) {
  const c = s.counts;
  const tiles = [
    ["Saved", c.flushed, "good"],
    ["Need a vehicle", c.needVehicle, c.needVehicle ? "warn" : "muted"],
    ["Check these", c.review, c.review ? "warn" : "muted"],
    ["Could not read", c.rejected, c.rejected ? "bad" : "muted"]
  ];
  if (c.cancelled) tiles.push(["Cancelled", c.cancelled, "muted"]);
  els.runTiles.innerHTML = "";
  for (const [label, value, tone] of tiles) {
    const d = document.createElement("div");
    d.className = "tile tone-" + tone;
    const v = document.createElement("strong");
    v.textContent = String(value);
    const l = document.createElement("span");
    l.textContent = label;
    d.appendChild(v);
    d.appendChild(l);
    els.runTiles.appendChild(d);
  }
}

/**
 * The coverage sentence comes from the worker verbatim
 * (coverageVerdict().display) and is asserted by test never to contain " of "
 * when the walk is incomplete. Do not reformat it here — the wording IS the
 * safety property.
 */
function renderCoverage(s) {
  if (!s.coverage) { els.runCoverage.textContent = ""; els.runCoverage.className = "coverage"; return; }
  els.runCoverage.textContent = capitalise(s.coverage.display) + ".";
  els.runCoverage.className = "coverage " + (s.coverage.complete ? "good" : "warn");
}

/**
 * TWO GATES, SHOWN SEPARATELY, ALWAYS.
 *
 * Collapsing "we saved what we read" and "we released blocks for trips that
 * were not there" into one green tick is the bug this whole feature is built to
 * avoid. A truncated read is perfectly safe to save from and catastrophic to
 * release from, so the operator sees both answers, side by side, with the
 * reason underneath.
 */
function renderGates(s) {
  if (!s.gates) { els.runGates.hidden = true; els.gReason.textContent = ""; return; }
  els.runGates.hidden = false;
  els.gWrite.textContent = s.gates.mayWrite ? "Yes" : "Nothing was saved";
  els.gWrite.className = s.gates.mayWrite ? "good" : "warn";
  els.gRelease.textContent = s.gates.mayRelease ? "Allowed" : "None — dates stay blocked";
  els.gRelease.className = s.gates.mayRelease ? "good" : "warn";
  els.gReason.textContent = s.gates.reason || "";
}

/**
 * The typed error state. Three lines, in this order, because that is the order
 * a person needs them: WHAT kind of problem, WHAT to do, and then the raw
 * detail for whoever is going to report it.
 */
function renderAlert(s) {
  const stuck = s.phase === "parked";
  if (!stuck && !(s.outcome && OUTCOME_LABEL[s.outcome] && OUTCOME_LABEL[s.outcome][1] !== "good")) {
    els.runAlert.hidden = true;
    return;
  }
  const [label, tone] = OUTCOME_LABEL[s.outcome] || ["Something unexpected happened", "bad"];
  els.runAlert.hidden = false;
  els.runAlert.dataset.tone = tone;
  /* `s.label` is set only when the worker parked for a reason the reader's
     vocabulary describes badly — a Drive247 session that ended mid-run reaches
     the server as NOT_LOGGED_IN, which is true, but "Not signed in to Turo" is
     not the sentence that helps. */
  els.alertKind.textContent = s.label || label;
  els.alertAdvice.textContent = s.advice || "";
  els.alertDetail.textContent = s.lastError && s.lastError !== s.advice ? s.lastError : "";
  els.alertDetail.hidden = !els.alertDetail.textContent;

  els.continueBtn.hidden = !s.canResume;
  els.stopBtn.hidden = !(s.phase === "running" || s.canResume);
  els.continueBtn.textContent = s.autoResumes && s.nextAllowedAt
    ? "Continue now"
    : "Continue";
}

/**
 * WHAT WE COULD NOT READ. This drawer is the single most important thing in the
 * UI that is not a number: it is the difference between "Turo changed something
 * and we told you" and "Turo changed something and your calendar quietly went
 * wrong". A field listed here was NOT guessed at.
 */
function renderUnknowns(s) {
  const list = s.unknownFields || [];
  els.unknownDrawer.hidden = list.length === 0;
  if (!list.length) return;
  els.unknownCount.textContent = list.length === 1
    ? "1 field Turo did not give us"
    : `${list.length} fields Turo did not give us`;
  els.unknownList.innerHTML = "";
  for (const u of list) {
    const li = document.createElement("li");
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = u.field.replace(/_/g, " ");
    const v = document.createElement("span");
    v.className = "v";
    v.textContent = `${u.count} trip${u.count === 1 ? "" : "s"} · ${(u.reason || "").replace(/_/g, " ")}` +
      (u.sample ? ` · saw "${u.sample}"` : "");
    li.appendChild(k);
    li.appendChild(v);
    els.unknownList.appendChild(li);
  }
}

/** Trips Turo sent that we refused rather than half-import. */
function renderRejections(s) {
  const list = s.rejected || [];
  els.rejectDrawer.hidden = list.length === 0;
  if (!list.length) return;
  els.rejectCount.textContent = list.length === 1
    ? "1 trip we could not read"
    : `${list.length} trips we could not read`;
  els.rejectList.innerHTML = "";
  for (const r of list) {
    const li = document.createElement("li");
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = (r.reason || "").replace(/_/g, " ");
    const v = document.createElement("span");
    v.className = "v";
    // The key names Turo ACTUALLY sent. This is the repair path: read them and
    // the alias list changes by one line.
    v.textContent = (r.fields && r.fields.length ? "missing " + r.fields.join(", ") + " · " : "") +
      "sent: " + (r.keys || []).slice(0, 8).join(", ");
    li.appendChild(k);
    li.appendChild(v);
    els.rejectList.appendChild(li);
  }
}

function renderTrips(s) {
  const rows = s.rows || [];
  els.tripDrawer.hidden = rows.length === 0;
  if (!rows.length) return;
  els.tripCount.textContent = rows.length === 1 ? "1 trip saved" : `${rows.length} trips saved`;
  els.tripList.innerHTML = "";
  for (const r of rows.slice().reverse()) {
    const li = document.createElement("li");
    li.className = r.review ? "trip needs-review" : "trip";

    const top = document.createElement("div");
    top.className = "trip-top";
    const veh = document.createElement("strong");
    veh.textContent = r.vehicle || "Unidentified vehicle";
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = formatRange(r.startsAt, r.endsAt);
    top.appendChild(veh);
    top.appendChild(when);

    const bot = document.createElement("div");
    bot.className = "trip-bot";
    const bits = [];
    if (r.guest) bits.push(r.guest);
    bits.push(LIFECYCLE_LABEL[r.lifecycle] || r.lifecycle);
    bits.push(VEHICLE_LABEL[r.vehicleEvidence] || r.vehicleEvidence);
    if (r.supersedes) bits.push("replaces " + r.supersedes);
    if (r.unknowns && r.unknowns.length) bits.push("missing " + r.unknowns.join(", "));
    bot.textContent = bits.join(" · ");

    li.appendChild(top);
    li.appendChild(bot);
    els.tripList.appendChild(li);
  }
}

/**
 * The absence ledger. Every line here is a trip that was in the last sync and
 * is not in this one, and the wording deliberately refuses to call any of them
 * "cancelled" unless Turo said so.
 */
function renderAbsences(s) {
  const list = s.absences || [];
  els.absenceDrawer.hidden = list.length === 0;
  if (!list.length) return;
  els.absenceCount.textContent = list.length === 1
    ? "1 trip is no longer listed"
    : `${list.length} trips are no longer listed`;
  els.absenceList.innerHTML = "";
  const WORDS = {
    explicit_cancelled_status: ["Turo says it was cancelled", "its dates were freed"],
    targeted_404: ["Turo no longer has this trip", "its dates were freed"],
    superseded: ["moved or reissued as another trip", "dates stay blocked"],
    absent_only: ["just did not appear this time", "dates stay blocked"]
  };
  for (const a of list) {
    const [why, effect] = WORDS[a.evidence] || ["unknown", "dates stay blocked"];
    const li = document.createElement("li");
    const k = document.createElement("span");
    k.className = "k mono";
    k.textContent = a.reservationId;
    const v = document.createElement("span");
    v.className = "v " + (a.releaseAllowed ? "" : "warn");
    v.textContent = why + " — " + effect +
      (a.evidence === "absent_only" && a.consecutiveAbsentRuns > 1
        ? ` (${a.consecutiveAbsentRuns} syncs running)` : "");
    li.appendChild(k);
    li.appendChild(v);
    els.absenceList.appendChild(li);
  }
}

// ============================================ render: the one-click PoC demo ==

function renderOne(run) {
  if (!run) {
    els.status.dataset.phase = "idle";
    els.statusTitle.textContent = "Ready";
    els.statusDetail.textContent = "";
    els.badge.hidden = true;
    els.result.hidden = true;
    setBusyOne(false);
    return;
  }

  const phase = run.phase || "idle";
  els.status.dataset.phase = phase;
  els.statusTitle.textContent = run.title || "";
  els.statusDetail.textContent = run.detail || "";

  // A finished run rendered from storage must not leave the button spinning
  // (e.g. the popup was reopened after the sync completed).
  setBusyOne(phase === "running");

  if (run.source === "turo" || run.source === "fixture") {
    els.badge.hidden = false;
    els.badge.dataset.source = run.source;
    els.badge.textContent = run.source === "turo" ? "Live Turo session" : "Bundled sample data";
  } else {
    els.badge.hidden = true;
  }

  const r = run.reservation;
  if (phase === "done" && r) {
    els.result.hidden = false;
    els.rTrip.textContent = r.reservation_id || "—";
    els.rVehicle.textContent = r.vehicle_label || "—";
    els.rGuest.textContent = r.guest_name || "—";
    els.rDates.textContent = formatRange(r.starts_at, r.ends_at);
  } else {
    els.result.hidden = true;
  }
}

// ================================================================== helpers ==

/** e.g. "12 Sep 2026, 15:00 → 16 Sep 2026, 11:00" (local time). */
function formatRange(startsAt, endsAt) {
  const one = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  };
  return `${one(startsAt)} → ${one(endsAt)}`;
}

function capitalise(s) {
  return typeof s === "string" && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}
