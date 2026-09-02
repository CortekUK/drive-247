/* =============================================================================
 * csv.js — the sheet: column definitions + an Excel-safe CSV writer
 * =============================================================================
 *
 * COLUMNS is the single source of truth for the sheet. The popup table and the
 * CSV both render from it, so they can never drift apart. Add a column here and
 * it appears in both.
 *
 * Each column declares a `type`, and the type is what decides Excel safety:
 *   "num"  -> written bare so Excel can sum and sort it
 *   "text" -> quoted, and force-escaped if Excel would mangle it
 *   "bool" -> TRUE / FALSE
 *   "url"  -> text, never force-escaped (a URL is safe and should stay clickable)
 *
 * -----------------------------------------------------------------------------
 * WHAT "EXCEL-SAFE" ACTUALLY REQUIRES (all four are needed; three is not enough)
 *
 * 1. UTF-8 BOM. Without EF BB BF, Excel opens the file in the system codepage
 *    and "£77/day" renders as "Â£77/day". Every price on a UK sheet, corrupted.
 *
 * 2. CRLF line endings, and every field quoted. RFC 4180. A section title like
 *    "Car rentals at King's Cross, London" splits into two cells otherwise.
 *
 * 3. Embedded quotes doubled. "" inside a quoted field.
 *
 * 4. Text-forcing for values Excel silently reinterprets. This is the subtle
 *    one, and it is applied ONLY where a real corruption would occur:
 *      - leading zeros      "007"        -> 7
 *      - 12+ digit numbers  "123456789012" -> 1.23457E+11
 *      - date-shaped        "3-5" or "5/12" -> 5 March / 12 May
 *      - formula injection  "=cmd|/c calc" -> executes on open
 *    Everything else stays clean and machine-readable. Over-applying ="..." to
 *    every field makes the CSV unpleasant to use anywhere except Excel.
 *
 * THE ESCAPING ORDER FOR FORCED TEXT IS TWO SEQUENTIAL STEPS, NOT ONE:
 *      1. build the Excel formula literal:  ="value"   (inner quotes doubled)
 *      2. CSV-encode THAT result:           wrap + double every quote again
 *    "0012345" must ship as  "=""0012345"""
 *    Writing this as one clever concatenation over-escapes every forced value.
 *    Round-trip through a real CSV parser after touching this function.
 *
 * NO NETWORK I/O in this file.
 * ========================================================================== */

(function (root) {
  "use strict";

  var P = root.TuroParsers;

  /* ---------------------------------------------------------------------- *
   * Columns — the sheet's shape
   *
   * Ordered the way an operator reads a listing: what the car is, what it is
   * rated, what it costs, where it came from, then the provenance columns that
   * say how much to trust the row.
   * ---------------------------------------------------------------------- */

  var COLUMNS = [
    { key: "__row",          label: "#",               type: "num"  },
    { key: "name",           label: "Vehicle",         type: "text" },
    { key: "make",           label: "Make",            type: "text" },
    { key: "model",          label: "Model",           type: "text" },
    { key: "year",           label: "Year",            type: "num"  },
    { key: "vehicleType",    label: "Type",            type: "text" },

    { key: "ratingDisplay",  label: "Rating shown",    type: "text" },
    { key: "rating",         label: "Rating",          type: "num"  },
    { key: "reviewCount",    label: "Reviews",         type: "num"  },
    { key: "isNewListing",   label: "New listing",     type: "bool" },

    { key: "priceDisplay",   label: "Price shown",     type: "text" },
    { key: "priceAmount",    label: "Price amount",    type: "num"  },
    { key: "currency",       label: "Currency",        type: "text" },
    { key: "priceUnit",      label: "Price unit",      type: "text" },
    { key: "priceBasis",     label: "Price basis",     type: "text" },
    { key: "dailyRateAmount",label: "Base daily rate", type: "num"  },
    { key: "tripTotalAmount",label: "Trip total",      type: "num"  },
    { key: "tripDays",       label: "Trip days",       type: "num"  },
    { key: "savings",        label: "Savings",         type: "text" },

    { key: "city",           label: "City",            type: "text" },
    { key: "region",         label: "Region",          type: "text" },
    { key: "country",        label: "Country",         type: "text" },

    { key: "section",        label: "Section",         type: "text" },
    { key: "sectionSubtitle",label: "Section subtitle",type: "text" },

    { key: "listingUrl",     label: "Listing URL",     type: "url"  },
    { key: "imageUrl",       label: "Image URL",       type: "url"  },

    // Long numeric ids: Excel turns these into scientific notation unless forced.
    { key: "vehicleId",      label: "Vehicle ID",      type: "text", forceText: true },
    { key: "hostId",         label: "Host ID",         type: "text", forceText: true },
    { key: "completedTrips", label: "Completed trips", type: "num"  },
    { key: "allStarHost",    label: "All-star host",   type: "bool" },

    // Provenance. These are per-row facts, so they are columns, not metadata.
    { key: "__tier",         label: "Strategy",        type: "text" },
    { key: "__confidence",   label: "Confidence",      type: "text" },
    { key: "__tiersUsed",    label: "Strategies used", type: "text" },
    { key: "__mixed",        label: "Gap-filled",      type: "bool" },
    { key: "__sources",      label: "Field sources",   type: "text" }
  ];

  /* ---------------------------------------------------------------------- *
   * Excel corruption predicates
   * ---------------------------------------------------------------------- */

  // Leading =, +, -, @, tab or CR is executed as a formula by Excel/Sheets.
  var INJECTION_RE = /^[=+\-@\t\r]/;
  var LEADING_ZERO_RE = /^0\d+$/;
  var LONG_DIGITS_RE = /^\d{12,}$/;
  var DATE_LIKE_RE = /^\s*\d{1,4}\s*[-\/.]\s*\d{1,2}(\s*[-\/.]\s*\d{1,4})?\s*$/;
  var MONTH_LIKE_RE = /^\s*\d{1,2}\s*[-\/ ]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

  function needsTextForcing(s) {
    return INJECTION_RE.test(s)
        || LEADING_ZERO_RE.test(s)
        || LONG_DIGITS_RE.test(s)
        || DATE_LIKE_RE.test(s)
        || MONTH_LIKE_RE.test(s);
  }

  /**
   * Encode one value as a CSV field, already quoted.
   * `column` decides whether a number stays bare and summable.
   */
  function field(value, column) {
    if (value === null || value === undefined) return '""';   // absence stays empty
    if (typeof value === "boolean") return value ? '"TRUE"' : '"FALSE"';

    var type = (column && column.type) || "text";

    if (typeof value === "number") {
      if (!isFinite(value)) return '""';
      // Numeric columns ship bare so the sheet can sum and sort them.
      if (type === "num") return '"' + String(value) + '"';
      value = String(value);
    }

    var s = String(value);
    if (s === "") return '""';

    var force = (column && column.forceText) || needsTextForcing(s);
    // A URL is never date-shaped or formula-shaped in practice, and forcing it
    // would break the hyperlink. Only guard it against genuine injection.
    if (type === "url") force = INJECTION_RE.test(s);

    if (force) {
      // TWO sequential escapes. See the header note — do not merge these.
      var formula = '="' + s.replace(/"/g, '""') + '"';
      return '"' + formula.replace(/"/g, '""') + '"';
    }
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /** Flatten a row's per-field provenance map into one readable cell. */
  function sourcesCell(row) {
    var prov = row && row.__prov;
    if (!prov) return null;
    var keys = Object.keys(prov);
    if (!keys.length) return null;
    return keys.map(function (k) { return k + "=" + prov[k]; }).join("; ");
  }

  /** Project an extractor row onto the COLUMNS shape. */
  function project(row, index) {
    var out = {};
    for (var i = 0; i < COLUMNS.length; i++) out[COLUMNS[i].key] = row[COLUMNS[i].key];
    out.__row = index + 1;
    out.__tiersUsed = Array.isArray(row.__tiers) ? row.__tiers.join(" + ") : row.__tier;
    out.__mixed = !!row.__filledFromLowerTier;
    out.__sources = sourcesCell(row);
    return out;
  }

  /**
   * Build the whole CSV.
   *
   * Run metadata is appended AFTER the data behind a blank line, so the header
   * stays on row 1 and Excel's autofilter / "format as table" still work. Put
   * it on top and every import wizard guesses the wrong header row.
   */
  function build(rows, meta) {
    var CRLF = "\r\n";
    var lines = [];

    lines.push(COLUMNS.map(function (c) { return field(c.label, { type: "text" }); }).join(","));

    (rows || []).forEach(function (row, i) {
      var p = project(row, i);
      lines.push(COLUMNS.map(function (c) { return field(p[c.key], c); }).join(","));
    });

    if (meta) {
      lines.push("");
      lines.push(field("# RUN METADATA", { type: "text" }));
      var order = [
        ["Scraped at", meta.scrapedAt],
        ["Page URL", meta.pageUrl],
        ["Page title", meta.pageTitle],
        ["Listings exported", (rows || []).length],
        ["Winning strategy", meta.tierSummary],
        ["Injection world", meta.world],
        ["Extension version", meta.version]
      ];
      order.forEach(function (pair) {
        lines.push(field(pair[0], { type: "text" }) + "," + field(pair[1], { type: "text" }));
      });

      if (meta.sections && meta.sections.length) {
        lines.push("");
        lines.push(field("# SECTIONS SEEN", { type: "text" }));
        meta.sections.forEach(function (s) {
          lines.push(field(s, { type: "text" }));
        });
      }

      if (meta.strategies && meta.strategies.length) {
        lines.push("");
        lines.push(field("# STRATEGIES ATTEMPTED", { type: "text" }));
        lines.push([field("Strategy", {}), field("Succeeded", {}),
                    field("Rows", {}), field("ms", {})].join(","));
        meta.strategies.forEach(function (t) {
          lines.push([field(t.tier, {}), field(!!t.ok, {}),
                      field(t.produced, { type: "num" }),
                      field(t.ms, { type: "num" })].join(","));
        });
      }

      if (meta.warnings && meta.warnings.length) {
        lines.push("");
        lines.push(field("# WARNINGS", { type: "text" }));
        meta.warnings.forEach(function (w) { lines.push(field(w, { type: "text" })); });
      }
    }

    // BOM first, or Excel mis-decodes every currency symbol.
    return "﻿" + lines.join(CRLF) + CRLF;
  }

  /** turo-listings-gb-en-20260902-1550.csv */
  function filename(meta) {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
                "-" + pad(d.getHours()) + pad(d.getMinutes());
    var loc = "";
    try {
      var path = new URL(meta && meta.pageUrl ? meta.pageUrl : "https://turo.com/").pathname;
      var m = path.match(/^\/([a-z]{2,3})\/([a-z]{2,3})\b/i);
      if (m) loc = "-" + m[1].toLowerCase() + "-" + m[2].toLowerCase();
    } catch (e) { /* filename must never be the thing that fails */ }
    return "turo-listings" + loc + "-" + stamp + ".csv";
  }

  /* ---------------------------------------------------------------------- *
   * Clipboard TSV — a genuinely DIFFERENT escaping problem from CSV
   *
   * Sheets and Excel split a pasted line on raw tabs and newlines with no
   * quoting convention they agree on, so values must be FLATTENED instead of
   * quoted. And the CSV ="value" coercion guard is wrong here: pasted, it
   * shows up as literal formula text. The leading apostrophe is the paste-side
   * equivalent. Both paths guard formula injection; neither may adopt the
   * other's escaping.
   * ---------------------------------------------------------------------- */

  var COERCED_ON_PASTE = [
    /^[+-]?\d{1,3}(,\d{3})*(\.\d+)?$/,   // "1,359" -> 1359, losing the format
    /^[+-]?\d+\.\d+$/,                   // "5.0"   -> 5, losing the trailing zero
    LEADING_ZERO_RE, LONG_DIGITS_RE, DATE_LIKE_RE,
    /^\d{1,2}:\d{2}(:\d{2})?$/,          // "4:30" -> a time
    /^(true|false)$/i
  ];

  function pasteCell(value, column) {
    if (value === null || value === undefined) return "";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";  // matches CSV exactly

    var type = (column && column.type) || "text";
    if (typeof value === "number") {
      if (!isFinite(value)) return "";
      if (type === "num") return String(value);                       // stays summable
      value = String(value);
    }

    // A raw tab or newline would become extra cells and extra rows on paste.
    var s = String(value).replace(/\r\n?/g, " ").replace(/[\n\t]/g, " ")
                         .replace(/\s{2,}/g, " ").trim();
    if (s === "") return "";
    if (INJECTION_RE.test(s)) return "'" + s;
    if (column && column.forceText && /^[\d.,+-]/.test(s)) return "'" + s;
    if (type !== "num" && type !== "url") {
      for (var i = 0; i < COERCED_ON_PASTE.length; i++) {
        if (COERCED_ON_PASTE[i].test(s)) return "'" + s;
      }
    }
    return s;
  }

  function buildTSV(rows) {
    var lines = [COLUMNS.map(function (c) { return c.label; }).join("\t")];
    (rows || []).forEach(function (row, i) {
      var p = project(row, i);
      lines.push(COLUMNS.map(function (c) { return pasteCell(p[c.key], c); }).join("\t"));
    });
    return lines.join("\n");
  }

  root.TuroCSV = {
    COLUMNS: COLUMNS,
    build: build,
    buildTSV: buildTSV,
    filename: filename,
    field: field,
    project: project,
    needsTextForcing: needsTextForcing
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
