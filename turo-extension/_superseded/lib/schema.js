/**
 * schema.js — the row shape, and every parser that produces it.
 *
 * ============================ LEGAL POSITION ============================
 * This file, and this extension, read the DOCUMENT THE USER ALREADY OPENED
 * in their own browser, on Turo's public homepage. That is a fundamentally
 * different act from crawling the site:
 *
 *   - There is no fetch(), no XMLHttpRequest, no WebSocket and no
 *     navigation ANYWHERE in this codebase. Grep for it. The extension is
 *     incapable of requesting a URL.
 *   - It therefore never touches /search, /drivers/ or /{locale}/p/*, the
 *     paths Turo's robots.txt disallows. robots.txt governs automated
 *     retrieval; we perform none.
 *   - The manifest declares NO host_permissions. It has "activeTab", which
 *     Chrome grants only for the tab the user was looking at, only after
 *     the user clicks the extension button. It cannot read a page in the
 *     background, cannot read other tabs, and cannot act without a click.
 *
 * If you are extending this: adding a fetch() would change the legal
 * character of the tool. Don't. Read what is on screen; nothing else.
 * =======================================================================
 *
 * WHY THIS FILE IS SO DEFENSIVE
 * turo.com answers HTTP 403 (Cloudflare WAF) to every automated request, so
 * nobody building this has ever seen the real DOM or the real JSON. Every
 * selector and every key name below is a HYPOTHESIS. Consequently:
 *   - no parser may throw; a bad parse yields null plus a warning
 *   - null and 0 are never conflated (see parseRating)
 *   - the raw string is preserved next to every parsed value, so a human can
 *     always audit what we did to it.
 */
(function () {
  "use strict";

  var NS = (globalThis.__turoScrape = globalThis.__turoScrape || {});

  // ------------------------------------------------------------------ ROW
  /**
   * THE ROW SHAPE.
   *
   * Column order here is the column order in the popup table and in the CSV.
   * `type` documents intent; `absent` documents what happens when we cannot
   * find the field, which is the question that actually matters here.
   */
  var COLUMNS = [
    // --- identity -----------------------------------------------------
    { key: "row_index",        label: "#",              type: "int",    absent: "never — assigned by us" },
    { key: "listing_id",       label: "Listing ID",     type: "text",   absent: "null — we do NOT invent one", forceTextInExcel: true },

    // --- vehicle ------------------------------------------------------
    { key: "vehicle_raw",      label: "Vehicle (raw)",  type: "text",   absent: "null — a row with no vehicle string is dropped as noise" },
    { key: "make",             label: "Make",           type: "text",   absent: "null — best-effort split only" },
    { key: "model",            label: "Model",          type: "text",   absent: "null — best-effort split only" },
    { key: "year",             label: "Year",           type: "int",    absent: "null — never guessed from context" },

    // --- rating -------------------------------------------------------
    { key: "rating",           label: "Rating",         type: "number", absent: "null, NEVER 0 — 0 is a real, terrible rating" },
    { key: "reviews_count",    label: "Reviews",        type: "int",    absent: "null, NEVER 0 — 0 reviews is a real value" },
    { key: "is_new_listing",   label: "New listing",    type: "bool",   absent: "false only when we positively saw a rating; see below" },

    // --- price --------------------------------------------------------
    { key: "price_amount",     label: "Price",          type: "number", absent: "null" },
    { key: "price_currency",   label: "Currency",       type: "text",   absent: "null when the symbol is unmappable" },
    { key: "price_period",     label: "Per",            type: "text",   absent: "null — we do not default to 'day'" },
    { key: "price_raw",        label: "Price (raw)",    type: "text",   absent: "null" },
    { key: "total_amount",     label: "Total",          type: "number", absent: "null — many cards have no total" },
    { key: "total_raw",        label: "Total (raw)",    type: "text",   absent: "null" },

    // --- section (carries the city and the rental type) ----------------
    { key: "section_title",    label: "Section",        type: "text",   absent: "null" },
    { key: "section_subtitle", label: "Section note",   type: "text",   absent: "null — only some sections have one" },
    { key: "section_location", label: "Location",       type: "text",   absent: "null — derived from the section title" },
    { key: "section_category", label: "Rental type",    type: "text",   absent: "null — derived; monthly/weekly/daily/etc" },

    // --- links --------------------------------------------------------
    { key: "listing_url",      label: "Listing URL",    type: "url",    absent: "null" },
    { key: "image_url",        label: "Image URL",      type: "url",    absent: "null" },

    // --- provenance: per-row, because tiers can differ per row ---------
    { key: "extraction_tier",  label: "Tier",           type: "text",   absent: "never" },
    { key: "extraction_source",label: "Source",         type: "text",   absent: "never" },
    { key: "section_source",   label: "Section from",   type: "text",   absent: "null — section is the one field we allow to come from another tier" },
    { key: "confidence",       label: "Confidence",     type: "number", absent: "never" },
    { key: "confidence_band",  label: "Band",           type: "text",   absent: "never" },
    { key: "fields_missing",   label: "Missing fields", type: "text",   absent: "empty string when the row is complete" }
  ];

  function emptyRow() {
    var r = {};
    for (var i = 0; i < COLUMNS.length; i++) r[COLUMNS[i].key] = null;
    r.is_new_listing = false;
    r.fields_missing = "";
    return r;
  }

  // -------------------------------------------------------- tiny helpers

  /** Collapse NBSP/narrow-NBSP/newlines. Turo's prices are full of U+00A0. */
  function clean(s) {
    if (s === null || s === undefined) return null;
    var t = String(s)
      .replace(/[   ]/g, " ")   // nbsp family -> plain space
      .replace(/[–—]/g, "-")          // en/em dash -> hyphen
      .replace(/\s+/g, " ")
      .trim();
    return t === "" ? null : t;
  }

  function isFiniteNum(n) { return typeof n === "number" && isFinite(n); }

  // -------------------------------------------------------------- PRICE
  /**
   * Currency symbols we can map to ISO. Deliberately NOT just "£": the same
   * page shipped to a different locale will use $, EUR, and different digit
   * separators, and this parser is expected to survive that.
   *
   * "$" alone is ambiguous (USD/CAD/AUD/NZD/SGD/MXN...). We map bare "$" to
   * USD but keep the raw symbol in price_raw so the ambiguity stays visible
   * rather than being silently resolved.
   */
  var CURRENCY_SYMBOLS = [
    ["R$", "BRL"], ["C$", "CAD"], ["A$", "AUD"], ["NZ$", "NZD"], ["HK$", "HKD"],
    ["S$", "SGD"], ["NT$", "TWD"], ["US$", "USD"], ["CHF", "CHF"], ["kr", "SEK"],
    ["zl", "PLN"], ["Kc", "CZK"],
    ["£", "GBP"], ["€", "EUR"], ["¥", "JPY"], ["₹", "INR"],
    ["₩", "KRW"], ["₽", "RUB"], ["₺", "TRY"], ["₪", "ILS"],
    ["₦", "NGN"], ["฿", "THB"], ["₴", "UAH"], ["₿", "BTC"],
    ["$", "USD"]
  ];

  var PERIOD_PATTERNS = [
    [/\bper\s*day\b|\/\s*day\b|\bdaily\b|\ba\s*day\b|\bday\b(?!\s*trip)|\/\s*night\b|\bper\s*night\b/i, "day"],
    [/\bper\s*month\b|\/\s*month\b|\bmonthly\b|\ba\s*month\b|\bmo\b/i,                                   "month"],
    [/\bper\s*week\b|\/\s*week\b|\bweekly\b|\ba\s*week\b|\bwk\b/i,                                       "week"],
    [/\bper\s*hour\b|\/\s*hour\b|\bhourly\b|\/\s*hr\b/i,                                                 "hour"],
    [/\btotal\b|\ball-?in\b|\btrip\s*total\b/i,                                                          "total"]
  ];

  /**
   * Locale-agnostic numeric parse. This is the fiddly one, so the rules are
   * spelled out:
   *
   *   spaces / NBSP / apostrophes  -> ALWAYS group separators (fr, ch)
   *   both "." and "," present     -> the LAST one is the decimal point
   *   only one, appearing twice+   -> it is a group separator ("1.234.567")
   *   only one, appearing once     -> 3 digits after  => group  ("1,359" = 1359,
   *                                                              "1.359" = 1359)
   *                                   1-2 digits after => decimal ("77,50" = 77.5,
   *                                                                "1.5"   = 1.5)
   *
   * That last rule is the whole trick: it is locale-agnostic and it is correct
   * for en-GB "1,359", de-DE "1.359", de-DE "77,50" and en-GB "1.5" alike,
   * because money is not quoted to three decimal places.
   */
  function parseAmount(token) {
    if (token === null || token === undefined) return null;
    var t = String(token).replace(/[\s   '’]/g, "");
    if (!/\d/.test(t)) return null;
    t = t.replace(/[^\d.,-]/g, "");
    if (t === "") return null;

    var neg = /^-/.test(t);
    t = t.replace(/-/g, "");

    var dots = (t.match(/\./g) || []).length;
    var commas = (t.match(/,/g) || []).length;

    if (dots && commas) {
      var decSep = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
      var grpSep = decSep === "." ? "," : ".";
      t = t.split(grpSep).join("");
      t = t.replace(decSep, ".");
    } else if (dots || commas) {
      var sep = dots ? "." : ",";
      var count = dots || commas;
      if (count > 1) {
        t = t.split(sep).join("");                       // 1.234.567 -> grouping
      } else {
        var after = t.length - t.indexOf(sep) - 1;
        if (after === 3) t = t.split(sep).join("");      // 1,359 -> 1359
        else if (after >= 1 && after <= 2) t = t.replace(sep, ".");
        else t = t.split(sep).join("");                  // 0 or 4+ digits: junk sep
      }
    }

    var n = Number(t);
    if (!isFiniteNum(n)) return null;
    if (n < 0 || n > 100000000) return null;             // sanity fence
    return neg ? -n : n;
  }

  function detectCurrency(str) {
    var s = String(str || "");
    // Explicit ISO code wins over a symbol ("EUR 1.359").
    var iso = s.match(/\b(GBP|USD|EUR|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|CZK|JPY|INR|MXN|BRL|ZAR|AED|SGD|HKD)\b/i);
    if (iso) return { code: iso[1].toUpperCase(), symbol: iso[1].toUpperCase() };
    for (var i = 0; i < CURRENCY_SYMBOLS.length; i++) {
      if (s.indexOf(CURRENCY_SYMBOLS[i][0]) !== -1) {
        return { code: CURRENCY_SYMBOLS[i][1], symbol: CURRENCY_SYMBOLS[i][0] };
      }
    }
    return { code: null, symbol: null };
  }

  function detectPeriod(str) {
    var s = String(str || "");
    for (var i = 0; i < PERIOD_PATTERNS.length; i++) {
      if (PERIOD_PATTERNS[i][0].test(s)) return PERIOD_PATTERNS[i][1];
    }
    return null;
  }

  /**
   * Parse ONE price mention: "£77/day", "£1,359/month", "$232 total".
   * Returns null when there is no number at all.
   */
  function parsePrice(raw) {
    var s = clean(raw);
    if (!s) return null;
    var numTok = s.match(/\d[\d.,\s  '’]*\d|\d/);
    if (!numTok) return null;
    var amount = parseAmount(numTok[0]);
    if (amount === null) return null;
    var cur = detectCurrency(s);
    return {
      amount: amount,
      currency: cur.code,
      currency_symbol: cur.symbol,
      period: detectPeriod(s),
      raw: s
    };
  }

  /**
   * A card usually shows TWO prices: a rate ("£77/day") and a trip total
   * ("£232 total"). Split the card's price text into mentions and classify.
   *
   * A mention with a per-period wins the `price` slot; one reading "total"
   * fills `total`. If neither declares itself, the FIRST is treated as the
   * rate (that is the visual hierarchy on every rental card ever built) and
   * the warning records that we guessed.
   */
  function parsePriceGroup(raw) {
    var out = { price: null, total: null, warnings: [] };
    var s = clean(raw);
    if (!s) return out;

    // Split on boundaries between money mentions without eating the symbols.
    var parts = s.split(/(?:\s{2,}|\s*[·•|]\s*|,\s(?=[^\d]))/)
                 .map(clean).filter(Boolean);
    if (parts.length < 2) {
      // One string that may still hold two mentions: "£77/day £232 total"
      var multi = s.match(/(?:[^\d]{0,4})\d[\d.,\s]*(?:\/\s*\w+|\s*\w+)?/g);
      if (multi && multi.length > 1) parts = multi.map(clean).filter(Boolean);
    }

    var mentions = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parsePrice(parts[i]);
      if (p) mentions.push(p);
    }
    if (!mentions.length) {
      var single = parsePrice(s);
      if (single) mentions.push(single);
    }

    for (var j = 0; j < mentions.length; j++) {
      var m = mentions[j];
      if (m.period === "total") { if (!out.total) out.total = m; }
      else if (m.period)        { if (!out.price) out.price = m; }
    }
    // Nothing declared a period: fall back to positional reading.
    if (!out.price) {
      for (var k = 0; k < mentions.length; k++) {
        if (mentions[k] !== out.total) {
          out.price = mentions[k];
          out.warnings.push("price period not stated on the card; took the first amount as the rate");
          break;
        }
      }
    }
    if (!out.total && mentions.length > 1) {
      for (var q = 0; q < mentions.length; q++) {
        if (mentions[q] !== out.price) { out.total = mentions[q]; break; }
      }
    }
    return out;
  }

  // ------------------------------------------------------------- RATING
  var NEW_LISTING_RE = /\bnew\s+listing\b|\bnewly\s+listed\b|\bnouvelle\s+annonce\b|\bnuevo\s+anuncio\b|\bneu\b/i;

  /**
   * "5.0 (5)" -> 5.0 / 5.    "4.75 (5)" -> 4.75 / 5.
   * "New listing" -> rating null, reviews null, is_new true.
   *
   * The null-vs-zero rule is load-bearing and is the reason this returns an
   * explicit `is_new` flag rather than zeros: a 0.0 rating and an unrated new
   * car are opposite facts, and an operator pricing against this data must
   * never see them collapsed. `is_new` is true ONLY when we positively saw a
   * new-listing marker — "we found no rating" leaves is_new false and rating
   * null, which is a third, honestly-different state.
   */
  function parseRating(raw) {
    var out = { rating: null, reviews: null, is_new: false, raw: null, warnings: [] };
    var s = clean(raw);
    if (!s) return out;
    out.raw = s;

    if (NEW_LISTING_RE.test(s) && !/\d/.test(s)) {
      out.is_new = true;
      return out;
    }

    // rating: a 0-5 decimal, optionally followed by /5 or a star
    var rm = s.match(/(\d(?:[.,]\d{1,2})?)\s*(?:★|☆|\/\s*5|out of 5)?/);
    if (rm) {
      var r = parseAmount(rm[1]);
      if (r !== null && r >= 0 && r <= 5) out.rating = r;
      else if (r !== null) out.warnings.push("ignored an out-of-range rating value: " + rm[1]);
    }

    // reviews: an integer in parens, or after a dot/bullet separator, or
    // followed by the words review/trip/rating
    var vm = s.match(/\(\s*(\d[\d.,\s]*)\s*\)/)
          || s.match(/[·•]\s*(\d[\d.,\s]*)\s*(?:reviews?|trips?|ratings?)?/i)
          || s.match(/(\d[\d.,\s]*)\s*(?:reviews?|trips?|ratings?)\b/i);
    if (vm) {
      var v = parseAmount(vm[1]);
      if (v !== null && v >= 0 && Math.floor(v) === v) out.reviews = v;
    }

    if (out.rating === null && out.reviews === null && NEW_LISTING_RE.test(s)) out.is_new = true;
    return out;
  }

  // --------------------------------------------------------------- YEAR
  var YEAR_MIN = 1900;
  var YEAR_MAX = new Date().getFullYear() + 2;   // pre-registered next-year models

  /**
   * A 4-digit 19xx/20xx, validated. Refuses years that are actually part of a
   * price ("£2,019/month") by rejecting a match glued to a currency symbol
   * or a separator, which is the realistic false positive on these cards.
   */
  function parseYear(raw) {
    var s = clean(raw);
    if (!s) return null;
    var re = /(^|[^\d.,£$€¥₹])((?:19|20)\d{2})(?![\d.,])/g;
    var m, best = null;
    while ((m = re.exec(s)) !== null) {
      var y = parseInt(m[2], 10);
      if (y >= YEAR_MIN && y <= YEAR_MAX) { best = y; break; }
    }
    return best;
  }

  // ------------------------------------------------------- VEHICLE NAME
  /**
   * Multi-word makes, longest first. Without this, "Land Rover Defender"
   * naively splits to make "Land" / model "Rover Defender".
   * "Mercedes-Benz" needs no entry (it is one whitespace-token) but is listed
   * for the reader's benefit.
   */
  var MULTI_WORD_MAKES = [
    "Mercedes-AMG", "Mercedes-Benz", "Aston Martin", "Alfa Romeo", "Land Rover",
    "Range Rover", "Rolls-Royce", "Great Wall", "MG Motor", "Morgan Motor",
    "General Motors", "Lynk & Co", "DS Automobiles"
  ].sort(function (a, b) { return b.length - a.length; });

  /**
   * ALWAYS keeps the raw string. make/model are best-effort and optional; a
   * wrong split must never destroy the only trustworthy value on the row.
   */
  function parseVehicleName(raw) {
    var out = { raw: null, make: null, model: null, year: null };
    var s = clean(raw);
    if (!s) return out;

    // A year embedded in the name ("2023 Tesla Model Y") belongs in `year`.
    var y = parseYear(s);
    if (y !== null) {
      out.year = y;
      s = clean(s.replace(new RegExp("(^|\\s)" + y + "(\\s|$)"), " "));
      if (!s) { out.raw = clean(raw); return out; }
    }
    out.raw = s;

    for (var i = 0; i < MULTI_WORD_MAKES.length; i++) {
      var mk = MULTI_WORD_MAKES[i];
      if (s.toLowerCase().indexOf(mk.toLowerCase()) === 0) {
        out.make = s.slice(0, mk.length);
        out.model = clean(s.slice(mk.length)) || null;
        return out;
      }
    }

    var sp = s.indexOf(" ");
    if (sp === -1) { out.make = s; out.model = null; return out; }
    out.make = s.slice(0, sp);
    out.model = clean(s.slice(sp + 1)) || null;
    return out;
  }

  /** Does this string plausibly name a car? Used to score JSON candidates. */
  function looksLikeVehicleName(s) {
    var t = clean(s);
    if (!t) return false;
    if (t.length < 3 || t.length > 60) return false;
    if (!/[A-Za-z]/.test(t)) return false;
    if (/^(https?:|\/|www\.)/i.test(t)) return false;
    if (/\b(sign in|log in|menu|search|about|help|privacy|cookie|terms)\b/i.test(t)) return false;
    return true;
  }

  // ------------------------------------------------------------ SECTION
  var SECTION_CATEGORIES = [
    [/\bmonthly\b|\bper month\b/i, "monthly"],
    [/\bweekly\b/i,               "weekly"],
    [/\bdaily\b/i,                "daily"],
    [/\bairport\b/i,              "airport"],
    [/\bluxury\b|\bpremium\b/i,   "luxury"],
    [/\bdeliver/i,                "delivery"],
    [/\belectric\b|\bEV\b/,       "electric"]
  ];

  /**
   * "Monthly luxury car rentals in Oxford" -> location "Oxford", category
   * "monthly". "Car rentals at King's Cross" -> location "King's Cross".
   * The section heading is real signal: it is where the city and the rental
   * type come from, and neither appears anywhere else on a card.
   */
  function parseSection(title, subtitle) {
    var out = {
      title: clean(title),
      subtitle: clean(subtitle),
      location: null,
      category: null
    };
    if (!out.title) return out;

    var loc = out.title.match(/\b(?:in|at|near|around)\s+(.+)$/i);
    if (loc) {
      var l = clean(loc[1]);
      if (l) out.location = l.replace(/[.,;:!?]+$/, "");
    }
    for (var i = 0; i < SECTION_CATEGORIES.length; i++) {
      if (SECTION_CATEGORIES[i][0].test(out.title)) { out.category = SECTION_CATEGORIES[i][1]; break; }
    }
    return out;
  }

  // --------------------------------------------------------------- URLS
  /** Absolute-ise against the page. Returns null rather than throwing. */
  function absoluteUrl(u, base) {
    var s = clean(u);
    if (!s) return null;
    try { return new URL(s, base || location.href).href; } catch (e) { return null; }
  }

  /**
   * Best-effort listing id from a URL. Turo listing paths end in a numeric id.
   * Unknown shape -> null. We do NOT fabricate an id, because a wrong id
   * silently corrupts every join the operator later makes on this sheet.
   */
  function listingIdFromUrl(u) {
    var s = clean(u);
    if (!s) return null;
    var path;
    try { path = new URL(s, location.href).pathname; } catch (e) { path = s; }
    var segs = path.split("/").filter(Boolean);
    for (var i = segs.length - 1; i >= 0; i--) {
      if (/^\d{4,}$/.test(segs[i])) return segs[i];
    }
    var q = s.match(/[?&](?:vehicleId|listingId|id)=(\d{4,})/i);
    return q ? q[1] : null;
  }

  /** Page locale: "/gb/en" -> {country:"gb", lang:"en"}; falls back to <html lang>. */
  function parseLocale(href, htmlLang) {
    var out = { locale: null, country: null, language: null };
    try {
      var p = new URL(href).pathname.split("/").filter(Boolean);
      if (p.length >= 2 && /^[a-z]{2}$/i.test(p[0]) && /^[a-z]{2}$/i.test(p[1])) {
        out.country = p[0].toLowerCase();
        out.language = p[1].toLowerCase();
        out.locale = out.language + "-" + out.country.toUpperCase();
      }
    } catch (e) { /* fall through */ }
    if (!out.locale && htmlLang) {
      out.locale = clean(htmlLang);
      var bits = String(htmlLang).split("-");
      out.language = bits[0] ? bits[0].toLowerCase() : null;
      out.country = bits[1] ? bits[1].toLowerCase() : null;
    }
    return out;
  }

  // --------------------------------------------------------- CONFIDENCE
  /** Base confidence per source. JSON we were handed beats text we inferred. */
  var SOURCE_CONFIDENCE = {
    "ld+json":          0.95,
    "__NEXT_DATA__":    0.92,
    "__APOLLO_STATE__": 0.90,
    "__INITIAL_STATE__":0.88,
    "__next_f":         0.80,
    "inline-script":    0.78,
    "microdata":        0.70,
    "data-testid":      0.65,
    "aria-label":       0.60,
    "heuristic-dom":    0.40
  };

  /** Fields whose absence should actually cost confidence. */
  var CRITICAL = ["vehicle_raw", "price_amount", "year", "listing_url"];

  function scoreRow(row) {
    var base = SOURCE_CONFIDENCE[row.extraction_source];
    if (base === undefined) base = 0.35;
    var missing = [];
    for (var i = 0; i < CRITICAL.length; i++) {
      if (row[CRITICAL[i]] === null || row[CRITICAL[i]] === undefined || row[CRITICAL[i]] === "") {
        missing.push(CRITICAL[i]);
      }
    }
    // Ratings are legitimately absent on a new listing; only penalise when we
    // have no explanation for the absence.
    if (row.rating === null && !row.is_new_listing) missing.push("rating");

    var conf = base - (0.06 * missing.length);
    if (conf < 0.1) conf = 0.1;
    conf = Math.round(conf * 100) / 100;

    row.confidence = conf;
    row.confidence_band = conf >= 0.8 ? "high" : (conf >= 0.55 ? "medium" : "low");
    row.fields_missing = missing.join(" ");
    return row;
  }

  // ------------------------------------------------------- ROW ASSEMBLY
  /**
   * Turn a loose bag of extracted strings/values into a validated row.
   * Every tier funnels through here, so normalisation is identical no matter
   * which strategy won — that is the point.
   */
  function buildRow(bag, ctx) {
    var row = emptyRow();
    var warnings = [];

    var v = parseVehicleName(bag.vehicle_raw);
    row.vehicle_raw = v.raw;
    row.make = bag.make ? clean(bag.make) : v.make;
    row.model = bag.model ? clean(bag.model) : v.model;

    var year = (bag.year !== null && bag.year !== undefined) ? parseYear(String(bag.year)) : null;
    row.year = year !== null ? year : v.year;

    // rating: prefer explicit numeric fields (JSON tiers), else parse the text
    if (isFiniteNum(bag.rating) && bag.rating >= 0 && bag.rating <= 5) {
      row.rating = bag.rating;
    }
    if (isFiniteNum(bag.reviews_count) && bag.reviews_count >= 0) {
      row.reviews_count = Math.floor(bag.reviews_count);
    }
    if (row.rating === null || row.reviews_count === null) {
      var rt = parseRating(bag.rating_raw);
      if (row.rating === null) row.rating = rt.rating;
      if (row.reviews_count === null) row.reviews_count = rt.reviews;
      if (rt.is_new) row.is_new_listing = true;
      warnings = warnings.concat(rt.warnings);
    }
    if (bag.is_new_listing === true) row.is_new_listing = true;
    // A rating and "new listing" cannot both be true; trust the number.
    if (row.rating !== null) row.is_new_listing = false;

    // price
    if (isFiniteNum(bag.price_amount)) {
      row.price_amount = bag.price_amount;
      row.price_currency = bag.price_currency ? String(bag.price_currency).toUpperCase() : null;
      row.price_period = bag.price_period || null;
      row.price_raw = clean(bag.price_raw);
    } else {
      var pg = parsePriceGroup(bag.price_raw);
      warnings = warnings.concat(pg.warnings);
      if (pg.price) {
        row.price_amount = pg.price.amount;
        row.price_currency = pg.price.currency;
        row.price_period = pg.price.period;
        row.price_raw = pg.price.raw;
      }
      if (pg.total) { row.total_amount = pg.total.amount; row.total_raw = pg.total.raw; }
    }
    if (row.total_amount === null && isFiniteNum(bag.total_amount)) {
      row.total_amount = bag.total_amount;
      row.total_raw = clean(bag.total_raw);
    }
    if (row.price_currency === null && ctx && ctx.currencyHint) row.price_currency = ctx.currencyHint;

    // section
    var sec = parseSection(bag.section_title, bag.section_subtitle);
    row.section_title = sec.title;
    row.section_subtitle = sec.subtitle;
    row.section_location = sec.location;
    row.section_category = sec.category;
    row.section_source = bag.section_source || null;

    // links
    row.listing_url = absoluteUrl(bag.listing_url, ctx && ctx.baseUrl);
    row.image_url = absoluteUrl(bag.image_url, ctx && ctx.baseUrl);
    row.listing_id = bag.listing_id ? String(bag.listing_id) : listingIdFromUrl(row.listing_url);

    row.extraction_tier = bag.extraction_tier || null;
    row.extraction_source = bag.extraction_source || null;

    scoreRow(row);
    row.__warnings = warnings;
    return row;
  }

  /** A row with no vehicle string is noise, not data. */
  function isUsableRow(row) {
    return !!row && !!row.vehicle_raw && looksLikeVehicleName(row.vehicle_raw);
  }

  /**
   * Dedupe. Same listing_id => same car. Otherwise fall back to a composite,
   * because the same model genuinely appears in two different sections at two
   * different prices and those are two legitimate rows.
   */
  function dedupe(rows) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var k = r.listing_id
        ? "id:" + r.listing_id + "|" + (r.section_title || "")
        : ["n:" + (r.vehicle_raw || ""), r.year, r.price_amount, r.price_period, r.section_title].join("|");
      if (seen[k]) continue;
      seen[k] = true;
      out.push(r);
    }
    return out;
  }

  NS.schema = {
    COLUMNS: COLUMNS,
    emptyRow: emptyRow,
    clean: clean,
    parseAmount: parseAmount,
    parsePrice: parsePrice,
    parsePriceGroup: parsePriceGroup,
    parseRating: parseRating,
    parseYear: parseYear,
    parseVehicleName: parseVehicleName,
    parseSection: parseSection,
    parseLocale: parseLocale,
    absoluteUrl: absoluteUrl,
    listingIdFromUrl: listingIdFromUrl,
    looksLikeVehicleName: looksLikeVehicleName,
    detectCurrency: detectCurrency,
    detectPeriod: detectPeriod,
    scoreRow: scoreRow,
    buildRow: buildRow,
    isUsableRow: isUsableRow,
    dedupe: dedupe,
    SOURCE_CONFIDENCE: SOURCE_CONFIDENCE
  };
})();
