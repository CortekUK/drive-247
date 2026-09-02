#!/usr/bin/env node
/* =============================================================================
 * run-tests.js — the whole test suite for the Turo listing exporter
 * =============================================================================
 *
 * Plain Node. No framework, no config, no watch mode. Run it with:
 *
 *     node test/run-tests.js
 *
 * The only dependency is jsdom, resolved from the surrounding monorepo's
 * node_modules (with a plain `require("jsdom")` fallback), because the
 * extension itself deliberately has no build step and no package.json.
 *
 * -----------------------------------------------------------------------------
 * WHAT THIS SUITE IS ACTUALLY FOR
 * -----------------------------------------------------------------------------
 *
 * turo.com returns HTTP 403 to every automated request, so no test here can
 * ever talk to the real site, and none tries. What the fixtures encode instead
 * is the SHAPE of the real page, recovered from raw Wayback captures: the
 * App-Router vehicle DTO, the id-keyed price map that sits BESIDE the vehicle
 * array, Emotion's hashed class names, and Turo's own misspelling of
 * `resizeableUrlTemplate`.
 *
 * The four fixtures carry THE SAME FIVE LISTINGS expressed four different ways.
 * That is the entire point. Any single fixture only proves a tier returns
 * something; five identical listings across four encodings prove the tiers
 * CONVERGE, which is the property the layered design actually promises.
 *
 * The five listings, and why each one is in the set:
 *
 *   Mercedes-Benz EQE   2023  New listing   £1,359/month   <- unrated listing
 *   Porsche Macan       2022  4.75 (5)      £4,056/month
 *   Tesla Model Y       2025  5.0 (3)       £4,395/month   <- integer rating -> "5.0"
 *   Citroen e-C4        2021  4.9 (12)      £77/day +£232  <- accents; split price
 *   =Volkswagen ID.3    2020  (no rating)   £64/day        <- CSV injection; no rating
 *
 * The awkward cases are deliberate and each one guards a specific failure:
 *   - an accented name proves UTF-8 survives the DOM, the JSON and the BOM'd CSV
 *   - a thousands separator proves "£1,359/month" is not truncated to 1
 *   - a leading "=" proves Excel/Sheets formula injection is neutralised
 *   - a missing rating proves null is never rendered or exported as 0
 *
 * -----------------------------------------------------------------------------
 * TESTS vs DEFECTS — read this before reacting to the exit code
 * -----------------------------------------------------------------------------
 *
 * Some assertions in here fail against the CURRENT extractor. Those are not
 * broken tests; they are real defects in extractor.js, which this suite does
 * not own and must not edit. They are registered with `defect()` so the output
 * separates them cleanly:
 *
 *     TESTS   — assertions about behaviour that is correct today. Must all pass.
 *     DEFECTS — assertions about behaviour that is wrong today, each carrying
 *               the root cause and the file to fix.
 *
 * The process exits non-zero while any defect stands, because a green suite
 * over an empty price column would be worse than useless for a pricing tool.
 * ========================================================================== */

"use strict";

const fs = require("fs");
const path = require("path");

const TEST_DIR = __dirname;
const EXT_DIR = path.resolve(TEST_DIR, "..");

let JSDOM;
try {
  ({ JSDOM } = require(path.resolve(EXT_DIR, "../node_modules/jsdom")));
} catch (_) {
  try {
    ({ JSDOM } = require("jsdom"));
  } catch (e) {
    console.error(
      "\nCannot run: jsdom is not installed.\n" +
      "Looked in " + path.resolve(EXT_DIR, "../node_modules/jsdom") + " and in require('jsdom').\n" +
      "Install it anywhere on the require path, e.g.  npm i -D jsdom\n"
    );
    process.exit(2);
  }
}

/* =============================================================================
 * HARNESS
 * ========================================================================== */

const results = { pass: [], fail: [], defect: [] };
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, kind: "test" };
  try {
    fn();
    results.pass.push(name);
  } catch (e) {
    results.fail.push({ name, message: e.message });
  }
  CURRENT = null;
}

/**
 * An assertion that SHOULD hold but does not yet, because of a known bug in
 * code this suite does not own. If it starts passing, that is reported too —
 * a defect that quietly heals should be promoted to a real test, not left
 * sitting here pretending the bug is still live.
 */
function defect(name, rootCause, fn) {
  CURRENT = { name, kind: "defect" };
  try {
    fn();
    results.defect.push({ name, rootCause, fixed: true });
  } catch (e) {
    results.defect.push({ name, rootCause, fixed: false, message: e.message });
  }
  CURRENT = null;
}

function fail(msg) { throw new Error(msg); }

function eq(actual, expected, what) {
  if (actual !== expected) {
    fail((what || "value") + ": expected " + JSON.stringify(expected) +
         " but got " + JSON.stringify(actual));
  }
}

function ok(cond, what) { if (!cond) fail(what || "expected a truthy value"); }

function has(haystack, needle, what) {
  if (String(haystack).indexOf(needle) === -1) {
    fail((what || "text") + ": expected it to contain " + JSON.stringify(needle));
  }
}

function isNullish(v, what) {
  if (v !== null && v !== undefined && v !== "") {
    fail((what || "value") + ": expected empty/null but got " + JSON.stringify(v));
  }
}

/* =============================================================================
 * LOADING A FIXTURE
 *
 * The extension is injected exactly the way popup.js injects it in Chrome:
 * parsers.js first (extractor.js hard-requires globalThis.TuroParsers and
 * refuses to run without it), then extractor.js, then csv.js when the test
 * needs the sheet writer. Then __turoExtractorRun() is called explicitly,
 * which is the same two-step popup.js performs.
 *
 * `strip` is what makes tier isolation possible on a single fixture:
 *   "scripts" removes every <script>, so no structured state survives and the
 *            data-testid tier has to carry the page on its own
 *   "testids" also strips every data-testid attribute, leaving nothing but
 *            hashed Emotion classes — the heuristic tier's worst case
 *   "dom"    removes <main>, leaving the JSON with no DOM to lean on. This is
 *            the only way to see what the JSON tier truly extracted, because
 *            the merge will otherwise fill a JSON row's gaps from the DOM and
 *            make a broken join look healthy.
 * ========================================================================== */

function loadPage(file, opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(TEST_DIR, file), "utf8");
  const dom = new JSDOM(html, {
    url: opts.url || "https://turo.com/gb/en",
    runScripts: "dangerously"
  });
  const win = dom.window;
  const doc = win.document;

  if (opts.strip === "scripts" || opts.strip === "testids") {
    doc.querySelectorAll("script").forEach((s) => s.remove());
  }
  if (opts.strip === "testids") {
    doc.querySelectorAll("[data-testid]").forEach((e) => e.removeAttribute("data-testid"));
  }
  if (opts.strip === "dom") {
    doc.querySelectorAll("main").forEach((m) => m.remove());
  }

  const files = ["parsers.js", "extractor.js"].concat(opts.withCsv ? ["csv.js"] : []);
  for (const f of files) {
    const s = doc.createElement("script");
    s.textContent = fs.readFileSync(path.join(EXT_DIR, f), "utf8");
    doc.head.appendChild(s);
  }

  if (typeof win.__turoExtractorRun !== "function") {
    fail("extractor.js did not expose globalThis.__turoExtractorRun");
  }
  return win;
}

function scrape(file, opts) {
  const win = loadPage(file, opts);
  return { win, result: win.__turoExtractorRun() };
}

/** Rows come back in tier/section order; index them by vehicle name to assert. */
function byName(rows) {
  const m = {};
  for (const r of rows) if (r.name) m[r.name] = r;
  return m;
}

/* =============================================================================
 * THE EXPECTED DATA — one definition, shared by every fixture's assertions.
 *
 * If a fixture and this table ever disagree, the fixture is wrong. Keeping the
 * expectation in exactly one place is what stops a copy-paste drift from
 * silently weakening a tier's test.
 * ========================================================================== */

const EXPECTED = [
  { name: "Mercedes-Benz EQE", year: 2023, price: "£1,359/month", amount: 1359,
    unit: "month", section: "Monthly luxury car rentals in Oxford",
    rating: null, newListing: true },
  { name: "Porsche Macan", year: 2022, price: "£4,056/month", amount: 4056,
    unit: "month", section: "Monthly luxury car rentals in Oxford",
    rating: 4.75, ratingDisplay: "4.75 (5)", reviews: 5 },
  { name: "Tesla Model Y", year: 2025, price: "£4,395/month", amount: 4395,
    unit: "month", section: "Monthly luxury car rentals in Oxford",
    rating: 5, ratingDisplay: "5.0 (3)", reviews: 3 },
  { name: "Citroën ë-C4", year: 2021, price: "£77/day", amount: 77,
    unit: "day", section: "Car rentals at King's Cross",
    rating: 4.9, ratingDisplay: "4.9 (12)", reviews: 12 },
  { name: "=Volkswagen ID.3", year: 2020, price: "£64/day", amount: 64,
    unit: "day", section: "Car rentals at King's Cross",
    rating: null }
];

/** The fields every tier must agree on, whatever route it took to get there. */
function assertCoreFields(rows, label) {
  eq(rows.length, EXPECTED.length, label + ": row count");
  const got = byName(rows);
  for (const want of EXPECTED) {
    const row = got[want.name];
    ok(row, label + ": missing listing " + JSON.stringify(want.name));
    eq(row.year, want.year, label + " / " + want.name + " year");
    eq(row.priceDisplay, want.price, label + " / " + want.name + " priceDisplay");
    eq(row.priceAmount, want.amount, label + " / " + want.name + " priceAmount");
    eq(row.priceUnit, want.unit, label + " / " + want.name + " priceUnit");
    eq(row.section, want.section, label + " / " + want.name + " section");
    eq(row.currency, "GBP", label + " / " + want.name + " currency");
  }
}

/* =============================================================================
 * 1. TIER 1 — EMBEDDED STRUCTURED STATE (fixture-nextdata.html)
 * ========================================================================== */

test("nextdata: a JSON tier wins, not a DOM tier", () => {
  const { result } = scrape("fixture-nextdata.html");
  ok(result.ok, "result.ok");
  eq(result.rows.length, 5, "row count");
  const tiers = Object.keys(result.summary.byTier);
  eq(tiers.length, 1, "exactly one tier should own these rows");
  ok(/^json-/.test(tiers[0]),
     "expected a json-* tier to win over the rendered DOM, got " + tiers[0]);
});

test("nextdata: every listing comes out with the right core fields", () => {
  const { result } = scrape("fixture-nextdata.html");
  assertCoreFields(result.rows, "nextdata");
});

test("nextdata: structured identifiers survive the JSON tier", () => {
  const { result } = scrape("fixture-nextdata.html");
  const got = byName(result.rows);
  // The id is deliberately carried as a STRING: csv.js declares vehicleId as
  // text with forceText, because a 7-digit id left numeric is exactly the kind
  // of value Excel reformats into scientific notation.
  eq(String(got["Mercedes-Benz EQE"].vehicleId), "1234567", "EQE vehicleId");
  eq(got["Mercedes-Benz EQE"].make, "Mercedes-Benz", "EQE make");
  eq(got["Mercedes-Benz EQE"].model, "EQE", "EQE model");
  eq(got["Porsche Macan"].vehicleType, "SUV", "Macan type");
  eq(got["Porsche Macan"].allStarHost, true, "Macan all-star host");
  eq(got["Citroën ë-C4"].city, "London", "e-C4 city");
});

test("nextdata: Turo's misspelled resizeableUrlTemplate still yields an image", () => {
  const { result } = scrape("fixture-nextdata.html");
  const row = byName(result.rows)["Tesla Model Y"];
  ok(row.imageUrl, "imageUrl should be present");
  has(row.imageUrl, "model-y", "imageUrl");
});

test("nextdata: rows carry their strategy and confidence", () => {
  const { result } = scrape("fixture-nextdata.html");
  for (const row of result.rows) {
    ok(row.__tier, "every row must record __tier");
    ok(row.__confidence, "every row must record __confidence");
    ok(Array.isArray(row.__tiers), "every row must record __tiers");
  }
});

/* =============================================================================
 * 2. TIER CONVERGENCE — the property the layered design actually promises
 *
 * One fixture, three tiers, by progressively removing what the better tiers
 * rely on. If these three agree, the fallbacks are genuinely equivalent and
 * not merely non-empty.
 * ========================================================================== */

test("tier isolation: stripping scripts hands the page to the data-testid tier", () => {
  const { result } = scrape("fixture-nextdata.html", { strip: "scripts" });
  ok(result.ok, "result.ok");
  eq(Object.keys(result.summary.byTier).join(), "data-testid", "winning tier");
  assertCoreFields(result.rows, "data-testid tier");
});

test("tier isolation: stripping scripts AND testids falls through to heuristic", () => {
  const { result } = scrape("fixture-nextdata.html", { strip: "testids" });
  ok(result.ok, "result.ok");
  eq(Object.keys(result.summary.byTier).join(), "heuristic", "winning tier");
  assertCoreFields(result.rows, "heuristic tier");
});

test("tier isolation: all three tiers agree field-for-field", () => {
  const shape = (rows) => byName(rows) && EXPECTED.map((w) => {
    const r = byName(rows)[w.name];
    return [w.name, r.year, r.priceDisplay, r.priceAmount, r.priceUnit, r.section].join(" | ");
  }).sort().join("\n");

  const json = shape(scrape("fixture-nextdata.html").result.rows);
  const testid = shape(scrape("fixture-nextdata.html", { strip: "scripts" }).result.rows);
  const heur = shape(scrape("fixture-nextdata.html", { strip: "testids" }).result.rows);

  if (json !== testid) fail("json tier and data-testid tier disagree:\n" + json + "\n---\n" + testid);
  if (json !== heur) fail("json tier and heuristic tier disagree:\n" + json + "\n---\n" + heur);
});

/* =============================================================================
 * 3. THE PRICE JOIN — the failure that matters most for a pricing tool
 *
 * On the real page the displayed price is NOT inside the vehicle object. It
 * lives in a sibling map keyed by vehicle id, so a row is only correct if the
 * two are joined. The join is easy to get silently wrong in two ways, and both
 * produce a full set of confident-looking rows:
 *
 *   - not joining at all      -> the price column is empty
 *   - reading avgDailyPrice   -> the price column is full of the BASE RATE,
 *                                which is a different number from the one the
 *                                card shows (45.30 vs £1,359/month)
 *
 * The DOM hides both mistakes, because the merge back-fills a JSON row's empty
 * price from the data-testid tier. So this must be measured with the DOM
 * removed, or it measures nothing.
 * ========================================================================== */

test("price join: with the DOM removed, the JSON tier still returns all five rows", () => {
  const { result } = scrape("fixture-nextdata.html", { strip: "dom" });
  eq(result.rows.length, 5, "rows from JSON alone");
  ok(/^json-/.test(Object.keys(result.summary.byTier)[0]), "a json tier should own them");
});

test("price join: the base daily rate is never passed off as the displayed price", () => {
  const { result } = scrape("fixture-nextdata.html", { strip: "dom" });
  const row = byName(result.rows)["Mercedes-Benz EQE"];
  // 45.3 is avgDailyPrice. The card says £1,359/month. If priceAmount is ever
  // 45.3, the tool is reporting a number the customer never saw.
  if (row.priceAmount === 45.3) {
    fail("priceAmount is the base daily rate (45.3), not the displayed price");
  }
});

test(
  "price join: the id-keyed price map is also read from a __NEXT_DATA__ blob",
  () => {
    // REGRESSION GUARD. harvestPriceMap() only ever scanned the raw
    // self.__next_f flight TEXT, so quotes shipped in any *parsed* blob
    // (__NEXT_DATA__, __APOLLO_STATE__, an inline JSON script) were never
    // seen: priceMapEntries came back 0 and every JSON row lost its price.
    // It hid itself, because on a fully-rendered page the merge back-fills
    // the price from the DOM tier. Stripping the DOM is what exposes it, and
    // is also the case that matters most — lazy-rendered carousel rows never
    // enter the DOM at all. Fixed by harvestPriceMapFromObject().
    const { result } = scrape("fixture-nextdata.html", { strip: "dom" });
    eq(result.diagnostics.page.priceMapEntries, 5, "priceMapEntries from __NEXT_DATA__");
    const got = byName(result.rows);
    eq(got["Mercedes-Benz EQE"].priceDisplay, "\u00a31,359/month", "EQE priceDisplay from JSON alone");
    eq(got["Mercedes-Benz EQE"].priceAmount, 1359, "EQE priceAmount from JSON alone");
    eq(got["Citro\u00ebn \u00eb-C4"].tripTotalAmount, 232, "e-C4 trip total from JSON alone");
  }
);

/* =============================================================================
 * 4. TIER 1b — JSON-LD (fixture-jsonld.html)
 *
 * Real turo.com emits only a schema.org Organization block, so JSON-LD carries
 * no cars there. But the extractor advertises JSON-LD as a tier-1 source and
 * collects it, and plenty of rental sites DO emit Car/Product/ItemList. A
 * page whose listings are fully described in JSON-LD must not be exported as
 * low-confidence guesswork.
 * ========================================================================== */

test("jsonld: the listings are extracted correctly whatever tier claims them", () => {
  const { result } = scrape("fixture-jsonld.html");
  ok(result.ok, "result.ok");
  assertCoreFields(result.rows, "jsonld");
});

test(
  "jsonld: schema.org Car/ItemList data is claimed by a JSON tier, not heuristics",
  () => {
    // REGRESSION GUARD. The extractor had no JSON-LD reader: schema.org's
    // vocabulary (brand{name}, vehicleModelDate, offers{price},
    // aggregateRating{ratingValue}) scored ~22 against scoreVehicleLike()'s
    // threshold of 45 — `brand` was actively rejected for being an object —
    // so fully structured listings were discarded and came back from the
    // heuristic DOM tier labelled LOW CONFIDENCE. Understating declared data
    // is the one thing a provenance-carrying exporter must never do.
    const { result } = scrape("fixture-jsonld.html");
    const tiers = Object.keys(result.summary.byTier);
    eq(tiers.length, 1, "exactly one tier should own these rows");
    ok(/^json-/.test(tiers[0]),
       "expected a json-* tier to claim JSON-LD listings, got " + tiers.join(","));
    for (const row of result.rows) {
      eq(row.__confidence, "high", row.name + " confidence");
    }
  }
);

test("jsonld: the ItemList name becomes the section, and the Organization block yields no cars", () => {
  const { result } = scrape("fixture-jsonld.html");
  const got = byName(result.rows);
  eq(got["Porsche Macan"].section, "Monthly luxury car rentals in Oxford", "Macan section");
  eq(got["Citro\u00ebn \u00eb-C4"].section, "Car rentals at King's Cross", "e-C4 section");
  // The page also carries a schema.org Organization (a phone number). If the
  // reader were loose enough to emit that as a listing, the count would rise.
  eq(result.rows.length, 5, "no phantom row from the Organization block");
  // The Offer and Brand nodes hanging off each Car must not become rows either.
  ok(result.rows.every((r) => r.name && r.priceAmount), "every row is a real listing");
});

test("jsonld: a rating absent from schema.org is New listing, never zero", () => {
  const { result } = scrape("fixture-jsonld.html");
  const got = byName(result.rows);
  eq(got["Mercedes-Benz EQE"].rating, undefined, "EQE has no rating value");
  eq(got["Mercedes-Benz EQE"].ratingDisplay, "New listing", "EQE rating display");
  eq(got["Porsche Macan"].ratingDisplay, "4.75 (5)", "Macan rating display");
  eq(got["Tesla Model Y"].ratingDisplay, "5.0 (3)", "Tesla rating display");
});

/* =============================================================================
 * 5. TIER 3 — HEURISTIC DOM ONLY (fixture-domonly.html)
 *
 * No embedded JSON of any kind, and nothing but hashed Emotion class names to
 * navigate by — the state a restyled production build leaves the scraper in.
 * ========================================================================== */

test("domonly: with no JSON anywhere, the heuristic tier carries the page", () => {
  const { result } = scrape("fixture-domonly.html");
  ok(result.ok, "result.ok");
  eq(Object.keys(result.summary.byTier).join(), "heuristic", "winning tier");
  assertCoreFields(result.rows, "domonly");
});

test("domonly: heuristic rows are honestly labelled as low confidence", () => {
  const { result } = scrape("fixture-domonly.html");
  for (const row of result.rows) {
    eq(row.__tier, "heuristic", row.name + " tier");
    eq(row.__confidence, "low", row.name + " confidence");
  }
});

test("domonly: the split '£77/day' + '£232 total' price is not conflated", () => {
  const { result } = scrape("fixture-domonly.html");
  const row = byName(result.rows)["Citroën ë-C4"];
  eq(row.priceDisplay, "£77/day", "headline price");
  eq(row.priceAmount, 77, "headline amount");
  // The £232 is the trip total, and must never overwrite the daily rate.
  if (row.priceAmount === 232) fail("the trip total was read as the daily rate");
});

/* =============================================================================
 * 6. THE NULL-VS-ZERO RULE
 *
 * An unrated new listing and a 0.0-rated car are opposite facts. Anyone
 * pricing against this sheet must never see them collapsed, so a missing
 * rating has to stay missing through the extractor, the merge and the CSV.
 * ========================================================================== */

test("ratings: a missing rating is never reported as zero", () => {
  for (const fixture of ["fixture-nextdata.html", "fixture-jsonld.html", "fixture-domonly.html"]) {
    const { result } = scrape(fixture);
    for (const row of result.rows) {
      if (row.rating === 0) fail(fixture + " / " + row.name + ": rating came out as 0");
      if (row.reviewCount === 0 && row.rating != null) {
        fail(fixture + " / " + row.name + ": rated row reported 0 reviews");
      }
    }
  }
});

test("ratings: the unrated listings are flagged rather than left ambiguous", () => {
  const { result } = scrape("fixture-nextdata.html");
  const eqe = byName(result.rows)["Mercedes-Benz EQE"];
  isNullish(eqe.rating, "EQE rating");
  eq(eqe.isNewListing, true, "EQE isNewListing");
  eq(eqe.ratingDisplay, "New listing", "EQE ratingDisplay");
});

test("ratings: an integer rating is displayed as 5.0, not 5", () => {
  const { result } = scrape("fixture-nextdata.html");
  const y = byName(result.rows)["Tesla Model Y"];
  eq(y.rating, 5, "numeric rating stays numeric");
  eq(y.ratingDisplay, "5.0 (3)", "displayed rating keeps its decimal");
});

test("ratings: review counts survive alongside the rating", () => {
  const { result } = scrape("fixture-nextdata.html");
  eq(byName(result.rows)["Porsche Macan"].reviewCount, 5, "Macan reviews");
  eq(byName(result.rows)["Citroën ë-C4"].reviewCount, 12, "e-C4 reviews");
});

/* =============================================================================
 * 7. THE EMPTY PAGE — it must explain itself, never show a blank table
 * ========================================================================== */

test("empty: a page with no listings reports failure rather than zero rows quietly", () => {
  const { result } = scrape("fixture-empty.html");
  eq(result.ok, false, "result.ok");
  eq(result.rows.length, 0, "row count");
  ok(result.message, "there must be a message");
});

test("empty: the message names the strategies that were actually tried", () => {
  const { result } = scrape("fixture-empty.html");
  const m = result.message;
  has(m, "__next_f", "message");
  has(m, "__NEXT_DATA__", "message");
  has(m, "data-testid", "message");
  ok(/heuristic|card-shaped/i.test(m), "message should mention the heuristic fallback");
});

test("empty: a page fingerprint is attached so a field failure can be diagnosed", () => {
  const { result } = scrape("fixture-empty.html");
  const p = result.diagnostics.page;
  ok(typeof p.scriptCount === "number", "scriptCount");
  ok(typeof p.dataTestIdCount === "number", "dataTestIdCount");
  ok(typeof p.imgCount === "number", "imgCount");
  ok("hasNextData" in p, "hasNextData");
});

test("empty: nothing throws, and no tier reports an error", () => {
  const { result } = scrape("fixture-empty.html");
  eq(result.diagnostics.errors.length, 0,
     "errors: " + JSON.stringify(result.diagnostics.errors));
});

/* =============================================================================
 * 8. THE ROBOTS.TXT POSTURE — enforced in code, not just in comments
 *
 * Reading a page the operator already opened is a different act from crawling.
 * The line is held by refusing outright on the paths Turo disallows, and the
 * locale prefix is load-bearing: Turo serves /gb/en/search, so a guard anchored
 * at /^\/search\b/ would miss the single most important path to refuse.
 * ========================================================================== */

const DISALLOWED_URLS = [
  "https://turo.com/search?location=London",
  "https://turo.com/gb/en/search?location=London",
  "https://turo.com/gb/en/drivers/12345",
  "https://turo.com/drivers/12345",
  "https://turo.com/gb/en/p/some-landing-page",
  "https://turo.com/p/some-landing-page"
];

for (const url of DISALLOWED_URLS) {
  test("robots: refuses " + new URL(url).pathname, () => {
    const { result } = scrape("fixture-nextdata.html", { url });
    eq(result.refused, true, "refused");
    eq(result.ok, false, "ok");
    eq(result.rows.length, 0, "must read nothing at all");
    has(result.message, "robots.txt", "refusal message");
  });
}

const ALLOWED_URLS = [
  "https://turo.com/gb/en",
  "https://turo.com/",
  "https://turo.com/gb/en/car-rental/united-kingdom/oxford"
];

for (const url of ALLOWED_URLS) {
  test("robots: still reads the public browse page " + new URL(url).pathname, () => {
    const { result } = scrape("fixture-nextdata.html", { url });
    eq(result.refused, false, "refused");
    eq(result.rows.length, 5, "rows");
  });
}

test("robots: the guard is not a substring match that would eat legitimate paths", () => {
  // "/gb/en/search-tips" is not the disallowed "/search" endpoint, and a
  // careless \/search.* would swallow it.
  const { result } = scrape("fixture-nextdata.html",
    { url: "https://turo.com/gb/en/searchable-fleet" });
  eq(result.refused, false, "/searchable-fleet must not be refused");
});

/* =============================================================================
 * 9. NO NETWORK — the property that keeps this legally distinct from crawling
 *
 * Source-level, because it is one careless line from being lost and no runtime
 * assertion would catch a call added on a code path the tests do not reach.
 * ========================================================================== */

test("no network: the shipped source contains no fetch/XHR/beacon/navigation", () => {
  const BANNED = [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /navigator\s*\.\s*sendBeacon/,
    /\bimport\s*\(/,
    /new\s+Worker\s*\(/,
    /new\s+EventSource\s*\(/,
    /new\s+WebSocket\s*\(/,
    /location\s*\.\s*(?:href|assign|replace)\s*=/,
    /window\s*\.\s*open\s*\(/
  ];
  for (const f of ["parsers.js", "extractor.js", "csv.js", "popup.js"]) {
    const p = path.join(EXT_DIR, f);
    if (!fs.existsSync(p)) continue;
    // Strip comments first: the files discuss these APIs at length in prose,
    // and matching the prose would make this test permanently and uselessly red.
    const src = fs.readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const re of BANNED) {
      if (re.test(src)) fail(f + " contains a network/navigation call matching " + re);
    }
  }
});

test("no network: the only tab navigation is a literal, allowed public URL", () => {
  // chrome.tabs.create is the single navigation-capable call in the extension.
  // A dynamic URL here would be how "read the page the user opened" quietly
  // becomes "drive the browser around the site", so pin it to a literal.
  const src = fs.readFileSync(path.join(EXT_DIR, "popup.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const calls = src.match(/chrome\s*\.\s*tabs\s*\.\s*create\s*\([^)]*\)/g) || [];
  eq(calls.length, 1, "expected exactly one tabs.create, got " + calls.length);
  const urls = calls[0].match(/"([^"]*)"/g) || [];
  eq(urls.length, 1, "the URL must be a string literal, not built at runtime");
  eq(urls[0], '"https://turo.com/gb/en"', "navigates only to the public browse page");
  // And it must not be a path robots.txt disallows.
  const p2 = new URL(JSON.parse(urls[0])).pathname;
  ok(!/^(?:\/[a-z]{2,3}\/[a-z]{2,3})?\/(?:search|drivers\/|p\/)/i.test(p2),
     "tabs.create targets a disallowed path: " + p2);
});

test("no network: the manifest declares no unknown keys Chrome would warn about", () => {
  // Chrome emits an "Unrecognized manifest key" install warning for any key it
  // does not know — a yellow banner on chrome://extensions, which is a poor
  // first impression for an extension whose whole argument is restraint.
  const m = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
  const KNOWN = ["manifest_version", "name", "version", "description",
                 "permissions", "host_permissions", "action", "icons",
                 "background", "content_scripts", "web_accessible_resources",
                 "options_page", "default_locale", "minimum_chrome_version"];
  const unknown = Object.keys(m).filter((k) => KNOWN.indexOf(k) === -1);
  eq(unknown.length, 0, "unknown manifest keys: " + unknown.join(", "));
  eq(m.manifest_version, 3, "must be MV3");
  ok(!m.background, "no background service worker is needed or wanted");
  ok(!m.content_scripts, "no auto-injected content scripts — injection is click-driven");
});

test("no network: the manifest requests no host permissions", () => {
  const mf = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
  ok(!mf.host_permissions,
     "host_permissions would let the extension read Turo in the background, " +
     "in any tab, without the user acting — which is the capability that turns " +
     "'reading the page you opened' into crawling");
  eq(mf.manifest_version, 3, "manifest_version");
  ok(mf.permissions.indexOf("activeTab") !== -1, "activeTab must be requested");
});

/* =============================================================================
 * 10. THE SHEET — Excel-safe CSV
 * ========================================================================== */

function csvOf(fixture) {
  const { win, result } = scrape(fixture || "fixture-nextdata.html", { withCsv: true });
  ok(win.TuroCSV, "csv.js must expose globalThis.TuroCSV");
  return { csv: win.TuroCSV.build(result.rows, null), rows: result.rows, win };
}

test("csv: starts with a UTF-8 BOM so Excel does not mangle £", () => {
  const { csv } = csvOf();
  const bytes = Buffer.from(csv, "utf8").slice(0, 3);
  eq(bytes.toString("hex"), "efbbbf", "leading bytes");
});

test("csv: uses CRLF line endings and puts the header on row 1", () => {
  const { csv } = csvOf();
  ok(csv.indexOf("\r\n") > 0, "CRLF");
  const first = csv.split("\r\n")[0];
  has(first, '"Vehicle"', "header row");
  has(first, '"Price shown"', "header row");
});

test("csv: every field is quoted, so a comma in a section title cannot split a cell", () => {
  const { csv } = csvOf();
  const rows = csv.split("\r\n").slice(1).filter((l) => l.length);
  for (const line of rows) {
    if (line.charAt(0) !== '"') fail("a data row does not start with a quote: " + line.slice(0, 40));
  }
});

test("csv: a leading = is neutralised so Sheets/Excel cannot execute it", () => {
  const { csv } = csvOf();
  // The name is literally "=Volkswagen ID.3". It must never reach a cell as a
  // bare formula. csv.js wraps it as ="..." and then CSV-escapes that.
  has(csv, '"=""=Volkswagen ID.3"""', "text-forced injection cell");
  if (/,"=Volkswagen/.test(csv)) fail("the = prefixed value reached a cell unescaped");
});

test("csv: accented characters survive into the sheet", () => {
  const { csv } = csvOf();
  has(csv, "Citroën ë-C4", "accented vehicle name");
});

test("csv: a thousands separator stays text and does not truncate the number", () => {
  const { csv } = csvOf();
  has(csv, '"£1,359/month"', "displayed price keeps its separator, quoted");
  has(csv, '"1359"', "the numeric amount is written bare for summing");
});

test("csv: a missing rating is an empty cell, never a zero", () => {
  const { csv, rows } = csvOf();
  const eqeIndex = rows.findIndex((r) => r.name === "Mercedes-Benz EQE");
  ok(eqeIndex >= 0, "EQE present");
  const line = csv.split("\r\n")[1 + eqeIndex];
  has(line, '"New listing"', "rating shown");
  // The numeric Rating column immediately follows "Rating shown".
  has(line, '"New listing","",', "numeric rating must be empty, not 0");
});

test("csv: provenance columns travel with the data", () => {
  const { csv } = csvOf();
  const header = csv.split("\r\n")[0];
  has(header, '"Strategy"', "strategy column");
  has(header, '"Confidence"', "confidence column");
});

test("csv: a heuristic run is exported labelled as heuristic", () => {
  const { csv } = csvOf("fixture-domonly.html");
  has(csv, '"heuristic"', "tier recorded per row");
  has(csv, '"low"', "confidence recorded per row");
});

test("csv: the row count matches the extracted listings", () => {
  const { csv, rows } = csvOf();
  const dataLines = csv.split("\r\n").slice(1).filter((l) => l.length);
  eq(dataLines.length, rows.length, "data rows");
});

/* =============================================================================
 * 9. THE PAGE NOBODY HAS SEEN
 *
 * Every fixture above encodes the shape recovered from Wayback captures of
 * turo.com, which means the whole suite could agree with itself and still be
 * wrong about the live page. These tests deliberately do NOT use the captured
 * shape. They build pages that differ from it in the ways the real one most
 * plausibly might, and assert the extractor degrades instead of throwing,
 * inventing, or silently dropping a column.
 * ========================================================================== */

/** Build a page from a string rather than a fixture file. */
function scrapeHtml(html, url) {
  const dom = new JSDOM(html, { url: url || "https://turo.com/gb/en", runScripts: "dangerously" });
  const doc = dom.window.document;
  for (const f of ["parsers.js", "extractor.js", "csv.js"]) {
    const sc = doc.createElement("script");
    sc.textContent = fs.readFileSync(path.join(EXT_DIR, f), "utf8");
    doc.head.appendChild(sc);
  }
  return { win: dom.window, result: dom.window.__turoExtractorRun() };
}

/** A flight-shaped page carrying whatever sections you hand it. */
function flightPage(sections) {
  const payload = JSON.stringify({ sections });
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
         "<title>Turo</title></head><body><script>self.__next_f=[[1," +
         JSON.stringify("2:" + payload) + "]]</script></body></html>";
}

test("unseen page: a section title with no rental keyword still reaches the sheet", () => {
  // REGRESSION GUARD. Section attribution used to require the title to match
  // /rental|rent|car|vehicle|suv|truck/. That passes for the English captures
  // and fails for a French section, or an English one that simply does not say
  // "car" — those pages exported a blank Section column with nothing to show
  // the column had been DROPPED rather than being genuinely absent.
  const { result } = scrapeHtml(flightPage([{
    title: "Weekend escapes near you",
    estimatedQuotes: { "7654321": { pricingDisplay: { carousel: { value: "£55/day" } } } },
    vehicles: [{ id: 7654321, make: "Mini", model: "Cooper", year: 2021, rating: 4.9,
                 completedTrips: 8, avgDailyPrice: { amount: 55, currency: "GBP" } }]
  }]));
  ok(result.ok, "not ok: " + result.message);
  eq(result.rows[0].section, "Weekend escapes near you", "section survived");
});

test("unseen page: an unfamiliar __NEXT_DATA__ shape yields nothing rather than nonsense", () => {
  const junk = { props: { pageProps: { flags: { a: 1 }, experiments: [{ key: "x", variant: "b" }],
    nav: { links: [{ href: "/a", label: "About" }, { href: "/b", label: "Help" }] } } } };
  const { result } = scrapeHtml(
    '<!doctype html><html><head><meta charset="utf-8"><script id="__NEXT_DATA__" ' +
    'type="application/json">' + JSON.stringify(junk) + "</script></head><body></body></html>");
  eq(result.ok, false, "should report failure");
  eq(result.rows.length, 0, "invented rows from unrelated JSON");
  eq(result.diagnostics.errors.length, 0, "errors: " + JSON.stringify(result.diagnostics.errors));
  has(result.message, "Looked for", "message must name what was tried");
});

test("unseen page: malformed embedded JSON does not throw", () => {
  const { result } = scrapeHtml(
    '<!doctype html><html><head><meta charset="utf-8"><script id="__NEXT_DATA__" ' +
    'type="application/json">{"props":{ BROKEN</script></head><body></body></html>');
  eq(result.rows.length, 0, "rows from broken JSON");
  eq(result.diagnostics.errors.length, 0, "errors: " + JSON.stringify(result.diagnostics.errors));
});

test("unseen page: a truncated flight stream (user clicked mid-load) does not throw", () => {
  const full = JSON.stringify({ sections: [{ title: "Car rentals in Leeds",
    estimatedQuotes: { "7700001": { pricingDisplay: { carousel: { value: "£50/day" } } } },
    vehicles: [{ id: 7700001, make: "Kia", model: "Niro", year: 2022, rating: 4.9,
                 completedTrips: 3, avgDailyPrice: { amount: 50, currency: "GBP" } }] }] });
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
    "self.__next_f=[[1," + JSON.stringify("2:" + full.slice(0, Math.floor(full.length * 0.6))) +
    "]]</script></body></html>";
  const { result } = scrapeHtml(html);
  eq(result.diagnostics.errors.length, 0, "errors: " + JSON.stringify(result.diagnostics.errors));
  ok(typeof result.ok === "boolean", "still returns a well-formed payload");
});

test("unseen page: 500 listings all come out priced, sectioned and in one tier", () => {
  const vehicles = [], quotes = {};
  for (let i = 0; i < 500; i++) {
    const id = 1000000 + i;
    vehicles.push({ id, make: "Make" + (i % 40), model: "Model" + i, year: 2015 + (i % 10),
      rating: 4 + (i % 10) / 10, completedTrips: i + 1,
      avgDailyPrice: { amount: 40 + i, currency: "GBP" } });
    quotes[String(id)] = { pricingDisplay: { carousel: { value: "£" + (40 + i) + "/day" } } };
  }
  const t0 = Date.now();
  const { result } = scrapeHtml(flightPage([{ title: "Car rentals in Bulk",
    estimatedQuotes: quotes, vehicles }]));
  const ms = Date.now() - t0;
  eq(result.rows.length, 500, "row count");
  eq(Object.keys(result.summary.byTier).length, 1, "one tier owns all 500");
  ok(result.rows.every((r) => r.priceDisplay), "every row priced");
  ok(result.rows.every((r) => r.section === "Car rentals in Bulk"), "every row sectioned");
  ok(ms < 15000, "took " + ms + "ms — too slow for a popup");
});

test("unseen page: /us/en collapses Turo's doubled currency symbol", () => {
  const { result } = scrapeHtml(flightPage([{ title: "Car rentals in Austin",
    estimatedQuotes: { "9900001": { pricingDisplay: { carousel: { value: "$$109 total" } },
      priceDisplayType: "TOTAL", totalTripPrice: { amount: 109, currencyCode: "USD" } } },
    vehicles: [{ id: 9900001, make: "Kia", model: "Niro EV", year: 2025, rating: 5,
      completedTrips: 16, avgDailyPrice: { amount: 36, currency: "USD" },
      location: { city: "Austin", country: "US" } }] }]), "https://turo.com/us/en");
  const r = result.rows[0];
  eq(r.priceDisplay, "$109 total", "doubled symbol collapsed");
  eq(r.currency, "USD", "currency");
  eq(r.ratingDisplay, "5.0 (16)", "rating display");
});

test("unseen page: a suffix-symbol currency (fr locale) still yields a price", () => {
  // "77 €/jour" — the symbol comes AFTER the number and the period word is
  // French. Before the fallbacks in parsers.js this exported an EMPTY price
  // column while the row still looked healthy.
  const { result } = scrapeHtml(flightPage([{ title: "Location de voitures à Paris",
    estimatedQuotes: { "8800001": { pricingDisplay: { carousel: { value: "77 €/jour" } } } },
    vehicles: [{ id: 8800001, make: "Renault", model: "Zoe", year: 2021, rating: 4.8,
      completedTrips: 9, avgDailyPrice: { amount: 77, currency: "EUR" } }] }]),
    "https://turo.com/fr/fr");
  const r = result.rows[0];
  eq(r.priceAmount, 77, "amount");
  eq(r.priceUnit, "day", "unit resolved from 'jour'");
  eq(r.currency, "EUR", "currency");
  eq(r.priceDisplay, "77 €/jour", "display keeps the order the page used");
});

test("unseen page: a listing with no price keeps its row and leaves the cell EMPTY", () => {
  const { result } = scrapeHtml(flightPage([{ title: "Car rentals in Hull",
    vehicles: [{ id: 6600001, make: "Fiat", model: "500", year: 2018, rating: 4.5,
                 completedTrips: 2 }] }]));
  ok(result.ok, "a priceless listing must not fail the run");
  const r = result.rows[0];
  eq(r.name, "Fiat 500", "name");
  eq(r.priceAmount, undefined, "must not invent an amount");
  eq(r.priceDisplay, undefined, "must not invent a display");
});

test("unseen page: a cyclic window global does not throw, and its quotes still join", () => {
  const dom = new JSDOM('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
    { url: "https://turo.com/gb/en", runScripts: "dangerously" });
  const w = dom.window;
  // JSON.stringify would throw on this. The harvester walks the graph instead.
  const a = { ROOT_QUERY: {} };
  a.self = a; a.ROOT_QUERY.parent = a;
  a["3524295"] = { pricingDisplay: { carousel: { value: "£100/day" } }, cyclic: a };
  w.__APOLLO_STATE__ = a;
  for (const f of ["parsers.js", "extractor.js"]) {
    const sc = w.document.createElement("script");
    sc.textContent = fs.readFileSync(path.join(EXT_DIR, f), "utf8");
    w.document.head.appendChild(sc);
  }
  const result = w.__turoExtractorRun();
  eq(result.diagnostics.errors.length, 0, "errors: " + JSON.stringify(result.diagnostics.errors));
  eq(result.diagnostics.page.priceMapEntries, 1, "quote still harvested through the cycle");
});

test("unseen page: schema.org nodes that are not listings never become rows", () => {
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "Offer", price: "999", priceCurrency: "GBP" },
    { "@type": "Organization", name: "Turo", telephone: "+1-415-965-4525" },
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", name: "Home" }] },
    { "@type": "Car", name: "Audi Q4", brand: { "@type": "Brand", name: "Audi" },
      vehicleModelDate: "2024", sku: "888",
      offers: { "@type": "Offer", price: "88", priceCurrency: "GBP", unitText: "per day" } } ] };
  const { result } = scrapeHtml('<!doctype html><html><head><meta charset="utf-8">' +
    '<script type="application/ld+json">' + JSON.stringify(ld) + "</script></head><body></body></html>");
  eq(result.rows.length, 1, "only the Car is a listing; got " +
     result.rows.map((r) => r.name).join(","));
  eq(result.rows[0].priceDisplay, "£88/day", "price built from the Offer");
  eq(result.rows[0].__tier, "json-ld", "tier");
});

test("unseen page: every Excel-dangerous cell is neutralised, none is dropped", () => {
  const { win, result } = scrapeHtml(flightPage([{ title: "=cmd|'/c calc'!A1",
    estimatedQuotes: { "5500001": { pricingDisplay: { carousel: { value: "£10/day" } } } },
    vehicles: [{ id: 5500001, make: "@SUM(1+1)", model: "+1-800-EVIL", year: 2020,
      rating: 5, completedTrips: 1, location: { city: "-2+3" } }] }]));
  ok(result.ok, "not ok");
  const csv = win.TuroCSV.build(result.rows, { url: "https://turo.com/gb/en" }).replace(/^﻿/, "");
  const cells = [].concat.apply([], parseCsvStrict(csv));
  const naked = cells.filter((c) => /^[=+\-@\t\r]/.test(c) && !/^="/.test(c));
  eq(naked.length, 0, "cells still executable: " + JSON.stringify(naked.slice(0, 3)));
  // Neutralised is not the same as deleted — the operator must still see it.
  ok(cells.some((c) => c.indexOf("=cmd|'/c calc'!A1") !== -1), "the section text was dropped");
  ok(cells.some((c) => c.indexOf("@SUM(1+1)") !== -1), "the make text was dropped");
});

function ldItemList(name, items) {
  return { "@context": "https://schema.org", "@type": "ItemList", name: name,
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, item: it })) };
}

function pageWith(ld, sections) {
  const payload = JSON.stringify({ sections });
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Turo</title>' +
    (ld ? '<script type="application/ld+json">' + JSON.stringify(ld) + "</script>" : "") +
    "</head><body><script>self.__next_f=[[1," + JSON.stringify("2:" + payload) +
    "]]</script></body></html>";
}

test("merge: an id-less JSON-LD row folds onto the flight row for the same car", () => {
  // REGRESSION GUARD. Adding the JSON-LD tier introduced a double-count: a page
  // carrying both flight data (id 3524295) and a schema.org block with no `sku`
  // produced TWO rows for one car, keyed "id:3524295" and by content, with
  // nothing linking them. A duplicated listing in a pricing sheet is worse than
  // a missing one — it is silently wrong and survives a row-count sanity check.
  const { result } = scrapeHtml(pageWith(
    ldItemList("Car rentals in Oxford", [{ "@type": "Car", name: "Tesla Model Y",
      vehicleModelDate: "2025",
      offers: { "@type": "Offer", price: "77", priceCurrency: "GBP", unitText: "per day" } }]),
    [{ title: "Car rentals in Oxford",
       estimatedQuotes: { "3524295": { pricingDisplay: { carousel: { value: "£77/day" } } } },
       vehicles: [{ id: 3524295, make: "Tesla", model: "Model Y", year: 2025, rating: 4.9,
                    completedTrips: 12, avgDailyPrice: { amount: 77, currency: "GBP" } }] }]));
  eq(result.rows.length, 1, "one car, one row");
  eq(result.rows[0].vehicleId, "3524295", "the id from the stronger tier survives");
  ok(result.rows[0].__tiers.indexOf("json-ld") !== -1, "both tiers recorded on the row");
});

test("merge: two genuinely different listings that look identical stay separate", () => {
  // The other direction of the same error. A fleet really can hold two
  // identical cars at the same price; collapsing them would under-report.
  const car = (id) => ({ id, make: "Tesla", model: "Model Y", year: 2025, rating: 4.9,
    completedTrips: 12, avgDailyPrice: { amount: 77, currency: "GBP" } });
  const { result } = scrapeHtml(pageWith(null, [{ title: "Car rentals in Oxford",
    estimatedQuotes: { "111111": { pricingDisplay: { carousel: { value: "£77/day" } } },
                       "222222": { pricingDisplay: { carousel: { value: "£77/day" } } } },
    vehicles: [car(111111), car(222222)] }]));
  eq(result.rows.length, 2, "distinct ids must not collapse");
  eq(result.rows.map((r) => r.vehicleId).sort().join(","), "111111,222222", "both ids kept");
});

test("merge: an ambiguous id-less row is never attributed to one twin arbitrarily", () => {
  // When an id-less row matches TWO different ids equally well, guessing would
  // put real data against the wrong listing. Leaving it as its own row is
  // visibly odd, which is the failure mode an operator can actually catch.
  const car = (id) => ({ id, make: "Tesla", model: "Model Y", year: 2025, rating: 4.9,
    completedTrips: 12, avgDailyPrice: { amount: 77, currency: "GBP" } });
  const { result } = scrapeHtml(pageWith(
    ldItemList("Car rentals in Oxford", [{ "@type": "Car", name: "Tesla Model Y",
      vehicleModelDate: "2025",
      offers: { "@type": "Offer", price: "77", priceCurrency: "GBP", unitText: "per day" } }]),
    [{ title: "Car rentals in Oxford",
       estimatedQuotes: { "111111": { pricingDisplay: { carousel: { value: "£77/day" } } },
                          "222222": { pricingDisplay: { carousel: { value: "£77/day" } } } },
       vehicles: [car(111111), car(222222)] }]));
  eq(result.rows.length, 3, "the ambiguous row stands alone rather than picking a twin");
  eq(result.rows.filter((r) => r.vehicleId).length, 2, "both identified rows intact");
});

/** Strict RFC4180 reader, so CSV safety is asserted on PARSED cells. */
function parseCsvStrict(text) {
  const rows = []; let row = [], cell = "", i = 0, inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } inQ = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(cell); cell = ""; i++; continue; }
    if (c === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 2; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += c; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* =============================================================================
 * REPORT
 * ========================================================================== */

const liveDefects = results.defect.filter((d) => !d.fixed);
const healed = results.defect.filter((d) => d.fixed);

console.log("");
console.log("Turo listing exporter — test suite");
console.log("==================================");
console.log("");

for (const name of results.pass) console.log("  pass    " + name);
for (const f of results.fail) {
  console.log("  FAIL    " + f.name);
  console.log("          " + f.message);
}

console.log("");
console.log("  " + results.pass.length + " passed, " + results.fail.length + " failed");

if (liveDefects.length) {
  console.log("");
  console.log("PRODUCT DEFECTS — these are bugs in extractor.js, not failures of the suite");
  console.log("==========================================================================");
  for (const d of liveDefects) {
    console.log("");
    console.log("  " + d.name);
    console.log("    what the test saw : " + d.message);
    console.log("    root cause        : " + d.rootCause);
  }
}

if (healed.length) {
  console.log("");
  console.log("DEFECTS THAT NOW PASS — promote these to real tests:");
  for (const d of healed) console.log("  - " + d.name);
}

console.log("");

if (results.fail.length) {
  console.log("Result: FAILING — " + results.fail.length + " assertion(s) about " +
              "currently-correct behaviour broke.");
  process.exit(1);
}
if (liveDefects.length) {
  console.log("Result: tests green, but " + liveDefects.length + " known defect(s) " +
              "still stand in extractor.js. Exiting non-zero on purpose — a green " +
              "run over an empty price column would be worse than no test at all.");
  process.exit(1);
}
console.log("Result: all green.");
process.exit(0);
