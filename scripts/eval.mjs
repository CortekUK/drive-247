#!/usr/bin/env node
/**
 * eval.mjs — run a feature's evals and write down the result.
 *
 *   npm run eval -- feat-001          every eval of that feature
 *   npm run eval -- feat-001 02       only the evals of spec 02
 *
 * A feature's evals are in docs/application/feat-NNN-name/evals/:
 *   NN-name.mjs       proves a spec's statements against STAGING (docs/application/eval-kit.mjs)
 *   NN-name.test.ts   proves a spec's math, every worked example, in Vitest
 *
 * It prints each statement, writes evals/RESULTS.md (commit it: it is the proof
 * that goes with the pull request), and ends with one line:
 *
 *   EVALS feat-001  23/23 statements proved
 *
 * See .claude/skills/eval.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "docs", "application");
const [want, only] = process.argv.slice(2);

if (!want) {
  console.error("Which feature?  npm run eval -- feat-001");
  process.exit(2);
}
const folder = readdirSync(APP).find((d) => d === want || d.startsWith(`${want}-`));
if (!folder) {
  console.error(`No feature folder for "${want}" in docs/application.`);
  process.exit(2);
}
const dir = join(APP, folder, "evals");
const files = existsSync(dir) ? readdirSync(dir).filter((f) => (!only || f.startsWith(`${only}-`))).sort() : [];
const scripts = files.filter((f) => f.endsWith(".mjs"));
const tests = files.filter((f) => f.endsWith(".test.ts"));
if (!scripts.length && !tests.length) {
  console.error(`No evals in ${relative(ROOT, dir)}${only ? ` for spec ${only}` : ""}.`);
  process.exit(2);
}

const all = []; // { file, id, text, pass, why }
let trouble = false;

for (const file of scripts) {
  console.log(`\n${file}`);
  const res = spawnSync(process.execPath, [join(dir, file)], { cwd: ROOT, encoding: "utf8", env: process.env });
  const out = res.stdout || "";
  process.stdout.write(out.split("\n").filter((l) => !l.startsWith("EVAL_RESULT ")).join("\n"));
  if (res.stderr) process.stderr.write(res.stderr);
  const line = out.split("\n").find((l) => l.startsWith("EVAL_RESULT "));
  if (!line) {
    trouble = true;
    all.push({ file, id: "00.0", text: "The eval ran to the end", pass: false, why: "It stopped before printing a result. Does it end with `await run(import.meta.url)`?" });
    continue;
  }
  const parsed = JSON.parse(line.slice("EVAL_RESULT ".length));
  if (!parsed.cleaned) trouble = true;
  for (const r of parsed.results) all.push({ file, ...r });
}

if (tests.length) {
  const json = join(dir, ".vitest-result.json");
  const targets = tests.map((t) => relative(ROOT, join(dir, t)));
  // Vitest's own config-less run: plain TypeScript files, relative imports only.
  const res = spawnSync("npx", ["vitest", "run", ...targets, "--root", ROOT, "--reporter=json", `--outputFile=${json}`], {
    cwd: ROOT, encoding: "utf8", env: process.env, shell: process.platform === "win32",
  });
  if (!existsSync(json)) {
    trouble = true;
    console.log(`\n${tests.join(", ")}\n  FAIL  Vitest could not run:\n${(res.stderr || res.stdout || "").split("\n").slice(-12).join("\n")}`);
    for (const t of tests) all.push({ file: t, id: "00.0", text: "The math tests ran", pass: false, why: "Vitest could not load the file. See the output above." });
  } else {
    const report = JSON.parse(readFileSync(json, "utf8"));
    rmSync(json);
    for (const suite of report.testResults || []) {
      const file = suite.name.split(/[\\/]/).pop();
      console.log(`\n${file}`);
      if (!suite.assertionResults?.length) {
        trouble = true;
        all.push({ file, id: "00.0", text: "The math tests ran", pass: false, why: (suite.message || "No tests ran.").split("\n")[0] });
        console.log(`  FAIL  ${(suite.message || "No tests ran.").split("\n")[0]}`);
      }
      for (const a of suite.assertionResults || []) {
        // A test is named "02.3 #1 ..." so it can be tied to the statement it proves.
        const m = a.title.match(/^(\d{2}\.\d+)\s*(.*)$/);
        const row = { file, id: m ? m[1] : "??.?", text: m ? m[2] : a.title, pass: a.status === "passed", why: (a.failureMessages || [])[0]?.split("\n")[0] };
        if (!m) { row.pass = false; row.why = 'The test name must start with its statement number, like "02.3 #1 ...".'; }
        all.push(row);
        console.log(`  ${row.pass ? "pass" : "FAIL"}  ${row.id}  ${row.text}`);
        if (!row.pass) console.log(`        ${row.why}`);
      }
    }
  }
}

// A statement is proved only when every check written against it passes.
const byStatement = new Map();
for (const r of all) {
  const s = byStatement.get(r.id) || { id: r.id, checks: 0, failed: [] };
  s.checks++;
  if (!r.pass) s.failed.push(r);
  byStatement.set(r.id, s);
}
const ids = [...byStatement.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
const proved = ids.filter((s) => !s.failed.length).length;
const good = proved === ids.length && !trouble;

const git = (...a) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "?"; } };
const when = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const md = [
  `# Eval results · ${folder}`,
  "",
  `**${good ? "PASS" : "FAIL"}** · ${proved}/${ids.length} statements proved · ${all.length} checks · ${when}`,
  "",
  `Run on staging by \`npm run eval -- ${want}${only ? ` ${only}` : ""}\`, at commit \`${git("rev-parse", "--short", "HEAD")}\` on \`${git("rev-parse", "--abbrev-ref", "HEAD")}\`${git("status", "--porcelain") ? " (with uncommitted changes)" : ""}.`,
  "This file is written by the command. Do not edit it by hand.",
  "",
  "| Statement | Result | Checks | Eval |",
  "|---|---|---|---|",
  ...ids.map((s) => {
    const files = [...new Set(all.filter((r) => r.id === s.id).map((r) => `\`${r.file}\``))].join(", ");
    return `| ${s.id} | ${s.failed.length ? "FAIL" : "pass"} | ${s.checks} | ${files} |`;
  }),
  ...(all.some((r) => !r.pass) ? ["", "## What failed", "", ...all.filter((r) => !r.pass).map((r) => `- **${r.id}** ${r.text} (\`${r.file}\`): ${r.why || "failed"}`)] : []),
  ...(trouble ? ["", "An eval did not finish or did not clean up after itself. See the run's output."] : []),
  "",
].join("\n");
if (!only) writeFileSync(join(dir, "RESULTS.md"), md);

console.log(`\n${only ? "(one spec only: RESULTS.md not rewritten)\n" : `Wrote ${relative(ROOT, join(dir, "RESULTS.md"))}\n`}`);
console.log(`EVALS ${want}  ${proved}/${ids.length} statements proved${good ? "" : "  FAILED"}`);
process.exit(good ? 0 : 1);
