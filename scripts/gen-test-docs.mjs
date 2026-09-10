#!/usr/bin/env node
/**
 * gen-test-docs.mjs — generate tests/TEST-CATALOGUE.md from the suite itself.
 *
 * WHY THIS IS GENERATED AND NOT WRITTEN BY HAND
 * --------------------------------------------
 * The team lead asked for documentation of every test, and said he would not read
 * each one but that each must make sense. A hand-maintained list of ~1000 test
 * names goes stale on the first commit and then actively lies. So this reads the
 * suite's own JSON report — `vitest --reporter=json`, the format he was reaching
 * for — and derives the catalogue from what actually ran.
 *
 * It adds three things the raw report does not carry:
 *
 *   1. LAYER, inferred from hard evidence in each file rather than a convention
 *      someone has to remember: importing `live-call` means it has Layer 2 tests;
 *      reading source text (readFileSync / readEdgeFunction) means Layer 1;
 *      importing a real module through `@fn`/relative app paths and calling it
 *      means Layer 3. A file can be more than one, and unclassifiable is reported
 *      as such rather than guessed.
 *
 *   2. WATCHDOGS. `it.fails(...)` tests report as `passed` in the JSON when their
 *      inner assertion fails — which is the watchdog working correctly — so they
 *      are indistinguishable in the report. They are recovered by parsing each
 *      source file for `it.fails(` and matching titles. These are the entries that
 *      document a KNOWN DEFECT: green today, red the day it is fixed.
 *
 *   3. USE CASE, taken from the `@usecase` line of each describe block's preceding
 *      comment when present. Never invented: absent means absent.
 *
 * Usage:  node scripts/gen-test-docs.mjs [--json]
 *         npm run test:docs
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const OUT_MD = join(ROOT, "tests/TEST-CATALOGUE.md");
const OUT_JSON = join(ROOT, "tests/test-catalogue.json");

// --- 1. run the suite and collect its own report ---------------------------
const tmp = mkdtempSync(join(tmpdir(), "d247-testdocs-"));
const reportPath = join(tmp, "results.json");

console.error("running the suite to harvest its report…");
try {
  execSync(
    `npx vitest run --config tests/vitest.config.ts --reporter=json --outputFile=${reportPath}`,
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], timeout: 900_000 },
  );
} catch {
  // A failing suite still writes the report, and a catalogue of a red suite is
  // exactly when you want one. Carry on and mark the failures.
  console.error("suite reported failures — cataloguing anyway, failures are marked");
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));

// --- 2. per-file evidence: layers, and which titles are watchdogs ----------
const LAYER_EVIDENCE = [
  { layer: "L2 live", test: (s) => /from\s+["'][^"']*live-call/.test(s) || /liveCall|describeLive|itLive/.test(s) },
  { layer: "L1 contract", test: (s) => /readEdgeFunction|readFileSync|readSharedClientSource|readEdgeFunctionSource/.test(s) },
  { layer: "L3 executable", test: (s) => /from\s+["']@fn\/|from\s+["']\.\.\/\.\.\/\.\.\/apps\/|liftEdgeFunction|readPremiumModel|readRateCard/.test(s) },
];

/** Titles declared with it.fails(...) — the known-defect watchdogs. */
function watchdogTitles(src) {
  const out = new Set();
  // it.fails("…") / test.fails('…') / it.fails(`…`)
  for (const m of src.matchAll(/\b(?:it|test)\.fails\s*\(\s*(["'`])([\s\S]*?)\1/g)) {
    out.add(m[2].replace(/\s+/g, " ").trim());
  }
  return out;
}

/**
 * `@usecase …` in the comment block immediately preceding a describe.
 *
 * Parsed line-by-line rather than with one regex because the text is usually
 * WRAPPED across several `//` lines, and a single-line capture silently truncated
 * it at the first newline — which produced half-sentences in the catalogue.
 * Continuation lines are joined until the comment run ends or the describe starts.
 */
function useCases(src) {
  const map = new Map();
  const lines = src.split("\n");
  const commentText = (l) => {
    const m = /^\s*(?:\/\/|\*)\s?(.*)$/.exec(l);
    return m ? m[1].trimEnd() : null;
  };

  for (let i = 0; i < lines.length; i++) {
    const c = commentText(lines[i]);
    if (c === null || !/@usecase\b/.test(c)) continue;

    const parts = [c.replace(/.*@usecase\s*/, "").trim()];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const cont = commentText(lines[j]);
      if (cont === null) break;              // comment run ended
      if (!cont.trim()) break;               // blank comment line ends the paragraph
      if (/@\w+/.test(cont)) break;          // a different annotation
      parts.push(cont.trim());
    }

    // The next describe(...) within a short window is the one being annotated.
    const window = lines.slice(j, j + 6).join("\n");
    const d = /describe\s*\(\s*(["\'`])([\s\S]*?)\1/.exec(window);
    // Join, but respect a hyphen the wrapper broke across lines: a part ending in
    // "-" followed by a lowercase continuation is one word ("re-" + "bills"), not
    // two, so joining those with a space would print "re- bills".
    let text = "";
    for (const part of parts) {
      if (!text) { text = part; continue; }
      text += /-$/.test(text) && /^[a-z]/.test(part) ? part : " " + part;
    }
    if (d) map.set(d[2].replace(/\s+/g, " ").trim(), text.replace(/\s+/g, " ").trim());
  }
  return map;
}

/** The leading block comment of a file, as its stated purpose. */
function fileHeader(src) {
  const m = /^\s*\/\*\*([\s\S]*?)\*\//.exec(src);
  if (!m) return null;
  const lines = m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*\*ted?\s?/, "").replace(/^\s*\*\s?/, "").trimEnd())
    .filter((l) => !/^-{3,}$/.test(l.trim()));
  // The purpose is the first paragraph: up to the first blank line.
  const para = [];
  for (const l of lines) {
    if (!l.trim() && para.length) break;
    if (l.trim()) para.push(l.trim());
  }
  return para.join(" ") || null;
}

// --- 3. assemble ------------------------------------------------------------
const files = [];
for (const f of report.testResults || []) {
  const abs = f.name;
  const rel = relative(ROOT, abs);
  let src = "";
  try { src = readFileSync(abs, "utf8"); } catch { /* file moved mid-run */ }

  const layers = LAYER_EVIDENCE.filter((e) => e.test(src)).map((e) => e.layer);
  const dogs = watchdogTitles(src);
  const cases = useCases(src);

  const blocks = new Map();
  for (const a of f.assertionResults || []) {
    const key = (a.ancestorTitles || []).join(" › ") || "(no describe)";
    if (!blocks.has(key)) blocks.set(key, []);
    const title = (a.title || "").replace(/\s+/g, " ").trim();
    blocks.get(key).push({
      title,
      status: a.status,
      watchdog: dogs.has(title),
    });
  }

  files.push({
    file: rel,
    purpose: fileHeader(src),
    layers: layers.length ? layers : ["unclassified"],
    blocks: [...blocks.entries()].map(([describe, tests]) => ({
      describe,
      useCase: cases.get(describe) || null,
      tests,
    })),
    counts: {
      total: (f.assertionResults || []).length,
      passed: (f.assertionResults || []).filter((a) => a.status === "passed").length,
      skipped: (f.assertionResults || []).filter((a) => a.status === "pending" || a.status === "skipped").length,
      failed: (f.assertionResults || []).filter((a) => a.status === "failed").length,
      watchdogs: (f.assertionResults || []).filter((a) => dogs.has((a.title || "").replace(/\s+/g, " ").trim())).length,
    },
  });
}

files.sort((a, b) => a.file.localeCompare(b.file));

const totals = files.reduce(
  (t, f) => ({
    total: t.total + f.counts.total,
    passed: t.passed + f.counts.passed,
    skipped: t.skipped + f.counts.skipped,
    failed: t.failed + f.counts.failed,
    watchdogs: t.watchdogs + f.counts.watchdogs,
  }),
  { total: 0, passed: 0, skipped: 0, failed: 0, watchdogs: 0 },
);

// --- 4. emit ----------------------------------------------------------------
const esc = (s) => String(s).replace(/\|/g, "\\|");

let md = `# Test catalogue

**GENERATED FILE — do not edit by hand.** Regenerate with \`npm run test:docs\`
(which runs the suite and rebuilds this from its own JSON report). Editing this
file directly means the next run silently discards your change.

Every test title below is the string the suite actually ran. If a title does not
read as a sentence about behaviour, that is a defect in the test, not in this
document — see the naming convention in [README.md](./README.md#naming-convention).

| | |
|---|---|
| Test files | ${files.length} |
| Tests | ${totals.total} |
| Passing | ${totals.passed} |
| Skipped (opt-in Layer 2) | ${totals.skipped} |
| Failing | ${totals.failed} |
| Known-defect watchdogs | ${totals.watchdogs} |

## How to read this

- **Layer** is inferred from evidence in the file, not from a naming rule.
  \`L1 contract\` reads edge-function source text offline. \`L2 live\` makes real
  HTTP calls and is skipped unless explicitly enabled. \`L3 executable\` imports
  the shipped module and runs it against hand-derived literals.
- **⚠ watchdog** marks a test declared with \`it.fails(...)\`. It documents a
  **known, unfixed defect**: the test states the CORRECT behaviour, so it passes
  while the bug exists and turns **red the day someone fixes it**, which forces
  the stale expectation to be revisited. A watchdog going red is good news.
- **skipped** means an opt-in Layer 2 test that needs credentials. Not a failure.

`;

for (const f of files) {
  md += `\n## \`${f.file}\`\n\n`;
  md += `**Layer:** ${f.layers.join(", ")} · **${f.counts.total} tests** `;
  md += `(${f.counts.passed} passing`;
  if (f.counts.skipped) md += `, ${f.counts.skipped} skipped`;
  if (f.counts.failed) md += `, **${f.counts.failed} FAILING**`;
  if (f.counts.watchdogs) md += `, ${f.counts.watchdogs} watchdog`;
  md += `)\n\n`;
  if (f.purpose) md += `${f.purpose}\n\n`;

  for (const b of f.blocks) {
    md += `### ${esc(b.describe)}\n\n`;
    if (b.useCase) md += `*Use case: ${esc(b.useCase)}*\n\n`;
    for (const t of b.tests) {
      const flags = [];
      if (t.watchdog) flags.push("⚠ watchdog");
      if (t.status === "pending" || t.status === "skipped") flags.push("skipped");
      if (t.status === "failed") flags.push("**FAILING**");
      md += `- it ${esc(t.title)}${flags.length ? ` — ${flags.join(", ")}` : ""}\n`;
    }
    md += `\n`;
  }
}

writeFileSync(OUT_MD, md);
writeFileSync(OUT_JSON, JSON.stringify({ totals, files }, null, 2));

console.error(`wrote ${relative(ROOT, OUT_MD)} and ${relative(ROOT, OUT_JSON)}`);
console.error(
  `${files.length} files · ${totals.total} tests · ${totals.passed} passing · ` +
  `${totals.skipped} skipped · ${totals.failed} failing · ${totals.watchdogs} watchdogs`,
);
if (process.argv.includes("--json")) process.stdout.write(JSON.stringify({ totals, files }, null, 2));
