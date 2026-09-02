/**
 * sheet.js — export adapter: turns a scrape result into a file or a clipboard
 * paste. Owns the popup's two export buttons.
 *
 * NO NETWORK. See the legal note at the top of schema.js.
 *
 * WHY THIS IS SEPARATE FROM csv.js
 * csv.js owns CSV *encoding* — quoting, the BOM, CRLF, and the Excel coercion
 * guards. This file owns everything around that: assembling the run metadata,
 * handing the bytes to the browser as a download, and producing the tab
 * separated variant for "paste into Sheets", which is a different escaping
 * problem and does not belong in the CSV encoder.
 *
 * THE CLIPBOARD IS NOT JUST "CSV WITH TABS"
 * Two things change when the destination is a paste buffer:
 *
 *   1. No quoting. Google Sheets and Excel both split a pasted line on raw
 *      tabs and newlines; there is no quoting convention they agree on. So a
 *      value containing a tab or a newline cannot be escaped — it has to be
 *      flattened, or it silently becomes extra cells and extra rows.
 *
 *   2. csv.js guards coercion with Excel's ="…" formula form, which is right
 *      for a file. On paste it is wrong: the user sees the formula text in the
 *      formula bar, and any tool that is not Excel or Sheets shows ="0012345"
 *      literally. For a paste we use the leading apostrophe instead, which
 *      every spreadsheet consumes as "treat this as text".
 *
 * Formula injection is guarded in BOTH paths. A pasted "=cmd|…" executes
 * exactly as readily as an imported one, and every string here came from a
 * third-party page.
 */
(function () {
  "use strict";

  var NS = (globalThis.__turoScrape = globalThis.__turoScrape || {});

  /** Columns come from schema.js so the sheet can never drift from the rows. */
  function columns() {
    return (NS.schema && NS.schema.COLUMNS) || [];
  }

  /**
   * Assemble the metadata block csv.js appends below the data.
   *
   * Everything is optional and defensive: content.js supplies a rich `meta`
   * when it can, but a scrape that only returned rows must still export. A
   * missing field prints as an empty cell rather than "undefined".
   */
  function buildMeta(result, fallbackPageUrl, rowCount) {
    var m = (result && result.meta) || {};
    var iso = m.scraped_at_iso || (result && (result.scraped_at || result.scrapedAt)) || new Date().toISOString();
    var d = new Date(iso);

    return {
      scraped_at_iso: iso,
      scraped_at_local: isFinite(d.getTime()) ? d.toString() : "",
      page_url: m.page_url || (result && (result.page_url || result.pageUrl)) || fallbackPageUrl || "",
      page_title: m.page_title || "",
      locale: m.locale || "",
      country: m.country || "",
      language: m.language || "",
      cards_found: typeof m.cards_found === "number" ? m.cards_found : rowCount,
      extraction_tier_won: m.extraction_tier_won || "",
      sections_backfilled_from_dom: m.sections_backfilled_from_dom,
      inline_script_count: m.inline_script_count,
      microdata_elements: m.microdata_elements,
      testid_elements: m.testid_elements,
      anchors_scanned: m.anchors_scanned,
      heuristic_candidates: m.heuristic_candidates,
      duration_ms: m.duration_ms,
      extension_version: m.extension_version || version(),
      tiers_attempted: m.tiers_attempted || [],
      state_sources: m.state_sources || [],
      warnings: m.warnings || []
    };
  }

  function version() {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest) {
        return chrome.runtime.getManifest().version || "";
      }
    } catch (e) { /* not in an extension context */ }
    return "";
  }

  /* ---------------------------------------------------------------- CSV -- */

  function buildCSV(rows, meta) {
    if (!NS.csv || typeof NS.csv.build !== "function") {
      throw new Error("csv.js did not load, so the sheet cannot be encoded");
    }
    return NS.csv.build(rows || [], meta, columns());
  }

  /**
   * Save the sheet. Object URL + synthetic click, which needs no "downloads"
   * permission in the manifest.
   *
   * The popup window is destroyed the instant it loses focus, and revoking the
   * URL immediately can abort the save on slower machines, so the revoke is
   * deferred rather than done inline.
   */
  function download(rows, meta) {
    var text = buildCSV(rows, meta);
    var name = (NS.csv && NS.csv.filename) ? NS.csv.filename(meta) : "turo-listings.csv";

    // The charset hint stops Windows handing the file to Excel's web-query
    // importer, which ignores the BOM.
    var blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 4000);

    return { filename: name, bytes: blob.size, rows: (rows || []).length };
  }

  /* ----------------------------------------------------------- CLIPBOARD -- */

  var INJECTION = /^[=+\-@\t\r]/;

  // Values a spreadsheet would silently retype on paste. Deliberately wider
  // than the CSV rules on one point: a bare decimal like "5.0" in a TEXT
  // column loses its trailing zero, and rating fidelity is the whole reason
  // someone exports this sheet.
  var COERCED = [
    /^[+-]?\d{1,3}(,\d{3})*(\.\d+)?$/,
    /^[+-]?\d+\.\d+$/,
    /^0\d+$/,
    /^\d{12,}$/,
    /^\d{1,4}\s*[-/.]\s*\d{1,2}(\s*[-/.]\s*\d{1,4})?$/,
    /^\d{1,2}:\d{2}(:\d{2})?$/,
    /^(true|false)$/i,
    /^\d{4}-\d{2}-\d{2}T/
  ];

  function coerced(s) {
    for (var i = 0; i < COERCED.length; i++) if (COERCED[i].test(s)) return true;
    return false;
  }

  /**
   * One clipboard cell. Numbers stay bare so the pasted column is still
   * summable; text is flattened and guarded.
   */
  function cell(value, column) {
    if (value === null || value === undefined) return "";
    // TRUE/FALSE, not Yes/No: this must match how csv.js writes a boolean, or
    // the same data reads differently depending on whether it was downloaded
    // or pasted. Both spreadsheets also treat TRUE/FALSE as real booleans, so
    // the column stays filterable.
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

    var numeric = column && (column.type === "int" || column.type === "number");
    if (typeof value === "number") {
      if (!isFinite(value)) return "";
      if (numeric && !(column && column.forceTextInExcel)) return String(value);
    }

    // Flatten: a raw tab or newline would become extra cells / extra rows.
    var s = String(value).replace(/\r\n?/g, " ").replace(/[\n\t]/g, " ")
                         .replace(/\s{2,}/g, " ").trim();
    if (s === "") return "";

    if (INJECTION.test(s)) return "'" + s;
    if (column && column.forceTextInExcel && /^[\d.,+-]/.test(s)) return "'" + s;
    if (!numeric && coerced(s)) return "'" + s;
    return s;
  }

  /**
   * Tab-separated text for "Copy for Sheets". Header row included, so a paste
   * lands as a labelled table rather than anonymous columns.
   */
  function buildTSV(rows) {
    var cols = columns();
    var list = rows || [];
    var lines = [cols.map(function (c) { return c.label; }).join("\t")];

    for (var i = 0; i < list.length; i++) {
      var out = [];
      for (var j = 0; j < cols.length; j++) out.push(cell(list[i][cols[j].key], cols[j]));
      lines.push(out.join("\t"));
    }
    return lines.join("\n");
  }

  NS.sheet = {
    buildMeta: buildMeta,
    buildCSV: buildCSV,
    buildTSV: buildTSV,
    download: download,
    columns: columns,
    _cell: cell
  };
})();
