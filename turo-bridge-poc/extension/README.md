# Drive247 Turo Bridge

A Chrome extension that reads an operator's **own logged-in Turo host calendar**
and lands it in their Drive247 portal.

There are two paths in here and they are deliberately separate:

| | What it does | Status |
|---|---|---|
| **Sync one reservation** | The original proof of concept. One click, one best-scoring reservation, one row. | Unchanged. Still the demo. |
| **Sync my Turo calendar** | The real read. A resumable, paginated walk over every upcoming trip, with typed degraded-read handling and an absence ledger. | New. Foundation, not yet met a real Turo response. |

**Nothing in here has ever run against real Turo data, and that is a permanent
constraint, not a temporary one** — Turo does not operate in our country and we
have no host account. Every field name is a reconstruction. The whole design
follows from that one fact: the parser *discovers* fields rather than assuming
them, refuses to emit a value it is unsure of, and reports what it could not
read instead of inventing something plausible.

## The one idea worth understanding

> **Acquiring a block is cheap and reversible. Releasing one sells the same car
> twice.**

Every rule below is that asymmetry applied. Concretely, it means the extension
carries **two independent permissions, never one**:

- **`mayWrite`** — may we save the trips we did read? Almost always yes. Saving
  a trip we can see is idempotent and harmless even from a half-finished read.
- **`mayRelease`** — may the *absence* of a trip be treated as that trip having
  ended? Almost always **no**. It requires three separate facts to line up: the
  outcome permits it, the walk demonstrably reached the end of the feed, **and**
  a second independent endpoint confirmed the Turo session was healthy.

A degraded read — a WAF returning HTTP 200 with an empty body, an expired
session, a field Turo renamed overnight — produces *fewer records*. If fewer
records could release blocks, the cars behind those trips go back on sale while
they are physically out on rent. So absence is never evidence. Only something we
positively **read** can release anything.

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

## What to expect — the one-reservation demo

*(The full-sync path has its own states; see **The full sync, step by step** and
**Why the progress readout has no bar** below.)*

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

Both paths share the same plumbing. The difference is how many times the middle
of it runs, and how much is written down between the turns.

```
popup.js            view only; owns no state, writes only the token
   │  sendMessage({type:"SYNC_ONE"})      or  {type:"SYNC_ALL"}
   ▼
background.js       the service worker
   │  chrome.scripting.executeScript  → turo.com tab, ISOLATED world
   ▼                                     (MAIN world on one retry, see below)
content-turo.js     fetch, classify the outcome, normalise
   │                  SYNC_ONE : one best-scoring trip, fixture on failure
   │                  SYNC_ALL : one PAGE, via turo-read-contract.js
   ▼  result[0].result
background.js       POST { token, source, reservation } — ONE trip per call
   ▼                persist the receipt only AFTER the ack
Supabase edge fn    resolves tenant from the token, upserts one row
```

Everything the multi-batch run needs to continue lives in
`chrome.storage.local`, never in a JS variable: the cursor (`turoCursor`), the
page awaiting acknowledgement (`syncPending`), the per-record rows and
diagnostics (`syncSummary`), the view model (`syncState`) and the previous run's
ids (`syncManifest`).

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

## The full sync, step by step

Click **Sync my Turo calendar**. The service worker then does this, and every
step is written to `chrome.storage.local` *before* the network call it
describes:

```
  probe the session   GET /api/vehicles/me
        │             (also the fleet read — see "How empty is told apart from blocked")
        ▼
  read a page   ───▶  normalise each trip   ───▶  flush, one POST per trip
        ▲                                              │
        └──────────  next page, if the feed gave us one ┘
        ▼
  finish: coverage verdict, the two gates, absence ledger
```

### Surviving the service worker being killed

MV3 kills the worker at any moment — after ~30 seconds idle, after ~5 minutes of
work, and completely while Chrome is quit. A long-running loop holding progress
in a local variable is not a design, it is a bug that shows up on someone else's
machine. So:

| Rule | How |
|---|---|
| **No module-scope state holds progress** | The only mutable at module scope is a re-entrancy latch, and losing it to a worker death is *correct* — a dead worker has no concurrent pump to guard against. Everything else is in `chrome.storage.local`. |
| **The intent is persisted before the await that fulfils it** | The cursor records "I am about to read page N" and is written *before* the fetch. A worker killed mid-read wakes knowing exactly what it was doing. |
| **The receipt is written only after the acknowledgement** | A death between "read" and "ingest acked" replays exactly one page. That is safe because the ingest upserts on `(tenant_id, reservation_id)` — at-least-once delivery over an idempotent sink, which is the only guarantee an MV3 worker can honestly offer. |
| **A dead worker can wake itself** | `chrome.alarms` is the only thing that can revive one, so an active run keeps a 1-minute backstop alarm. `setTimeout` still handles the ~1.2s pacing between pages whenever the worker happens to be alive, because a 1-minute floor would make a 3-page sync take 3 minutes. |

This is tested literally: `background-orchestrator.test.js` starts a run, throws
away the entire module *and its pending timers*, re-requires it against the same
storage, and asserts the sync still finishes with every record delivered.

### The ingest takes one reservation per call

`supabase/functions/turo-bridge-ingest/index.ts` reads a single `reservation`
object. There is no batch endpoint and this extension does not own that
function, so a page of *N* trips becomes *N* sequential POSTs. That is why the
flush is its own resumable phase rather than one call: each acknowledged record
is removed from the stored pending list immediately, so a worker death partway
through a page neither loses the trips that landed nor double-writes them.

---

## How "empty" is told apart from "blocked"

These four things produce **identical bytes**:

- a WAF returning HTTP 200 with `{"trips":[]}`
- an expired Turo session
- an envelope key Turo renamed overnight
- a host who genuinely has no upcoming trips

An empty trips list therefore means *nothing on its own*. It produces the
outcome `EMPTY_UNCONFIRMED`, which writes nothing and releases nothing. The only
thing that can promote it to `NO_TRIPS_CONFIRMED` is a **second, independent
endpoint** saying the session is healthy — `GET /api/vehicles/me`, which we want
anyway for vehicle identity. One extra request buys the whole distinction.

A non-empty vehicle list counts as corroboration. An **empty** one deliberately
does not: an operator we are migrating *off* Turo owns cars by definition, so
zero vehicles and zero trips is far likelier a degraded surface than a real
state.

---

## Why the progress readout has no bar

The easiest bug to write in this entire feature is `processed / total` where
`total` came from the same possibly-degraded response as `processed`. A WAF that
truncates a list to 8 items will just as happily report `total: 8`, and the
operator sees a full green bar over half a calendar.

So there is no bar. The popup shows:

- **`Batch 3 · 47 trips read so far`** while walking — a number with no
  denominator, because there is no honest denominator yet
- **`Batch 3 of 3 · 47 trips read`** only once the walk has *proved* it reached
  the end of the feed
- absolute counts (`Saved`, `Need a vehicle`, `Check these`, `Could not read`) —
  never a percentage, all of them counted from what we actually parsed
- a coverage sentence that reads *"read 8 trips (there may be more — page
  failed)"* when incomplete, and is asserted by test never to contain `" of "`

What Turo *claimed* the total was is captured as `declaredTotal` and shown only
in the diagnostics. It corroborates; it never counts.

`popup-render.test.js` renders the real orchestrator output through the real
`popup.html` and asserts the string `"N of N"` never appears on a truncated run.

---

## When a trip disappears

A trip that was in the last sync and is not in this one is classified, and only
one of these classifications frees a car:

| What we observed | Verdict | Effect |
|---|---|---|
| We **read** it with a cancelled status | `explicit_cancelled_status` | Dates freed. This is *presence*, not absence. |
| A targeted lookup returned "gone" | `targeted_404` | Dates freed. |
| Another trip claims to replace it | `superseded` | **Dates stay blocked.** It moved; it did not end. |
| It simply was not in the response | `absent_only` | **Dates stay blocked, forever if need be.** |

`absent_only` never releases, no matter how many consecutive syncs repeat it.
Repeating an unreliable observation does not make it reliable — a WAF that
returns 200-with-nothing does so every single time.

And even positive evidence is ANDed with the run's own `mayRelease`, so a
cancellation read during a truncated walk still changes nothing.

### The ledger is unioned, not replaced

An id dropped from the manifest can never be diffed again, so a degraded run
overwriting it would quietly erase our own memory of trips that are still real.
The only id ever allowed to fall out is one with positive release evidence in a
run that earned `mayRelease`.

---

## Vehicle identity, and why it is the hard part

In the Drive247 database `vehicles.reg` is globally unique — 461 rows, 461
distinct — while `vehicles.vin` is **not**: 400 non-null values across only 326
distinct, so 74 rows share a VIN with another row. That single fact settles the
ladder:

| Evidence | Confidence | Needs a human? |
|---|---|---|
| `turo_vehicle_id` from a real nested vehicle object | high | no |
| `plate_exact` — a plate stated as a plate | high | no |
| `label_plate_parsed` — a plate mined out of `"Owner 1 Wagoneer (Jon) (CA #9DUC203)"` | medium | **yes** |
| `vin_unique` | medium | **yes** |
| `label_fuzzy` — a name and nothing else | low | **yes** |
| `unbound` | low | **yes** |

A VIN can raise confidence in a match reached another way. It can never *be* the
match.

### A defect this code refuses to inherit

`turo-read-contract.js` hands the **whole trip object** to its vehicle reader
when a trip carries no nested `vehicle` object, and that reader's first rung
looks for `id`. The result is that the *trip's* id is adopted as the *vehicle's*
identity, with confidence `high` and `requiresReview: false`. Verified:

```js
{ id: 900000004, reservationId: "R-900000004", vehicleLabel: "Owner 1 Wagoneer (Jon) (CA #9DUC203)" }
  -> vehicle.turoVehicleId === "900000004"   // that is the TRIP
```

That is worse than being unbound, because `turo_vehicle_id` is the one rung that
matches a car *without* a human confirming it. `hardenVehicle()` in
`content-turo.js` refuses that binding, re-mines the label for a plate, moves
the record **down** the ladder, and records the rejected id so it shows up in
the run report rather than being silently swallowed. It can only ever reduce
confidence, never raise it.

---

## The bundled sample data is not a bypass

`fixture.js` is a substitute **network**, not a substitute pipeline. A sample
run goes through the same `classifyBody`, the same `extractItems`, the same
`detectPagination` and the same normaliser a live response would. It is three
cursor-paginated pages, and several records in it are **deliberately awkward** so
the tolerant paths run on every single sync rather than only on the day Turo
changes something:

| Record | What is wrong with it | What must happen |
|---|---|---|
| FX-2 | spans a month boundary (28 Sep → 3 Oct) | imported intact |
| FX-3 | no end date at all | **rejected**, `ends_at` reported |
| FX-4 | no vehicle object — only `"Owner 1 Wagoneer (Jon) (CA #9DUC203)"` | plate mined, marked review-required |
| FX-5 | `return` renamed to `tripEndTs` | **rejected**, and `tripEndTs` is *named on screen* |
| FX-6 | cancelled | the one thing that may release |
| FX-7 | claims to replace a trip from the last run | followed as a move, not a disappearance |
| FX-8 | same-day turnaround with FX-2 (back 10:00, out 16:00) | both survive as separate trips |
| FX-9 | `COMPLETED`, and in the past | held 48h past the end anyway |
| FX-10 | no timezone, no guest | lands, with both reported as unknown |
| FX-11 | VIN, no plate, no id | bound at medium confidence, review-required |

Plus seven degraded **scenarios** selectable from the popup — WAF empty 200, bot
challenge, expired session, renamed envelope, cut-off stream, 429, and silent
truncation — so every gate can be exercised on a machine that will never see
Turo.

Anything produced from this file is stamped `source: "fixture"` all the way to
the database, whose column carries `CHECK (source IN ('turo','fixture'))`, and
the popup says *"sample data"* out loud. A demo that cannot tell you which of
the two things it just did is worse than no demo.

---

## Running the tests

No build step, no test runner, no dependencies — plain `node`:

```bash
cd turo-bridge-poc/extension
node turo-read-contract.test.js          # the read layer          (78 assertions)
node background-orchestrator.test.js     # the resumable sync      (79 assertions)
node popup-render.test.js                # the UI, via jsdom       (30 assertions)
```

The orchestrator suite fakes the whole browser: `chrome.storage.local` is a
plain object, the tab is the bundled fixture, and "the worker was killed" is
implemented literally. The popup suite renders the *actual* states the
orchestrator produced through the *actual* `popup.html`, then reads the rendered
text back out — so if the wrong sentence ever reaches the screen, it fails
there rather than in front of an operator.

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
| `storage` | Persists the token, the run cursor and every result. On the multi-batch path this is not a convenience — it is the *only* thing that survives the worker being killed, so it holds all progress. |
| `alarms` | The only mechanism that can revive a dead MV3 service worker. Without it an interrupted sync waits for the operator to click **Continue**; the code degrades to exactly that if the permission is ever stripped. |
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
| `manifest.json` | MV3 manifest. Classic service worker, 3 permissions, 3 host permissions. |
| `background.js` | The service worker. Owns **both** paths: the one-click PoC and the resumable multi-batch run. The only thing that talks to Drive247. |
| `turo-read-contract.js` | The read layer: degraded-read taxonomy, pagination detection, tolerant normalisation, coverage verdict, absence ledger, cursor. Pure functions plus two tab-only fetchers. Owned by a sibling design; treated here as settled. |
| `turo-contract.d.ts` | Types for the above. No build step — `tsc --noEmit --strict` only. |
| `content-turo.js` | Runs in the turo.com tab. The original one-reservation reader, **plus** the v3 multi-page entry points (`collectPage`, `collectVehicles`) and `hardenVehicle()`. Also `importScripts`-ed by the worker so the fixture path reuses the same parser. |
| `fixture.js` | Bundled sample data: 11 deliberately awkward trips over 3 pages, a fleet, a previous-run manifest, and 7 degraded scenarios. A substitute network, not a substitute pipeline. |
| `popup.html` / `popup.css` / `popup.js` | The popup. A view only — it owns no state and the run outlives it. |
| `*.test.js` | Three suites, plain `node`. See **Running the tests**. |

---

## Known limits

Read these as the honest edge of what has been built, not as a to-do list.

- **Nothing here has run against a real Turo response, and nothing will until
  someone has a host account.** Every field name, every envelope key, every
  request parameter is a reconstruction. The design absorbs that: an
  unrecognised shape produces a *reported unknown*, never a guess. But do not
  read this README as a claim that the live path is verified — it is not, and
  the first live run will almost certainly need alias edits.
- **The first live run is the schema.** Every page contributes to a
  `keyHistogram` of the keys Turo actually sent, and every rejected record
  carries the key names it was carrying. After one real run, fixing an alias
  list is a one-line change informed by data rather than an investigation.
  That is the entire recovery plan and it is deliberate.
- **`PARAM.cursor` / `offset` / `limit` / `page` are guessed *request*
  parameter names** — a separate unknown from the response key names. They are
  only used when the feed does **not** hand back a full next-URL. If Turo
  returns a `links.next`, we never guess at all, and that path is preferred.
- **`explicitEnd` is derived, not reported.** `readPage()` consumes the
  envelope's `hasMore` / `isLastPage` signal internally and does not hand it
  back, so `content-turo.js` reconstructs it from the pagination plan. The
  reconstruction is conservative — it can only fail by refusing to call a
  finished walk finished, which costs an unnecessary "there may be more" and
  never a wrong release. Worth replacing with the real value if `readPage` ever
  returns it.
- **`SUSPECT_FIRST_PAGE = 50`**, the heuristic that decides whether a first page
  was capped, is a guess. Turo returns ~200 per *search* page; the host-trips
  page size is unconfirmed. Being wrong only ever costs an unnecessary "there
  may be more".
- **Vehicle *matching* against Drive247 is not here.** The extension resolves as
  far as a plate, a VIN hint and a label, records which rung of the ladder it
  reached, and flags anything that is not an outright plate match for review.
  Actually choosing a `vehicles` row is a portal-side, human-confirmed step.
- **The landing table is not `rentals`.** Rows land in a staging table that
  nothing downstream reads. Promotion into a real rental — with pricing,
  agreements and payments — is a separate, deliberate, human-confirmed step.
- **Two extension scaffolds exist in this repo and have drifted.** This one, and
  `extensions/turo-bridge/` with an ES-module `lib/turo-read.js`. They disagree
  about the ISOLATED-vs-MAIN world retry. The ingest already carries
  compatibility shims for their disagreements. Someone should pick one and
  delete the other before this grows further.
- **This directory is untracked.** It has been wiped mid-session by a stray
  `git clean -fd` more than once. **Commit it before doing more work in here.**
- `BOT_BLOCKED` vs `NOT_LOGGED_IN` on a bare 403 with unattributable HTML is a
  judgement call. We default to `BOT_BLOCKED`, because that is overwhelmingly
  what a 403 HTML body is, and keep a 300-character snippet in the diagnostics
  precisely so the first operator with a real Turo account can tell us whether
  that default is wrong.

---

## Blocking issue, outside this directory

`turo-bridge-ingest` is **broken against production right now**, independently of
anything here. The live `turo_bridge_tokens` table has a plaintext
`token text NOT NULL` column and no `token_hash`, while the repo's
`supabase/functions/turo-bridge-ingest/index.ts:167` queries
`.eq("token_hash", tokenHash)`. The *deployed* function is an older version that
still compares plaintext and works.

So: deploying the repo's version without first applying
`turo-bridge-poc/sql/01-schema.sql` (which adds the digest columns, backfills,
then drops the plaintext one) turns **every** sync into a 500. There is 1 token
and 1 reservation live today, so the migration is trivial now and will not be
later. Nothing in this extension can be tested end-to-end against production
until that lands.
