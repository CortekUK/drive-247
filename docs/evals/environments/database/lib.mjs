/**
 * lib.mjs — shared plumbing for the database evals.
 *
 * Holds the one place that talks to Supabase, the one place that applies
 * accepted differences, and the one place that prints and writes a report.
 * The eval scripts only describe WHAT to compare.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..", "..", "..");
export const PROD_REF = "hviqoaokxvlancmftwuo";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const argv = process.argv.slice(2);
export const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
export const flag = (name) => argv.includes(`--${name}`);
export const isMain = (metaUrl) => process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;

function credential(name) {
  if (process.env[name]) return process.env[name];
  const file = join(ROOT, ".staging-credentials.local");
  if (!existsSync(file)) return undefined;
  // Last assignment wins, so a newer block appended to the file overrides an older one.
  const hits = [...readFileSync(file, "utf8").matchAll(new RegExp(`^${name}=(.+)$`, "gm"))];
  return hits.length ? hits[hits.length - 1][1].trim() : undefined;
}

export const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
export const TARGET = arg("target") || credential("STAGING_REF");
export const STAGING_DB_PASS = credential("STAGING_DB_PASS");

export function die(msg) {
  console.error(msg);
  process.exit(2);
}

export function requireSetup() {
  if (!TOKEN) die("Set SUPABASE_ACCESS_TOKEN.");
  if (!TARGET) die("Pass --target <staging-ref>, or put STAGING_REF in .staging-credentials.local.");
  if (TARGET === PROD_REF) die("Target is the production ref. Refusing.");
}

async function call(url, init, label) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": UA, ...(init?.headers || {}) },
      });
    } catch (e) {
      // A dropped connection is not an answer. Retry, then fail loudly.
      if (attempt < 5) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
      throw new Error(`${label}: network error, ${e.message}`);
    }
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : null;
    if (attempt < 5 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(`${label}: HTTP ${res.status} ${text.slice(0, 600)}`);
  }
}

/**
 * Run SQL on a project. Read-only unless { write: true } — and a write to
 * production is refused here, in the only function that can reach a database,
 * so no eval script can do it by mistake.
 */
export async function sql(ref, query, { write = false } = {}) {
  if (write && ref === PROD_REF) throw new Error("REFUSED: write attempted against production.");
  return call(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    { method: "POST", body: JSON.stringify(write ? { query } : { query, read_only: true }) },
    ref,
  );
}

/** GET raw bytes from the Management API (a deployed function's code). Never a write. */
export async function mgmtBytes(ref, path) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, { headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": UA } }).catch(() => null);
    if (res?.ok) {
      // The connection can drop halfway through a large download. That is not an answer: ask again.
      const bytes = await res.arrayBuffer().catch(() => null);
      if (bytes) return Buffer.from(bytes);
      if (attempt < 6) { await new Promise((r) => setTimeout(r, 3000 * attempt)); continue; }
      throw new Error(`${ref}${path}: the download kept dropping`);
    }
    if (res?.status === 404) return null;
    if (attempt < 6 && (!res || res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 3000 * attempt)); continue; }
    throw new Error(`${ref}${path}: HTTP ${res?.status ?? "no answer"}`);
  }
}

/** GET a Supabase project setting (never a write). */
export const mgmtGet = (ref, path) => call(`https://api.supabase.com/v1/projects/${ref}${path}`, { method: "GET" }, `${ref}${path}`);

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
/** Hide the two things that legitimately differ between two projects. */
export const mask = (s) =>
  String(s ?? "")
    .replaceAll(PROD_REF, "<REF>")
    .replaceAll(TARGET ?? "\u0000", "<REF>")
    .replace(JWT, "<JWT>")
    .replace(/\r\n/g, "\n");

export function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 30);
  const cut = (s) => s.slice(from, i + 70).replace(/\s+/g, " ");
  return `prod: ...${cut(a)}...  staging: ...${cut(b)}...`;
}

/** Compare two lists of { k, d } rows into a check result. */
export function compare(name, prodRows, stagRows, extra = {}) {
  const toMap = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(mask(r.k), mask(r.d));
    return m;
  };
  const prod = toMap(prodRows);
  const stag = toMap(stagRows);
  return {
    name,
    kind: "parity",
    prod: prod.size,
    staging: stag.size,
    missing: [...prod.keys()].filter((k) => !stag.has(k)).sort(),
    extra: [...stag.keys()].filter((k) => !prod.has(k)).sort(),
    changed: [...prod.keys()]
      .filter((k) => stag.has(k) && stag.get(k) !== prod.get(k))
      .sort()
      .map((k) => ({ key: k, hint: firstDiff(prod.get(k), stag.get(k)) })),
    problems: [],
    accepted: [],
    warnings: [],
    ...extra,
  };
}

export const blankResult = (name, kind = "parity") => ({
  name, kind, prod: "-", staging: "-", missing: [], extra: [], changed: [], problems: [], accepted: [], warnings: [],
});

export const diffCount = (r) => (r.kind === "info" ? 0 : r.missing.length + r.extra.length + r.changed.length + r.problems.length);

// ── accepted differences ────────────────────────────────────────────────────

const EXCEPTIONS_FILE = join(HERE, "accepted-differences.json");

function loadExceptions(file) {
  if (!existsSync(file)) return [];
  const list = JSON.parse(readFileSync(file, "utf8")).accepted ?? [];
  list.forEach((e, i) => {
    for (const f of ["check", "key", "reason", "added", "by"]) {
      if (!e[f] || !String(e[f]).trim()) die(`accepted-differences.json entry ${i + 1}: "${f}" is required.`);
    }
    if (/[*%?]/.test(e.key)) die(`accepted-differences.json entry ${i + 1}: key must name one exact object, no wildcards (${e.key}).`);
    if (e.reason.trim().length < 15) die(`accepted-differences.json entry ${i + 1}: the reason is too short to mean anything.`);
  });
  return list;
}

/**
 * Move accepted differences out of the failing lists. An entry that matches
 * nothing is itself a failure: the exception is stale and must be removed.
 * Only checks that actually ran are judged, so --only never reports false stale entries.
 */
export function applyExceptions(results, file = EXCEPTIONS_FILE) {
  const list = loadExceptions(file);
  const ran = new Set(results.map((r) => r.name));
  const stale = [];
  for (const e of list) {
    if (!ran.has(e.check)) continue;
    const r = results.find((x) => x.name === e.check);
    let hit = false;
    for (const bucket of ["missing", "extra"]) {
      const i = r[bucket].indexOf(e.key);
      if (i !== -1) { r[bucket].splice(i, 1); hit = true; }
    }
    const ci = r.changed.findIndex((c) => c.key === e.key);
    if (ci !== -1) { r.changed.splice(ci, 1); hit = true; }
    if (hit) r.accepted.push({ key: e.key, reason: e.reason });
    else stale.push(`${e.check}: ${e.key}`);
  }
  if (list.length) {
    const r = blankResult("accepted_differences", "safety");
    r.staging = list.length;
    r.problems = stale.map((s) => `stale exception, remove it: ${s}`);
    results.push(r);
  }
  return results;
}

// ── report ──────────────────────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function buildLines(script, results, show) {
  const scored = results.filter((r) => r.kind !== "info");
  const passed = scored.filter((r) => diffCount(r) === 0).length;
  const total = scored.reduce((n, r) => n + diffCount(r), 0);
  const accepted = results.reduce((n, r) => n + r.accepted.length, 0);
  const warnings = results.flatMap((r) => r.warnings.map((w) => `${r.name}: ${w}`));
  const ok = total === 0;
  const summary = `SCORE ${passed}/${scored.length} checks identical, ${total} differences, ${accepted} accepted exceptions`;

  const table = [
    pad("check", 28) + lpad("prod", 7) + lpad("staging", 9) + lpad("missing", 9) + lpad("extra", 7) + lpad("changed", 9) + "  result",
    "-".repeat(77),
    ...results.map(
      (r) =>
        pad(r.name, 28) + lpad(r.prod, 7) + lpad(r.staging, 9) + lpad(r.missing.length, 9) + lpad(r.extra.length, 7) +
        lpad(r.changed.length + r.problems.length, 9) + (r.kind === "info" ? "  -" : diffCount(r) === 0 ? "  PASS" : "  FAIL"),
    ),
  ];

  const cut = (list) => (show === 0 ? list : list.slice(0, show));
  const more = (list) => (show !== 0 && list.length > show ? [`      ... and ${list.length - show} more`] : []);
  const details = [];
  for (const r of scored.filter((x) => diffCount(x) > 0)) {
    details.push("", `[${r.name}]`);
    if (r.problems.length) { details.push(`  problems (${r.problems.length}):`, ...cut(r.problems).map((p) => `    ! ${p}`), ...more(r.problems)); }
    if (r.missing.length) { details.push(`  missing on staging (${r.missing.length}):`, ...cut(r.missing).map((k) => `    - ${k}`), ...more(r.missing)); }
    if (r.extra.length) {
      details.push(`  ${r.kind === "safety" ? "must not be there" : "only on staging"} (${r.extra.length}):`, ...cut(r.extra).map((k) => `    + ${k}`), ...more(r.extra));
    }
    if (r.changed.length) {
      details.push(`  different definition (${r.changed.length}):`, ...cut(r.changed).flatMap((c) => [`    ~ ${c.key}`, `        ${c.hint}`]), ...more(r.changed));
    }
  }
  const acceptedLines = results.flatMap((r) => r.accepted.map((a) => `  ${r.name}: ${a.key}  --  ${a.reason}`));
  return { ok, summary, table, details, acceptedLines, warnings, passed, scored: scored.length, total };
}

async function writePdf(script, lines, meta) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const mono = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const W = 595, H = 842, M = 36;
  let page = doc.addPage([W, H]);
  let y = H - M;
  // The built-in PDF fonts only cover Latin-1; anything else would throw.
  const clean = (s) => String(s).replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
  const put = (text, { font = mono, size = 7.5, color = rgb(0.15, 0.15, 0.2), gap = 2.5 } = {}) => {
    if (y < M + size) { page = doc.addPage([W, H]); y = H - M; }
    const max = Math.floor((W - 2 * M) / (size * (font === mono ? 0.6 : 0.5)));
    const t = clean(text);
    page.drawText(t.length > max ? t.slice(0, max - 3) + "..." : t, { x: M, y: y - size, size, font, color });
    y -= size + gap;
  };
  const heading = (t) => { y -= 8; put(t, { font: bold, size: 11, color: rgb(0.03, 0.03, 0.07), gap: 5 }); };

  put(meta.title, { font: bold, size: 16, color: rgb(0.03, 0.03, 0.07), gap: 6 });
  put(`${lines.ok ? "PASS" : "FAIL"}  -  ${script}`, { font: bold, size: 13, color: lines.ok ? rgb(0.09, 0.64, 0.29) : rgb(0.86, 0.15, 0.15), gap: 6 });
  put(lines.summary, { font: sans, size: 9.5, gap: 3 });
  put(`Run ${meta.when}   prod ${PROD_REF}   staging ${TARGET}`, { font: sans, size: 8.5, color: rgb(0.45, 0.45, 0.45), gap: 3 });

  heading("Checks");
  lines.table.forEach((l) => put(l));
  if (lines.details.length) { heading("What is different"); lines.details.forEach((l) => put(l)); }
  heading(`Accepted exceptions (${lines.acceptedLines.length})`);
  (lines.acceptedLines.length ? lines.acceptedLines : ["  none"]).forEach((l) => put(l));
  heading(`Warnings (${lines.warnings.length})`);
  (lines.warnings.length ? lines.warnings : ["  none"]).forEach((l) => put(`  ${l}`));

  const dir = join(meta.home, "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${meta.stamp}_${script}_${lines.ok ? "PASS" : "FAIL"}.pdf`);
  writeFileSync(file, await doc.save());
  copyFileSync(file, join(dir, "latest.pdf"));
  return file;
}

/**
 * Print the result, write the PDF report, and return the outcome.
 * `pdfShow` keeps the report short: only the first few items per failing check.
 */
export async function report(script, results, { show = Number(arg("show") ?? 8), pdfShow = 6, pdf = !flag("no-pdf"), home = HERE, title = "Drive247 database eval" } = {}) {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const meta = {
    home,
    title,
    when: now.toISOString().replace("T", " ").slice(0, 16) + " UTC",
    stamp: `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}`,
  };
  const screen = buildLines(script, results, show);
  console.log(`\n${script}: prod ${PROD_REF}  vs  staging ${TARGET}\n`);
  screen.table.forEach((l) => console.log(l));
  screen.details.forEach((l) => console.log(l));
  if (screen.acceptedLines.length) { console.log(`\naccepted exceptions (${screen.acceptedLines.length}):`); screen.acceptedLines.forEach((l) => console.log(l)); }
  if (screen.warnings.length) { console.log(`\nwarnings (${screen.warnings.length}):`); cutList(screen.warnings, show).forEach((l) => console.log(`  ${l}`)); }
  console.log(`\n${screen.summary}`);
  console.log(screen.ok ? "IDENTICAL: staging matches prod." : "NOT IDENTICAL.");
  let file;
  if (pdf) {
    file = await writePdf(script, buildLines(script, results, pdfShow), meta);
    console.log(`report: ${file}\n`);
  }
  if (arg("json")) writeFileSync(arg("json"), JSON.stringify({ script, prod: PROD_REF, target: TARGET, ...screen, results }, null, 2));
  return { ok: screen.ok, file, summary: screen.summary };
}

const cutList = (list, show) => (show === 0 ? list : list.slice(0, show));
