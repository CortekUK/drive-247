/**
 * popup.js — drives one scrape of the ACTIVE TAB and renders the result.
 *
 * PERMISSION MODEL (this is the whole legal posture, in code):
 * The manifest declares "activeTab" and NOT host_permissions. Chrome grants
 * activeTab only for the tab the user was already looking at, and only for
 * the gesture of clicking this extension's button. So the extension:
 *   - cannot read any page in the background
 *   - cannot read any other tab
 *   - cannot do anything at all until the user clicks
 * and there is no fetch() anywhere in this codebase, so it cannot request a
 * URL of any kind. It reads the open document. That is the entire capability.
 *
 * WHY THE MAIN WORLD
 * The richest sources — window.__APOLLO_STATE__, __INITIAL_STATE__ and
 * self.__next_f — are page JS globals, and those are simply invisible from the
 * ISOLATED world an extension normally gets. So we inject into MAIN. If that
 * is refused we retry in ISOLATED, where the DOM-based tiers and the
 * <script>-tag-text reads still work; the run then reports the reduced source
 * list rather than pretending it saw everything.
 */
(function () {
  "use strict";

  var NS = globalThis.__turoScrape;
  var LIB = ["lib/schema.js", "lib/extract.js"];

  var el = {
    dot: document.getElementById("dot"),
    status: document.getElementById("status"),
    summary: document.getElementById("summary"),
    rows: document.getElementById("s-rows"),
    tier: document.getElementById("s-tier"),
    conf: document.getElementById("s-conf"),
    locale: document.getElementById("s-locale"),
    ms: document.getElementById("s-ms"),
    tierNote: document.getElementById("tierNote"),
    tableWrap: document.getElementById("tableWrap"),
    thead: document.getElementById("thead"),
    tbody: document.getElementById("tbody"),
    empty: document.getElementById("empty"),
    diagBox: document.getElementById("diagBox"),
    diag: document.getElementById("diag"),
    download: document.getElementById("download"),
    rescan: document.getElementById("rescan"),
    copyDiag: document.getElementById("copyDiag")
  };

  var lastResult = null;

  // Columns shown in the popup. The CSV carries all of them; the table shows
  // the ones a human reads at a glance.
  var VISIBLE = [
    "row_index", "vehicle_raw", "year", "price_amount", "price_period",
    "total_amount", "rating", "reviews_count", "section_title",
    "section_location", "confidence_band", "extraction_source"
  ];

  function setStatus(text, state) {
    if (el.status) el.status.textContent = text;
    if (el.dot) el.dot.className = "dot" + (state ? " " + state : "");
  }

  function isTuroUrl(u) {
    return /^https:\/\/([a-z0-9-]+\.)*turo\.com(\/|$)/i.test(u || "");
  }

  // ------------------------------------------------------------- scraping
  async function scrape() {
    el.download.disabled = true;
    setStatus("Reading the page you have open…");

    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs && tabs[0];
    if (!tab || !tab.id) { return fail("Could not identify the active tab."); }

    if (!isTuroUrl(tab.url)) {
      return fail(
        "This is not a Turo page.",
        "Open the Turo page you want to read — for example the public homepage at turo.com/gb/en — " +
        "then click this button again. The extension only ever reads the tab you are looking at."
      );
    }

    var world = "MAIN";
    var res;
    try {
      res = await inject(tab.id, "MAIN");
    } catch (e1) {
      try {
        world = "ISOLATED";
        res = await inject(tab.id, "ISOLATED");
      } catch (e2) {
        return fail(
          "Chrome refused to run the reader in this tab.",
          "This happens on chrome:// pages, the Web Store, and PDF viewers. " +
          "Reload the Turo tab and try again. (" + (e2 && e2.message ? e2.message : e2) + ")"
        );
      }
    }

    if (!res || !res.ok) return fail("The reader returned nothing usable.");
    res.meta.injection_world = world;
    lastResult = res;
    render(res, world);
  }

  async function inject(tabId, world) {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: world,
      files: LIB
    });
    var out = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: world,
      func: function () {
        try { return globalThis.__turoScrape.extract.run(); }
        catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
      }
    });
    return out && out[0] ? out[0].result : null;
  }

  // ------------------------------------------------------------ rendering
  function render(res, world) {
    var rows = res.rows || [], meta = res.meta || {};

    renderDiagnostics(res, world);

    if (!rows.length) {
      el.summary.hidden = true;
      el.tableWrap.hidden = true;
      el.tierNote.hidden = true;
      el.empty.hidden = false;
      el.empty.innerHTML =
        "<b>No listing cards found on this page.</b>" +
        "<p>All three strategies ran and none recognised a car. The most likely reasons:</p>" +
        "<ul>" +
        "<li>The page had not finished loading. Scroll the listings into view, then hit <b>Re-scan</b>.</li>" +
        "<li>This page genuinely has no listing cards (a login or help page, for example).</li>" +
        "<li>Turo changed its markup. Open <b>Diagnostics</b> below and hit <b>Copy</b> — that report " +
        "says exactly what each strategy looked for and what it saw, which is what a developer needs " +
        "to adapt the reader.</li>" +
        "</ul>";
      setStatus("Nothing found — see diagnostics.", "err");
      el.diagBox.open = true;
      return;
    }

    el.empty.hidden = true;

    var sum = 0;
    for (var i = 0; i < rows.length; i++) sum += rows[i].confidence || 0;
    var avg = Math.round((sum / rows.length) * 100) / 100;

    el.rows.textContent = rows.length;
    el.tier.textContent = meta.extraction_tier_won || "–";
    el.conf.textContent = avg.toFixed(2);
    el.locale.textContent = meta.locale || "unknown";
    el.ms.textContent = (meta.duration_ms || 0) + " ms";
    el.summary.hidden = false;

    // Say plainly how the data was obtained. A heuristic row is NOT the same
    // as a row lifted out of JSON, and the operator is told so up front.
    var tierMsg = {
      json: "Read from structured JSON the page shipped to itself — the most reliable source, and immune to restyling.",
      semantic: "Read from semantic attributes (microdata / data-testid / aria-label). Reliable, but a step below the page's own JSON.",
      heuristic: "No JSON and no semantic hooks were found, so these rows were inferred from the page's visual shape. Treat them as indicative and spot-check before relying on them."
    }[meta.extraction_tier_won];
    if (tierMsg) {
      el.tierNote.textContent = tierMsg;
      el.tierNote.className = "note" + (meta.extraction_tier_won === "heuristic" ? " warn" : "");
      el.tierNote.hidden = false;
    }

    renderTable(rows);
    el.tableWrap.hidden = false;
    el.download.disabled = false;

    var band = meta.extraction_tier_won === "heuristic" ? "warn" : "ok";
    setStatus(rows.length + " listing" + (rows.length === 1 ? "" : "s") + " read from " +
              (meta.page_url || "this page") + ".", band);
  }

  function renderTable(rows) {
    var cols = NS.schema.COLUMNS.filter(function (c) { return VISIBLE.indexOf(c.key) !== -1; });
    cols.sort(function (a, b) { return VISIBLE.indexOf(a.key) - VISIBLE.indexOf(b.key); });

    el.thead.innerHTML = "";
    cols.forEach(function (c) {
      var th = document.createElement("th");
      th.textContent = c.label;
      th.title = "Absent: " + c.absent;
      el.thead.appendChild(th);
    });

    el.tbody.innerHTML = "";
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      cols.forEach(function (c) {
        var td = document.createElement("td");
        var v = r[c.key];

        if (c.key === "confidence_band") {
          var b = document.createElement("span");
          b.className = "badge " + (v || "low");
          b.textContent = v || "low";
          b.title = "confidence " + r.confidence +
                    (r.fields_missing ? " · missing: " + r.fields_missing : "");
          td.appendChild(b);
        } else if (v === null || v === undefined || v === "") {
          // Absence is rendered as an explicit em-dash, never as 0 or blank,
          // so a missing rating can never be misread as a bad rating.
          td.className = "null";
          td.textContent = (c.key === "rating" && r.is_new_listing) ? "new listing" : "—";
        } else {
          if (c.type === "int" || c.type === "number") td.className = "num";
          var s = String(v);
          if (s.length > 30) {
            var span = document.createElement("span");
            span.className = "trunc"; span.textContent = s; span.title = s;
            td.appendChild(span);
          } else td.textContent = s;
        }
        tr.appendChild(td);
      });
      el.tbody.appendChild(tr);
    });
  }

  /**
   * The diagnostics panel is not decoration. Nobody has been able to inspect
   * turo.com's real DOM (it answers 403 to every automated request), so this
   * report is the only way the guesses in extract.js can ever be corrected:
   * an operator runs it on the real page and copies this back.
   */
  function renderDiagnostics(res, world) {
    var meta = res.meta || {};
    var lines = [];
    lines.push("PAGE      " + meta.page_url);
    lines.push("TITLE     " + (meta.page_title || "(none)"));
    lines.push("LOCALE    " + meta.locale + "   world=" + world + "   " + meta.duration_ms + "ms");
    lines.push("SCRAPED   " + meta.scraped_at_iso);
    lines.push("");
    lines.push("TIERS ATTEMPTED (in order, first usable one wins)");
    (meta.tiers_attempted || []).forEach(function (t) {
      lines.push("  " + pad(t.tier, 11) + pad(t.candidates + " candidates", 18) + t.usable_rows + " usable rows");
    });
    lines.push("  WINNER    " + (meta.extraction_tier_won || "none"));
    lines.push("");
    lines.push("STRUCTURED-STATE SOURCES PROBED (tier 1)");
    (meta.state_sources || []).forEach(function (s) {
      lines.push("  " + (s.found ? "[found]  " : "[absent] ") + pad(s.source, 20) + (s.note || ""));
    });
    lines.push("");
    lines.push("DOM SIGNALS");
    lines.push("  inline <script> blocks   " + meta.inline_script_count);
    lines.push("  microdata elements       " + meta.microdata_elements);
    lines.push("  data-testid elements     " + meta.testid_elements);
    lines.push("  anchors scanned          " + meta.anchors_scanned);
    lines.push("  heuristic card shapes    " + meta.heuristic_candidates);
    lines.push("  sections back-filled     " + meta.sections_backfilled_from_dom);
    if (meta.warnings && meta.warnings.length) {
      lines.push("");
      lines.push("WARNINGS");
      meta.warnings.forEach(function (w) { lines.push("  - " + w); });
    }
    var pre = document.createElement("pre");
    pre.textContent = lines.join("\n");
    el.diag.innerHTML = "";
    el.diag.appendChild(pre);
    el.diagBox.hidden = false;
  }

  function pad(s, n) { s = String(s === null || s === undefined ? "" : s); while (s.length < n) s += " "; return s; }

  function fail(msg, detail) {
    setStatus(msg, "err");
    el.summary.hidden = true; el.tableWrap.hidden = true; el.tierNote.hidden = true;
    el.empty.hidden = false;
    el.empty.innerHTML = "<b>" + escapeHtml(msg) + "</b>" + (detail ? "<p>" + escapeHtml(detail) + "</p>" : "");
    el.download.disabled = true;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  // ------------------------------------------------------------ downloads
  /**
   * Optional-control binding. The buttons below are conveniences, not the
   * feature; if a future popup.html drops one, the scrape and the table must
   * still work rather than dying on a null listener.
   */
  function on(node, evt, fn) { if (node && node.addEventListener) node.addEventListener(evt, fn); }

  on(el.download, "click", function () {
    if (!lastResult) return;
    var text = NS.csv.build(lastResult.rows, lastResult.meta, NS.schema.COLUMNS);
    // "text/csv" + BOM. The BOM is inside `text`; the charset label keeps
    // Excel and the browser from disagreeing about it.
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = NS.csv.filename(lastResult.meta);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  });

  on(el.rescan, "click", scrape);

  on(el.copyDiag, "click", function (e) {
    e.preventDefault(); e.stopPropagation();
    var t = el.diag.textContent || "";
    navigator.clipboard.writeText(t).then(function () {
      el.copyDiag.textContent = "Copied";
      setTimeout(function () { el.copyDiag.textContent = "Copy"; }, 1500);
    });
  });

  scrape();
})();
