/* =============================================================================
 * parsers.js — normalisation layer
 * =============================================================================
 *
 * Every messy-string-to-clean-value function lives here, and NOWHERE else.
 *
 * Three consumers load this file:
 *   1. extractor.js, injected into the Turo page (needs cleanText / DOM helpers)
 *   2. csv.js, in the popup (needs formatting + the Excel safety predicates)
 *   3. popup.js, in the popup (needs display formatting)
 *
 * They must agree exactly. A rating rendered as "5.0" in the popup and written
 * as "5" in the CSV would be a small lie, and small lies about numbers are how
 * a pricing sheet becomes untrustworthy. One implementation, three callers.
 *
 * NO NETWORK I/O. There is no fetch, XHR, beacon or navigation in this file,
 * and none may ever be added — see the legal note at the top of extractor.js.
 *
 * -----------------------------------------------------------------------------
 * THE RULES THAT CARRY MEANING (each was a bug before it was a rule):
 *
 * - null is NEVER 0. An unrated new listing and a 0.0-rated car are opposite
 *   facts. Anyone pricing against this sheet must never see them collapsed.
 *
 * - Money is parsed locale-agnostically. "1,359" (en) and "1.359" (de) are both
 *   1359; "77,50" (de) and "1.5" (en) are both decimals. The decisive rule is
 *   digit count after a lone separator: exactly 3 => grouping, 1-2 => decimal.
 *   This is safe because money is never quoted to 3 decimal places.
 *
 * - Currency symbols are doubled in Turo's US flight data ("$$109 total").
 *   collapseCurrency() fixes that before anything else looks at the string.
 *
 * - A card shows TWO prices (a rate and a trip total) and the discount badge
 *   sits in the same subtree ("Save £811/mo £1,014/month"). Reading the first
 *   currency match yields the SAVINGS. stripSavings() must run first, always.
 *
 * - element.textContent is banned. Emotion injects <style> INSIDE cards, so
 *   textContent returns CSS mixed with content, and CSS numbers then become
 *   candidates for the price and rating regexes. Worse, textContent fuses
 *   adjacent elements: <span>Model Y</span><span>2025</span> reads back as
 *   "Model Y2025", destroying the year and inventing numbers that were never
 *   on the page. cleanText() walks text nodes and inserts boundaries.
 * ========================================================================== */

(function (root) {
  "use strict";

  /* ---------------------------------------------------------------------- *
   * Text basics
   * ---------------------------------------------------------------------- */

  /** Collapse all whitespace (incl. NBSP) and trim. Null-safe. */
  function clean(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[\s  ]+/g, " ").trim();
  }

  /* ---------------------------------------------------------------------- *
   * Currency
   * ---------------------------------------------------------------------- */

  // Character class used inside dynamically built price regexes.
  var CURRENCY_CHARS = "\\$£€¥₹₽¢₩₪₺";

  // Longest-first so "C$" beats a bare "$" and "NZ$" beats "N"+"Z$".
  var CURRENCY_SYMBOLS = [
    ["CHF", "CHF"], ["NZ$", "NZD"], ["A$", "AUD"], ["C$", "CAD"], ["R$", "BRL"],
    ["HK$", "HKD"], ["S$", "SGD"], ["kr", "SEK"], ["zł", "PLN"], ["Kč", "CZK"],
    ["₹", "INR"], ["₽", "RUB"], ["₩", "KRW"], ["₪", "ILS"], ["₺", "TRY"],
    ["£", "GBP"], ["€", "EUR"], ["¥", "JPY"], ["¢", "USD"], ["$", "USD"]
  ];

  var ISO_RE = /\b(GBP|USD|EUR|JPY|INR|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|CZK|BRL|MXN|ZAR|AED|SAR|SGD|HKD|KRW|RUB|TRY|ILS|CNY)\b/i;

  /**
   * "$$109 total" -> "$109 total".
   * Turo's US flight data doubles the symbol; the GB build does not. Left
   * uncollapsed a naive number parse still succeeds, so the sheet silently
   * ships a broken-looking string rather than failing loudly.
   */
  function collapseCurrency(s) {
    if (typeof s !== "string") return s;
    return s.replace(/([\$£€¥₹₽¢₩₪₺])\1+/g, "$1").trim();
  }

  /**
   * Detect currency from a price string. An explicit ISO code always beats a
   * symbol, because "$ 50 USD" and "$ 50 CAD" differ only in the code.
   * A bare "$" resolves to USD, and the ambiguity is preserved in price_raw
   * rather than being silently resolved away.
   */
  function detectCurrency(s) {
    var str = String(s || "");
    var iso = str.match(ISO_RE);
    if (iso) return { code: iso[1].toUpperCase(), symbol: null };
    for (var i = 0; i < CURRENCY_SYMBOLS.length; i++) {
      if (str.indexOf(CURRENCY_SYMBOLS[i][0]) !== -1) {
        return { code: CURRENCY_SYMBOLS[i][1], symbol: CURRENCY_SYMBOLS[i][0] };
      }
    }
    return { code: null, symbol: null };
  }

  /* ---------------------------------------------------------------------- *
   * Numbers
   * ---------------------------------------------------------------------- */

  /**
   * Locale-agnostic amount parser.
   *
   *   spaces / NBSP / apostrophes are ALWAYS group separators
   *   both "." and ","   -> the LAST one is the decimal point
   *   one separator, 2+  -> grouping ("1.234.567")
   *   one separator, 1x  -> 3 digits after  => GROUPING ("1,359" and "1.359" = 1359)
   *                         1-2 digits after => DECIMAL  ("77,50" = 77.5, "1.5" = 1.5)
   *
   * Correct for en-GB, en-US, de-DE and fr-FR alike. The 3-digit rule is safe
   * because money is not quoted to three decimal places.
   */
  function parseAmount(token) {
    if (token === null || token === undefined) return null;
    var t = String(token).replace(/[\s  '’]/g, "").replace(/[^\d.,-]/g, "");
    if (!/\d/.test(t)) return null;
    var neg = /^-/.test(t);
    t = t.replace(/-/g, "");

    var dots = (t.match(/\./g) || []).length;
    var commas = (t.match(/,/g) || []).length;

    if (dots && commas) {
      var dec = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
      t = t.split(dec === "." ? "," : ".").join("").replace(dec, ".");
    } else if (dots || commas) {
      var sep = dots ? "." : ",";
      var count = dots || commas;
      if (count > 1) {
        t = t.split(sep).join("");
      } else {
        var after = t.length - t.indexOf(sep) - 1;
        if (after === 3) t = t.split(sep).join("");
        else if (after >= 1 && after <= 2) t = t.replace(sep, ".");
        else t = t.split(sep).join("");
      }
    }

    var n = Number(t);
    if (!isFinite(n) || n < 0 || n > 1e8) return null;   // sanity fence
    return neg ? -n : n;
  }

  /**
   * Scalar coercion for values that came out of JSON, where a number is
   * already a number. Deliberately NOT locale-aware: this is for ids, counts,
   * years and ratings, not for money. Money goes through parseAmount.
   */
  function toNumber(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v !== "string") return null;
    var m = v.replace(/[,\s ]/g, "").match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  /* ---------------------------------------------------------------------- *
   * Price
   * ---------------------------------------------------------------------- */

  function detectPeriod(s) {
    var str = String(s || "");
    if (/\/\s*(?:day|d)\b/i.test(str) || /\bper\s+day\b/i.test(str) || /\bnight\b/i.test(str)) return "day";
    if (/\/\s*(?:month|mo)\b/i.test(str) || /\bper\s+month\b/i.test(str)) return "month";
    if (/\/\s*(?:week|wk)\b/i.test(str) || /\bper\s+week\b/i.test(str)) return "week";
    if (/\/\s*(?:hour|hr|h)\b/i.test(str) || /\bper\s+hour\b/i.test(str)) return "hour";
    if (/\btotal\b/i.test(str) || /\ball-?in\b/i.test(str)) return "total";
    // Turo serves fr / es / de / it locales as well as en. A localised period
    // word is the difference between a priced row and a blank price column, so
    // it is worth four regexes. Tested AFTER every English form, so nothing
    // above can change meaning.
    if (/\b(?:jour|jours|tag|t\u00e4glich|d\u00eda|dia|giorno|dag)\b/i.test(str)) return "day";
    if (/\b(?:mois|monat|monatlich|mes|mese|m\u00e5nad)\b/i.test(str)) return "month";
    if (/\b(?:semaine|woche|semana|settimana|vecka)\b/i.test(str)) return "week";
    if (/\b(?:heure|stunde|hora|ora|timme)\b/i.test(str)) return "hour";
    return null;
  }

  /**
   * Parse every Turo price form observed in the real captures:
   *   "£77/day"  "£1,359/month"  "£1,014/mo"  "$143 for 3 days"
   *   "$$109 total"  "£232 total"  "$2,213/mo"
   *
   * Returns { display, amount, currency, symbol, unit, days } or null.
   *
   * `display` is the price TOKEN plus its unit, never the whole surrounding
   * sentence — so a sheet cell reads "£1,014/month", not "Save £811/mo …".
   */
  function parsePriceString(raw) {
    if (!raw || typeof raw !== "string") return null;
    var s = collapseCurrency(raw);

    var m = s.match(new RegExp("([" + CURRENCY_CHARS + "])\\s*([\\d.,\\s ']+)"));

    /* ------------------------------------------------------------------ *
     * FALLBACKS — reached ONLY when the prefix-symbol form above did not
     * match, so nothing here can change how an en-GB / en-US string parses.
     *
     * Turo publishes fr, es, de and it locales, which put the symbol AFTER
     * the number ("77 \u20ac/jour", "1.359 \u20ac/mois"), and some currencies have
     * no symbol in CURRENCY_CHARS at all ("CHF 120", "500 kr").
     *
     * Without these the price column comes out EMPTY on those pages: the one
     * number the sheet exists to carry, silently missing, while the row is
     * still present and still looks healthy. That is the worst shape a
     * failure can take in a pricing tool, which is why it is worth handling
     * a locale we have never seen.
     * ------------------------------------------------------------------ */
    var suffixForm = false;
    if (!m) {
      var sm = s.match(new RegExp("(\\d[\\d.,\\s ']*)\\s*([" + CURRENCY_CHARS + "])"));
      if (sm) { m = [sm[0], sm[2], sm[1]]; m.index = sm.index; suffixForm = true; }
    }
    if (!m) {
      // A word currency, either side of the number.
      var WORD = "(?:CHF|kr|z\u0142|K\u010d|GBP|USD|EUR|CAD|AUD|NZD|SEK|NOK|DKK|" +
                 "PLN|CZK|BRL|MXN|ZAR|AED|SGD|HKD|KRW|RUB|TRY|ILS|CNY|JPY|INR)";
      var wm = s.match(new RegExp(WORD + "\\s*(\\d[\\d.,\\s ']*)", "i"));
      if (wm) { m = [wm[0], "", wm[1]]; m.index = wm.index; }
      else {
        var wm2 = s.match(new RegExp("(\\d[\\d.,\\s ']*)\\s*" + WORD, "i"));
        if (wm2) { m = [wm2[0], "", wm2[1]]; m.index = wm2.index; suffixForm = true; }
      }
    }
    if (!m) return null;

    var amount = parseAmount(m[2]);
    if (amount === null) return null;

    var unit = detectPeriod(s) || "unknown";
    var days = null;
    if (unit === "unknown" || unit === "total") {
      var d = s.match(/for\s+(\d+)\s+days?/i);            // "$143 for 3 days"
      if (d) { unit = "total"; days = parseInt(d[1], 10); }
    }

    // Rebuild a tidy display token: symbol + number + trailing unit only.
    var numText = clean(m[2]).replace(/[.,]$/, "");
    // Preserve the ORDER the page used. Rewriting "77 \u20ac" as "\u20ac77" would make
    // the sheet disagree with the screen the operator is looking at.
    var display = suffixForm ? (numText + (m[1] ? " " + m[1] : ""))
                             : (m[1] + numText);
    // The amount regex greedily eats the trailing space, so the remainder can
    // begin directly with the unit. Re-insert exactly one space before a WORD
    // unit ("£232 total") but never before a slash unit ("£77/day").
    var tail = s.slice(m.index + m[0].length).match(
      /^\s*(?:\/\s*[A-Za-z\u00c0-\u024f]{1,12}\b|total\b|for\s+\d+\s+days?\b|per\s+\w+\b)/i);
    if (tail) {
      var unitText = clean(tail[0]).replace(/^\/\s*/, "/");
      display += (unitText.charAt(0) === "/" ? "" : " ") + unitText;
    }

    var cur = detectCurrency(s);
    return {
      display: clean(display),
      amount: amount,
      currency: cur.code,
      symbol: cur.symbol || m[1],
      unit: unit,
      days: days
    };
  }

  /**
   * BUG FOUND IN TESTING: [data-testid*="price"] wraps BOTH the discount badge
   * and the price — raw text "Save £811/mo £1,014/month". The first currency
   * match there is the SAVINGS (£811), not the price (£1,014). This shipped a
   * plausible-looking wrong number, which is the worst failure mode for a
   * pricing tool. Always strip the discount clause before parsing a price.
   */
  var SAVINGS_RE = new RegExp(
    "(?:Save|Savings?|You save)\\s+[" + CURRENCY_CHARS + "]\\s*[\\d.,]+\\s*(?:\\/\\s*\\w+)?", "i");

  function stripSavings(text) {
    if (!text) return { savings: null, rest: "" };
    var m = String(text).match(SAVINGS_RE);
    return m ? { savings: clean(m[0]), rest: String(text).replace(m[0], " ") }
             : { savings: null, rest: String(text) };
  }

  /* ---------------------------------------------------------------------- *
   * Rating — the null-vs-zero rule
   * ---------------------------------------------------------------------- */

  var NEW_LISTING_RE = /\bnew listing\b/i;

  /** Turo prints one decimal for whole ratings ("5.0") and two otherwise. */
  function formatRating(n) {
    if (n === null || n === undefined) return null;
    var num = Number(n);
    if (!isFinite(num)) return null;
    return Number.isInteger(num) ? num.toFixed(1) : String(parseFloat(num.toFixed(2)));
  }

  /**
   * "5.0 (5)"      -> { rating: 5,    reviews: 5,   is_new: false }
   * "4.75 (12)"    -> { rating: 4.75, reviews: 12,  is_new: false }
   * "New listing"  -> { rating: null, reviews: null, is_new: true  }
   *
   * NEVER 0. A 0.0 rating and an unrated new car are opposite facts.
   */
  function parseRating(raw) {
    var out = { rating: null, reviews: null, is_new: false, raw: null, warnings: [] };
    var s = clean(raw);
    if (!s) return out;
    out.raw = s;

    if (NEW_LISTING_RE.test(s) && !/\d/.test(s)) { out.is_new = true; return out; }

    var rm = s.match(/(\d(?:[.,]\d{1,2})?)\s*(?:★|☆|\/\s*5|out of 5)?/);
    if (rm) {
      var r = parseAmount(rm[1]);
      if (r !== null && r >= 0 && r <= 5) out.rating = r;
      else if (r !== null) out.warnings.push("ignored out-of-range rating: " + rm[1]);
    }

    var vm = s.match(/\(\s*(\d[\d.,\s]*)\s*(?:trips?|reviews?|ratings?)?\s*\)/i)   // "(5)" "(16 trips)"
          || s.match(/[·•]\s*(\d[\d.,\s]*)\s*(?:reviews?|trips?|ratings?)/i)       // "· 128 trips"
          || s.match(/(\d[\d.,\s]*)\s*(?:reviews?|trips?|ratings?)\b/i);
    if (vm) {
      var v = parseAmount(vm[1]);
      if (v !== null && v >= 0 && Number.isInteger(v)) out.reviews = v;
    }

    if (out.rating === null && out.reviews === null && NEW_LISTING_RE.test(s)) out.is_new = true;
    return out;
  }

  /* ---------------------------------------------------------------------- *
   * Year
   * ---------------------------------------------------------------------- */

  // Next-year models are pre-registered, so allow a little headroom.
  var YEAR_MAX = new Date().getFullYear() + 2;

  /**
   * Rejects a 4-digit match glued to a currency symbol or separator, so
   * "£2,019/month" is NOT read as a 2019 model. That is the realistic false
   * positive on a rental card, where prices and years occupy the same range.
   */
  function parseYear(raw) {
    var s = clean(raw);
    if (!s) return null;
    var re = /(^|[^\d.,£$€¥₹₽])((?:19|20)\d{2})(?![\d.,])/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var y = parseInt(m[2], 10);
      if (y >= 1900 && y <= YEAR_MAX) return y;
    }
    return null;
  }

  function looksLikeYear(v) {
    var n = toNumber(v);
    return n !== null && n >= 1900 && n <= YEAR_MAX && Number.isInteger(n);
  }

  function looksLikeRating(v) {
    var n = toNumber(v);
    return n !== null && n >= 0 && n <= 5;
  }

  /* ---------------------------------------------------------------------- *
   * Vehicle name
   * ---------------------------------------------------------------------- */

  // Longest-first: "Land Rover Defender" must not split to make="Land".
  var MULTI_WORD_MAKES = [
    "Mercedes-AMG", "Mercedes-Benz", "Aston Martin", "Alfa Romeo", "Land Rover",
    "Range Rover", "Rolls-Royce", "Great Wall", "MG Motor", "Lynk & Co",
    "DS Automobiles", "Grand Cherokee"
  ].sort(function (a, b) { return b.length - a.length; });

  /**
   * ALWAYS keeps the raw string. make/model are best-effort extras: a wrong
   * split must never destroy the only value we actually trust.
   * "2023 Tesla Model Y" -> { raw:"Tesla Model Y", make:"Tesla", model:"Model Y", year:2023 }
   */
  function parseVehicleName(raw) {
    var out = { raw: null, make: null, model: null, year: null };
    var s = clean(raw);
    if (!s) return out;

    var y = parseYear(s);
    if (y !== null) {
      out.year = y;
      s = clean(s.replace(new RegExp("(^|\\s)" + y + "(\\s|$)"), " "));
    }
    if (!s) { out.raw = clean(raw); return out; }
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
    if (sp === -1) { out.make = s; return out; }
    out.make = s.slice(0, sp);
    out.model = clean(s.slice(sp + 1)) || null;
    return out;
  }

  var titleCase = function (s) {
    if (!s) return null;
    return String(s).split(/[-_\s]+/).map(function (w) {
      return w ? w[0].toUpperCase() + w.slice(1) : w;
    }).join(" ");
  };

  /* ---------------------------------------------------------------------- *
   * Section — the only path by which city and rental type reach a row
   * ---------------------------------------------------------------------- */

  var SECTION_CATEGORIES = [
    [/\bmonthly\b/i, "monthly"], [/\bweekly\b/i, "weekly"], [/\bdaily\b/i, "daily"],
    [/\bairport\b/i, "airport"], [/\bluxury\b/i, "luxury"], [/\bdeliver/i, "delivery"],
    [/\belectric\b|\bEV\b/i, "electric"], [/\bSUV\b/i, "suv"]
  ];

  /** "Monthly luxury car rentals in Oxford" -> location "Oxford", category "monthly" */
  function parseSection(title, subtitle) {
    var out = { title: clean(title) || null, subtitle: clean(subtitle) || null,
                location: null, category: null };
    if (!out.title) return out;
    var loc = out.title.match(/\b(?:in|at|near|around)\s+(.+)$/i);
    if (loc) out.location = clean(loc[1]).replace(/[.,;:!?]+$/, "") || null;
    for (var i = 0; i < SECTION_CATEGORIES.length; i++) {
      if (SECTION_CATEGORIES[i][0].test(out.title)) { out.category = SECTION_CATEGORIES[i][1]; break; }
    }
    return out;
  }

  /* ---------------------------------------------------------------------- *
   * DOM readers (only meaningful inside the page)
   * ---------------------------------------------------------------------- */

  var TEXT_SKIP = /^(?:STYLE|SCRIPT|NOSCRIPT|TEMPLATE|SVG|PATH)$/;

  /**
   * THE MOST IMPORTANT FUNCTION IN THIS FILE. Never use element.textContent.
   *
   * 1. Emotion injects <style> elements INSIDE cards and headings, so
   *    textContent returns CSS mixed with content — a section title came back
   *    as "SUV rental in Las Vegas.seo-pages-s2svv4{margin-top:2px;}..." and
   *    the CSS numbers became candidates for the price and rating regexes.
   *
   * 2. textContent FUSES adjacent elements with no separator:
   *      <span>Model Y</span><span>2025</span><span>4.75</span>
   *      -> "Model Y20254.75"
   *    which destroys the year AND invents numbers never on the page.
   *
   * This walks text nodes, skips style/script subtrees, and inserts boundaries.
   */
  function cleanText(el) {
    if (!el) return "";
    var out = "";
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          out += c.nodeValue;
        } else if (c.nodeType === 1 && !TEXT_SKIP.test(c.tagName)) {
          out += " "; walk(c); out += " ";
        }
      }
    })(el);
    return out.replace(/\s+/g, " ").trim();
  }

  /**
   * Turo hrefs encode a lot:
   *   /gb/en/suv-rental/united-kingdom/edinburgh/honda/hr-v/3524295
   * Tracking and date params are dropped so the same car in two sections
   * produces one stable identity.
   */
  function parseListingHref(href, origin) {
    var out = {};
    if (!href) return out;
    try {
      var base = origin || (typeof location !== "undefined" ? location.origin : "https://turo.com");
      var u = new URL(href, base);
      out.listingUrl = u.origin + u.pathname;
      var seg = u.pathname.split("/").filter(Boolean);
      var last = seg[seg.length - 1];
      if (/^\d{3,}$/.test(last)) {
        out.vehicleId = last;
        if (seg.length >= 3) {
          out.modelSlug = seg[seg.length - 2];
          out.makeSlug = seg[seg.length - 3];
        }
        if (seg.length >= 4) out.citySlug = seg[seg.length - 4];
        for (var i = 0; i < seg.length; i++) {
          if (/-rental$/.test(seg[i])) { out.vehicleTypeSlug = seg[i].replace(/-rental$/, ""); break; }
        }
      }
    } catch (e) { /* a malformed href must never kill the row */ }
    return out;
  }

  /**
   * The img alt is remarkably consistent and is the best DOM source of year:
   *   "Honda HR-V 2016 in Edinburgh"
   */
  function parseImageAlt(alt) {
    var out = {};
    if (!alt || typeof alt !== "string") return out;
    var m = alt.match(/^(.*?)\s+((?:19|20)\d{2})(?:\s+in\s+(.+))?$/);
    if (m) {
      out.nameFromAlt = clean(m[1]);
      out.year = parseInt(m[2], 10);
      if (m[3]) out.city = clean(m[3]);
    } else {
      out.nameFromAlt = clean(alt);
    }
    return out;
  }

  /* ---------------------------------------------------------------------- *
   * Export
   * ---------------------------------------------------------------------- */

  root.TuroParsers = {
    clean: clean,
    CURRENCY_CHARS: CURRENCY_CHARS,
    collapseCurrency: collapseCurrency,
    detectCurrency: detectCurrency,
    detectPeriod: detectPeriod,
    parseAmount: parseAmount,
    toNumber: toNumber,
    parsePriceString: parsePriceString,
    stripSavings: stripSavings,
    formatRating: formatRating,
    parseRating: parseRating,
    parseYear: parseYear,
    looksLikeYear: looksLikeYear,
    looksLikeRating: looksLikeRating,
    parseVehicleName: parseVehicleName,
    titleCase: titleCase,
    parseSection: parseSection,
    cleanText: cleanText,
    parseListingHref: parseListingHref,
    parseImageAlt: parseImageAlt,
    NEW_LISTING_RE: NEW_LISTING_RE,
    YEAR_MAX: YEAR_MAX
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
