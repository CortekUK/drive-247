#!/usr/bin/env node
/**
 * build-prd.mjs — docs/application/PRD.md  ->  docs/application/PRD.pdf
 *
 * The PRD is one document for the whole application (see .claude/skills/prd).
 * People read the PDF; the markdown beside it is the source and is the only
 * file that is edited.
 *
 *   node scripts/build-prd.mjs
 *
 * It needs a browser to print the page. It tries Playwright's own Chromium,
 * then Chrome, then Edge (every Windows machine has Edge), so there is nothing
 * to install on most machines. If none is found:  npx playwright install chromium
 *
 * The markdown reader below is small on purpose: the PRD uses headings,
 * paragraphs, lists, tables, **bold** and `code`, and nothing else. No package
 * to install or to break.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "docs", "application", "PRD.md");
const OUT = join(ROOT, "docs", "application", "PRD.pdf");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

/** The PRD's subset of markdown, as HTML. */
function toHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const isBlockStart = (l) => /^(#{1,3} |[-*] |\d+\. |\|)/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,3}) (.*)$/);
    if (h) {
      const level = h[1].length;
      const feature = level === 2 && /^feat-\d+/.test(h[2]);
      out.push(`<h${level}${feature ? ' class="feature"' : ""}>${inline(h[2])}</h${level}>`);
      i++; continue;
    }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
      const body = rows.filter((r) => !/^\|[\s:|-]+\|?\s*$/.test(r));
      out.push("<table><thead><tr>" + cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
        body.slice(1).map((r) => "<tr>" + cells(r).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
      continue;
    }
    const list = line.match(/^([-*]|\d+\.) /);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items = [];
      while (i < lines.length && (ordered ? /^\d+\. / : /^[-*] /).test(lines[i])) {
        let item = lines[i++].replace(/^([-*]|\d+\.) /, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item += " " + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

if (!existsSync(SRC)) {
  console.error(`No PRD source at ${SRC}`);
  process.exit(1);
}
const md = readFileSync(SRC, "utf8");
const features = (md.match(/^## feat-\d+/gm) || []).length;
const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 18mm 17mm 16mm; }
body { font-family: -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #080812; font-size: 10.5pt; line-height: 1.5; }
h1 { font-size: 24pt; font-weight: 600; margin: 0 0 4pt; }
h2 { font-size: 15pt; font-weight: 600; margin: 20pt 0 6pt; break-after: avoid; }
h2.feature { break-before: page; margin-top: 0; padding-bottom: 6pt; border-bottom: 1px solid #e0e7ff; color: #4338ca; }
h3 { font-size: 11.5pt; font-weight: 600; margin: 14pt 0 3pt; break-after: avoid; }
p { margin: 4pt 0; color: #404040; } li { color: #404040; margin: 2pt 0; } li strong, p strong { color: #080812; }
ul, ol { margin: 4pt 0 4pt 16pt; padding: 0; }
code { font: 9pt Menlo, Consolas, monospace; background: #f1f5f9; padding: 0 3px; border-radius: 3px; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0; font-size: 9.5pt; }
th { background: #eef2ff; text-align: left; font-weight: 600; } th, td { border: 1px solid #e2e8f0; padding: 5pt 7pt; vertical-align: top; }
.stamp { color: #737373; font-size: 9pt; margin-bottom: 12pt; }
</style></head><body>
${toHtml(md).replace("</h1>", `</h1><div class="stamp">${features} feature${features === 1 ? "" : "s"} · built ${today}</div>`)}
</body></html>`;

let chromium;
try {
  // Playwright is installed with the booking app and lifted to the root by npm.
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("Playwright is not installed. Run:  npm install");
  process.exit(1);
}

let browser = null;
for (const options of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
  try { browser = await chromium.launch(options); break; } catch { /* try the next browser */ }
}
if (!browser) {
  console.error("No browser found to print the PDF. Run:  npx playwright install chromium");
  process.exit(1);
}
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.pdf({
  path: OUT,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: '<div style="width:100%;font-size:8px;color:#737373;padding:0 17mm;display:flex;justify-content:space-between"><span>Drive247 PRD</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log(`PRD.pdf written  (${features} feature${features === 1 ? "" : "s"})`);
