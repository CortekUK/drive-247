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
  spinnerAuth: $("spinnerAuth"), reveal: $("reveal"),
  acct: $("acct"), acctTenant: $("acctTenant"), acctEmail: $("acctEmail"),
  signOut: $("signOut"), work: $("work"), lastSync: $("lastSync"),

  // the two connections
  connTuro: $("connTuro"), connTuroDetail: $("connTuroDetail"), connTuroCheck: $("connTuroCheck"),
  connD247: $("connD247"), connD247Detail: $("connD247Detail"), syncGate: $("syncGate"),

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
  const bag = await chrome.storage.local.get(["lastRun", "syncState", "lastSyncAt", "lastEmail", "useSample", "scenario"]);
  renderOne(bag.lastRun || null);
  renderRun(bag.syncState || null);
  renderLastSync(bag.lastSyncAt || null);

  /* THE EMAIL, AND ONLY THE EMAIL. Retyping an address on every attempt is the
     single most tedious thing about a popup that is destroyed each time it
     closes. The password is deliberately NOT remembered — see the note on
     rememberEmail() — so a reopened popup shows a filled email and an empty
     password, which is also the shape every browser password manager expects. */
  if (bag.lastEmail && !els.email.value) els.email.value = bag.lastEmail;

  /* Ask the WORKER, not storage. Only the worker can tell an identity that is
     still valid from one whose refresh token has since been rejected, because
     only the worker can attempt the refresh. Reading d247Identity alone would
     show a confident "Signed in as…" over a session that is actually dead. */
  await refreshAuth();

  /* Cached first so the row paints immediately, then a live check. Blocking the
     popup on a network round trip to turo.com is how a status line becomes
     something people stop reading. */
  await refreshTuro(true);
  refreshTuro(false);
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

/**
 * Show / hide the password.
 *
 * Touches `type` and nothing else. It does not rewrite `value` (which would
 * lose an unsaved keystroke in some browsers), does not re-render the form, and
 * cannot submit it — the button is explicitly type="button", because inside a
 * <form> an untyped button IS a submit button.
 *
 * Focus is returned to the input at the caret's previous position, so a tenant
 * who reveals the password mid-typing carries on where they were instead of
 * being dumped at the start of the field or left focused on the icon.
 */
els.reveal.addEventListener("click", () => {
  const showing = els.password.type === "text";
  const start = els.password.selectionStart;
  const end = els.password.selectionEnd;

  els.password.type = showing ? "password" : "text";
  els.reveal.setAttribute("aria-pressed", String(!showing));
  els.reveal.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  els.reveal.setAttribute("title", showing ? "Show password" : "Hide password");
  els.reveal.querySelector(".eye-open").hidden = !showing;
  els.reveal.querySelector(".eye-shut").hidden = showing;

  try {
    els.password.focus();
    if (start !== null && end !== null) els.password.setSelectionRange(start, end);
  } catch (_) {
    /* setSelectionRange throws on some input types in some engines. Never let a
       cosmetic focus restore break the toggle itself. */
  }
});

/**
 * Remember the email. NEVER the password.
 *
 * A password in chrome.storage.local is a password on disk, readable by anyone
 * who can read the profile directory, for the benefit of saving one field of
 * typing. The browser's own password manager already solves this properly, and
 * the form is marked up (`autocomplete="current-password"`) so it can.
 */
function rememberEmail(value) {
  const email = String(value || "").trim();
  if (!email) return;
  chrome.storage.local.set({ lastEmail: email }).catch(() => {});
}

/* ============================ THE TWO CONNECTIONS =========================
   Held here rather than re-read per render, because the sync button depends on
   BOTH and a half-updated pair would flicker the button on and off. */
let conn = { turo: null, d247: null };

const TURO_LABEL = {
  no_tab:        "Open turo.com and sign in as the host",
  not_signed_in: "Not signed in to Turo",
  challenge:     "Turo is showing a security check",
  unreachable:   "Could not reach Turo",
  no_vehicles:   "Signed in, but no vehicles found",
  unreadable:    "Turo answered in a shape we do not recognise",
};

/**
 * Paint one connection row and, once both are known, decide the button.
 *
 * The two rows are deliberately INDEPENDENT. A tenant whose Turo session has
 * lapsed should not be told to sign into Drive247 again, and vice versa —
 * that is the whole reason there are two of them rather than one "not
 * connected" line covering both accounts.
 */
function paintConnections() {
  // ---- Turo -------------------------------------------------------------
  const t = conn.turo;
  if (!t) {
    els.connTuro.dataset.state = "checking";
    els.connTuroDetail.textContent = "Checking…";
  } else if (t.connected) {
    els.connTuro.dataset.state = "on";
    /* "Turo Connected", plus the one fact that proves it rather than asserts
       it: we read this operator's own fleet. */
    els.connTuroDetail.textContent = typeof t.vehicles === "number" && t.vehicles > 0
      ? "Connected · " + t.vehicles + (t.vehicles === 1 ? " vehicle" : " vehicles")
      : "Connected";
  } else {
    els.connTuro.dataset.state = "off";
    els.connTuroDetail.textContent = TURO_LABEL[t.reason] || "Not connected";
  }

  // ---- Drive247 ---------------------------------------------------------
  const d = conn.d247;
  if (!d) {
    els.connD247.dataset.state = "checking";
    els.connD247Detail.textContent = "Checking…";
  } else if (d.signedIn && d.identity) {
    els.connD247.dataset.state = "on";
    els.connD247Detail.textContent = "Connected · " + (d.identity.tenantName || "your account");
  } else {
    els.connD247.dataset.state = "off";
    els.connD247Detail.textContent = d.expired ? "Sign-in expired" : "Sign in below";
  }

  paintSyncGate();
}

/**
 * The sync button opens only when BOTH halves are live, and says which one is
 * missing when it does not.
 *
 * A disabled button with no explanation is a puzzle. Naming the missing half
 * is the difference between a tenant fixing it in ten seconds and a tenant
 * filing a support ticket.
 */
function paintSyncGate() {
  const turoOk = !!(conn.turo && conn.turo.connected);
  const d247Ok = !!(conn.d247 && conn.d247.signedIn && conn.d247.identity);
  const ready = turoOk && d247Ok;

  els.syncAll.disabled = !ready || els.syncAll.dataset.busy === "1";

  if (ready) {
    els.syncGate.hidden = true;
    els.syncGate.textContent = "";
    return;
  }
  /* Both missing is its own sentence: telling someone to fix Turo when they
     have not signed into Drive247 either just sends them round twice. */
  els.syncGate.textContent =
    !turoOk && !d247Ok ? "Connect Turo and sign in to Drive247 to sync."
    : !turoOk ? "Connect Turo to sync. Your Drive247 account is ready."
    : "Sign in to Drive247 to sync. Your Turo session is ready.";
  els.syncGate.hidden = false;
}

/** Ask the worker for the Turo half. `cached` paints instantly on open. */
async function refreshTuro(cached) {
  try {
    conn.turo = await chrome.runtime.sendMessage({ type: "TURO_STATUS", cached: !!cached });
  } catch (_) {
    conn.turo = { connected: false, reason: "unreachable" };
  }
  paintConnections();
}

els.connTuroCheck.addEventListener("click", async () => {
  els.connTuroCheck.disabled = true;
  els.connTuro.dataset.state = "checking";
  els.connTuroDetail.textContent = "Checking…";
  await refreshTuro(false);
  els.connTuroCheck.disabled = false;
});

async function refreshAuth() {
  let state = null;
  try { state = await chrome.runtime.sendMessage({ type: "AUTH_STATE" }); } catch (_) {}
  const resolved = state || { signedIn: false, expired: false, identity: null };
  conn.d247 = resolved;
  paintAuth(resolved);
  paintConnections();
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
    /* Deliberately NOT touching els.email / els.password here. paintAuth runs on
       every storage change, including ones a half-typed form should survive. */
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

/* THE SUBMIT LATCH. Enter and a click on Sign in raise the same submit event,
   and a popup on a slow connection invites a second press. Two concurrent
   password grants against the same account is how you find the rate limiter. */
let signingIn = false;

els.authForm.addEventListener("submit", async (e) => {
  /* A form submit inside an extension popup would NAVIGATE this document,
     which destroys it. The default is prevented on every path, including the
     failure paths below. Enter-to-submit works because this is a real <form>
     with a real submit button. */
  e.preventDefault();
  if (signingIn) return;

  const email = els.email.value.trim();
  const password = els.password.value;

  /* Checked here so an empty field never costs a network round trip, and never
     comes back looking like a server rejection. */
  if (!email) { showAuthError("Enter your Drive247 email address."); els.email.focus(); return; }
  if (!password) { showAuthError("Enter your Drive247 password."); els.password.focus(); return; }

  signingIn = true;
  hideAuthError();
  setBusyAuth(true);
  rememberEmail(email);

  let result = null;
  try {
    result = await chrome.runtime.sendMessage({ type: "AUTH_SIGN_IN", email, password });
  } catch (_) {
    result = { ok: false, reason: "The extension could not reach its background worker. Reload the extension and try again." };
  }

  signingIn = false;
  setBusyAuth(false);

  if (!result || !result.ok) {
    /* BOTH FIELDS SURVIVE A FAILURE, and that is the deliberate reversal of
       what this used to do. Wiping the password on every rejection meant a
       tenant whose real problem was a typo'd email domain — or a dropped
       connection — retyped a correct password over and over. The popup is
       destroyed the moment it closes, so nothing here outlives the window, and
       the value is in a password field the browser already masks.

       Nothing is re-rendered on this path either: the error is written into a
       slot that is always present in the layout, so the inputs are never
       recreated and never lose their values or the caret. */
    showAuthError((result && result.reason) || "Sign-in failed. Try again.");
    els.password.focus();
    els.password.select();
    return;
  }

  /* Cleared only on SUCCESS, when the form is about to be hidden anyway and
     the value has served its purpose. */
  els.password.value = "";
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
  /* The password goes; the email stays. Signing out is not the same as
     forgetting who you are, and the next sign-in is overwhelmingly the same
     person. `lastEmail` is not a credential. */
  els.password.value = "";
  const bag = await chrome.storage.local.get("lastEmail").catch(() => ({}));
  els.email.value = (bag && bag.lastEmail) || "";
  /* Only the Drive247 half. Signing out of the portal has no bearing on the
     operator's Turo session, and clearing that row too would imply it did. */
  await refreshAuth();
});

/**
 * Loading state. Sets `disabled` and label text ONLY.
 *
 * It must never assign to `.value`, and it must never rebuild the form: a
 * disabled input keeps what is in it, a recreated one does not. The submit
 * button is what stops a second attempt; the inputs stay enabled so a tenant
 * who spots their own typo mid-request can start fixing it.
 */
function setBusyAuth(busy) {
  els.signIn.disabled = busy;
  els.spinnerAuth.hidden = !busy;
  els.signInLabel.textContent = busy ? "Signing in…" : "Sign in";
  els.authForm.dataset.busy = busy ? "1" : "";
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
  /* The button has TWO reasons to be disabled — a run in flight, and a missing
     connection — and they are set from different places. The flag is what stops
     a finished run re-enabling a button the gate wants shut. */
  els.syncAll.dataset.busy = busy ? "1" : "";
  els.spinnerAll.hidden = !busy;
  els.syncAllLabel.textContent = busy ? "Syncing…" : "Sync Turo to Drive247";
  paintSyncGate();
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
  /* The worker re-probes Turo during a run; reflect that here rather than
     leaving a stale "Connected" over a session that has since lapsed. */
  if (changes.turoStatus) { conn.turo = changes.turoStatus.newValue || null; paintConnections(); }
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
     refactor collapse the live and sample paths into one label.

     IT ANSWERS EXACTLY ONE QUESTION: real data, or bundled sample data. It read
     "Live Turo session" until it turned up on screen beside "Turo returned an
     empty response we could not verify" — a green badge asserting a healthy
     session directly above a panel explaining the session could NOT be
     confirmed. The extension appeared to be arguing with itself, and of the two
     the badge was the one making a claim it had no evidence for: `mode` is set
     when the run STARTS and only ever means live-versus-fixture. Session health
     is decided by the probe in turo-read-contract.js:1199 and reported by the
     run panel. This says where the bytes came from, and nothing more. */
  if (s.mode === "fixture") {
    els.runSource.hidden = false;
    els.runSource.dataset.source = "fixture";
    els.runSource.textContent = s.scenario ? "Sample · " + s.scenario.replace(/_/g, " ") : "Bundled sample data";
  } else if (s.mode === "live") {
    els.runSource.hidden = false;
    els.runSource.dataset.source = "turo";
    els.runSource.textContent = "Live Turo data";
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
    // Same rule as the run panel's badge: the data's origin, never a claim
    // about the health of the Turo session.
    els.badge.textContent = run.source === "turo" ? "Live Turo data" : "Bundled sample data";
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
