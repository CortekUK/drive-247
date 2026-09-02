# Turo Public Listing Exporter

Reads the public Turo listing cards on the page **you already have open**, shows them
in a table, and exports them to an Excel-safe CSV. No login, no account, no host
session, no network calls, no build step.

## Install (30 seconds, no tooling)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open `https://turo.com/gb/en`, let it finish loading, scroll the listings into view
5. Click the extension button, then **Scrape page**

**Download CSV** saves the sheet. **Copy for Sheets** puts a TSV on the clipboard
that pastes straight into Google Sheets or Excel as a proper table.

## What it does, and deliberately does not, do

It reads the document already rendered in your tab. It contains **no `fetch()`,
no `XMLHttpRequest`, no navigation** — the test suite greps the shipped source
for all of them and fails the build if one appears. The extension is incapable
of requesting a URL.

It therefore never touches `/search`, `/drivers/` or `/{locale}/p/*`, the paths
Turo's `robots.txt` disallows. That posture is **enforced, not just documented**:
`PATH_DENYLIST` in `extractor.js` and `classifyUrl()` in `popup.js` both refuse
those paths — including the locale-prefixed forms like `/gb/en/search` — and the
extractor returns without reading a single node. Reading a page you opened is a
different act from crawling a site, and the code is built to keep it that way.

The manifest declares `activeTab` + `scripting` and **no `host_permissions`**.
Chrome grants `activeTab` only for the tab you were looking at, and only for the
click. The extension cannot read pages in the background, cannot read other tabs,
and does nothing until you click. The permission model *is* the legal position,
enforced by Chrome rather than asserted in a comment.

## What Turo actually is

The original brief assumed the page could never be inspected — `turo.com` answers
HTTP 403 (Cloudflare WAF) to every automated request. That is true of live
fetches, but the Wayback Machine's raw-bytes endpoint
(`web.archive.org/web/<ts>id_/<url>`) returns the original HTML uncensored. Two
captures were analysed, including the exact target `turo.com/gb/en`. The tiers
below are written against **real markup**, not guesses:

- **Next.js App Router.** There is **no `#__NEXT_DATA__`** — that is Pages Router.
  The payload ships as React Server Component "flight" chunks in dozens of inline
  `self.__next_f.push([1,"…"])` calls.
- **JSON-LD is a dead end.** The single block is `schema.org/Organization` — a
  customer-service phone number, zero listing data.
- **Prices are not in the vehicle object.** `avgDailyPrice` is the *base rate*;
  the price on the card lives in a sibling map keyed by vehicle id
  (`estimatedQuotes`). Tier 1 **joins them by id**, coercing `String(id)` because
  the map's keys are strings while `vehicles[].id` is a number.
- **Every class is an Emotion hash** (`seo-pages-1hdlq5i-StyledText`). Nothing
  keys off a class name anywhere.

## The tiers, in order

| # | Tier | Looks for | Confidence |
|---|------|-----------|-----------|
| 1 | `json-state` | `self.__next_f` flight chunks, mined with a string-aware balanced-brace scanner, then joined to the id-keyed price map | **high** |
| 2 | `json-ld` | `<script type="application/ld+json">` and Next's `self.__next_s` script queue, read with the schema.org vocabulary (`brand{name}`, `vehicleModelDate`, `offers{price,priceCurrency}`, `aggregateRating`) and an `ItemList` name as the section | **high** |
| 3 | `json-deep` | `__APOLLO_STATE__`, `__INITIAL_STATE__`, `__REDUX_STATE__`, `#__NEXT_DATA__`, JSON-LD, and any inline script holding vehicle-shaped JSON, scored by **value shape** rather than key names | **high** |
| 4 | `data-testid` | `a[data-testid="vehicle-card-link-box"]` and friends, `[itemtype]` microdata; parses card **text**, not structure | **medium** |
| 5 | `heuristic` | repeated card-shaped subtrees matched by currency / year / rating patterns | **low** |

The DOM tiers only run as a fallback. Results are merged **per field with
provenance**: a higher tier wins a field, a lower tier may fill a gap, and every
row carries `__tier`, `__confidence` and `__tiers` so a row found by shape can
never be presented as if it were lifted from JSON. The popup renders low-confidence
rows in amber.

**JSON-first is not just more robust — it recovers more rows.** Turo's carousels
lazy-render: the flight data carries ~40 vehicles where the DOM has only 16. A
DOM-only scraper silently under-reports by roughly 60% with no error.

## Diagnostics

The **How it found these** panel reports what each strategy looked for and what
it found on *your* page: which state globals existed, how many inline scripts,
`data-testid` and microdata elements were present, and how many card shapes were
detected. If a future Turo redesign breaks a tier, that report is what makes it
fixable.

## The CSV

UTF-8 **BOM** (without it Excel renders `£77/day` as `Â£77/day`), CRLF, every
field quoted, embedded quotes doubled per RFC 4180 — verified by round-tripping
through an independently written parser in the test suite.

Values Excel would silently rewrite — leading zeros, 12+ digit numbers (vehicle
and host ids), anything date-shaped like `5-3`, and formula-injection strings
starting with `=`, `+`, `-`, `@` — are emitted as `="value"`. It is applied only
where a real corruption would occur, so the rest of the file stays clean and
numbers stay summable.

The clipboard TSV is a **separate escaping problem**, not "CSV with tabs": Excel's
`="…"` form shows as literal formula text on paste, so the TSV uses the
leading-apostrophe form instead. Formula injection is neutralised in both paths.
Do not "unify" them.

Run metadata (when, what URL, which strategy won, which injection world) is
appended **after** the data behind a blank line, so the header stays on row 1 and
autofilter still works.

### Null is never zero

The most important rule in the schema. `"New listing"` yields `rating = null` and
`New listing` in the *Rating shown* column — never `0`, because a 0.0 rating and
an unrated new car are opposite facts, and anyone pricing against this sheet must
not see them collapsed.

Turo's own `isNewListing` flag is **not authoritative**: the GB capture contains a
vehicle with `isNewListing: false, rating: null, completedTrips: 0` that the site
nonetheless renders as "New listing". The extractor infers the state rather than
trusting the flag.

## Tests

Plain Node, no framework. Needs `jsdom`, resolved from the monorepo root.

```bash
node test/run-tests.js        # 64 checks: extraction, tiers, refusals, CSV,
                              #   plus a "page nobody has seen" section (alien
                              #   __NEXT_DATA__, 500 listings, truncated flight
                              #   stream, /us/en, suffix currencies, cyclic
                              #   globals, formula injection)
node test/run-popup-test.js   # 12 checks: popup end-to-end with a mocked chrome API
```

`test/fixture-flight.html` reproduces Turo's **real** App Router payload shape —
split flight chunks, the id-keyed `estimatedQuotes` map, the doubled `$$` US
currency symbol, Turo's misspelled `resizeableUrlTemplate`, a discount badge that
must not be read as the price, and one DOM card against three JSON vehicles so
the lazy-render gap is covered. Regenerate it with
`node test/make-flight-fixture.js`.

The suite proves all three tiers **independently agree** on the same values:

```
FULL (json)                       rows=3 | tier=json-state  conf=high
NO SCRIPTS (testid)               rows=1 | tier=data-testid conf=medium
NO SCRIPTS+NO TESTID (heuristic)  rows=1 | tier=heuristic   conf=low
   Volkswagen Tiguan | 2015 | 4.81 (59) | £1,014/month | Monthly SUV rentals in Edinburgh
```

## Files

```
manifest.json      MV3; activeTab + scripting only, no host_permissions
extractor.js       the four tiers, the price join, merge + provenance (injected)
parsers.js         every normaliser: price, rating, year, name, section (injected)
csv.js             COLUMNS + Excel-safe CSV and clipboard TSV
popup.html/css/js  UI: table, CSV download, clipboard, diagnostics
test/              fixtures + the two harnesses above
_superseded/       losing files from a three-agent collision; referenced by
                   nothing and safe to delete (see the note inside)
```

`parsers.js` and `extractor.js` are injected into the page by `popup.js` via
`chrome.scripting.executeScript`, MAIN world first — `self.__next_f` and the
state globals are invisible from the isolated world. If MAIN is refused the
popup falls back to ISOLATED, where the DOM tiers and the inline-`<script>`-text
route still work, and **says so** rather than pretending it saw everything.

## Known limits

- Only the listings currently in the DOM *plus* whatever the flight payload
  carries are exported. Scroll more carousels in and press **Scrape page** again.
  There is deliberately no auto-scroll — driving the page starts to look like
  crawling.
- The Wayback captures are from early 2026. If Turo restyles, tier 1 is the most
  likely to keep working (it reads data, not markup) and the heuristic tier is
  the safety net. Check the diagnostics panel before assuming a total failure.
