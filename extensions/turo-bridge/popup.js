// The popup document is destroyed the moment the popup closes — so it owns no
// state. It renders whatever chrome.storage.local says, and writes the token
// straight back there for the service worker to read.

const tokenEl = document.getElementById("token");
const syncEl = document.getElementById("sync");
const statusEl = document.getElementById("status");

function render(status) {
  if (!status) return;
  statusEl.textContent = status.text;
  statusEl.className = status.phase;
  syncEl.disabled = status.phase === "working";
  syncEl.textContent = status.phase === "working" ? "Syncing…" : "Sync one reservation";
}

// Restore: token, plus the outcome of a run that may have finished while the
// popup was closed (or after the service worker was recycled).
chrome.storage.local.get(["pairingToken", "lastStatus"]).then(({ pairingToken, lastStatus }) => {
  if (pairingToken) tokenEl.value = pairingToken;
  render(lastStatus);
});

tokenEl.addEventListener("input", () => {
  chrome.storage.local.set({ pairingToken: tokenEl.value.trim() });
});

// Live updates while the popup happens to be open.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "STATUS") render(msg.status);
});

syncEl.addEventListener("click", async () => {
  await chrome.storage.local.set({ pairingToken: tokenEl.value.trim() });
  render({ phase: "working", text: "Starting…" });
  // One click, one message, one short round trip.
  const final = await chrome.runtime.sendMessage({ type: "SYNC_ONE" }).catch(() => null);
  if (final) render(final);
  // If the worker was recycled mid-run, sendMessage rejects and we fall back to
  // whatever setStatus last persisted.
  else chrome.storage.local.get("lastStatus").then(({ lastStatus }) => render(lastStatus));
});
