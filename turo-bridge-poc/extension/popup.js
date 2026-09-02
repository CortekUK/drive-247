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
 * The one thing this file writes is the pairing token, and it writes it on
 * every keystroke, because the worker reads the token from storage and never
 * from this DOM.
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
  token: $("token"), reveal: $("reveal"), tokenHint: $("tokenHint"), clear: $("clear"),

  // full sync
  syncAll: $("syncAll"), syncAllLabel: $("syncAllLabel"), spinnerAll: $("spinnerAll"),
  useSample: $("useSample"), scenario: $("scenario"),
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
  const bag = await chrome.storage.local.get(["pairingToken", "lastRun", "syncState", "useSample", "scenario"]);
  els.token.value = bag.pairingToken || "";
  paintTokenHint(bag.pairingToken || "");
  els.useSample.checked = !!bag.useSample;
  els.scenario.value = bag.scenario || "";
  els.scenario.disabled = !els.useSample.checked;
  renderOne(bag.lastRun || null);
  renderRun(bag.syncState || null);
})();

// ============================================================= token field ==

els.token.addEventListener("input", () => {
  const value = els.token.value.trim();
  chrome.storage.local.set({ pairingToken: value });
  paintTokenHint(value);
});

els.reveal.addEventListener("click", () => {
  const showing = els.token.type === "text";
  els.token.type = showing ? "password" : "text";
  els.reveal.textContent = showing ? "Show" : "Hide";
  els.reveal.setAttribute("aria-pressed", String(!showing));
});

els.clear.addEventListener("click", async () => {
  await chrome.storage.local.remove([
    "pairingToken", "lastRun", "syncState", "turoCursor", "syncPending", "syncSummary"
  ]);
  els.token.value = "";
  els.token.type = "password";
  els.reveal.textContent = "Show";
  paintTokenHint("");
  renderOne(null);
  renderRun(null);
});

/**
 * Never echoes the whole secret back onto the screen — a prefix is enough to
 * confirm the right token is loaded, and this popup gets screen-shared during
 * a demo.
 */
function paintTokenHint(value) {
  if (!value) {
    els.tokenHint.className = "hint";
    els.tokenHint.textContent = "Paste the token from your Drive247 portal.";
    return;
  }
  if (value.length < 20) {
    els.tokenHint.className = "hint warn";
    els.tokenHint.textContent = "That looks too short to be a pairing token.";
    return;
  }
  els.tokenHint.className = "hint good";
  els.tokenHint.textContent = `Saved · ${value.slice(0, 14)}…`;
}

// ================================================================ the clicks ==

els.useSample.addEventListener("change", () => {
  els.scenario.disabled = !els.useSample.checked;
  chrome.storage.local.set({ useSample: els.useSample.checked });
});
els.scenario.addEventListener("change", () => {
  chrome.storage.local.set({ scenario: els.scenario.value });
});

els.syncAll.addEventListener("click", async () => {
  setBusyAll(true);
  try {
    await chrome.runtime.sendMessage({
      type: "SYNC_ALL",
      mode: els.useSample.checked ? "fixture" : "live",
      scenario: els.useSample.checked ? (els.scenario.value || null) : null
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
  if (changes.pairingToken) paintTokenHint(changes.pairingToken.newValue || "");
});

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
  els.alertKind.textContent = label;
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
