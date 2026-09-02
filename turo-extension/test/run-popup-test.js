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

  console.log("\n" + (fail ? "FAILED" : "PASSED") + " — " + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})();
