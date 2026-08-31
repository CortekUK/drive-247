# Drive247 Turo Bridge (PoC)

A Chrome extension that pulls **one** upcoming reservation out of an operator's
own logged-in Turo session and lands it in their Drive247 portal.

This is a proof of concept for a demo, not a product. The entire scope is:

1. Load the unpacked extension in Chrome
2. Click it, paste a pairing token
3. One reservation syncs from Turo
4. That reservation appears in the Drive247 portal

Everything else — multiple trips, scheduling, promotion into `rentals`,
two-way sync — is explicitly out of scope.

---

## Load it (about 60 seconds)

1. Open `chrome://extensions`
2. Turn **Developer mode** on (top right)
3. Click **Load unpacked** and select this folder —
   `turo-bridge-poc/extension`, the folder *containing* `manifest.json`,
   not the file itself
4. Pin **Drive247 Turo Bridge (PoC)** with the puzzle-piece icon so it is one
   click away on stage
5. Click the icon, paste the pairing token, click **Sync one reservation**

**After editing a file**, press the circular-arrow reload button on the
extension's card. The popup and content script pick up changes immediately; the
service worker is restarted by the reload.

**Debugging**: click the **service worker** link on the extension's card to open
its own DevTools console. Worker logs (`[TuroBridge] …`) do *not* appear in the
page's console — looking in the wrong console is the fastest way to conclude
that a working demo is broken. If the card shows a red **Errors** button, the
worker failed to register; open it first.

### Getting a pairing token

The token is minted server-side against a tenant and pasted into the popup. It
is the *only* credential this extension holds, and it is the only thing in the
request that identifies a tenant — the extension never sends a tenant id, so a
copied token plus a guessed uuid cannot produce a cross-tenant write.

Mint one from the Supabase SQL editor (see the `turo_bridge_tokens` migration
that ships with the `turo-bridge-ingest` edge function). Only the SHA-256 hash
is stored, so the plaintext exists exactly once, in that statement's output —
copy it straight into the popup.

---

## What to expect

The popup always ends in one of these states, and the **badge under the status
line always tells you which data path ran**. That badge is the most important
pixel in the demo: it is what stops sample data from being mistaken for a real
reservation.

### ✅ Real Turo data — badge reads `LIVE TURO SESSION`

> **Synced from your live Turo session**
> Open Drive247 → Turo Import to see it.

The operator is signed in to turo.com as a host, the upcoming-trips feed
answered with JSON, and the parser found a reservation whose id **and both
dates** it can vouch for. The trip id, vehicle, guest and dates are listed
underneath. The row in the portal carries `source = 'turo'`.

### 🟡 Bundled sample data — badge reads `BUNDLED SAMPLE DATA`

> **Synced using bundled sample data**
> Sample data used — *(the specific reason)*

The full round trip still completed: read → normalise → POST → row in the
portal. Only the *input* was substituted. The row carries `source = 'fixture'`
permanently, the guest is `Sample Guest (fixture)` and the plate is
`SAMPLE-001`, so it is unmistakable in the database and on screen.

This is the expected path on any machine without a Turo host account — which
includes every machine we have. **The demo is designed to work here.** The
reasons you may see:

| Reason shown | What actually happened |
|---|---|
| *You are not signed in to Turo in this browser…* | 401, or Turo redirected to its login page |
| *Turo's bot protection challenged the request…* | Cloudflare / PerimeterX interstitial (often HTTP 200 with an HTML body) |
| *Signed in to Turo, but there are no upcoming host trips.* | The feed was explicitly empty — a real, correct answer |
| *Turo is rate-limiting this browser…* | HTTP 429 |
| *Could not reach Turo — offline, or the request timed out.* | Network failure, or the 9-second budget expired |
| *…its response held no reservation we could read…* | Turo answered, but the shape changed past what the parser will vouch for |

### ❌ Nothing synced — red status line

> **No pairing token** — paste the token first.
> **Drive247 rejected the import** — the token was invalid, revoked, or the
> `turo-bridge-ingest` function is not deployed (a 404 says so explicitly).
> **Could not read a reservation** — even the bundled fixture failed to load,
> which means the extension itself is broken.

---

## How it works

```
popup.js            view only; owns no state, writes only the token
   │  chrome.runtime.sendMessage({type:"SYNC_ONE"})
   ▼
background.js       the service worker — orchestrates one click
   │  chrome.scripting.executeScript  → turo.com tab, ISOLATED world
   ▼
content-turo.js     fetch the feed, classify the outcome, normalise ONE trip
   │                (falls back to fixture.js here, in-page)
   ▼  result[0].result
background.js       POST { token, source, reservation } to turo-bridge-ingest
   ▼
Supabase edge fn    resolves tenant from sha256(token), upserts one row
```

### The read happens inside a turo.com tab, never in the worker

The trips URL is requested as a **relative path**, so from a turo.com tab it is
definitionally same-origin: no `Origin` header, `Sec-Fetch-Site: same-origin`,
and the page's first-party cookies. On the wire it is indistinguishable from
Turo's own XHR.

A fetch from the service worker would instead send
`Origin: chrome-extension://<id>`, `Sec-Fetch-Site: cross-site` and no
`Referer` — a textbook non-browser-page fingerprint, and exactly what edge bot
protection challenges. That is why the read never happens there.

We try the **ISOLATED** world first: it gets the tab's origin and cookie jar
with no page-visible footprint and no exposure to the page's own globals. The
one thing it cannot do is see a header minted by the page's own JS (a CSRF value
or an `x-px-authorization` held in a `window` global). So if the isolated
attempt comes back `BOT_BLOCKED`, `UNKNOWN` or `UNPARSEABLE`, background.js
retries **the identical code** in the **MAIN** world, where the SPA's own
`fetch` wrapper runs. Nothing else differs between the two attempts.

`NOT_LOGGED_IN`, `NO_TRIPS`, `RATE_LIMITED` and `UNREACHABLE` are *not* retried
— they answer the same in either world, so a retry would only double the
traffic.

### The parser discovers; it does not assume

Turo retired its public API and publishes no schema for
`/api/v2/feeds/upcoming-trips`. The URL and `appMode=HOST` are confirmed; **every
field name in this extension is a guess.** So the parser walks the response
breadth-first and *scores* each object on how reservation-shaped it is (an id,
two parseable dates, a vehicle sub-object, a guest sub-object, a booking-ish
status), rather than trusting any one key. Shallower candidates win ties, which
is correct — a trip object sits above its own sub-objects.

The one place it is deliberately strict is **dates**. It accepts ISO-8601,
`MM/DD/YYYY`, epoch seconds, epoch millis and the common wrapper objects, and it
**refuses display strings**. This matters more than it looks: `new Date("Sep 14")`
returns a *valid* Date in the current year. The `/feeds/` segment in the URL
suggests this endpoint may return rendered cards — `"Sep 14 – Sep 18"` — rather
than domain objects, and letting those through would import a confidently wrong
booking date. Refusing routes the run to the clearly-labelled fixture instead.

**A visible fallback beats a plausible wrong date.**

`reservation_id`, `starts_at` and `ends_at` are required; `guest_name` and
`vehicle_label` are nullable, because a trip whose id and dates we trust is
still worth importing.

### The fixture is not a bypass

`fixture.js` goes through the **same** `normalize()` as live data, in both the
in-page and worker-side fallback paths. The demo therefore exercises the real
code, and a bug in the parser would break the demo rather than hide behind it.

---

## Security posture

- **We never ask for Turo credentials.** There is no login form in this
  extension by design — Turo's terms forbid disclosing a password to a third
  party. We read the session already open in the operator's browser, nothing
  else.
- **The pairing token travels in the request BODY, never a header.** The shared
  CORS helper whitelists only `authorization, x-client-info, apikey,
  content-type, x-tenant-slug`; a custom header would fail the OPTIONS preflight
  and the function body would never run, surfacing as a bare network error with
  nothing in the server logs.
- **The token is stored in `chrome.storage.local`, not `.sync`** — it must not
  replicate to the operator's other machines.
- **The popup never echoes the whole token back** — only a 14-character prefix,
  because this window gets screen-shared.
- **The embedded Supabase anon key is already public** (it ships in the portal
  bundle to every browser). It is not what authorises the call; the token is.
- **`source: "turo" | "fixture"` stays on the wire and is persisted.** It is
  never merely inferable. Do not let a refactor collapse the two paths into one
  label.

### Permissions, and why each one is the narrowest that works

| Permission | Why |
|---|---|
| `scripting` | The only way to run the reader inside a real turo.com tab. It *is* the mechanism. |
| `storage` | Persists the token and the last result so nothing is lost when the MV3 worker is evicted. |
| `https://turo.com/*`, `https://*.turo.com/*` | Injecting into the operator's own Turo tab — and what makes `tabs.query({url})` work **without** the `tabs` permission. |
| `https://hviqoaokxvlancmftwuo.supabase.co/*` | POST the reservation to our own edge function. |

**Deliberately not requested:** `tabs` (the host permission already covers tab
discovery, and `tabs` would add a "Read your browsing history" warning to the
install prompt for zero functional gain), `cookies` (we never read cookies — the
page's own fetch carries them), `activeTab`, `<all_urls>`.

There is **no `content_scripts` block**. Everything is injected programmatically
on the user's click, so the extension does literally nothing until invoked.

---

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest. Classic service worker, 2 permissions, 3 host permissions. |
| `background.js` | The service worker. Orchestrates one click; the only thing that talks to Drive247. |
| `content-turo.js` | Runs in the turo.com tab. Fetches, classifies, normalises. Also `importScripts`-ed by the worker so the fixture path reuses the same normaliser. |
| `fixture.js` | The bundled sample reservation. Clearly labelled, in-band. |
| `popup.html` / `popup.css` / `popup.js` | The popup. A view only — it owns no state. |

---

## Known limits

- **Nothing here has run against a real Turo response.** There is no Turo
  account to test with and no published schema to check against. The parser is
  built so that being wrong is *survivable* — an unrecognised shape yields the
  labelled fixture plus an honest reason string, never a crash and never a wrong
  date — but do not read this README as a claim that the live path is verified.
- **One reservation, not many.** `collectOneReservation()` returns the single
  best-scoring candidate. Pagination and multi-trip import are out of scope.
- **The landing table is not `rentals`.** Rows land in a staging table that
  nothing downstream reads. Promotion into a real rental — with pricing,
  agreements and payments — is a separate, deliberate step.
- **This directory is untracked.** It has been wiped mid-session by a stray
  `git clean -fd` more than once. **Commit it before doing more work in here.**
- `BOT_BLOCKED` vs `NOT_LOGGED_IN` on a bare 403 with unattributable HTML is a
  judgement call. We default to `BOT_BLOCKED`, because that is overwhelmingly
  what a 403 HTML body is, and keep a 300-character snippet in the diagnostics
  precisely so the first operator with a real Turo account can tell us whether
  that default is wrong.
