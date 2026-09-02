/* =============================================================================
 * run-popup-test.js — drives popup.html/popup.js with a mocked chrome API.
 * Proves the popup boots, injects, renders and exports. Run: node test/run-popup-test.js
 * ========================================================================== */
"use strict";
const fs = require("fs"), path = require("path");
const EXT = path.resolve(__dirname, "..");
let JSDOM;
try { ({ JSDOM } = require(path.resolve(EXT, "../node_modules/jsdom"))); }
catch (e) { ({ JSDOM } = require("jsdom")); }

let pass = 0, fail = 0;
function check(name, fn) {
  let probs; try { probs = fn() || []; } catch (e) { probs = ["threw: " + (e && e.stack || e)]; }
  if (probs.length) { fail++; console.log("  FAIL  " + name); probs.forEach(x => console.log("        - " + x)); }
  else { pass++; console.log("  ok    " + name); }
}

/* Boot the popup against a fake tab. The mocked chrome.scripting.executeScript
 * mirrors Chrome's real contract: `files` evaluates them in the page, `func`
 * runs a function there and returns [{result}]. */
function bootPopup(tabUrl, opts) {
  opts = opts || {};
  const pageDom = new JSDOM(fs.readFileSync(path.join(__dirname, "fixture-flight.html"), "utf8"),
    { url: tabUrl, runScripts: "dangerously" });
  const page = pageDom.window;

  const popupDom = new JSDOM(fs.readFileSync(path.join(EXT, "popup.html"), "utf8"),
    { url: "chrome-extension://abc/popup.html", runScripts: "outside-only" });
  const win = popupDom.window;
  const calls = { worlds: [] };

  win.chrome = {
    runtime: { getManifest: () => ({ version: "1.0.0" }), lastError: null },
    tabs: { query: (q, cb) => cb([{ id: 1, url: tabUrl, title: "Turo | Car rental" }]) },
    scripting: {
      executeScript: (o, cb) => {
        if (o.world === "MAIN" && opts.refuseMain) { win.chrome.runtime.lastError = { message: "blocked" }; cb(); win.chrome.runtime.lastError = null; return; }
        if (calls.worlds.indexOf(o.world) === -1) calls.worlds.push(o.world);
        if (o.files) { o.files.forEach(f => page.eval(fs.readFileSync(path.join(EXT, f), "utf8"))); return cb([{ result: null }]); }
        cb([{ result: page.eval("(" + o.func.toString() + ")()") }]);
      }
    }
  };
  // Blob/URL plumbing so the CSV download path can be exercised headlessly.
  const saved = [];
  win.URL.createObjectURL = b => { saved.push(b); return "blob:mock/" + saved.length; };
  win.URL.revokeObjectURL = () => {};
  for (const lib of ["parsers.js", "csv.js", "popup.js"])
    win.eval(fs.readFileSync(path.join(EXT, lib), "utf8"));
  return { win, calls, saved };
}
const settle = () => new Promise(r => setTimeout(r, 60));
// jsdom Blobs keep their parts; read them back without FileReader (which strips
// the BOM per the encoding spec and would make a correct file look wrong).
function blobText(blob) {
  // jsdom stores the bytes on the impl object behind Symbol(impl). Reading the
  // buffer directly is deliberate: FileReader.readAsText strips the BOM per the
  // encoding spec, which would make a correctly-BOM'd file look broken.
  const sym = Object.getOwnPropertySymbols(blob).find(x => String(x) === "Symbol(impl)");
  const impl = sym ? blob[sym] : null;
  if (impl && impl._buffer) return Buffer.from(impl._buffer).toString("utf8");
  throw new Error("could not read jsdom Blob bytes");
}

(async () => {
  console.log("\nPOPUP — end to end on an allowed Turo page");
  const { win, calls, saved } = bootPopup("https://turo.com/gb/en");
  await settle();
  win.document.getElementById("scrape").click();
  await settle();

  check("the popup boots and enables the scrape button", () => {
    const p = [];
    if (win.document.getElementById("scrape").disabled) p.push("scrape button still disabled");
    return p;
  });

  check("it injects into the MAIN world (page globals need it)", () => {
    const p = [];
    if (calls.worlds[0] !== "MAIN") p.push("first world was " + calls.worlds[0] + ", expected MAIN");
    return p;
  });

  check("rows are rendered into the table", () => {
    const p = [];
    const trs = win.document.querySelectorAll("#rows tr");
    if (trs.length !== 3) p.push("expected 3 rendered rows, got " + trs.length);
    const txt = win.document.getElementById("rows").textContent;
    if (txt.indexOf("Volkswagen Tiguan") === -1) p.push("Tiguan not rendered");
    if (txt.indexOf("£1,014/month") === -1) p.push("price not rendered");
    return p;
  });

  check("scraped strings are inserted as text, never as markup", () => {
    const p = [];
    // The popup holds extension privileges over third-party page content.
    if (/innerHTML\s*=/.test(fs.readFileSync(path.join(EXT, "popup.js"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")))
      p.push("popup.js assigns innerHTML somewhere");
    return p;
  });

  check("export buttons become enabled once there are rows", () => {
    const p = [];
    ["download", "copy"].forEach(id => {
      const b = win.document.getElementById(id);
      if (!b) return p.push("#" + id + " missing");
      if (b.disabled) p.push("#" + id + " still disabled after a successful scrape");
    });
    return p;
  });

  // Capture what the download button actually hands to the browser.
  {
    const before = saved.length;
    win.document.getElementById("download").click();
    check("Download CSV emits a blob with a BOM and the scraped data", () => {
      const p = [];
      if (saved.length !== before + 1) return ["no blob was created by the download button"];
      const blob = saved[saved.length - 1];
      const text = blobText(blob);
      const bytes = Buffer.from(text, "utf8");
      if (!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF))
        p.push("blob has no UTF-8 BOM — Excel would render £ as Â£");
      if (text.indexOf("Volkswagen Tiguan") === -1) p.push("blob does not contain the scraped rows");
      if (text.indexOf("£1,014/month") === -1) p.push("blob lost the price");
      if (text.indexOf("\r\n") === -1) p.push("blob has no CRLF line endings");
      if (bytes.length < 500) p.push("blob suspiciously small: " + bytes.length + " bytes");
      const a = win.document.querySelector("a[download]");
      if (a && !/\.csv$/.test(a.download || "")) p.push("download filename is not a .csv: " + a.download);
      return p;
    });
  }

  console.log("\nPOPUP — refusals");
  for (const [url, why] of [
    ["https://turo.com/gb/en/search", "locale-prefixed /search"],
    ["https://turo.com/search", "bare /search"],
    ["https://turo.com/drivers/99", "/drivers/"],
    ["https://turo.com/gb/en/p/host", "/{locale}/p/*"]
  ]) {
    const b = bootPopup(url); await settle();
    check("refuses " + why + " with the button disabled", () => {
      const p = [];
      if (!b.win.document.getElementById("scrape").disabled)
        p.push("scrape button was left enabled on " + url);
      if (b.calls.worlds.length) p.push("injected into the page anyway");
      return p;
    });
  }

  const off = bootPopup("https://example.com/"); await settle();
  check("a non-Turo tab is refused", () => {
    const p = [];
    if (!off.win.document.getElementById("scrape").disabled) p.push("button enabled off-Turo");
    if (off.calls.worlds.length) p.push("injected into a non-Turo page");
    return p;
  });

  console.log("\nPOPUP — degraded injection");
  const fb = bootPopup("https://turo.com/gb/en", { refuseMain: true }); await settle();
  fb.win.document.getElementById("scrape").click(); await settle();
  check("falls back to ISOLATED when MAIN is refused, and says so", () => {
    const p = [];
    if (fb.calls.worlds.indexOf("ISOLATED") === -1) p.push("never tried ISOLATED");
    const body = fb.win.document.body.textContent;
    if (body.indexOf("isolated") === -1 && body.indexOf("ISOLATED") === -1)
      p.push("the degraded world was not surfaced to the operator");
    return p;
  });

  /* ===========================================================================
   * ACCESSIBILITY
   *
   * Added deliberately after an audit. Each of these guards a defect that was
   * actually present, so each one fails if the defect comes back.
   * ======================================================================== */
  console.log("\nPOPUP — accessibility");

  const CSS = fs.readFileSync(path.join(EXT, "popup.css"), "utf8");
  const JS  = fs.readFileSync(path.join(EXT, "popup.js"),  "utf8");
  const HTML= fs.readFileSync(path.join(EXT, "popup.html"),"utf8");

  const a11y = bootPopup("https://turo.com/gb/en");
  await settle();

  check("every button's accessible name contains its visible label (WCAG 2.5.3)", () => {
    // Was broken on all three of Scrape page / Copy for Sheets / Download CSV:
    // each carried an aria-label that REPLACED the words on the button, so
    // "click Scrape page" could not reach it by voice.
    const p = [];
    a11y.win.document.querySelectorAll("button").forEach(b => {
      // A hidden button is not exposed and has no purpose yet; #placeholder-action
      // is given its label at the moment a state actually offers an action.
      if (b.hasAttribute("hidden")) return;
      const visible = (b.textContent || "").replace(/\s+/g, " ").trim();
      const label = b.getAttribute("aria-label");
      if (!visible && !label) p.push("a button has no name at all");
      if (visible && label &&
          label.toLowerCase().indexOf(visible.toLowerCase()) === -1)
        p.push('aria-label "' + label + '" does not contain visible text "' + visible + '"');
    });
    return p;
  });

  check("the status live region is never removed from the accessibility tree", () => {
    // It used to toggle `hidden`. A live region inserted and populated in the
    // same frame is not reliably announced, which is every status change here.
    const p = [];
    const st = a11y.win.document.getElementById("status");
    if (!st) return ["#status missing"];
    if (st.hasAttribute("hidden")) p.push("#status carries `hidden` at rest");
    if (/el\.status\.hidden\s*=/.test(JS)) p.push("popup.js still toggles el.status.hidden");
    if (!/\.status:empty/.test(CSS)) p.push("no .status:empty rule to collapse it when idle");
    a11y.win.document.getElementById("scrape").click();
    return p;
  });
  await settle();

  check("a status message reaches the live region, unhidden", () => {
    const st = a11y.win.document.getElementById("status");
    const p = [];
    if (st.hasAttribute("hidden")) p.push("#status was hidden while carrying a message");
    if (!(st.textContent || "").trim()) p.push("#status carries no text after a scrape");
    if (st.getAttribute("aria-live") !== "polite") p.push("#status lost aria-live");
    return p;
  });

  check("the scroll region can take keyboard focus (WCAG 2.1.1)", () => {
    const p = [];
    const sc = a11y.win.document.getElementById("scroll");
    if (!sc) return ["#scroll missing"];
    if (sc.getAttribute("tabindex") !== "0")
      p.push("the only scroll container is not focusable, so it cannot be scrolled from a keyboard");
    if (!/\.scroll:focus-visible/.test(CSS)) p.push("no focus ring on the scroll region");
    return p;
  });

  check("no table cell is removed by the empty-value rule", () => {
    // display:none on a <td> drops it from the accessibility tree, and these
    // rows are display:grid (implicit table roles already stripped), so a
    // missing cell shifts every later cell one column left — a row with no
    // year announced its rating under the heading "Year".
    const p = [];
    if (/td:has\(> span\.muted:only-child\)[^{]*\{[^}]*display:\s*none/.test(CSS))
      p.push("popup.css still sets display:none on a <td>");
    const cells = a11y.win.document.querySelectorAll("#rows tr:first-child td");
    const heads = a11y.win.document.querySelectorAll(".grid thead th");
    if (cells.length !== heads.length)
      p.push("row has " + cells.length + " cells against " + heads.length + " headers");
    return p;
  });

  check("decorative CSS glyphs declare alternative text", () => {
    // Chrome exposes generated content to the a11y tree: without `/ ""` the
    // status reads as "check mark Found 12 listings", the caret as "black
    // down-pointing small triangle", the rating as "black star 4.9".
    const p = [];
    const glyphs = CSS.match(/content:\s*"(?!\s*\/)[^"]+"\s*;/g) || [];
    glyphs.forEach(g => {
      const val = g.match(/content:\s*("[^"]+")/)[1];
      if (CSS.indexOf("content: " + val + " / \"\"") === -1)
        p.push("no alternative text declared for content: " + val);
    });
    return p;
  });

  check("prefers-reduced-motion neutralises delay as well as duration", () => {
    const p = [];
    const m = CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/);
    if (!m) return ["no prefers-reduced-motion block"];
    if (!/animation-delay:\s*0m?s\s*!important/.test(m[0]))
      p.push("row stagger still holds rows invisible for up to 126ms");
    return p;
  });

  check("a mixed-source row is distinguishable without colour, and audibly", () => {
    // The old signal was `box-shadow: inset 0 -1px 0` — invisible in practice
    // and flattened away under forced colours, i.e. an honesty signal nobody
    // would ever see.
    const p = [];
    if (/\.src--mixed\s*\{[^}]*box-shadow/.test(CSS))
      p.push(".src--mixed is still a 1px inset shadow");
    if (!/\.src--mixed\s*\{[^}]*border:/.test(CSS))
      p.push(".src--mixed has no visible border");
    if (!/\.src--mixed::after\s*\{[^}]*content:/.test(CSS))
      p.push(".src--mixed carries no non-colour mark");
    if (!/__filledFromLowerTier[\s\S]{0,320}sr-only/.test(JS))
      p.push("popup.js gives a screen reader no text for a mixed-source row");
    return p;
  });

  check("no operator-facing copy leaks the extractor's vocabulary", () => {
    const p = [];
    const strings = JS
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      // Line-bounded, or the match runs across code between two quotes.
      .match(/"(?:[^"\\\n]){14,}"/g) || [];
    const BANNED = /\b(DOM|heuristics?|flight|schema\.org|microdata|test hooks|JSON-LD)\b/i;
    strings.forEach(s2 => { if (BANNED.test(s2)) p.push("jargon in operator copy: " + s2); });
    if (BANNED.test(HTML.replace(/<!--[\s\S]*?-->/g, ""))) p.push("jargon in popup.html copy");
    return p;
  });

  check("the document has exactly one h1 and it names the product", () => {
    const p = [];
    const h1 = a11y.win.document.querySelectorAll("h1");
    if (h1.length !== 1) p.push("found " + h1.length + " h1 elements, expected 1");
    else if (!/Drive247/.test(h1[0].textContent)) p.push("h1 does not name the product");
    return p;
  });

  console.log("\n" + (fail ? "FAILED" : "PASSED") + " — " + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
