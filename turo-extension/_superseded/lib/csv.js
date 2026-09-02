/**
 * csv.js — Excel-safe CSV.
 *
 * "Excel-safe" is doing a lot of work in that sentence, so concretely:
 *
 *  1. UTF-8 BOM. Without it Excel on Windows reads the file as ANSI and
 *     "£77/day" becomes "Â£77/day". This is the single most common way a
 *     correct export looks broken.
 *  2. CRLF line endings, which Excel prefers and every other tool tolerates.
 *  3. Every field quoted; embedded quotes doubled ("" per RFC 4180).
 *  4. Coercion guards. Excel silently rewrites values that merely LOOK like
 *     something else:
 *       - "0012345"  -> 12345      (leading zeros eaten)
 *       - "1234567890123" -> 1.23E+12  (long digits to scientific)
 *       - "5-3", "1/2", "Jan 5"  -> a date, in the reader's locale
 *       - "=cmd|..." -> a FORMULA, which is also a security problem
 *     Values at risk are emitted as ="value", the one form Excel, Google
 *     Sheets and LibreOffice all render as literal text. It is applied ONLY
 *     where needed, so the file stays clean and machine-readable everywhere
 *     else.
 *
 * Numbers are emitted plainly (still quoted) so the sheet can sum and sort
 * them. Nulls are emitted as empty — never as "null", "0" or "N/A", because
 * the whole point of this schema is that absence stays visible.
 */
(function () {
  "use strict";

  var NS = (globalThis.__turoScrape = globalThis.__turoScrape || {});

  var DATE_LIKE = /^\s*\d{1,4}\s*[-\/.]\s*\d{1,2}(\s*[-\/.]\s*\d{1,4})?\s*$/;
  var MONTH_LIKE = /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\s*$/i;
  var INJECTION = /^[=+\-@\t\r]/;

  function needsTextForcing(s) {
    if (s === "") return false;
    if (INJECTION.test(s)) return true;              // formula injection + coercion
    if (/^0\d+$/.test(s)) return true;               // leading zeros
    if (/^\d{12,}$/.test(s)) return true;            // scientific notation
    if (DATE_LIKE.test(s) || MONTH_LIKE.test(s)) return true;
    return false;
  }

  /** One CSV field, always quoted, coercion-guarded when required. */
  function field(value, opts) {
    if (value === null || value === undefined) return '""';
    if (typeof value === "boolean") return value ? '"TRUE"' : '"FALSE"';

    var s = String(value);
    if (typeof value === "number") {
      if (!isFinite(value)) return '""';
      return '"' + s + '"';                          // quoted, still a number to Excel
    }

    var force = (opts && opts.forceText) || needsTextForcing(s);
    if (force) {
      // Two separate escapes, in this order — collapsing them into one clever
      // concatenation is how this gets written wrong:
      //   1. build the Excel formula text:  ="value"   (quotes inside `value`
      //      are doubled, because that is how a formula string literal escapes)
      //   2. CSV-encode THAT whole string: wrap in quotes, double every quote
      // "0012345" therefore ships as:  "=""0012345"""
      var formula = '="' + s.replace(/"/g, '""') + '"';
      return '"' + formula.replace(/"/g, '""') + '"';
    }
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function row(values, optsList) {
    var out = [];
    for (var i = 0; i < values.length; i++) out.push(field(values[i], optsList ? optsList[i] : null));
    return out.join(",");
  }

  /**
   * Build the whole sheet.
   *
   * The header is row 1 so that Excel's "Format as table", autofilter and
   * every importer work normally. The run metadata is appended AFTER the data
   * behind a blank line — putting it on top would push the header down and
   * break all of those. The sheet is still self-describing: the tier, source
   * and confidence that produced each row are per-row COLUMNS, because they
   * are per-row facts and can legitimately differ from one row to the next.
   */
  function build(rows, meta, columns) {
    var lines = [];

    var headers = [], optsList = [];
    for (var c = 0; c < columns.length; c++) {
      headers.push(columns[c].label);
      optsList.push({ forceText: !!columns[c].forceTextInExcel });
    }
    lines.push(row(headers));

    for (var r = 0; r < rows.length; r++) {
      var vals = [];
      for (var k = 0; k < columns.length; k++) vals.push(rows[r][columns[k].key]);
      lines.push(row(vals, optsList));
    }

    // ---- run metadata -------------------------------------------------
    lines.push("");
    lines.push(row(["# RUN METADATA", "(describes how the rows above were obtained)"]));
    var pairs = [
      ["Scraped at (UTC)", meta.scraped_at_iso],
      ["Scraped at (local)", meta.scraped_at_local],
      ["Page URL", meta.page_url],
      ["Page title", meta.page_title],
      ["Locale", meta.locale],
      ["Country", meta.country],
      ["Language", meta.language],
      ["Cards found", meta.cards_found],
      ["Winning extraction tier", meta.extraction_tier_won],
      ["Sections back-filled from DOM", meta.sections_backfilled_from_dom],
      ["Inline scripts seen", meta.inline_script_count],
      ["Microdata elements seen", meta.microdata_elements],
      ["data-testid elements seen", meta.testid_elements],
      ["Anchors scanned", meta.anchors_scanned],
      ["Heuristic card candidates", meta.heuristic_candidates],
      ["Duration (ms)", meta.duration_ms],
      ["Extension version", meta.extension_version]
    ];
    for (var p = 0; p < pairs.length; p++) lines.push(row(pairs[p]));

    lines.push("");
    lines.push(row(["# TIERS ATTEMPTED", "candidates", "usable rows"]));
    var ta = meta.tiers_attempted || [];
    for (var t = 0; t < ta.length; t++) lines.push(row([ta[t].tier, ta[t].candidates, ta[t].usable_rows]));

    lines.push("");
    lines.push(row(["# STRUCTURED-STATE SOURCES PROBED", "found", "note"]));
    var ss = meta.state_sources || [];
    for (var s2 = 0; s2 < ss.length; s2++) lines.push(row([ss[s2].source, ss[s2].found, ss[s2].note]));

    if (meta.warnings && meta.warnings.length) {
      lines.push("");
      lines.push(row(["# WARNINGS"]));
      for (var w = 0; w < meta.warnings.length; w++) lines.push(row([meta.warnings[w]]));
    }

    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  function filename(meta) {
    var d = new Date(meta.scraped_at_iso || Date.now());
    function p(n) { return (n < 10 ? "0" : "") + n; }
    var stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
    var loc = (meta.locale || "unknown").replace(/[^A-Za-z0-9-]/g, "");
    return "turo-listings-" + loc + "-" + stamp + ".csv";
  }

  NS.csv = { build: build, field: field, filename: filename, needsTextForcing: needsTextForcing };
})();
