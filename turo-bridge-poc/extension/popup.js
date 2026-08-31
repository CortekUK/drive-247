/**
 * popup.js — the popup is a VIEW ONLY.
 *
 * Closing the popup destroys this document instantly, so it must never own the
 * operation or the result. All the work happens in the service worker; all the
 * state lives in chrome.storage.local. We render storage on open and then
 * follow storage.onChanged — so a sync that finishes AFTER the popup was closed
 * is still correct, and is still there when the popup is reopened.
 *
 * The one thing this file writes is the pairing token, and it writes it on
 * every keystroke, because the worker reads the token from storage and never
 * from this DOM.
 */

"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  token: $("token"),
  reveal: $("reveal"),
  tokenHint: $("tokenHint"),
  sync: $("sync"),
  syncLabel: $("syncLabel"),
  spinner: $("spinner"),
  clear: $("clear"),
  status: $("status"),
  statusTitle: $("statusTitle"),
  statusDetail: $("statusDetail"),
  badge: $("badge"),
  result: $("result"),
  rTrip: $("rTrip"),
  rVehicle: $("rVehicle"),
  rGuest: $("rGuest"),
  rDates: $("rDates")
};

// ------------------------------------------------------------------ startup

(async function init() {
  const { pairingToken = "", lastRun = null } = await chrome.storage.local.get([
    "pairingToken",
    "lastRun"
  ]);
  els.token.value = pairingToken;
  paintTokenHint(pairingToken);
  render(lastRun);
})();

// -------------------------------------------------------------- token field

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
  await chrome.storage.local.remove(["pairingToken", "lastRun"]);
  els.token.value = "";
  els.token.type = "password";
  els.reveal.textContent = "Show";
  paintTokenHint("");
  render(null);
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

// ---------------------------------------------------------------- the click

els.sync.addEventListener("click", async () => {
  setBusy(true);
  render({ phase: "running", title: "Starting…" });
  try {
    await chrome.runtime.sendMessage({ type: "SYNC_ONE" });
  } catch (_) {
    // The worker was revived, or the popup raced it. Harmless: storage carries
    // the real outcome and storage.onChanged will paint it.
  }
  setBusy(false);
});

function setBusy(busy) {
  els.sync.disabled = busy;
  els.spinner.hidden = !busy;
  els.syncLabel.textContent = busy ? "Syncing…" : "Sync one reservation";
}

// ------------------------------------------------------------ live updates

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lastRun) render(changes.lastRun.newValue);
  if (changes.pairingToken) paintTokenHint(changes.pairingToken.newValue || "");
});

// ------------------------------------------------------------------ render

function render(run) {
  if (!run) {
    els.status.dataset.phase = "idle";
    els.statusTitle.textContent = "Ready";
    els.statusDetail.textContent = "";
    els.badge.hidden = true;
    els.result.hidden = true;
    setBusy(false);
    return;
  }

  const phase = run.phase || "idle";
  els.status.dataset.phase = phase;
  els.statusTitle.textContent = run.title || "";
  els.statusDetail.textContent = run.detail || "";

  // A finished run rendered from storage must not leave the button spinning
  // (e.g. the popup was reopened after the sync completed).
  setBusy(phase === "running");

  /* The source badge is the one place this UI uses a filled pill, because
     "is this real data?" must be impossible to miss on stage. Never let a
     refactor collapse the live and sample paths into one label. */
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

/** e.g. "12 Sep 2026, 15:00 → 16 Sep 2026, 11:00" (local time). */
function formatRange(startsAt, endsAt) {
  const one = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };
  return `${one(startsAt)} → ${one(endsAt)}`;
}
