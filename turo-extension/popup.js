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
 * SECURITY NOTE: every scraped string is written with textContent, never as
 * markup. This popup runs with extension privileges over third-party page
 * content, so a vehicle name containing tags must stay inert text. Listing
 * URLs are validated to http(s) before becoming links.
 *
 * -----------------------------------------------------------------------------
 * TWO VOCABULARIES, AND WHY THEY ARE KEPT APART
 *
 * extractor.js speaks in strategies: "json-state", "data-testid", "heuristic",
 * and a zero-row message that ends in a JSON dump of the page fingerprint.
 * That language is precise and it is what a bug report needs — but it is not
 * what an operator should read on the front of the popup.
 *
 * So this file owns three maps and nothing else translates:
 *
 *   TIERS            strategy name -> the precise label. Kept verbatim, and it
 *                    is what lands in the CSV metadata and the chip's second
 *                    line, because the export is where precision pays.
 *   FAMILY           trust family -> the operator's words, the badge word and
 *                    the legend sentence. This is what the table and the
 *                    summary chip show.
 *   STRATEGY_LABELS  strategy name -> a plain sentence, for the trace list.
 *   FACT_LABELS      fingerprint key -> a plain noun, for the facts table.
 *
 * result.message is NEVER rendered as operator copy. It goes to #raw-message
 * inside the diagnostics disclosure, where it is genuinely useful.
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
 * <a download> click, which needs none. No "clipboardWrite": navigator
 * .clipboard.writeText works from a popup under a user gesture. And no
 * background service worker — every action is driven by a click, so nothing
 * runs when the popup is closed.
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

  /** What each disallowed path IS, in the operator's words. */
  var PATH_COPY = {
    "/search":        "search results",
    "/drivers/":      "driver profiles",
    "/{locale}/p/*":  "host profile pages"
  };

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
   * Maps the extractor's tier names to a precise label and a trust family.
   * An UNRECOGNISED tier deliberately falls through to "unknown" -> slate,
   * because the extractor's vocabulary could change and a badge that borrowed
   * a trusted colour for an unknown source would be a lie.
   * ---------------------------------------------------------------------- */

  var TIERS = {
    "json-state":  { label: "The page's own data",            family: "json" },
    "json-ld":     { label: "The page's search-engine data",  family: "json" },
    "json-deep":   { label: "The page's own data, found by a deeper search",
                                                              family: "json" },
    "data-testid": { label: "Labelled elements on the page",  family: "semantic" },
    "heuristic":   { label: "Matched by the shape of the cards",
                                                              family: "heuristic" }
  };
  var FAMILY_RANK = { heuristic: 0, unknown: 1, semantic: 2, json: 3 };
  var FAMILY_ORDER = ["json", "semantic", "heuristic", "unknown"];

  /**
   * The operator-facing scale. `short` is the row badge — one word, because at
   * 420px there is no room for "Page JSON (embedded state)" twenty-four times
   * down a list. `plain` is the summary chip's first line. `explain` is the
   * legend inside the disclosure. `count` is how the mixed-run detail line
   * names each group.
   *
   * NO BRAND VIOLET APPEARS ANYWHERE IN THIS SCALE (see popup.css): violet
   * means "Drive247 action", never "trustworthy data".
   */
  var FAMILY = {
    json: {
      short: "DATA",
      plain: "Read from the page's own data",
      count: "read from the page data",
      explain: "The numbers the page itself uses to draw the cards. These match what is on screen."
    },
    semantic: {
      short: "MARKUP",
      plain: "Read from labelled markup",
      count: "read from the page markup",
      explain: "Read from labelled elements in the page. Reliable, but the labels belong to Turo and can change."
    },
    heuristic: {
      short: "GUESS",
      plain: "Guessed from the page layout",
      count: "guessed from the page layout",
      explain: "Matched by the shape of the cards on screen. Names and prices are usually right; anything else may be approximate — check a few."
    },
    unknown: {
      short: "UNKNOWN",
      plain: "Source not recognised",
      count: "from a source this version does not recognise",
      explain: "This version does not recognise where these came from. Treat them as unchecked."
    }
  };

  function familyInfo(f) { return FAMILY[f] || FAMILY.unknown; }

  function tierInfo(name) {
    return TIERS[name] ||
      { label: name ? "Unrecognised source (" + name + ")" : "Unknown", family: "unknown" };
  }

  /**
   * Summarise how the rows were found, DESCRIBED BY THE WEAKEST COMPONENT.
   * A run that is 90% JSON and 10% heuristic is a mixed run, and calling it
   * "read from the page data" would present guessed rows under a trusted badge.
   *
   * Grouping is by FAMILY, not by tier name. A page that yields json-state and
   * json-ld together is not "mixed" in any sense the operator cares about, and
   * an honesty signal that cries wolf gets ignored — which costs you the one
   * time it matters. The per-TIER breakdown survives in `precise`, which is
   * what the CSV metadata and the chip's tooltip carry.
   */
  function summariseTiers(rows) {
    var byTier = {}, byFamily = {};
    rows.forEach(function (r) {
      var t = r.__tier || "unknown";
      var f = tierInfo(r.__tier).family;
      byTier[t] = (byTier[t] || 0) + 1;
      byFamily[f] = (byFamily[f] || 0) + 1;
    });

    var tierKeys = Object.keys(byTier);
    var famKeys = FAMILY_ORDER.filter(function (f) { return byFamily[f]; });

    var precise = tierKeys.map(function (k) {
      return byTier[k] + "× " + tierInfo(k).label;
    }).join(", ");

    if (!famKeys.length) {
      return { family: "unknown", plain: "Source not recognised", detail: "Nothing extracted",
               precise: "Nothing extracted", weakCount: 0, mixed: false };
    }

    var worst = famKeys.reduce(function (acc, f) {
      return FAMILY_RANK[f] < FAMILY_RANK[acc] ? f : acc;
    }, "json");
    var weak = (byFamily.heuristic || 0) + (byFamily.unknown || 0);

    if (famKeys.length === 1) {
      return {
        family: worst,
        plain: familyInfo(worst).plain,
        detail: precise,
        precise: precise,
        weakCount: weak,
        mixed: false
      };
    }

    var parts = famKeys.map(function (f) { return byFamily[f] + " " + familyInfo(f).count; });
    return {
      family: worst,
      plain: "Mixed sources",
      detail: parts.join(", "),
      precise: "Mixed · " + precise,
      weakCount: weak,
      mixed: true
    };
  }

  /* ---------------------------------------------------------------------- *
   * Diagnostics vocabulary — the disclosure speaks English too
   * ---------------------------------------------------------------------- */

  var STRATEGY_LABELS = {
    "fingerprint":     "Looked at what the page contains",
    "json-state+deep": "The page's own data",
    "data-testid":     "Labelled elements",
    "heuristic":       "Card layout",
    "merge":           "Merged and de-duplicated"
  };

  var FACT_LABELS = {
    scriptCount:        "Scripts on the page",
    hasNextData:        "Page data block",
    hasNextFlight:      "Streamed page data",
    hasNextStatic:      "App framework",
    ldJsonTags:         "Search-engine data blocks",
    dataTestIdCount:    "Labelled elements",
    vehicleCardTestIds: "Labelled car cards",
    microdataCount:     "Marked-up items",
    imgCount:           "Images",
    knownGlobals:       "Data sources present",
    flightChars:        "Streamed data size",
    stateBlobs:         "Data blocks read",
    priceMapEntries:    "Prices found"
  };

  /** Formats a fingerprint value. diag.page.stateBlobs is a plain object and
   *  used to render as "[object Object]" — the fix is here, not in extractor.js. */
  function factValue(v) {
    if (v === true) return "Yes";
    if (v === false) return "No";
    if (v === null || v === undefined) return "—";
    if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
    if (typeof v === "object") {
      var keys = Object.keys(v);
      if (!keys.length) return "none";
      // These keys are extractor.js's own source names — "flight",
      // "script(embedded)", "window.__APOLLO_STATE__" — and used to print raw.
      return keys.map(function (k) { return humanise(k) + ": " + String(v[k]); }).join(", ");
    }
    return String(v);
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

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function span(cls, text) {
    var s = document.createElement("span");
    if (cls) s.className = cls;
    if (text !== undefined && text !== null) s.textContent = text;
    return s;
  }

  /**
   * setStatus assigns className wholesale — see the note in popup.css.
   *
   * It NEVER sets `hidden`. #status is an aria-live region, and a live region
   * that is inserted into the accessibility tree and populated in the same
   * frame is not reliably announced — which is what toggling `hidden` did, on
   * every single status change, because each one started from the hidden
   * state. Emptying it leaves the region permanently present and collapses it
   * to nothing visually (.status:empty), and an empty element contributes no
   * text to be read either.
   */
  function setStatus(text, tone) {
    if (!text) {
      el.status.className = "status";
      el.status.textContent = "";
      return;
    }
    el.status.className = "status tone-" + (tone || "info");
    el.status.textContent = text;
  }

  /** The host chip's dot. An explicit attribute, not a :has() rule, so it is
   *  right on every engine. ok | blocked | offsite | idle. */
  function setPageState(text, dotState, fullTitle) {
    el.pageContext.textContent = text;
    el.pageContext.dataset.state = dotState || "idle";
    el.pageContext.title = fullTitle || text;
  }

  var PH_ICONS = ["placeholder-mark", "ic-ready", "ic-empty", "ic-blocked", "ic-offsite", "ic-error"];
  var PH_ICON_MAP = {
    mark: "placeholder-mark", ready: "ic-ready", empty: "ic-empty",
    blocked: "ic-blocked", offsite: "ic-offsite", error: "ic-error"
  };

  function renderPlaceholder(title, body, hints, action, icon) {
    el.tableWrap.hidden = true;
    el.placeholder.hidden = false;

    // NOTE: `hidden` is a property of HTMLElement, NOT of SVGElement. Five of
    // these six marks are inline <svg>, where `node.hidden = false` silently
    // sets a JS expando and leaves the ATTRIBUTE in place — so the glyph stays
    // display:none while the code believes it is showing. Toggle the attribute.
    var want = PH_ICON_MAP[icon] || null;
    PH_ICONS.forEach(function (id) {
      var node = $(id);
      if (!node) return;
      if (id === want) node.removeAttribute("hidden");
      else node.setAttribute("hidden", "");
    });

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
      // A property assignment, not an inline handler: CSP-clean under MV3.
      el.placeholderAction.onclick = action.run;
      el.placeholderAction.className = action.primary
        ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm";
    } else {
      el.placeholderAction.hidden = true;
      // Null it, or a stale handler from a previous state fires on the next click.
      el.placeholderAction.onclick = null;
    }
  }

  /** The extractor's own words, and the only place they are ever shown. */
  function setRawMessage(text) {
    var t = text ? String(text) : "";
    el.rawMessage.textContent = t;
    el.rawMessage.hidden = !t;
    el.rawTitle.hidden = !t;
  }

  /**
   * Wipe every result surface. Called before each render pass, because two
   * failure branches used to return without touching #summary or the export
   * buttons: after one good scrape and one bad one the operator saw the
   * PREVIOUS page's counts and could export the PREVIOUS page's rows into a
   * file named after the new page.
   */
  function resetResults() {
    state.rows = [];
    state.result = null;
    state.meta = null;
    clear(el.rows);
    el.tableWrap.hidden = true;
    el.summary.hidden = true;
    el.worldChip.hidden = true;
    el.statLowWrap.hidden = true;
    setExportEnabled(false);
    setRawMessage("");
  }

  /* ---------------------------------------------------------------------- *
   * The table
   *
   * The seven-cell <tr> below is reflowed into two visual lines by CSS Grid
   * (see popup.css §7). Because display:grid on table parts strips the
   * implicit ARIA table roles in Chrome, role="row"/"cell" are set explicitly
   * and the <thead> is visually hidden rather than deleted.
   * ---------------------------------------------------------------------- */

  function td(row, opts) {
    var cell = document.createElement("td");
    cell.setAttribute("role", "cell");
    if (opts && opts.cls) cell.className = opts.cls;
    row.appendChild(cell);
    return cell;
  }

  /** A missing value is an em dash. It is NEVER a zero. */
  function muted(cell, text) {
    cell.appendChild(span("muted", text || "—"));
  }

  function renderRows(rows) {
    clear(el.rows);
    var P = globalThis.TuroParsers;

    rows.forEach(function (r, i) {
      var info = tierInfo(r.__tier);
      var fam = familyInfo(info.family);
      var tr = document.createElement("tr");
      tr.setAttribute("role", "row");
      if (info.family === "heuristic" || info.family === "unknown") tr.className = "is-low";

      td(tr, { cls: "col-num" }).textContent = String(i + 1);

      // Vehicle: the name, plus the listing URL as an inline glyph when it is
      // safely http(s). The glyph costs no row height; a "open listing" line
      // would cost 15px on every row.
      var vc = td(tr);
      var nameSpan = span("v-name", r.name || "—");
      nameSpan.title = r.name || "";
      vc.appendChild(nameSpan);
      if (r.listingUrl && /^https?:\/\//i.test(r.listingUrl)) {
        var a = document.createElement("a");
        a.className = "v-link";
        a.href = r.listingUrl;
        a.target = "_blank";
        a.rel = "noreferrer noopener";
        a.textContent = "↗";
        a.title = "Open listing in a new tab";
        a.setAttribute("aria-label",
          r.name ? "View " + r.name + " on Turo (opens a new tab)" : "Open listing in a new tab");
        vc.appendChild(a);
      } else if (r.city) {
        vc.appendChild(span("v-city", r.city));
      }

      var yc = td(tr, { cls: "col-num" });
      if (r.year) yc.textContent = String(r.year); else muted(yc);

      // Rating: null and 0 are opposite facts. A new listing gets a pill.
      var rc = td(tr, { cls: "col-num col-rating" });
      if (r.rating !== null && r.rating !== undefined && r.rating !== "") {
        rc.textContent = (P ? P.formatRating(r.rating) : String(r.rating)) +
                         (r.reviewCount !== null && r.reviewCount !== undefined
                           ? " (" + r.reviewCount + ")" : "");
      } else if (r.isNewListing) {
        rc.appendChild(span("pill-new", "New"));
      } else {
        muted(rc);
      }

      var pc = td(tr, { cls: "col-num col-price" });
      if (r.priceDisplay) pc.textContent = r.priceDisplay;
      else if (r.priceAmount !== null && r.priceAmount !== undefined) {
        pc.textContent = String(r.priceAmount) + (r.currency ? " " + r.currency : "");
      } else muted(pc);

      var sc = td(tr);
      if (r.section) sc.appendChild(span("sect-pill", r.section)); else muted(sc);

      // The badge carries the FAMILY word. The precise strategy name is too
      // long for a 420px row and lives in the tooltip, the summary chip and
      // the CSV instead.
      var cc = td(tr, { cls: "col-conf" });
      var badge = span("src tier-" + info.family, fam.short);
      badge.title = fam.plain + " · " + info.label +
        (r.__filledFromLowerTier ? " · Some values in this row came from a weaker source." : "");
      if (r.__filledFromLowerTier) {
        badge.classList.add("src--mixed");
        badge.appendChild(span("sr-only",
          " — plus some values from a weaker source"));
      }
      cc.appendChild(badge);

      el.rows.appendChild(tr);
    });

    el.placeholder.hidden = true;
    el.tableWrap.hidden = false;
  }

  /* ---------------------------------------------------------------------- *
   * The disclosure
   * ---------------------------------------------------------------------- */

  /** Rendered once at boot, so the vocabulary is on screen before anything
   *  goes wrong rather than only after it does. */
  function renderLegend() {
    clear(el.tierLegend);
    FAMILY_ORDER.forEach(function (f) {
      var dt = document.createElement("dt");
      dt.className = "tier-" + f;
      dt.textContent = FAMILY[f].short;
      var dd = document.createElement("dd");
      dd.textContent = FAMILY[f].explain;
      el.tierLegend.appendChild(dt);
      el.tierLegend.appendChild(dd);
    });
  }

  /**
   * The backstop for a name no map covers. extractor.js reports per-source
   * failures as "pricemap:flight", "script-sweep", "ld-json", and its page
   * fingerprint can grow a key at any time — all of which used to print
   * verbatim in the disclosure, which is where "flight" and friends leaked.
   * This turns any such name into a plain phrase rather than an identifier.
   */
  function humanise(name) {
    var t = String(name)
      .replace(/[:_\-+]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/\bflight\b/g, "streamed data")
      .replace(/\bld json\b/g, "search-engine data")
      .replace(/\bpricemap\b/g, "price list")
      .replace(/\bjson\b/g, "page data")
      .replace(/\bdom\b/g, "page layout")
      .replace(/\bnext data\b/g, "page data block")
      .replace(/\bscript sweep\b/g, "a sweep of the page's scripts")
      .replace(/\bdata testid\b/g, "labelled elements");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : String(name);
  }

  function strategyLabel(name) {
    return STRATEGY_LABELS[name] || humanise(name);
  }

  function renderStrategies(result) {
    var diag = (result && result.diagnostics) || {};
    clear(el.strategyList);

    (diag.tiers || []).forEach(function (t) {
      var li = document.createElement("li");
      li.className = !t.ok ? "s-bad" : (t.produced > 0 ? "s-ok" : "s-none");
      li.textContent = strategyLabel(t.tier) + " — " +
        (!t.ok ? "didn't finish"
               : (t.produced > 0 ? t.produced + " found" : "nothing found")) +
        " (" + t.ms + " ms)";
      el.strategyList.appendChild(li);
    });

    if (!(diag.tiers || []).length) {
      var li2 = document.createElement("li");
      li2.className = "s-none";
      li2.textContent = "No record of what was tried on this page.";
      el.strategyList.appendChild(li2);
    }

    (diag.errors || []).forEach(function (e) {
      var li3 = document.createElement("li");
      li3.className = "s-bad";
      li3.textContent = strategyLabel(e.tier) + " — didn't finish: " +
        String(e.error).split("\n")[0];
      el.strategyList.appendChild(li3);
    });

    // What the page actually contained — the field-repair channel. Since the
    // live DOM cannot be inspected from here, this report is how a wrong guess
    // in extractor.js ever gets corrected.
    clear(el.pageFacts);
    var page = diag.page || {};

    function fact(label, value) {
      var dt = document.createElement("dt");
      dt.textContent = label;
      var dd = document.createElement("dd");
      dd.textContent = value;
      el.pageFacts.appendChild(dt);
      el.pageFacts.appendChild(dd);
    }

    Object.keys(page).forEach(function (k) {
      fact(FACT_LABELS[k] || humanise(k), factValue(page[k]));
    });

    // "Page access" is where the degraded-injection fact lives. The operator's
    // signal for it is the amber chip in the summary strip; the raw world name
    // belongs here, with the rest of the bug-report material.
    fact("Page access", state.world === "ISOLATED" ? "Limited (ISOLATED)"
                      : state.world === "MAIN" ? "Full (MAIN)" : "—");
    fact("Version", VERSION);
    if (result && result.__loadError) fact("Reader error", String(result.__loadError));
  }

  /* ---------------------------------------------------------------------- *
   * The summary strip
   * ---------------------------------------------------------------------- */

  /**
   * #stat-tier's className is overwritten wholesale here on every pass, so no
   * styling-only class may ever be put on that element in popup.html — it
   * would be destroyed after the first scrape. Both lines are built with
   * createElement + textContent.
   */
  function renderTierChip(family, plain, detail, tooltip) {
    el.statTier.className = "stat-value stat-tier tier-" + family;
    el.statTier.title = tooltip || (plain + (detail ? " · " + detail : ""));
    clear(el.statTier);
    el.statTier.appendChild(span("tier-plain", plain));
    if (detail) el.statTier.appendChild(span("tier-detail", detail));
  }

  function renderSummary(count, sections, summary) {
    el.summary.hidden = false;
    el.statCount.textContent = String(count);
    el.statSections.textContent = String(sections);

    if (summary.weakCount > 0) {
      el.statLow.textContent = String(summary.weakCount);
      el.statLowWrap.hidden = false;
    } else {
      el.statLowWrap.hidden = true;
    }

    renderTierChip(summary.family, summary.plain, summary.detail,
      summary.plain + " · " + summary.precise);
  }

  /* ---------------------------------------------------------------------- *
   * Failure explanations — a zero-row run must always say why
   * ---------------------------------------------------------------------- */

  function openHome() { chrome.tabs.create({ url: "https://turo.com/gb/en" }); }
  function homeAction() { return { label: "Open turo.com/gb/en", run: openHome, primary: true }; }
  function retryAction() { return { label: "Scrape page again", run: scrape }; }

  function explainIneligible(verdict) {
    resetResults();
    el.scrape.disabled = true;

    switch (verdict.code) {
      case "NOT_TURO":
        setPageState(verdict.detail || "Not Turo", "offsite", verdict.detail || "");
        el.scrape.title = "Open a Turo browse page to use this";
        setStatus("This tab is not on turo.com.", "info");
        renderPlaceholder(
          "This isn't a Turo page",
          "This extension only reads a Turo page you already have open. " +
          "Open a public browse page and try again.",
          null, homeAction(), "offsite");
        break;

      case "DISALLOWED":
        // A POLICY DECISION, not a failure. It is framed as one: amber, with
        // the reason stated, and nothing about it reads as broken.
        var what = PATH_COPY[verdict.detail] || "this part of the site";
        setPageState(verdict.detail + " · off limits", "blocked", verdict.detail);
        el.scrape.title = "This part of Turo is off limits";
        setStatus("Off limits — Turo asks tools not to read " + what + ".", "warn");
        renderPlaceholder(
          "This part of Turo is off limits",
          "Turo's site rules ask tools not to read " + what + ". This extension follows " +
          "those rules even though the page is already open on your screen — that line " +
          "is what keeps reading an open page distinct from crawling the site. Public " +
          "browse pages such as turo.com/gb/en work normally.",
          null, homeAction(), "blocked");
        break;

      case "NOT_WEB":
        setPageState("Browser page", "idle", verdict.detail || "");
        el.scrape.title = "Chrome doesn't allow extensions to read this kind of page";
        setStatus("Chrome doesn't allow extensions to read this kind of page.", "info");
        renderPlaceholder(
          "Nothing to read here",
          "Chrome keeps extensions out of its own pages — settings, the Web Store and " +
          "the built-in PDF viewer. Switch to a Turo tab and try again.",
          null, homeAction(), "blocked");
        break;

      default:
        setPageState("No tab", "idle", "");
        el.scrape.title = "Open a Turo browse page to use this";
        setStatus("No page is open in this window.", "bad");
        renderPlaceholder(
          "No page open",
          "Open a Turo browse page in a tab, then click the extension icon again.",
          null, homeAction(), "error");
    }
  }

  /**
   * A zero-row run. The extractor's own message is a paragraph of internals
   * ending in a JSON dump of the page fingerprint, so it goes to #raw-message
   * and the operator gets purpose-written copy instead.
   *
   * #summary is SHOWN here, with zeros. It used to be hidden — but
   * #details-toggle lives inside #summary, so hiding it left the details panel
   * this function force-opens with no visible control to close it.
   */
  function explainEmpty(result) {
    setStatus("No listings on this page yet.", "warn");
    renderSummary(0, 0, {
      family: "unknown", plain: "Source not recognised",
      detail: "Nothing extracted", precise: "Nothing extracted", weakCount: 0
    });
    renderPlaceholder(
      "This looks like a Turo page, but no listings have loaded",
      "Turo builds its rows as you scroll. Scroll down through the sections until the " +
      "cars appear, then scrape again.",
      [
        "Give the page a few seconds to finish loading, then try again.",
        "Browse pages such as turo.com/gb/en carry listings. Account, help and " +
          "checkout pages do not.",
        "If the page is clearly full of cars, press Copy diagnostics below and send " +
          "the report on — it records exactly what this page contained."
      ],
      retryAction(), "empty");

    setRawMessage(result && result.message);
    openDetails(true);
  }

  /**
   * #details is rendered AFTER <main> (CSS `order` in popup.css §1), so a
   * zero-row run explains itself before it shows diagnostics.
   *
   * openDetails() deliberately does NOT scroll. explainEmpty() and the
   * load-error branch call it to have the panel ALREADY open below the
   * explanation; scrolling here dragged the popup straight past the "no
   * listings loaded" copy to the diagnostics, so the operator opened the
   * popup already scrolled past the answer. Only the toggle scrolls, because
   * only there has the operator asked to look at the panel.
   */
  function openDetails(open) {
    el.details.hidden = !open;
    el.detailsToggle.setAttribute("aria-expanded", String(!!open));
  }

  /* ---------------------------------------------------------------------- *
   * Scrape
   * ---------------------------------------------------------------------- */

  function setBusy(busy) {
    el.scrape.classList.toggle("is-busy", busy);
    el.scrape.disabled = busy;
    el.scrape.setAttribute("aria-busy", String(!!busy));
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

    // On a re-scrape the existing table stays on screen, dimmed by CSS. A
    // table that vanishes and comes back reads as a bug.
    if (!state.rows.length) {
      renderPlaceholder(
        "Reading the page…",
        "Checking the page's own data first, then the page layout. On a long page " +
        "this takes a moment.",
        null, null, "ready");
    }

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

      var world = payload.world;
      var result = payload.res;

      resetResults();
      state.world = world;

      if (!result) {
        renderStrategies(null);
        setStatus("The page couldn't be read.", "bad");
        renderPlaceholder(
          "The page couldn't be read",
          "The reader started but the page sent nothing back. Reload the Turo tab, " +
          "then scrape again.",
          ["This normally clears after a reload."],
          retryAction(), "error");
        return;
      }

      if (result.__loadError) {
        renderStrategies(result);
        setStatus("The reader didn't start.", "bad");
        renderPlaceholder(
          "The reader didn't start on this page",
          "Reload the Turo tab and scrape again. If it keeps happening, open " +
          "“How it found these” and press Copy diagnostics.",
          null, retryAction(), "error");
        setRawMessage(String(result.__loadError));
        openDetails(true);
        return;
      }

      state.result = result;
      state.rows = result.rows || [];
      renderStrategies(result);

      // The extractor refuses independently of this popup's own guard.
      if (result.refused) {
        setPageState("off limits", "blocked", state.tabUrl);
        setStatus("Off limits — Turo asks tools not to read this part of the site.", "warn");
        renderPlaceholder(
          "This part of Turo is off limits",
          "Turo's site rules ask tools not to read this path. This extension follows " +
          "those rules even though the page is already open on your screen. Public " +
          "browse pages such as turo.com/gb/en work normally.",
          null, homeAction(), "blocked");
        setRawMessage(result.message);
        state.rows = [];
        return;
      }

      if (!state.rows.length) { explainEmpty(result); return; }

      var summary = summariseTiers(state.rows);
      var sections = (result.summary && result.summary.sections) || [];

      renderSummary(state.rows.length, sections.length, summary);
      el.worldChip.hidden = (world !== "ISOLATED");

      state.meta = {
        scrapedAt: new Date().toISOString(),
        pageUrl: state.tabUrl,
        pageTitle: state.tabTitle,
        tierSummary: summary.precise,
        world: world,
        version: VERSION,
        sections: sections,
        strategies: (result.diagnostics && result.diagnostics.tiers) || [],
        warnings: ((result.diagnostics && result.diagnostics.errors) || [])
          .map(function (e) { return e.tier + ": " + String(e.error).split("\n")[0]; })
      };

      renderRows(state.rows);
      setExportEnabled(true);
      setRawMessage("");

      var tone = summary.family === "json" ? "ok"
               : (summary.family === "heuristic" || summary.family === "unknown") ? "warn" : "info";
      var note = "Found " + state.rows.length + " listing" + (state.rows.length === 1 ? "" : "s") +
                 " across " + sections.length + " section" + (sections.length === 1 ? "" : "s") + ".";

      if (summary.weakCount === state.rows.length && summary.family === "heuristic") {
        note += " These were matched from the page layout, not from the page's own data " +
                "— check a few prices before you rely on them.";
      } else if (summary.weakCount > 0) {
        note += " " + summary.weakCount + " of them " +
                (summary.weakCount === 1 ? "was" : "were") +
                " guessed from the page layout — check those rows before you rely on them.";
      }
      if (summary.family === "unknown") {
        note += " Some rows came from a source this version does not recognise — " +
                "treat them as unchecked.";
      }
      // Kept SHORT on purpose. #world-chip is the designed home for this state
      // and says it in full; a long clause here pushed the status bar past its
      // 88px cap and truncated the sentence mid-word.
      if (world === "ISOLATED") {
        note += " It ran with limited access to the page — see below.";
      }
      setStatus(note, tone);
    })
    .catch(function (err) {
      setBusy(false);
      resetResults();
      setStatus("This page couldn't be read.", "bad");
      renderPlaceholder(
        "Chrome blocked the reader on this page",
        "Chrome would not let the extension run here. Access is granted only at the " +
        "moment you click the extension icon, and it ends when the page navigates.",
        [
          "Reload the tab, then click the extension icon again.",
          "If this tab was open before the extension was installed, reload it once."
        ],
        retryAction(), "error");
      setRawMessage(String((err && err.message) || err));
    });
  }

  /* ---------------------------------------------------------------------- *
   * Export
   * ---------------------------------------------------------------------- */

  function setExportEnabled(on) {
    el.download.disabled = !on;
    el.copy.disabled = !on;
    el.download.title = on ? "Download all rows as a CSV file" : "Scrape a page first";
    el.copy.title = on ? "Copy all rows, ready to paste into a spreadsheet"
                       : "Scrape a page first";
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

    setStatus("Saved " + name + " — " + state.rows.length + " rows, " +
              globalThis.TuroCSV.COLUMNS.length + " columns.", "ok");
  }

  function copyForSheets() {
    if (!state.rows.length) return;
    var tsv = globalThis.TuroCSV.buildTSV(state.rows);
    navigator.clipboard.writeText(tsv).then(function () {
      setStatus("Copied " + state.rows.length + " rows. Paste straight into a spreadsheet.", "ok");
    }).catch(function () {
      setStatus("The clipboard isn't available here. Use Download CSV instead.", "bad");
    });
  }

  function copyDiagnostics() {
    var blob = {
      version: VERSION,
      pageUrl: state.tabUrl,
      world: state.world,
      rows: state.rows.length,
      message: state.result && state.result.message,
      summary: state.result && state.result.summary,
      diagnostics: state.result && state.result.diagnostics
    };
    navigator.clipboard.writeText(JSON.stringify(blob, null, 2)).then(function () {
      setStatus("Diagnostics copied. Paste them into your message and send it on.", "ok");
    }).catch(function () {
      setStatus("The clipboard isn't available here. The same detail is listed " +
                "under “How it found these” — send a screenshot of it instead.", "bad");
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
    el.statLow = $("stat-low");
    el.statLowWrap = $("stat-low-wrap");
    el.worldChip = $("world-chip");
    el.details = $("details");
    el.detailsToggle = $("details-toggle");
    el.tierLegend = $("tier-legend");
    el.strategyList = $("strategy-list");
    el.pageFacts = $("page-facts");
    el.rawMessage = $("raw-message");
    el.rawTitle = $("raw-title");
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
      var opening = el.details.hidden;
      openDetails(opening);
      // The panel sits below the table in the shared scroller, so on a long
      // scrape it opens off-screen and the toggle looks dead. Bring it up.
      if (opening && el.details.scrollIntoView) {
        el.details.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });

    renderLegend();
    setExportEnabled(false);

    currentTab().then(function (tab) {
      if (!tab) { explainIneligible({ code: "NO_TAB" }); return; }
      var verdict = classifyUrl(tab.url || "");
      if (!verdict.ok) { explainIneligible(verdict); return; }

      setPageState(verdict.detail, "ok", tab.url || verdict.detail);
      el.scrape.disabled = false;
      el.scrape.title = "Read the listings on the page you have open";
      setStatus("", null);
      renderPlaceholder(
        "Ready to read this page",
        "Press Scrape page and every listing on the page you already have open is " +
        "read into a table you can export.",
        [
          "Turo loads its rows as you scroll. Scroll to the bottom of the page first " +
            "to include more of them.",
          "The page is read here in your browser. Nothing is sent anywhere.",
          "Every row is labelled with how it was found, so you can see which ones to " +
            "double-check."
        ],
        null, "mark");
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
