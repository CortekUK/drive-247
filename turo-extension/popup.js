/* =============================================================================
 * popup.js — the controller
 * =============================================================================
 *
 * Responsibilities, in order:
 *   1. Decide whether this tab may be read at all (host + robots.txt posture).
 *   2. Inject parsers.js + extractor.js and run the extractor in the page.
 *   3. Render the rows, honestly labelled by how each was found.
 *   4. Export: CSV download, or TSV to the clipboard for a direct paste.
 *
 * NO NETWORK I/O. There is no fetch, XHR, beacon or navigation in this file.
 * The only outbound act is a Blob download of data already on screen. That
 * property is what keeps this legally distinct from crawling, and it is one
 * careless line from being lost — do not add a "just check for updates" call.
 *
 * SECURITY NOTE: every scraped string is written with textContent, never
 * innerHTML. This popup runs with extension privileges over third-party page
 * content, so a vehicle name containing markup must stay inert text. Listing
 * URLs are validated to http(s) before becoming links.
 *
 * -----------------------------------------------------------------------------
 * WHY THE MANIFEST ASKS FOR SO LITTLE
 *
 * manifest.json requests exactly two permissions and NO host_permissions. That
 * is the legal position, enforced by Chrome rather than merely asserted here:
 *
 *   activeTab  — granted only for the tab the user is looking at, and only at
 *                the moment they click the toolbar icon. It expires on
 *                navigation. It is the narrowest permission that can read the
 *                current page at all.
 *
 *   scripting  — supplies chrome.scripting.executeScript, the API used to
 *                inject parsers.js + extractor.js. activeTab supplies the host
 *                access, scripting supplies the API; neither works alone.
 *
 * There is deliberately NO "host_permissions": ["*://*.turo.com/*"]. That entry
 * would let this extension read Turo pages in the background, in any tab,
 * without the user acting — which is precisely the capability that turns
 * "reading the page you opened" into "crawling the site". Its absence is what
 * makes the distinction structural instead of a promise in a comment.
 *
 * No "downloads" permission either: the CSV leaves via a Blob URL and an
 * <a download> click, which needs none. And no background service worker —
 * every action is driven by a click, so nothing runs when the popup is closed.
 *
 * (This rationale lives here rather than in manifest.json because Chrome emits
 * an "Unrecognized manifest key" install warning for any key it does not know,
 * including a "_comment". A yellow warning on chrome://extensions is a bad
 * first impression for an extension whose whole argument is restraint.)
 * ========================================================================== */

(function () {
  "use strict";

  var VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "1.0.0";

  /* ---------------------------------------------------------------------- *
   * Tab eligibility — the robots.txt posture, enforced rather than described
   * ---------------------------------------------------------------------- */

  /**
   * BUG FOUND IN TESTING: anchoring these as /^\/search\b/ does NOT match
   * "/gb/en/search", and Turo serves every route under a locale prefix — so
   * the single most important path to refuse walked straight through. The
   * optional (?:/xx/yy)? prefix is load-bearing. If someone later decides an
   * already-open /search page is acceptable to read, the change belongs here
   * as a whole-rule removal; deleting the PREFIX instead would silently
   * re-open only the localised paths and leave a guard that looks like it works.
   *
   * extractor.js carries the identical list and refuses independently, so the
   * posture survives even if this popup is bypassed.
   */
  var LOCALE = "(?:\\/[a-z]{2,3}\\/[a-z]{2,3})?";
  var DISALLOWED = [
    { re: new RegExp("^" + LOCALE + "\\/search\\b", "i"),  label: "/search" },
    { re: new RegExp("^" + LOCALE + "\\/drivers\\/", "i"), label: "/drivers/" },
    { re: new RegExp("^" + LOCALE + "\\/p\\/", "i"),       label: "/{locale}/p/*" }
  ];

  function classifyUrl(rawUrl) {
    var url;
    try { url = new URL(rawUrl); }
    catch (e) { return { ok: false, code: "NO_TAB" }; }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, code: "NOT_WEB", detail: url.protocol };
    }
    if (!/(^|\.)turo\.com$/i.test(url.hostname)) {
      return { ok: false, code: "NOT_TURO", detail: url.hostname };
    }
    for (var i = 0; i < DISALLOWED.length; i++) {
      if (DISALLOWED[i].re.test(url.pathname)) {
        return { ok: false, code: "DISALLOWED", detail: DISALLOWED[i].label };
      }
    }
    return { ok: true, code: "OK", detail: url.hostname + url.pathname };
  }

  /* ---------------------------------------------------------------------- *
   * DOM handles
   * ---------------------------------------------------------------------- */

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  var state = { rows: [], result: null, meta: null, world: null, tabUrl: "", tabTitle: "" };

  /* ---------------------------------------------------------------------- *
   * Strategy vocabulary
   *
   * Maps the extractor's tier names to a human label and a trust family.
   * An UNRECOGNISED tier deliberately falls through to "unknown" -> grey,
   * because the extractor's vocabulary could change and a badge that borrows
   * a trusted colour for an unknown source would be a lie.
   * ---------------------------------------------------------------------- */

  var TIERS = {
    "json-state":  { label: "Page JSON (embedded state)", family: "json" },
    "json-ld":     { label: "JSON-LD (schema.org)",       family: "json" },
    "json-deep":   { label: "Page JSON (deep search)",    family: "json" },
    "data-testid": { label: "Test hooks / microdata",     family: "semantic" },
    "heuristic":   { label: "Shape-matched DOM",          family: "heuristic" }
  };
  var FAMILY_RANK = { heuristic: 0, unknown: 1, semantic: 2, json: 3 };

  function tierInfo(name) {
    return TIERS[name] || { label: name ? "Unrecognised source (" + name + ")" : "Unknown", family: "unknown" };
  }

  /**
   * Summarise how the rows were found, DESCRIBED BY THE WEAKEST COMPONENT.
   * A run that is 90% JSON and 10% heuristic is a mixed run, and calling it
   * "Page JSON" would present guessed rows under a trusted badge.
   */
  function summariseTiers(rows) {
    var counts = {};
    rows.forEach(function (r) {
      var t = r.__tier || "unknown";
      counts[t] = (counts[t] || 0) + 1;
    });
    var keys = Object.keys(counts);
    if (!keys.length) return { label: "Nothing extracted", family: "unknown" };
    if (keys.length === 1) return tierInfo(keys[0]);

    var worst = keys.reduce(function (acc, k) {
      var f = tierInfo(k).family;
      return FAMILY_RANK[f] < FAMILY_RANK[acc] ? f : acc;
    }, "json");
    var parts = keys.map(function (k) { return counts[k] + "× " + tierInfo(k).label; });
    return { label: "Mixed · " + parts.join(", "), family: worst };
  }

  /* ---------------------------------------------------------------------- *
   * Injection
   *
   * MAIN world first: window.__APOLLO_STATE__, __INITIAL_STATE__ and
   * self.__next_f are PAGE globals and are completely invisible from the
   * isolated world. Falling back to ISOLATED still works — the extractor also
   * reads the literal <script> tag text, which survives there — but it is
   * genuinely degraded, so the world is reported rather than glossed over.
   *
   * parsers.js MUST be injected before extractor.js; the extractor throws a
   * specific error if TuroParsers is missing rather than silently degrading.
   * ---------------------------------------------------------------------- */

  var LIB = ["parsers.js", "extractor.js"];

  function exec(opts) {
    return new Promise(function (resolve, reject) {
      chrome.scripting.executeScript(opts, function (res) {
        var err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(res);
      });
    });
  }

  function runIn(tabId, world) {
    return exec({ target: { tabId: tabId }, world: world, files: LIB })
      .then(function () {
        return exec({
          target: { tabId: tabId }, world: world,
          func: function () {
            try {
              if (typeof globalThis.__turoExtractorRun !== "function") {
                return { ok: false, rows: [], __loadError: "extractor did not load" };
              }
              return globalThis.__turoExtractorRun();
            } catch (e) {
              return { ok: false, rows: [], __loadError: String((e && e.message) || e) };
            }
          }
        });
      })
      .then(function (res) { return res && res[0] ? res[0].result : null; });
  }

  function runExtractor(tabId) {
    return runIn(tabId, "MAIN")
      .then(function (res) { return { res: res, world: "MAIN" }; })
      .catch(function (mainErr) {
        return runIn(tabId, "ISOLATED")
          .then(function (res) { return { res: res, world: "ISOLATED" }; })
          .catch(function () { throw mainErr; });
      });
  }

  /* ---------------------------------------------------------------------- *
   * Rendering helpers
   * ---------------------------------------------------------------------- */

  function setStatus(text, tone) {
    if (!text) { el.status.hidden = true; return; }
    el.status.hidden = false;
    el.status.className = "status tone-" + (tone || "info");
    el.status.textContent = text;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function renderPlaceholder(title, body, hints, action) {
    el.tableWrap.hidden = true;
    el.placeholder.hidden = false;
    el.placeholderTitle.textContent = title;
    el.placeholderBody.textContent = body || "";

    clear(el.placeholderHints);
    if (hints && hints.length) {
      hints.forEach(function (h) {
        var li = document.createElement("li");
        li.textContent = h;
        el.placeholderHints.appendChild(li);
      });
      el.placeholderHints.hidden = false;
    } else {
      el.placeholderHints.hidden = true;
    }

    if (action) {
      el.placeholderAction.hidden = false;
      el.placeholderAction.textContent = action.label;
      el.placeholderAction.onclick = action.run;
    } else {
      el.placeholderAction.hidden = true;
      el.placeholderAction.onclick = null;
    }
  }

  function td(row, opts) {
    var cell = document.createElement("td");
    if (opts && opts.cls) cell.className = opts.cls;
    row.appendChild(cell);
    return cell;
  }

  /** A missing value is an em dash. It is NEVER a zero. */
  function muted(cell, text) {
    var s = document.createElement("span");
    s.className = "muted";
    s.textContent = text || "—";
    cell.appendChild(s);
  }

  function renderRows(rows) {
    clear(el.rows);
    var P = globalThis.TuroParsers;

    rows.forEach(function (r, i) {
      var info = tierInfo(r.__tier);
      var tr = document.createElement("tr");
      if (info.family === "heuristic" || info.family === "unknown") tr.className = "is-low";

      td(tr, { cls: "col-num" }).textContent = String(i + 1);

      // Vehicle: name, and the listing URL as a link when it is safely http(s).
      var vc = td(tr);
      var nameSpan = document.createElement("span");
      nameSpan.className = "v-name";
      nameSpan.textContent = r.name || "—";
      vc.appendChild(nameSpan);
      if (r.listingUrl && /^https?:\/\//i.test(r.listingUrl)) {
        var a = document.createElement("a");
        a.className = "v-sub";
        a.href = r.listingUrl;
        a.target = "_blank";
        a.rel = "noreferrer noopener";
        a.textContent = "open listing";
        vc.appendChild(a);
      } else if (r.city) {
        var sub = document.createElement("span");
        sub.className = "v-sub";
        sub.textContent = r.city;
        vc.appendChild(sub);
      }

      var yc = td(tr, { cls: "col-num" });
      if (r.year) yc.textContent = String(r.year); else muted(yc);

      // Rating: null and 0 are opposite facts. A new listing gets a pill.
      var rc = td(tr, { cls: "col-num" });
      if (r.rating !== null && r.rating !== undefined && r.rating !== "") {
        rc.textContent = (P ? P.formatRating(r.rating) : String(r.rating)) +
                         (r.reviewCount !== null && r.reviewCount !== undefined
                           ? " (" + r.reviewCount + ")" : "");
      } else if (r.isNewListing) {
        var pill = document.createElement("span");
        pill.className = "pill-new";
        pill.textContent = "New";
        rc.appendChild(pill);
      } else {
        muted(rc);
      }

      var pc = td(tr, { cls: "col-num" });
      if (r.priceDisplay) pc.textContent = r.priceDisplay;
      else if (r.priceAmount !== null && r.priceAmount !== undefined) {
        pc.textContent = String(r.priceAmount) + (r.currency ? " " + r.currency : "");
      } else muted(pc);

      var sc = td(tr);
      if (r.section) sc.textContent = r.section; else muted(sc);

      var cc = td(tr, { cls: "col-conf" });
      var badge = document.createElement("span");
      badge.className = "src tier-" + info.family;
      badge.textContent = info.label;
      badge.title = info.label +
        (r.__filledFromLowerTier ? " (some fields filled from a weaker strategy)" : "");
      cc.appendChild(badge);

      el.rows.appendChild(tr);
    });

    el.placeholder.hidden = true;
    el.tableWrap.hidden = false;
  }

  function renderStrategies(result) {
    var diag = (result && result.diagnostics) || {};
    clear(el.strategyList);

    (diag.tiers || []).forEach(function (t) {
      var li = document.createElement("li");
      var cls = !t.ok ? "s-bad" : (t.produced > 0 ? "s-ok" : "s-none");
      li.className = cls;
      li.textContent = t.tier + " — " +
        (!t.ok ? "errored" : (t.produced > 0 ? t.produced + " found" : "nothing found")) +
        " (" + t.ms + "ms)";
      el.strategyList.appendChild(li);
    });

    if (!(diag.tiers || []).length) {
      var li2 = document.createElement("li");
      li2.className = "s-none";
      li2.textContent = "The extractor did not report a strategy trace.";
      el.strategyList.appendChild(li2);
    }

    (diag.errors || []).forEach(function (e) {
      var li3 = document.createElement("li");
      li3.className = "s-bad";
      li3.textContent = e.tier + " error: " + String(e.error).split("\n")[0];
      el.strategyList.appendChild(li3);
    });

    // What the page actually contained — the field-repair channel. Since the
    // live DOM cannot be inspected from here, this report is how a wrong guess
    // in extractor.js ever gets corrected.
    clear(el.pageFacts);
    var page = diag.page || {};
    Object.keys(page).forEach(function (k) {
      var dt = document.createElement("dt");
      dt.textContent = k;
      var dd = document.createElement("dd");
      var v = page[k];
      dd.textContent = Array.isArray(v) ? (v.length ? v.join(", ") : "none") : String(v);
      el.pageFacts.appendChild(dt);
      el.pageFacts.appendChild(dd);
    });
  }

  /* ---------------------------------------------------------------------- *
   * Failure explanations — a zero-row run must always say why
   * ---------------------------------------------------------------------- */

  function openHome() {
    chrome.tabs.create({ url: "https://turo.com/gb/en" });
  }

  function explainIneligible(verdict) {
    el.scrape.disabled = true;
    switch (verdict.code) {
      case "NOT_TURO":
        el.pageContext.textContent = verdict.detail || "not a Turo page";
        setStatus("This tab is not on turo.com.", "info");
        renderPlaceholder(
          "You are not on Turo",
          "This extension only reads a Turo page that you already have open. " +
          "Open the public browse page and try again.",
          null, { label: "Open turo.com/gb/en", run: openHome });
        break;
      case "DISALLOWED":
        el.pageContext.textContent = verdict.detail + " — off limits";
        setStatus("Refused: " + verdict.detail + " is disallowed in Turo's robots.txt.", "warn");
        renderPlaceholder(
          "This path is off limits",
          "Turo's robots.txt disallows " + verdict.detail + ". Even though the page is " +
          "already open, this extension will not read it — that line is what keeps " +
          "reading an open page distinct from crawling the site. Public browse pages " +
          "such as turo.com/gb/en are fine.",
          null, { label: "Open turo.com/gb/en", run: openHome });
        break;
      case "NOT_WEB":
        el.pageContext.textContent = "browser page";
        setStatus("Chrome does not allow extensions to read this kind of page.", "info");
        renderPlaceholder(
          "Nothing to read here",
          "Chrome blocks extensions from reading " + (verdict.detail || "this") +
          " pages, including the Web Store and the built-in PDF viewer. " +
          "Switch to a Turo tab.",
          null, { label: "Open turo.com/gb/en", run: openHome });
        break;
      default:
        el.pageContext.textContent = "no active tab";
        setStatus("Could not identify the current tab.", "bad");
        renderPlaceholder("No active tab", "Open a Turo page in a tab and reopen this popup.");
    }
  }

  function explainEmpty(result) {
    var msg = (result && result.message) || "No listings were found on this page.";
    setStatus("No listings found.", "warn");
    renderPlaceholder(
      "Nothing found on this page",
      msg,
      [
        "The page may still be loading — give it a moment and scrape again.",
        "Turo's carousels lazy-render: scroll through the sections to bring more " +
          "cards into the page, then scrape again.",
        "If the page looks full of cars, Turo's markup may have changed. Open " +
          "“How it found these” and copy the diagnostics."
      ]);
    el.details.hidden = false;
    el.detailsToggle.setAttribute("aria-expanded", "true");
  }

  /* ---------------------------------------------------------------------- *
   * Scrape
   * ---------------------------------------------------------------------- */

  function setBusy(busy) {
    el.scrape.classList.toggle("is-busy", busy);
    el.scrape.disabled = busy;
    el.scrapeLabel.textContent = busy ? "Reading page…" : "Scrape page";
  }

  function currentTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function scrape() {
    setBusy(true);
    setStatus("Reading the page you have open…", "info");

    currentTab().then(function (tab) {
      if (!tab) throw new Error("No active tab.");
      var verdict = classifyUrl(tab.url || "");
      if (!verdict.ok) { setBusy(false); explainIneligible(verdict); return null; }

      state.tabUrl = tab.url || "";
      state.tabTitle = tab.title || "";
      return runExtractor(tab.id);
    })
    .then(function (payload) {
      if (!payload) return;
      setBusy(false);

      var result = payload.res;
      state.world = payload.world;

      if (!result) {
        setStatus("The extractor returned nothing.", "bad");
        renderPlaceholder(
          "The page could not be read",
          "Chrome injected the extractor but it returned no payload. Reload the Turo " +
          "tab and try once more.");
        return;
      }

      if (result.__loadError) {
        setStatus("The extractor failed to run.", "bad");
        renderPlaceholder("The extractor failed to run", String(result.__loadError));
        return;
      }

      state.result = result;
      state.rows = result.rows || [];
      renderStrategies(result);

      // The extractor refuses independently of this popup's own guard.
      if (result.refused) {
        setStatus("Refused on robots.txt grounds.", "warn");
        renderPlaceholder("This path is off limits", result.message || "",
          null, { label: "Open turo.com/gb/en", run: openHome });
        el.summary.hidden = true;
        setExportEnabled(false);
        return;
      }

      if (!state.rows.length) {
        el.summary.hidden = true;
        setExportEnabled(false);
        explainEmpty(result);
        return;
      }

      var summary = summariseTiers(state.rows);
      var sections = (result.summary && result.summary.sections) || [];

      el.summary.hidden = false;
      el.statCount.textContent = String(state.rows.length);
      el.statSections.textContent = String(sections.length);
      el.statTier.textContent = summary.label;
      el.statTier.className = "stat-value stat-tier tier-" + summary.family;
      el.statTier.title = summary.label;

      state.meta = {
        scrapedAt: new Date().toISOString(),
        pageUrl: state.tabUrl,
        pageTitle: state.tabTitle,
        tierSummary: summary.label,
        world: payload.world,
        version: VERSION,
        sections: sections,
        strategies: (result.diagnostics && result.diagnostics.tiers) || [],
        warnings: ((result.diagnostics && result.diagnostics.errors) || [])
          .map(function (e) { return e.tier + ": " + String(e.error).split("\n")[0]; })
      };

      renderRows(state.rows);
      setExportEnabled(true);

      var tone = summary.family === "json" ? "ok"
               : (summary.family === "heuristic" || summary.family === "unknown") ? "warn" : "info";
      var note = "Found " + state.rows.length + " listing" + (state.rows.length === 1 ? "" : "s") +
                 " across " + sections.length + " section" + (sections.length === 1 ? "" : "s") + ".";
      if (summary.family === "heuristic") {
        note += " These were matched by SHAPE, not read from the page's own data — " +
                "check a few values before relying on them.";
      }
      if (payload.world === "ISOLATED") {
        note += " Ran in the isolated world, so page globals were not visible; " +
                "some JSON sources could not be attempted.";
      }
      setStatus(note, tone);
    })
    .catch(function (err) {
      setBusy(false);
      setStatus("Could not read the page.", "bad");
      renderPlaceholder(
        "Could not read the page",
        String((err && err.message) || err),
        ["Reload the Turo tab, then reopen this popup and try again."]);
    });
  }

  /* ---------------------------------------------------------------------- *
   * Export
   * ---------------------------------------------------------------------- */

  function setExportEnabled(on) {
    el.download.disabled = !on;
    el.copy.disabled = !on;
  }

  function downloadCSV() {
    if (!state.rows.length) return;
    var text = globalThis.TuroCSV.build(state.rows, state.meta);
    var name = globalThis.TuroCSV.filename(state.meta);
    var blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);

    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();

    // The popup can be torn down the moment focus leaves it, so revoking
    // immediately can cancel the download in flight. Defer it.
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 4000);

    setStatus("Saved " + name + " (" + state.rows.length + " rows, " +
              globalThis.TuroCSV.COLUMNS.length + " columns).", "ok");
  }

  function copyForSheets() {
    if (!state.rows.length) return;
    var tsv = globalThis.TuroCSV.buildTSV(state.rows);
    navigator.clipboard.writeText(tsv).then(function () {
      setStatus("Copied " + state.rows.length + " rows. Paste straight into a sheet.", "ok");
    }).catch(function () {
      setStatus("Could not reach the clipboard. Use Download CSV instead.", "bad");
    });
  }

  function copyDiagnostics() {
    var blob = {
      version: VERSION,
      pageUrl: state.tabUrl,
      world: state.world,
      rows: state.rows.length,
      summary: state.result && state.result.summary,
      diagnostics: state.result && state.result.diagnostics
    };
    navigator.clipboard.writeText(JSON.stringify(blob, null, 2)).then(function () {
      setStatus("Diagnostics copied to the clipboard.", "ok");
    }).catch(function () {
      setStatus("Could not reach the clipboard.", "bad");
    });
  }

  /* ---------------------------------------------------------------------- *
   * Boot
   * ---------------------------------------------------------------------- */

  function init() {
    el.scrape = $("scrape");
    el.scrapeLabel = el.scrape.querySelector(".btn-label");
    el.status = $("status");
    el.summary = $("summary");
    el.statCount = $("stat-count");
    el.statTier = $("stat-tier");
    el.statSections = $("stat-sections");
    el.details = $("details");
    el.detailsToggle = $("details-toggle");
    el.strategyList = $("strategy-list");
    el.pageFacts = $("page-facts");
    el.placeholder = $("placeholder");
    el.placeholderTitle = $("placeholder-title");
    el.placeholderBody = $("placeholder-body");
    el.placeholderHints = $("placeholder-hints");
    el.placeholderAction = $("placeholder-action");
    el.tableWrap = $("table-wrap");
    el.rows = $("rows");
    el.copy = $("copy");
    el.download = $("download");
    el.pageContext = $("page-context");

    el.scrape.addEventListener("click", scrape);
    el.download.addEventListener("click", downloadCSV);
    el.copy.addEventListener("click", copyForSheets);
    $("copy-diag").addEventListener("click", copyDiagnostics);

    el.detailsToggle.addEventListener("click", function () {
      var open = el.details.hidden;
      el.details.hidden = !open;
      el.detailsToggle.setAttribute("aria-expanded", String(open));
    });

    currentTab().then(function (tab) {
      if (!tab) { explainIneligible({ code: "NO_TAB" }); return; }
      var verdict = classifyUrl(tab.url || "");
      if (!verdict.ok) { explainIneligible(verdict); return; }

      el.pageContext.textContent = verdict.detail;
      el.scrape.disabled = false;
      renderPlaceholder(
        "Ready",
        "Press Scrape page to read the listings on the page you already have open. " +
        "Turo's carousels lazy-render, so scroll through the sections first if you " +
        "want more of them included.");
    });
  }

  // Idempotent, and safe if this script is ever loaded AFTER DOMContentLoaded
  // has already fired (a future defer attribute or a moved <script> tag would
  // otherwise leave the popup silently dead).
  var booted = false;
  function boot() { if (booted) return; booted = true; init(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
