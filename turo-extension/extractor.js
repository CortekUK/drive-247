/* =============================================================================
 * Turo Public Listing Exporter — layered extractor
 * =============================================================================
 *
 * LEGAL POSITION (deliberate, please preserve):
 * This code READS THE DOCUMENT THE USER ALREADY OPENED, in their own browser,
 * on a public page. It performs NO network I/O of any kind: there is not a
 * single fetch(), XMLHttpRequest, image beacon or navigation anywhere below.
 * It never follows links, never paginates, never touches an internal API.
 *
 * Turo's robots.txt disallows /search, /drivers/ and /{locale}/p/*. Crawling
 * those is a different act from reading an already-rendered page, and we keep
 * it that way: PATH_DENYLIST below makes the extractor REFUSE to run on those
 * paths even if the user happens to be standing on one. Reading is not crawling,
 * and this file is written so that it cannot silently become crawling.
 *
 * -----------------------------------------------------------------------------
 * WHAT TURO ACTUALLY IS (researched against Wayback captures of turo.com and
 * turo.com/gb/en — see README for the evidence trail):
 *
 *   - Next.js APP ROUTER. There is NO #__NEXT_DATA__ (that is Pages Router).
 *     The payload ships as React Server Component "flight" chunks in dozens of
 *     inline  self.__next_f.push([1,"<json-string>"])  calls.
 *   - Concatenating the decoded chunks yields a flight stream that is NOT valid
 *     JSON as a whole, but contains complete JSON islands. Hence the balanced,
 *     string-aware brace scanner below rather than a plain JSON.parse.
 *   - Each island holds  "vehicles":[ {...} ]  with this exact DTO:
 *       { id, year, type, tags, availability,
 *         avgDailyPrice:{amount,currency}, completedTrips, estimatedQuote,
 *         hostId, images:[{originalImageUrl, resizeableUrlTemplate}],
 *         isAllStarHost, isFavoritedBySearcher, isNewListing,
 *         location:{city,country,state}, make, model, rating, seoCategory }
 *   - Prices are NOT in that DTO. They live in a SIBLING MAP KEYED BY VEHICLE ID:
 *       "3495714": { discountSavingsText, includedLineItems[], priceDisplayType,
 *                    totalTripPrice{amount,currencyCode}, vehicleDailyPrice{...},
 *                    pricingDisplay:{ card:{priceAfterDiscount:{value}},
 *                                     carousel:{value}, mapPin, modal } }
 *     So tier 1 MUST JOIN vehicles[] to that map by id. avgDailyPrice is the
 *     base rate and does NOT equal the price on the card.
 *   - JSON-LD on Turo is ONLY schema.org/Organization (a phone number). It has
 *     ZERO listing data, and it is injected through self.__next_s rather than a
 *     literal <script type="application/ld+json">. We still read it, but only
 *     for page context — never expect vehicles from it.
 *   - Every CSS class is an Emotion hash (seo-pages-1hdlq5i-StyledText). These
 *     change on every build. NOTHING here may key off a class name. It doesn't.
 *
 * STABLE DOM HOOKS (verified present in captures):
 *     a[data-testid="vehicle-card-link-box"]   <- the whole card, an <a>
 *     [data-testid="price-details-container"]
 *     [data-testid="vehicle-discount-and-price"]
 *     [data-testid^="IconStar"]                <- rating present
 *     img[alt="{Make} {Model} {Year} in {City}"]  <- best DOM source of year
 *     href="/{lang}/{loc}/{type}-rental/{country}/{city}/{make}/{model}/{id}"
 *     <h2> immediately preceding each carousel = the section title
 *
 * LOCALE DRIFT IS REAL — the card's internals differ between US and GB builds:
 *     US: <p>Kia Niro EV 2025</p> <span aria-label="rating.aria_label">5.0</span><span>(16 trips)</span>
 *     GB: <p>Honda HR-V</p> <p>2016</p><span>•</span><p>New listing</p>
 * so the DOM tiers parse the card's TEXT with tolerant regexes rather than
 * assuming any particular element layout.
 *
 * KNOWN QUIRKS ENCODED BELOW:
 *     - US flight data renders a doubled currency symbol: "$$109 total".
 *       Real Turo bug in their price templating. We collapse it.
 *     - "resizeableUrlTemplate" is misspelled by Turo (not "resizable").
 *       We accept both spellings.
 *     - The flight data carries MORE vehicles than the DOM renders (carousels
 *       lazy-render): 40 in JSON vs 16 in DOM on the GB capture. This is the
 *       main reason JSON tiers outrank DOM tiers.
 *
 * CONTRACT: this function NEVER throws. Every tier is individually wrapped.
 * If everything fails it still returns a payload containing diagnostics
 * describing exactly what was looked for and what the page actually held.
 * ========================================================================== */

/**
 * Exposed as a callable rather than a self-running IIFE.
 *
 * chrome.scripting.executeScript({files:[...]}) does return the completion
 * value of the last statement, but relying on that is fragile and invisible.
 * popup.js instead injects the files, then makes a second executeScript call
 * with func: () => globalThis.__turoExtractorRun(). That is explicit, and it
 * lets the popup distinguish "the file never loaded" from "it ran and found
 * nothing" — two failures that need very different messages.
 */
globalThis.__turoExtractorRun = function __turoExtractorRun() {
  "use strict";

  // ---- tier ranking: higher wins during the merge --------------------------
  const TIER = {
    JSON_STATE:    { name: "json-state",   rank: 100, confidence: "high"   },
    // schema.org is a PUBLISHED CONTRACT the site maintains for search engines,
    // so it outranks our own generic shape-guessing (json-deep) — but it sits
    // below the app's native state, which is what the page actually renders
    // from and is therefore the only source guaranteed to agree with the screen.
    JSON_LD:       { name: "json-ld",      rank: 90,  confidence: "high"   },
    JSON_DEEP:     { name: "json-deep",    rank: 80,  confidence: "high"   },
    TESTID:        { name: "data-testid",  rank: 60,  confidence: "medium" },
    HEURISTIC_DOM: { name: "heuristic",    rank: 30,  confidence: "low"    }
  };

  /**
   * robots.txt-disallowed areas. We refuse rather than quietly comply.
   *
   * BUG FOUND IN TESTING: these were anchored as /^\/search\b/, which does NOT
   * match "/gb/en/search" — and Turo serves every route under a locale prefix,
   * so the single most important path to refuse walked straight through. The
   * optional (?:/xx/yy)? prefix is load-bearing; do not "simplify" it away.
   */
  const LOCALE_PREFIX = "(?:\\/[a-z]{2,3}\\/[a-z]{2,3})?";
  const PATH_DENYLIST = [
    new RegExp("^" + LOCALE_PREFIX + "\\/search\\b", "i"),
    new RegExp("^" + LOCALE_PREFIX + "\\/drivers\\/", "i"),
    new RegExp("^" + LOCALE_PREFIX + "\\/p\\/", "i")
  ];

  const diag = { tiers: [], errors: [], notes: [], page: {} };
  const note = (m) => diag.notes.push(String(m));
  const fail = (tier, e) =>
    diag.errors.push({ tier, error: (e && (e.stack || e.message)) || String(e) });

  /** Run a tier so that a failure can never take the whole extraction down. */
  function safely(tierName, fn, fallback) {
    const t0 = Date.now();
    try {
      const out = fn();
      diag.tiers.push({ tier: tierName, ok: true, ms: Date.now() - t0,
                        produced: Array.isArray(out) ? out.length : (out ? 1 : 0) });
      return out;
    } catch (e) {
      fail(tierName, e);
      diag.tiers.push({ tier: tierName, ok: false, ms: Date.now() - t0, produced: 0 });
      return fallback;
    }
  }

  /* =========================================================================
   * 0. NORMALISERS
   *
   * These used to be defined inline here. They now live in parsers.js, which
   * is injected immediately before this file, so that the popup's CSV writer
   * and table renderer share ONE implementation with the page-side extractor.
   * A rating formatted as "5.0" on screen and "5" in the sheet would be a
   * small lie, and small lies about numbers are how a pricing sheet stops
   * being trusted.
   *
   * Every quirk found in the real Wayback captures is documented at the
   * definition site in parsers.js: the doubled "$$109" currency symbol, the
   * "Save £811/mo £1,014/month" discount-badge trap, and the ban on
   * element.textContent (Emotion injects <style> inside cards).
   * ====================================================================== */

  const P = (typeof globalThis !== "undefined" && globalThis.TuroParsers) || null;
  if (!P) {
    // Fail loudly and specifically. A silent fallback to weaker inline copies
    // is how two divergent parsers get shipped in one extension.
    throw new Error(
      "TuroParsers is not loaded. parsers.js must be injected BEFORE extractor.js " +
      "(see the files[] order in popup.js runIn()).");
  }

  const CURRENCY_CHARS   = P.CURRENCY_CHARS;
  const collapseCurrency = P.collapseCurrency;
  const toNumber         = P.toNumber;
  const parseAmount      = P.parseAmount;
  const formatRating     = P.formatRating;
  const parsePriceString = P.parsePriceString;
  const stripSavings     = P.stripSavings;
  const cleanText        = P.cleanText;
  const titleCase        = P.titleCase;
  const parseListingHref = P.parseListingHref;
  const parseImageAlt    = P.parseImageAlt;

  /* =========================================================================
   * TIER 1 — EMBEDDED STRUCTURED STATE
   * Collect every JSON island the page ships, from every known location.
   * ====================================================================== */

  /**
   * Balanced, STRING-AWARE brace matcher. Essential: the flight stream is
   * saturated with quotes and escapes, so naive depth counting mis-terminates.
   */
  function matchBalanced(text, start, limit) {
    const open = text[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    const end = Math.min(text.length, start + (limit || 4_000_000));
    for (let i = start; i < end; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) return i + 1;
    }
    return -1;
  }

  function tryParse(s) { try { return JSON.parse(s); } catch (_) { return undefined; } }

  /**
   * Pull the Next.js App Router flight stream. Two independent routes, because
   * either can be unavailable depending on injection world and hydration state:
   *   (a) the live self.__next_f global (MAIN world only), and
   *   (b) the literal text of the inline <script> tags (always readable).
   */
  function collectFlightText() {
    let buf = "";
    try {
      const g = self.__next_f;
      if (Array.isArray(g)) {
        for (const entry of g) {
          if (Array.isArray(entry) && typeof entry[1] === "string") buf += entry[1];
        }
        if (buf) note("flight: read " + g.length + " chunks from live self.__next_f");
      }
    } catch (e) { fail("flight-global", e); }

    if (!buf) {
      try {
        const re = /self\.__next_f\.push\(\s*\[\s*\d+\s*,\s*("(?:[^"\\]|\\.)*")\s*\]\s*\)/g;
        let n = 0;
        for (const sc of document.querySelectorAll("script")) {
          const t = sc.textContent;
          if (!t || t.indexOf("__next_f") === -1) continue;
          let m;
          while ((m = re.exec(t))) { const d = tryParse(m[1]); if (typeof d === "string") { buf += d; n++; } }
        }
        if (n) note("flight: recovered " + n + " chunks from inline <script> text");
      } catch (e) { fail("flight-scripts", e); }
    }
    return buf;
  }

  /** Every place a framework might have parked state. */
  function collectStateBlobs() {
    const blobs = [];
    const push = (where, value) => { if (value != null) blobs.push({ where, value }); };

    // Pages Router / other SSR frameworks
    try {
      const nd = document.getElementById("__NEXT_DATA__");
      if (nd) push("script#__NEXT_DATA__", tryParse(nd.textContent));
    } catch (e) { fail("next-data", e); }

    for (const key of ["__APOLLO_STATE__", "__INITIAL_STATE__", "__REDUX_STATE__",
                       "__PRELOADED_STATE__", "__NUXT__", "__remixContext",
                       "__staticRouterHydrationData", "__INITIAL_DATA__"]) {
      try { if (self[key] != null) push("window." + key, self[key]); } catch (_) {}
    }

    // JSON-LD, both as real tags and as Next's self.__next_s script queue.
    // (On Turo this yields Organization only — kept for page context, not cars.)
    try {
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        push("ld+json", tryParse(s.textContent));
      }
      const ns = self.__next_s;
      if (Array.isArray(ns)) {
        for (const e of ns) {
          const o = Array.isArray(e) ? e[1] : e;
          if (o && typeof o === "object" && /ld\+json/.test(o.type || "") && typeof o.children === "string") {
            push("ld+json(__next_s)", tryParse(o.children));
          }
        }
      }
    } catch (e) { fail("ld-json", e); }

    // Last resort: any <script> whose text smells of vehicle data.
    try {
      const SMELL = /"(?:make|model|vehicleId|avgDailyPrice|isNewListing|completedTrips|seoCategory)"\s*:/;
      for (const sc of document.querySelectorAll("script")) {
        const t = sc.textContent;
        if (!t || t.length < 80 || t.indexOf("__next_f") !== -1) continue;
        if (!SMELL.test(t)) continue;
        const direct = tryParse(t.trim());
        if (direct) { push("script(json)", direct); continue; }
        for (const isl of harvestIslands(t)) push("script(embedded)", isl);
      }
    } catch (e) { fail("script-sweep", e); }

    return blobs;
  }

  /**
   * Carve complete JSON islands out of text that is not itself JSON.
   * Anchored on keys we know Turo emits, plus generic collection keys, so this
   * still works if they rename things — we never require an exact key.
   */
  /**
   * Single string-aware forward pass that records, for a set of anchor offsets,
   * the innermost ENCLOSING object start. O(n) rather than a backward re-scan
   * per anchor.
   *
   * BUG FOUND IN TESTING: anchoring on `"vehicles":[` and taking just the array
   * threw away its sibling `title` — the section name. Turo's real shape is
   *     { title, deepLink, estimatedQuotes:{<id>:{...}}, vehicles:[...] }
   * so we must lift the ENCLOSING OBJECT, not the array, to keep section
   * attribution (and the section's own price map) attached to the rows.
   */
  function enclosingObjectStarts(text, anchors) {
    const wanted = anchors.slice().sort((a, b) => a - b);
    const out = new Map();
    let wi = 0, inStr = false, esc = false;
    const stack = [];
    for (let i = 0; i < text.length && wi < wanted.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") stack.push(i);
      else if (ch === "}") stack.pop();
      while (wi < wanted.length && wanted[wi] === i) {
        out.set(wanted[wi], stack.length ? stack[stack.length - 1] : -1);
        wi++;
      }
    }
    return out;
  }

  /**
   * Carve complete JSON islands out of text that is not itself JSON.
   * Anchored on keys we know Turo emits, plus generic collection keys, so this
   * still works if they rename things — we never require an exact key.
   */
  function harvestIslands(text) {
    const found = [];
    if (!text) return found;

    const collectionRe = /"(?:vehicles|listings|results|items|cars|edges|nodes)"\s*:\s*\[/g;
    const objectRes = [
      /\{"(?:id|vehicleId)"\s*:\s*\d+\s*,\s*"(?:year|make|model)"/g,
      /\{"(?:make|model)"\s*:\s*"/g
    ];

    // -- collection anchors: lift the ENCLOSING object so siblings survive ----
    const anchorIdx = [];
    let m;
    collectionRe.lastIndex = 0;
    while ((m = collectionRe.exec(text)) && anchorIdx.length < 500) anchorIdx.push(m.index);

    if (anchorIdx.length) {
      const encl = enclosingObjectStarts(text, anchorIdx);
      const takenStarts = new Set();
      for (const a of anchorIdx) {
        const start = encl.get(a);
        if (start === undefined) continue;
        if (start >= 0 && !takenStarts.has(start)) {
          takenStarts.add(start);
          const end = matchBalanced(text, start, 6_000_000);
          if (end > start) {
            const parsed = tryParse(text.slice(start, end));
            if (parsed) { found.push(parsed); continue; }
          }
        }
        // fall back to the bare array if the enclosing object won't parse
        const br = text.indexOf("[", a);
        if (br < 0) continue;
        const e2 = matchBalanced(text, br, 3_000_000);
        if (e2 > br) { const p2 = tryParse(text.slice(br, e2)); if (p2) found.push(p2); }
      }
    }

    // -- bare-object anchors (no section context available) -------------------
    for (const re of objectRes) {
      re.lastIndex = 0;
      let mm, guard = 0;
      while ((mm = re.exec(text)) && guard++ < 4000) {
        const end = matchBalanced(text, mm.index, 500000);
        if (end > mm.index) {
          const parsed = tryParse(text.slice(mm.index, end));
          if (parsed) found.push(parsed);
          re.lastIndex = end;
        }
      }
    }
    return found;
  }

  /**
   * The price map: objects keyed by numeric vehicle id whose values carry
   * pricingDisplay / totalTripPrice. Harvested separately because it sits
   * beside the vehicles array, not inside it.
   */
  function harvestPriceMap(text) {
    const map = {};
    if (!text) return map;
    const re = /"(\d{4,12})"\s*:\s*\{/g;
    let m, guard = 0;
    while ((m = re.exec(text)) && guard++ < 20000) {
      const braceAt = text.indexOf("{", m.index + m[0].length - 1);
      const peek = text.slice(braceAt, braceAt + 1200);
      if (!/pricingDisplay|totalTripPrice|vehicleDailyPrice|discountSavingsText/.test(peek)) continue;
      const end = matchBalanced(text, braceAt, 200000);
      if (end > braceAt) {
        const parsed = tryParse(text.slice(braceAt, end));
        if (parsed && typeof parsed === "object") map[m[1]] = parsed;
        re.lastIndex = end;
      }
    }
    return map;
  }

  /**
   * STRUCTURAL twin of harvestPriceMap().
   *
   * BUG FOUND IN TESTING: harvestPriceMap() only ever ran over the raw
   * self.__next_f flight TEXT, because that text is not parseable as a whole
   * and had to be scanned as a string. Every other source of state —
   * script#__NEXT_DATA__, window.__APOLLO_STATE__, an inline JSON <script> —
   * arrives ALREADY PARSED, and was never scanned at all. On a page that ships
   * its quotes in any of those, priceMapEntries came back 0 and every JSON row
   * silently lost priceDisplay / priceAmount / priceUnit / priceBasis /
   * tripTotalAmount.
   *
   * That failure hid itself: on a fully-rendered page the merge back-fills the
   * price from the DOM tier, so the sheet looked right. It broke precisely
   * where the JSON tier is the whole point — the lazy-rendered carousel rows
   * that never entered the DOM, which is most of them.
   *
   * Walking the parsed graph is better than re-serialising it: JSON.stringify
   * throws on the cyclic structures that live window globals genuinely contain.
   *
   * Existing entries are never overwritten, so the flight text (which is what
   * the page actually rendered from) keeps precedence over a stale duplicate.
   */
  function harvestPriceMapFromObject(root, into) {
    if (!root || typeof root !== "object") return into;
    const seen = new Set();
    const stack = [root];
    let budget = 200000;

    while (stack.length && budget-- > 0) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (seen.has(node)) continue;               // cycle guard
      seen.add(node);

      if (Array.isArray(node)) {
        for (const child of node) if (child && typeof child === "object") stack.push(child);
        continue;
      }

      for (const k of Object.keys(node)) {
        const v = node[k];
        if (!v || typeof v !== "object") continue;
        // An id-keyed quote entry: numeric key, value carrying price markers.
        // 1..12 digits, NOT the 4..12 the TEXT scanner needs. That scanner has
        // only a regex to go on and must exclude year-like keys; here the value
        // is already parsed, so the price-marker test below does the
        // discriminating and a short numeric id still joins.
        if (/^\d{1,12}$/.test(k) && !Array.isArray(v) &&
            (v.pricingDisplay || v.totalTripPrice || v.vehicleDailyPrice ||
             v.discountSavingsText || v.priceDisplayType)) {
          if (!Object.prototype.hasOwnProperty.call(into, k)) into[k] = v;
          continue;                               // it is a quote, not a container
        }
        stack.push(v);
      }
    }
    return into;
  }

  /**
   * Write an amount the way the site would have written it — "£1,359/month",
   * not "£1359/month". Used wherever we have a number and a currency but no
   * rendered string to copy (schema.org offers, a bare numeric price field).
   */
  function synthesizePriceDisplay(amount, currency, unit) {
    const sym = { GBP: "\u00a3", USD: "$", EUR: "\u20ac", JPY: "\u00a5", INR: "\u20b9",
                  CAD: "$", AUD: "$", NZD: "$" }[currency] || "";
    const parts = String(amount).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const grouped = parts.join(".");
    const tail = (!unit || unit === "unknown") ? ""
               : (unit === "total" ? " total" : "/" + unit);
    // With no symbol available the ISO code still beats an unlabelled number.
    return (sym ? sym + grouped : grouped + (currency ? " " + currency : "")) + tail;
  }

  /* =========================================================================
   * TIER 1b — JSON-LD (schema.org)
   *
   * REGRESSION FIXED HERE: collectStateBlobs() has always PARSED the ld+json
   * blocks, but the only thing that could turn a blob into rows was the generic
   * scoreVehicleLike(), which scores this app's native DTO vocabulary
   * (make/model/year/avgDailyPrice). schema.org speaks a different language —
   * brand:{name}, vehicleModelDate, offers:{price,priceCurrency},
   * aggregateRating:{ratingValue} — and `brand` was actively REJECTED there
   * because its value is an object rather than a string. Real listings scored
   * about 22 against a threshold of 45, were discarded, and came back from the
   * heuristic DOM tier labelled LOW CONFIDENCE. The sheet was understating data
   * that was fully structured on the page, which is the one thing a provenance-
   * carrying exporter must never do.
   *
   * On turo.com itself this currently yields nothing — Turo emits only a
   * schema.org Organization block (a phone number). It is kept because it costs
   * one cheap typed walk, it is the single most likely thing to APPEAR on a
   * public SEO page, and the alternative is silently downgrading it.
   * ====================================================================== */

  const LD_LISTING_TYPE = /\b(?:Car|Vehicle|Product|IndividualProduct|AutoRental|RentalCarReservation)\b/i;

  function ldTypes(node) {
    const t = node && node["@type"];
    if (!t) return "";
    return (Array.isArray(t) ? t : [t]).filter(Boolean).map(String).join(" ");
  }

  function ldString(v) {
    if (typeof v === "string") return v.trim() || null;
    if (typeof v === "number") return String(v);
    if (v && typeof v === "object") {
      // {"@type":"Brand","name":"Porsche"} / {"@value":"..."} / ["a","b"]
      if (Array.isArray(v)) return ldString(v[0]);
      return ldString(v.name != null ? v.name : v["@value"]);
    }
    return null;
  }

  /** One schema.org node -> one row in this extractor's vocabulary. */
  function rowFromLdNode(node, section, tier) {
    const prov = {};
    const row = {};
    const put = (k, val, src) => {
      if (val === null || val === undefined || val === "") return;
      row[k] = val; prov[k] = src;
    };

    const id = ldString(node.sku) || ldString(node.productID) ||
               ldString(node.identifier) || ldString(node.mpn);
    put("vehicleId", id, "ld.sku");

    const brand = ldString(node.brand) || ldString(node.manufacturer);
    const model = ldString(node.model) || ldString(node.vehicleModel);
    const label = ldString(node.name) || ldString(node.title);

    // The rendered name is what the operator recognises, so it wins. make and
    // model are then derived so the columns stay populated either way.
    if (label) {
      put("name", label, "ld.name");
      put("make", brand, "ld.brand");
      put("model", model, "ld.model");
      if (!row.make || !row.model) {
        const split = P.parseVehicleName(label);
        if (!row.make) put("make", split.make, "ld.name(split)");
        if (!row.model) put("model", split.model, "ld.name(split)");
      }
    } else if (brand || model) {
      put("make", brand, "ld.brand");
      put("model", model, "ld.model");
      put("name", [brand, model].filter(Boolean).join(" "), "ld.brand+model");
    }
    if (!row.name) return null;                  // a nameless row is not a listing

    const yr = node.vehicleModelDate || node.modelDate || node.productionDate ||
               node.releaseDate || node.vehicleConfiguration;
    const yrN = typeof yr === "string" ? P.parseYear(yr) : (looksLikeYear(yr) ? toNumber(yr) : null);
    if (yrN) put("year", yrN, "ld.vehicleModelDate");

    // ---- rating: the null-vs-zero rule applies here exactly as elsewhere ----
    const agg = (node.aggregateRating && typeof node.aggregateRating === "object")
      ? node.aggregateRating : {};
    const ratingN = toNumber(agg.ratingValue);
    const reviewsN = toNumber(agg.reviewCount != null ? agg.reviewCount : agg.ratingCount);
    if (reviewsN !== null) put("reviewCount", reviewsN, "ld.aggregateRating.reviewCount");
    if (ratingN !== null && ratingN > 0 && looksLikeRating(ratingN)) {
      put("rating", ratingN, "ld.aggregateRating.ratingValue");
      put("isNewListing", false, "ld.aggregateRating");
      put("ratingDisplay",
          formatRating(ratingN) + (reviewsN !== null ? " (" + reviewsN + ")" : ""),
          "ld.aggregateRating");
    } else {
      // No rating published is NOT a rating of zero. Say what the card says.
      put("isNewListing", true, "ld.inferred(no-rating)");
      put("ratingDisplay", "New listing", "ld.inferred");
    }

    // ---- offer / price -----------------------------------------------------
    let offer = node.offers != null ? node.offers : node.offer;
    if (Array.isArray(offer)) offer = offer[0];
    if (!offer || typeof offer !== "object") offer = {};
    // An AggregateOffer nests the real one.
    if (offer.offers) {
      const inner = Array.isArray(offer.offers) ? offer.offers[0] : offer.offers;
      if (inner && typeof inner === "object") offer = inner;
    }

    const rawPrice = offer.price != null ? offer.price
                   : (offer.lowPrice != null ? offer.lowPrice : node.price);
    const currency = ldString(offer.priceCurrency) || ldString(node.priceCurrency);
    // "per month" / "MONTH" / "P1D" all have to reduce to our unit vocabulary.
    const unitHint = [offer.unitText, offer.unitCode, offer.billingPeriod,
                      offer.referenceQuantity && offer.referenceQuantity.unitText,
                      node.priceSpecification && node.priceSpecification.unitText]
                     .map((x) => ldString(x)).filter(Boolean).join(" ");
    let unit = P.detectPeriod
      ? P.detectPeriod(unitHint) || P.detectPeriod("per " + unitHint)
      : null;
    if (!unit && /\bmonth|\bMON\b|P1M/i.test(unitHint)) unit = "month";
    if (!unit && /\bday|\bDAY\b|P1D/i.test(unitHint)) unit = "day";
    if (!unit && /\bweek|\bWEE\b|P1W/i.test(unitHint)) unit = "week";
    if (!unit && /\bhour|\bHUR\b|P1H/i.test(unitHint)) unit = "hour";

    // A price string may already carry its own symbol and period ("£77/day").
    const asString = typeof rawPrice === "string" ? parsePriceString(rawPrice) : null;
    const amount = asString ? asString.amount : toNumber(rawPrice);
    if (amount !== null && amount !== undefined) {
      const cur = currency || (asString && asString.currency) || null;
      if (!unit && asString && asString.unit !== "unknown") unit = asString.unit;
      put("priceAmount", amount, "ld.offers.price");
      put("priceUnit", unit || "unknown", "ld.offers.unitText");
      put("currency", cur, "ld.offers.priceCurrency");
      put("priceDisplay",
          (asString && asString.display && /[^\d.,\s]/.test(asString.display))
            ? asString.display
            : synthesizePriceDisplay(amount, cur, unit),
          "ld.offers");
    }
    // NOTE: offer.availability is deliberately NOT carried. mergeRows() copies
    // only DATA_FIELDS, so an extra key would survive on unmerged rows and
    // vanish on merged ones — a column that is populated for some listings and
    // blank for others for no reason the operator can see.

    const url = ldString(node.url) || ldString(offer.url);
    if (url && /^https?:\/\//i.test(url)) put("listingUrl", url, "ld.url");
    put("imageUrl", ldString(node.image) || ldString(node.photo), "ld.image");

    const loc = node.location || node.areaServed || {};
    if (loc && typeof loc === "object") {
      const addr = loc.address && typeof loc.address === "object" ? loc.address : loc;
      put("city", ldString(addr.addressLocality) || ldString(loc.name), "ld.location");
      put("region", ldString(addr.addressRegion), "ld.location");
      put("country", ldString(addr.addressCountry), "ld.location");
    }

    if (section) put("section", section, "ld.itemList.name");

    row.__tier = tier.name;
    row.__confidence = tier.confidence;
    row.__rank = tier.rank;
    row.__score = 100;                            // declared data, not inferred
    row.__prov = prov;
    return row;
  }

  /**
   * Walk a parsed blob for schema.org listings. An ItemList's `name` is the
   * section heading for everything beneath it, which is how the section column
   * survives the JSON-LD route.
   */
  function rowsFromJsonLd(blob) {
    const out = [];
    if (!blob || typeof blob !== "object") return out;
    const seen = new Set();
    const stack = [{ node: blob, section: null, depth: 0 }];

    while (stack.length && out.length < 2000) {
      const { node, section, depth } = stack.pop();
      if (!node || typeof node !== "object" || depth > 12) continue;
      if (seen.has(node)) continue;
      seen.add(node);

      if (Array.isArray(node)) {
        for (const child of node) stack.push({ node: child, section, depth: depth + 1 });
        continue;
      }

      const types = ldTypes(node);
      if (types && LD_LISTING_TYPE.test(types)) {
        const r = rowFromLdNode(node, section, TIER.JSON_LD);
        // Emitted rows are terminal: we must not descend and re-emit the Offer
        // or Brand hanging off them as listings in their own right.
        if (r) { out.push(r); continue; }
      }

      // An ItemList names the section for its members. @graph and mainEntity
      // are the other two standard containers.
      let sec = section;
      if (/\bItemList\b/i.test(types)) {
        const n = ldString(node.name) || ldString(node.headline);
        if (n && n.length > 2 && n.length < 160) sec = n;
      }

      for (const k of Object.keys(node)) {
        if (k.charAt(0) === "@" && k !== "@graph") continue;
        const v = node[k];
        if (v && typeof v === "object") stack.push({ node: v, section: sec, depth: depth + 1 });
      }
    }
    return out;
  }

  /* =========================================================================
   * TIER 2 — GENERIC DEEP SEARCH + VEHICLE-LIKENESS SCORING
   * Key NAMES are treated as hints, never requirements. An object qualifies on
   * the SHAPE of its values as much as on what its keys are called.
   * ====================================================================== */

  const KEY_FAMILIES = {
    id:     [/^id$/i, /vehicleid/i, /listingid/i, /^uuid$/i],
    make:   [/^make$/i, /manufacturer/i, /^brand$/i],
    model:  [/^model$/i, /^modelname$/i, /^trim$/i],
    year:   [/^year$/i, /modelyear/i, /^vehicleyear$/i],
    price:  [/price/i, /rate$/i, /amount/i, /cost/i, /fee$/i],
    rating: [/rating/i, /^stars?$/i, /score/i],
    trips:  [/trip/i, /review/i, /^ratingcount$/i],
    image:  [/image/i, /photo/i, /thumbnail/i, /picture/i],
    loc:    [/location/i, /^city$/i, /address/i, /^region$/i],
    name:   [/^name$/i, /^title$/i, /^label$/i]
  };

  const matchesFamily = (key, fam) => KEY_FAMILIES[fam].some((re) => re.test(key));

  function looksLikeYear(v) {
    const n = toNumber(v);
    return n !== null && n >= 1900 && n <= new Date().getFullYear() + 2 && Number.isInteger(n);
  }
  function looksLikeRating(v) {
    const n = toNumber(v);
    return n !== null && n >= 0 && n <= 5;
  }
  function looksLikeMoney(v) {
    if (typeof v === "number") return v >= 0 && v < 1e7;
    if (v && typeof v === "object")
      return ("amount" in v) && (("currency" in v) || ("currencyCode" in v));
    if (typeof v === "string") return !!parsePriceString(v);
    return false;
  }

  /** 0..100. Deliberately generous on names, strict on value shapes. */
  function scoreVehicleLike(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return 0;
    const keys = Object.keys(o);
    if (!keys.length || keys.length > 60) return 0;
    let s = 0;
    const has = {};
    for (const k of keys) {
      const v = o[k];
      if (v === null || v === undefined) continue;
      if (!has.make  && matchesFamily(k, "make")  && typeof v === "string" && v.length < 40) { s += 22; has.make = 1; }
      if (!has.model && matchesFamily(k, "model") && typeof v === "string" && v.length < 60) { s += 22; has.model = 1; }
      if (!has.year  && matchesFamily(k, "year")  && looksLikeYear(v))                       { s += 18; has.year = 1; }
      if (!has.price && matchesFamily(k, "price") && looksLikeMoney(v))                      { s += 14; has.price = 1; }
      if (!has.rate  && matchesFamily(k, "rating") && looksLikeRating(v))                    { s += 10; has.rate = 1; }
      if (!has.img   && matchesFamily(k, "image"))                                            { s += 6;  has.img = 1; }
      if (!has.loc   && matchesFamily(k, "loc"))                                              { s += 5;  has.loc = 1; }
      if (!has.id    && matchesFamily(k, "id") && (typeof v === "number" || typeof v === "string")) { s += 5; has.id = 1; }
      if (!has.trips && matchesFamily(k, "trips") && toNumber(v) !== null)                   { s += 3;  has.trips = 1; }
    }
    // A "make" alone is a manufacturer record, not a listing. Demand breadth.
    const breadth = Object.keys(has).length;
    if (breadth < 3) return Math.min(s, 25);
    return Math.min(s, 100);
  }

  const VEHICLE_SCORE_THRESHOLD = 45;

  /**
   * Walk an arbitrary object graph; return arrays whose members look like
   * listings, each with the nearest enclosing "title"/"name" as section hint.
   */
  function deepFindVehicleArrays(root) {
    const groups = [];
    const seen = new Set();
    const stack = [{ node: root, section: null, depth: 0 }];

    while (stack.length) {
      const { node, section, depth } = stack.pop();
      if (!node || typeof node !== "object" || depth > 14) continue;
      if (seen.has(node)) continue;            // cycle guard
      seen.add(node);

      if (Array.isArray(node)) {
        const objs = node.filter((x) => x && typeof x === "object" && !Array.isArray(x));
        if (objs.length) {
          const sample = objs.slice(0, 8);
          const avg = sample.reduce((a, o) => a + scoreVehicleLike(o), 0) / sample.length;
          if (avg >= VEHICLE_SCORE_THRESHOLD) {
            groups.push({ items: objs, section, score: Math.round(avg) });
            continue;                          // don't descend into accepted rows
          }
        }
        for (const child of node) stack.push({ node: child, section, depth: depth + 1 });
        continue;
      }

      /* -- section attribution ------------------------------------------
       * Turo's real shape is  { title, subtitle, estimatedQuotes, vehicles[] },
       * so the heading is a SIBLING of the array. That structural adjacency is
       * a far stronger signal than any keyword, and it is handed straight to
       * the array below.
       *
       * BUG FOUND IN TESTING: the keyword gate /rental|rent|car|vehicle|.../
       * was applied to EVERY title, including that sibling. It happens to pass
       * for the English captures ("Car rentals at King's Cross") and to FAIL
       * for anything else — a French section ("Location de voitures a Paris"),
       * or an English one that simply does not say "car" ("Deals near you",
       * "Weekend escapes"). Those pages exported with an EMPTY section column
       * and nothing to indicate the column had been dropped rather than being
       * genuinely absent.
       *
       * The gate is still right for the OTHER direction: a title several
       * levels above an array should not be dragged down onto it just because
       * it exists. So adjacency is trusted unconditionally; distance still has
       * to earn it.
       * ---------------------------------------------------------------- */
      const t = node.title || node.name || node.heading || node.header;
      const ownTitle = (typeof t === "string" && t.length > 3 && t.length < 160)
        ? t.trim() : null;

      let sec = section;
      if (ownTitle && /rental|rent|car|vehicle|suv|truck|van|location|noleggio|alquiler|mietwagen/i.test(ownTitle)) {
        sec = ownTitle;                          // travels down the whole subtree
      }

      for (const k of Object.keys(node)) {
        const child = node[k];
        // An array hanging directly off a titled object takes that title,
        // keyword or not — that is the shape a "section of listings" has.
        const childSection = (ownTitle && Array.isArray(child)) ? ownTitle : sec;
        stack.push({ node: child, section: childSection, depth: depth + 1 });
      }
    }
    return groups;
  }

  /** Turn one raw JSON listing object (+ its price-map entry) into a row. */
  function rowFromJsonVehicle(v, priceMap, section, tier, score) {
    const prov = {};
    const put = (k, val, src) => {
      if (val === null || val === undefined || val === "") return;
      row[k] = val; prov[k] = src;
    };
    const row = {};

    const id = v.id ?? v.vehicleId ?? v.listingId ?? null;
    put("vehicleId", id != null ? String(id) : null, "json.id");
    put("make", v.make ?? v.manufacturer ?? v.brand ?? null, "json.make");
    put("model", v.model ?? v.modelName ?? null, "json.model");
    if (looksLikeYear(v.year)) put("year", toNumber(v.year), "json.year");
    put("vehicleType", v.type ?? v.seoCategory ?? null, "json.type");

    if (row.make || row.model) {
      put("name", [row.make, row.model].filter(Boolean).join(" "), "json.make+model");
    } else {
      // Not every payload splits the vehicle into make + model. When a record
      // carries only a combined label, use it and derive make/model back out —
      // otherwise the row ships with an EMPTY vehicle name, which is the one
      // field that makes a row worth having at all.
      const label = v.name ?? v.title ?? v.displayName ?? v.vehicleName ?? null;
      if (typeof label === "string" && label.trim()) {
        put("name", label.trim(), "json.name");
        const parsed = P.parseVehicleName(label);
        put("make", parsed.make, "json.name(split)");
        put("model", parsed.model, "json.name(split)");
        if (!row.year && parsed.year) put("year", parsed.year, "json.name(split)");
      }
    }

    // rating / reviews. isNewListing is authoritative over a 0/absent rating.
    const trips = v.completedTrips ?? v.tripCount ?? v.reviewCount ?? null;
    const tripsN = toNumber(trips);
    if (tripsN !== null) put("reviewCount", tripsN, "json.completedTrips");

    // BUG FOUND IN TESTING: Turo's own isNewListing flag is not the whole story.
    // The GB capture has a Honda HR-V with isNewListing:false, rating:null and
    // completedTrips:0 that the site nonetheless RENDERS as "New listing".
    // The card shows "New listing" whenever there is no rating to show, so we
    // infer it the same way rather than trusting the flag alone.
    const hasRating = looksLikeRating(v.rating) && toNumber(v.rating) > 0;
    if (v.isNewListing === true || (!hasRating && (tripsN === 0 || tripsN === null))) {
      put("isNewListing", true, v.isNewListing === true ? "json.isNewListing" : "json.inferred(no-rating)");
      put("ratingDisplay", "New listing", "json.inferred");
    } else if (hasRating) {
      const n = toNumber(v.rating);
      put("rating", n, "json.rating");
      put("isNewListing", false, "json.isNewListing");
      // match Turo's own presentation: "5.0", "4.75", "4.94"
      put("ratingDisplay", formatRating(n) + (tripsN !== null ? " (" + tripsN + ")" : ""), "json.rating");
    }

    put("hostId", v.hostId != null ? String(v.hostId) : null, "json.hostId");
    if (typeof v.isAllStarHost === "boolean") put("allStarHost", v.isAllStarHost, "json.isAllStarHost");

    // location
    const loc = v.location || {};
    put("city", loc.city ?? v.city ?? null, "json.location.city");
    put("region", loc.state ?? loc.region ?? null, "json.location.state");
    put("country", loc.country ?? null, "json.location.country");

    // image — note Turo's own misspelling "resizeableUrlTemplate"
    try {
      const img = (v.images && v.images[0]) || null;
      if (img) {
        // NOTE: Turo misspells this key as "resizeableUrlTemplate". Accept both.
        const tpl = img.resizeableUrlTemplate || img.resizableUrlTemplate || null;
        const sized = tpl ? tpl.replace("{width}", "720").replace("{height}", "480") : null;
        put("imageUrl", img.originalImageUrl || sized, "json.images[0]");
        if (sized) put("imageThumb", sized, "json.images[0].template");
      }
    } catch (_) {}

    // base daily rate from the DTO (NOT the card price)
    const adp = v.avgDailyPrice || v.averageDailyPrice || null;
    if (adp && toNumber(adp.amount) !== null) {
      put("dailyRateAmount", toNumber(adp.amount), "json.avgDailyPrice");
      put("currency", adp.currency || adp.currencyCode || null, "json.avgDailyPrice");
    }

    // ---- THE JOIN: prices live in a separate id-keyed map -------------------
    const p = id != null ? priceMap[String(id)] : null;
    if (p) {
      const pd = p.pricingDisplay || {};
      const displayRaw =
        (pd.carousel && pd.carousel.value) ||
        (pd.card && pd.card.priceAfterDiscount && pd.card.priceAfterDiscount.value) ||
        (pd.mapPin && pd.mapPin.value) || null;
      const parsed = parsePriceString(displayRaw);
      if (parsed) {
        put("priceDisplay", parsed.display, "json.pricingDisplay");
        put("priceAmount", parsed.amount, "json.pricingDisplay");
        put("priceUnit", parsed.unit, "json.pricingDisplay");
        if (!row.currency) put("currency", parsed.currency, "json.pricingDisplay");
        if (parsed.days) put("tripDays", parsed.days, "json.pricingDisplay");
      }
      if (p.priceDisplayType) put("priceBasis", p.priceDisplayType, "json.priceDisplayType");
      if (p.totalTripPrice && toNumber(p.totalTripPrice.amount) !== null) {
        put("tripTotalAmount", toNumber(p.totalTripPrice.amount), "json.totalTripPrice");
        // Turo writes currencyCode here and `currency` elsewhere. Accept both;
        // a currency-less amount in a sheet is a number nobody can act on.
        if (!row.currency)
          put("currency", p.totalTripPrice.currencyCode || p.totalTripPrice.currency,
              "json.totalTripPrice");
      }
      if (p.vehicleDailyPrice && toNumber(p.vehicleDailyPrice.amount) !== null && !row.dailyRateAmount)
        put("dailyRateAmount", toNumber(p.vehicleDailyPrice.amount), "json.vehicleDailyPrice");
      if (p.discountSavingsText)
        put("savings", collapseCurrency(p.discountSavingsText), "json.discountSavingsText");
    }

    // ---- FALLBACK: a price carried INSIDE the vehicle object ----------------
    // Turo's live shape keeps prices in the sibling id-keyed map joined above,
    // and that is authoritative — this never overwrites it. But if that map is
    // missing (a different build, a locale variant, or a future restructure)
    // the most likely alternative is a price nested on the record itself.
    // Without this the row still renders, with an EMPTY price column: a
    // silent, total loss of the one number the sheet exists to carry.
    if (!row.priceDisplay && row.priceAmount === undefined) {
      const PRICE_KEYS = ["price", "dailyPrice", "pricePerDay", "displayPrice",
                          "rate", "dailyRate", "cost", "avgDailyPrice"];
      for (let i = 0; i < PRICE_KEYS.length; i++) {
        const key = PRICE_KEYS[i];
        const raw = v[key];
        if (raw === null || raw === undefined) continue;

        let amount = null, currency = null, unit = null, display = null;

        if (typeof raw === "object") {
          amount = toNumber(raw.amount ?? raw.value ?? raw.price ?? null);
          currency = raw.currency ?? raw.currencyCode ?? null;
          // "MONTH" / "PER_DAY" / "daily" all reduce to our unit vocabulary
          const per = String(raw.period ?? raw.unit ?? raw.interval ?? "").toLowerCase();
          if (/month/.test(per)) unit = "month";
          else if (/week/.test(per)) unit = "week";
          else if (/day|daily|night/.test(per)) unit = "day";
          else if (/hour/.test(per)) unit = "hour";
          else if (/total|trip/.test(per)) unit = "total";
        } else if (typeof raw === "string") {
          const parsed = parsePriceString(raw);
          if (parsed) {
            amount = parsed.amount; currency = parsed.currency;
            unit = parsed.unit; display = parsed.display;
          }
        } else if (typeof raw === "number") {
          amount = raw;
        }

        if (amount === null) continue;

        // avgDailyPrice is a BASE RATE, not the price shown on the card. Record
        // it as such rather than passing it off as the displayed price.
        if (key === "avgDailyPrice") {
          if (!row.dailyRateAmount) put("dailyRateAmount", amount, "json.avgDailyPrice");
          if (!row.currency && currency) put("currency", currency, "json.avgDailyPrice");
          continue;
        }

        if (!unit) unit = key === "dailyPrice" || key === "pricePerDay" || key === "dailyRate"
          ? "day" : "unknown";

        // One display synthesiser for the whole extractor (see its definition):
        // "£1,359/month", never "£1359/month".
        if (!display) display = synthesizePriceDisplay(amount, currency, unit);
        put("priceDisplay", display, "json." + key);
        put("priceAmount", amount, "json." + key);
        put("priceUnit", unit, "json." + key);
        if (!row.currency && currency) put("currency", currency, "json." + key);
        break;
      }
    }

    if (section) put("section", section, "json.section");
    row.__tier = tier.name;
    row.__confidence = tier.confidence;
    row.__rank = tier.rank;
    row.__score = score;
    row.__prov = prov;
    return row;
  }

  /* =========================================================================
   * TIER 3 — data-testid / aria-label
   * ====================================================================== */

  const CARD_SELECTORS = [
    'a[data-testid="vehicle-card-link-box"]',   // verified on turo.com
    '[data-testid*="vehicle-card" i]',
    '[data-testid*="vehiclecard" i]',
    '[data-testid*="listing-card" i]',
    '[data-testid*="car-card" i]',
    '[itemtype*="Product" i]',
    '[itemtype*="Vehicle" i]'
  ];

  /** The <h2> (or any heading) that most recently precedes this card. */
  function sectionForElement(el) {
    try {
      let cur = el;
      for (let up = 0; cur && up < 12; up++) {
        let sib = cur.previousElementSibling;
        while (sib) {
          const h = sib.matches && sib.matches("h1,h2,h3")
            ? sib
            : (sib.querySelector ? sib.querySelector("h1,h2,h3") : null);
          if (h && cleanText(h)) {
            const title = cleanText(h);
            // a subtitle often sits directly under the heading
            let sub = null;
            const next = h.nextElementSibling;
            if (next) {
              const tx = cleanText(next);
              if (tx && tx.length < 120 && tx !== title && !/^\s*$/.test(tx) &&
                  /price|day|trip|average/i.test(tx)) sub = tx;
            }
            return { title, subtitle: sub };
          }
          sib = sib.previousElementSibling;
        }
        cur = cur.parentElement;
      }
    } catch (_) {}
    return { title: null, subtitle: null };
  }

  /**
   * Parse a card's TEXT rather than its structure — the US and GB builds lay
   * the same information out differently, so structure is not portable.
   */
  function parseCardText(text) {
    const out = {};
    const t = collapseCurrency(text.replace(/\s+/g, " ").trim());

    // "New listing" wins over any rating parse
    if (/\bnew listing\b/i.test(t)) { out.isNewListing = true; out.ratingDisplay = "New listing"; }

    // "5.0 (5)" | "4.75 (5)" | "5.0 (16 trips)"
    const r = t.match(/\b([0-5](?:\.\d{1,2})?)\s*\((\d[\d,]*)\s*(?:trips?|reviews?)?\)/i);
    if (r) {
      out.rating = parseFloat(r[1]);
      out.reviewCount = toNumber(r[2]);
      out.ratingDisplay = r[1] + " (" + r[2] + ")";
      out.isNewListing = false;
    }

    // year: prefer a standalone 4-digit token
    const y = t.match(/\b(19\d{2}|20[0-4]\d)\b/);
    if (y) out.year = parseInt(y[1], 10);

    // savings, then price. Remove the savings clause so it can't be read as price.
    const sv = stripSavings(t);
    if (sv.savings) out.savings = sv.savings;
    const priceZone = sv.rest;

    const priceRe = new RegExp(
      "([" + CURRENCY_CHARS + "]\\s*[\\d.,]+\\s*(?:\\/\\s*(?:day|d|month|mo|week|wk)\\b|\\s*total\\b|\\s*for\\s+\\d+\\s+days?\\b)?)", "i");
    const pm = priceZone.match(priceRe);
    if (pm) {
      const parsed = parsePriceString(pm[1]);
      if (parsed) {
        out.priceDisplay = parsed.display;
        out.priceAmount = parsed.amount;
        out.priceUnit = parsed.unit;
        out.currency = parsed.currency;
        if (parsed.days) out.tripDays = parsed.days;
      }
    }
    // a second, "total" figure alongside a per-day headline (£77/day + £232 total)
    const totals = priceZone.match(new RegExp("[" + CURRENCY_CHARS + "]\\s*[\\d.,]+\\s*total", "gi"));
    if (totals && totals.length) {
      const p2 = parsePriceString(totals[0]);
      if (p2) out.tripTotalAmount = p2.amount;
    }
    return out;
  }

  function rowFromCardElement(el, tier) {
    const prov = {};
    const row = {};
    const put = (k, v, src) => {
      if (v === null || v === undefined || v === "") return;
      row[k] = v; prov[k] = src;
    };

    // href — the richest single attribute on the card
    // Self, then descendant, then ANCESTOR: the heuristic tier can hand us an
    // inner wrapper whose href lives on a parent <a>.
    let a = null;
    try {
      if (el.matches && el.matches("a[href]")) a = el;
      else if (el.querySelector) a = el.querySelector("a[href]");
      if (!a && el.closest) a = el.closest("a[href]");
    } catch (_) { /* a hostile node must not kill the row */ }
    if (a) {
      const h = parseListingHref(a.getAttribute("href"));
      put("listingUrl", h.listingUrl, "dom.href");
      put("vehicleId", h.vehicleId, "dom.href");
      put("make", titleCase(h.makeSlug), "dom.href.slug");
      put("model", titleCase(h.modelSlug), "dom.href.slug");
      put("city", titleCase((h.citySlug || "").replace(/-[a-z]{2}$/, "")), "dom.href.slug");
      put("vehicleType", titleCase(h.vehicleTypeSlug), "dom.href.slug");
    }

    // img alt carries make+model+YEAR+city in one string
    const img = el.querySelector ? el.querySelector("img[alt]") : null;
    if (img) {
      const alt = parseImageAlt(img.getAttribute("alt"));
      put("name", alt.nameFromAlt, "dom.img[alt]");
      put("year", alt.year, "dom.img[alt]");
      put("city", alt.city, "dom.img[alt]");
      const src = img.getAttribute("src");
      // prefer the largest candidate from srcSet
      let best = src;
      try {
        const ss = img.getAttribute("srcset") || img.getAttribute("srcSet");
        if (ss) {
          const cands = ss.split(",").map((s) => s.trim().split(/\s+/))
            .map(([u, w]) => ({ u, w: parseInt(w, 10) || 0 }))
            .sort((x, y) => y.w - x.w);
          if (cands.length && cands[0].u) best = cands[0].u;
        }
      } catch (_) {}
      put("imageUrl", best, "dom.img[src]");
      put("imageThumb", best, "dom.img[src]");
    }

    // a scoped price node if the page exposes one
    let priceText = null;
    try {
      const pn = el.querySelector('[data-testid*="price" i]');
      if (pn) priceText = cleanText(pn);
    } catch (_) {}

    const parsed = parseCardText(cleanText(el));
    for (const [k, v] of Object.entries(parsed)) put(k, v, "dom.text");
    if (priceText) {
      const sv = stripSavings(priceText);
      if (sv.savings) put("savings", sv.savings, "dom.testid.price");
      const pp = parsePriceString(sv.rest);
      if (pp) { put("priceDisplay", pp.display, "dom.testid.price");
                put("priceAmount", pp.amount, "dom.testid.price");
                put("priceUnit", pp.unit, "dom.testid.price");
                put("currency", pp.currency, "dom.testid.price"); }
    }
    // star icon presence corroborates that a rating exists
    try {
      if (!row.rating && el.querySelector('[data-testid^="IconStar" i], [aria-label*="rating" i]')) {
        const m = cleanText(el).match(/\b([0-5](?:\.\d{1,2})?)\b/);
        if (m) put("rating", parseFloat(m[1]), "dom.star-icon");
      }
    } catch (_) {}

    const sec = sectionForElement(el);
    put("section", sec.title, "dom.h2");
    put("sectionSubtitle", sec.subtitle, "dom.h2+1");

    if (!row.name && (row.make || row.model))
      put("name", [row.make, row.model].filter(Boolean).join(" "), "dom.href.slug");

    row.__tier = tier.name;
    row.__confidence = tier.confidence;
    row.__rank = tier.rank;
    row.__prov = prov;
    return row;
  }

  /* =========================================================================
   * TIER 4 — HEURISTIC DOM: find the repeated card-shaped subtree
   * Used only when no testid and no JSON matched. We infer the card by
   * structural repetition, not by any class or id.
   * ====================================================================== */

  function heuristicCards() {
    const MONEY = new RegExp("[" + CURRENCY_CHARS + "]\\s*\\d");
    const candidates = [];
    const all = document.querySelectorAll("body *");
    // 1) every element that contains a price, an image and a link, and is small
    for (const el of all) {
      try {
        const txt = cleanText(el);
        if (txt.length > 400 || txt.length < 8) continue;
        if (!MONEY.test(txt)) continue;
        if (!el.querySelector("img")) continue;
        if (!(el.matches("a[href]") || el.querySelector("a[href]"))) continue;
        candidates.push(el);
      } catch (_) {}
    }
    if (!candidates.length) return [];

    // 2) Reduce each nesting chain to ONE element per card.
    //
    // BUG FOUND IN TESTING: this used to keep the SHALLOWEST element of each
    // chain, on the theory that the outermost match is the card root. It is
    // not — the grid that CONTAINS all the cards also holds prices, images and
    // links, and when the cards are few (or the locale terse) its combined text
    // still fits under the length cap. So the container matched, swallowed
    // every real card, and the tier returned ONE row for a page of five. On a
    // busy page the container overflows the cap and the bug hides, which is
    // exactly why it survived until a small fixture caught it.
    //
    // The correct reduction is the MINIMAL element: keep candidates that
    // contain no other candidate. That is one node per card.
    const minimal = candidates.filter((el) => !candidates.some((o) => o !== el && el.contains(o)));

    // Then promote each back up to its enclosing <a> when that anchor still
    // covers only this one card — the anchor carries the href, which is the
    // single richest attribute on a Turo card.
    const kept = [];
    const seen = new Set();
    for (const el of minimal) {
      let node = el;
      try {
        const anchor = el.closest ? el.closest("a[href]") : null;
        if (anchor && !minimal.some((o) => o !== el && anchor.contains(o))) node = anchor;
      } catch (_) { /* closest() is unavailable on some nodes; keep the original */ }
      if (!seen.has(node)) { seen.add(node); kept.push(node); }
    }
    const sig = (el) => {
      const kids = Array.from(el.children).map((c) => c.tagName).join(">");
      return el.tagName + "|" + el.children.length + "|" + kids;
    };
    const clusters = new Map();
    for (const el of kept) {
      const key = (el.parentElement ? sig(el.parentElement) : "?") + "::" + sig(el);
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(el);
    }
    // BUG FOUND IN TESTING: this used to keep only the SINGLE LARGEST cluster,
    // which silently discarded every other carousel on the page. A page has
    // several sections and they do not all share one markup shape, so a page
    // with a 3-card row and a 2-card row returned 3 and dropped 2 with no error.
    //
    // Keep EVERY repeated cluster instead. Repetition (>= 2) is what separates
    // a listing grid from a one-off promo tile, and that test works per cluster
    // — it never needed to be a competition between clusters.
    let best = [];
    for (const arr of clusters.values()) if (arr.length >= 2) best = best.concat(arr);

    if (!best.length) {
      // No convincing repetition anywhere: fall back to the loose candidates
      // and say so, because these are the least trustworthy rows we emit.
      best = kept;
      note("heuristic: no repeated cluster; using " + best.length + " loose candidates");
    } else {
      note("heuristic: " + best.length + " card-shaped subtrees across " +
           Array.from(clusters.values()).filter((a) => a.length >= 2).length + " repeated cluster(s)");
    }

    // Restore document order: clusters were collected per shape, so a merged
    // list would otherwise interleave sections in the sheet.
    best.sort((a, b) => {
      const rel = a.compareDocumentPosition(b);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return best.slice(0, 500);
  }

  /* =========================================================================
   * TIER 5 — MERGE with per-field provenance
   * Highest-rank tier wins a field, but a lower tier may FILL A GAP the higher
   * tier left empty. Every field records which tier actually supplied it.
   * ====================================================================== */

  /**
   * A STRONG identity: an id or a URL. Two rows carrying the same one are the
   * same listing, full stop.
   */
  function strongIdentity(row) {
    if (row.vehicleId) return "id:" + row.vehicleId;
    if (row.listingUrl) return "url:" + row.listingUrl;
    return null;
  }

  /**
   * A WEAK identity: what the listing says it is. Used only to link a row that
   * has no id to one that does.
   *
   * BUG FOUND IN TESTING: adding the JSON-LD tier introduced a double-count.
   * A page carrying BOTH flight data (id 3524295) and a schema.org block with
   * no `sku` produced two rows for one car — one keyed "id:3524295", one keyed
   * by content — and nothing linked them. A duplicated listing in a pricing
   * sheet is worse than a missing one: it is silently wrong and it survives a
   * sanity check on the row count.
   *
   * Deliberately requires a name AND one corroborating fact. A name alone is
   * far too weak: a fleet genuinely can hold two identical cars, and collapsing
   * those would be the same error in the other direction.
   */
  function weakIdentity(row) {
    const name = (row.name || "").trim().toLowerCase();
    if (!name) return null;
    const corroborated = row.year || row.priceAmount || row.city;
    if (!corroborated) return null;
    return "w:" + [name, row.year || "", row.priceAmount || "",
                   (row.city || "").toLowerCase()].join("|");
  }

  const DATA_FIELDS = [
    "name","make","model","year","vehicleType","rating","ratingDisplay","reviewCount",
    "isNewListing","priceDisplay","priceAmount","priceUnit","priceBasis","currency",
    "tripTotalAmount","tripDays","dailyRateAmount","savings","city","region","country",
    "section","sectionSubtitle","listingUrl","imageUrl","imageThumb","vehicleId","hostId",
    "completedTrips","allStarHost"
  ];

  function mergeRows(groups) {
    const byKey = new Map();
    const loose = [];

    // Pass 1: rows with a real id or URL. These are the anchors.
    const weakToStrong = new Map();
    for (const row of groups) {
      const k = strongIdentity(row);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(row);
      const w = weakIdentity(row);
      // If two DIFFERENT ids share a weak key they are genuinely distinct
      // listings that merely look alike; poison the entry so neither claims it.
      if (w) weakToStrong.set(w, weakToStrong.has(w) && weakToStrong.get(w) !== k
        ? null : k);
    }

    // Pass 2: rows with no id — fold them onto an anchor when the page's own
    // facts say they are the same listing, otherwise group them among themselves.
    for (const row of groups) {
      if (strongIdentity(row)) continue;
      const w = weakIdentity(row);
      if (!w) { loose.push(row); continue; }
      const anchor = weakToStrong.get(w);
      const k = anchor || w;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(row);
    }

    const out = [];
    for (const [, variants] of byKey) {
      variants.sort((a, b) => b.__rank - a.__rank);
      const base = variants[0];
      const merged = { __tiers: [], __prov: {} };
      for (const f of DATA_FIELDS) {
        for (const v of variants) {
          if (v[f] !== undefined && v[f] !== null && v[f] !== "") {
            merged[f] = v[f];
            merged.__prov[f] = (v.__prov && v.__prov[f]) || v.__tier;
            break;                                    // first = highest rank
          }
        }
      }
      // Turo serves .heic originals, which Chrome cannot render in the popup.
      // For the PREVIEW ONLY, prefer any variant that is not .heic.
      const renderable = variants.map((v) => v.imageThumb || v.imageUrl)
        .find((u) => u && !/\.heic(\?|$)/i.test(u));
      if (renderable) merged.imageThumb = renderable;

      merged.__tier = base.__tier;
      merged.__confidence = base.__confidence;
      merged.__rank = base.__rank;
      merged.__tiers = [...new Set(variants.map((v) => v.__tier))];
      merged.__filledFromLowerTier =
        Object.values(merged.__prov).some((p) => p && !String(p).startsWith(base.__tier.split("-")[0]));
      out.push(merged);
    }
    for (const r of loose) { r.__tiers = [r.__tier]; out.push(r); }
    return out;
  }

  /* =========================================================================
   * ORCHESTRATION
   * ====================================================================== */

  const result = {
    ok: true, rows: [], diagnostics: diag,
    page: { url: location.href, title: document.title, host: location.host, path: location.pathname },
    extractedAt: new Date().toISOString(),
    refused: false
  };

  // --- robots.txt posture: refuse the disallowed areas outright -------------
  if (PATH_DENYLIST.some((re) => re.test(location.pathname))) {
    result.refused = true;
    result.ok = false;
    result.message =
      "Refused. " + location.pathname + " is a path Turo disallows in robots.txt " +
      "(/search, /drivers/, /{locale}/p/*). This tool only reads public browse pages " +
      "such as turo.com/gb/en. Nothing was read from this page.";
    return result;
  }

  // ---- page fingerprint, so the diagnostics are useful even on total failure
  safely("fingerprint", () => {
    const scripts = document.querySelectorAll("script");
    diag.page = {
      scriptCount: scripts.length,
      hasNextData: !!document.getElementById("__NEXT_DATA__"),
      hasNextFlight: (typeof self.__next_f !== "undefined") ||
                     Array.from(document.querySelectorAll("script"))
                       .some((x) => x.textContent && x.textContent.indexOf("__next_f") !== -1),
      hasNextStatic: !!document.querySelector('script[src*="/_next/static"]'),
      ldJsonTags: document.querySelectorAll('script[type="application/ld+json"]').length,
      dataTestIdCount: document.querySelectorAll("[data-testid]").length,
      vehicleCardTestIds: document.querySelectorAll('a[data-testid="vehicle-card-link-box"]').length,
      microdataCount: document.querySelectorAll("[itemtype]").length,
      imgCount: document.images.length,
      knownGlobals: ["__NEXT_DATA__","__APOLLO_STATE__","__INITIAL_STATE__","__REDUX_STATE__","__next_f","__next_s"]
        .filter((k) => { try { return typeof self[k] !== "undefined"; } catch (_) { return false; } })
    };
    return 1;
  }, null);

  // ---- TIER 1 + 2 ---------------------------------------------------------
  const jsonRows = safely("json-state+deep", () => {
    const rows = [];
    const flight = collectFlightText();
    diag.page.flightChars = flight.length;

    const priceMap = flight ? harvestPriceMap(flight) : {};

    const blobs = collectStateBlobs();
    if (flight) for (const isl of harvestIslands(flight)) blobs.push({ where: "flight", value: isl });
    diag.page.stateBlobs = blobs.reduce((a, b) => { a[b.where] = (a[b.where] || 0) + 1; return a; }, {});

    // The id-keyed quote map does NOT only live in the flight text. Scan every
    // parsed blob too, or a page that ships its quotes in __NEXT_DATA__ /
    // __APOLLO_STATE__ / an inline JSON script exports an empty price column.
    // This runs BEFORE any row is built, because the join needs the whole map.
    for (const blob of blobs) {
      try { harvestPriceMapFromObject(blob.value, priceMap); }
      catch (e) { fail("pricemap:" + blob.where, e); }
    }
    diag.page.priceMapEntries = Object.keys(priceMap).length;

    for (const blob of blobs) {
      // JSON-LD first: schema.org is declared, typed data. Letting the generic
      // shape-scorer see it first would score it ~22/100 and throw it away.
      try {
        for (const r of rowsFromJsonLd(blob.value)) {
          if (r.name || r.make || r.model || r.vehicleId) rows.push(r);
        }
      } catch (e) { fail("ld:" + blob.where, e); }

      let groups = [];
      try { groups = deepFindVehicleArrays(blob.value); } catch (e) { fail("deep:" + blob.where, e); }
      for (const g of groups) {
        const tier = blob.where === "flight" || blob.where === "script(embedded)"
          ? TIER.JSON_STATE : TIER.JSON_DEEP;
        for (const item of g.items) {
          try {
            const r = rowFromJsonVehicle(item, priceMap, g.section, tier, g.score);
            if (r.name || r.make || r.model || r.vehicleId) rows.push(r);
          } catch (e) { fail("row:" + blob.where, e); }
        }
      }
    }
    if (rows.length) note("json tiers produced " + rows.length + " rows");
    return rows;
  }, []);

  // ---- TIER 3 -------------------------------------------------------------
  const testIdRows = safely("data-testid", () => {
    const rows = [];
    const seen = new Set();
    for (const sel of CARD_SELECTORS) {
      let els = [];
      try { els = document.querySelectorAll(sel); } catch (_) { continue; }
      for (const el of els) {
        if (seen.has(el)) continue;
        seen.add(el);
        try { rows.push(rowFromCardElement(el, TIER.TESTID)); } catch (e) { fail("testid-row", e); }
      }
      if (rows.length) { note('data-testid matched via "' + sel + '" (' + rows.length + " cards)"); break; }
    }
    return rows;
  }, []);

  // ---- TIER 4 (only if the better tiers found nothing) --------------------
  const heurRows = safely("heuristic", () => {
    if (jsonRows.length || testIdRows.length) { note("heuristic skipped — higher tier succeeded"); return []; }
    return heuristicCards()
      .map((el) => { try { return rowFromCardElement(el, TIER.HEURISTIC_DOM); } catch (_) { return null; } })
      .filter((r) => r && (r.priceAmount || r.name));
  }, []);

  // ---- TIER 5 -------------------------------------------------------------
  result.rows = safely("merge", () => mergeRows([...jsonRows, ...testIdRows, ...heurRows]),
                       [...jsonRows, ...testIdRows, ...heurRows]);

  // ---- honest reporting when we come up empty -----------------------------
  if (!result.rows.length) {
    result.ok = false;
    result.message =
      "No listings found on this page. Looked for, in order: Next.js App Router flight " +
      "data (self.__next_f), script#__NEXT_DATA__, window.__APOLLO_STATE__ / " +
      "__INITIAL_STATE__ / __REDUX_STATE__, JSON-LD (incl. via self.__next_s), any " +
      "<script> containing vehicle-shaped JSON, data-testid card hooks, [itemtype] " +
      "microdata, and finally repeated card-shaped DOM subtrees. " +
      "This page reported: " + JSON.stringify(diag.page);
  } else {
    result.message = "Extracted " + result.rows.length + " listing" +
      (result.rows.length === 1 ? "" : "s") + ".";
  }

  result.summary = {
    total: result.rows.length,
    byTier: result.rows.reduce((a, r) => { a[r.__tier] = (a[r.__tier] || 0) + 1; return a; }, {}),
    sections: [...new Set(result.rows.map((r) => r.section).filter(Boolean))]
  };
  return result;
};
