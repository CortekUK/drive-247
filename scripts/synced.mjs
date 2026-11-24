#!/usr/bin/env node
/**
 * synced.mjs — are we all on the same thing?
 *
 *   SUPABASE_ACCESS_TOKEN=… npm run synced
 *
 * Checks three layers and prints one verdict:
 *   1. Code: my main and staging, and GitHub's main and staging, are one commit.
 *   2. Database: staging is built the same as production (db-eval).
 *   3. Edge functions: staging runs the same code as production (fn-eval).
 *
 * Every commit has an id, a fingerprint of the whole codebase. Two places with
 * the same id hold exactly the same code. Read the last line out loud to a
 * teammate: if theirs says the same, you are on the same thing.
 *
 * Takes one to a few minutes. It only reads: it never pulls, pushes, or changes a
 * file, a database or a function.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
};

// Ask GitHub what it has now. Without this the "GitHub" rows would be a memory.
const fetched = git("fetch", "origin", "--quiet") !== null;

const id = (ref) => git("rev-parse", "--short=8", "--verify", "--quiet", ref);
const places = [
  ["My main", id("refs/heads/main")],
  ["GitHub main", id("refs/remotes/origin/main")],
  ["My staging", id("refs/heads/staging")],
  ["GitHub staging", id("refs/remotes/origin/staging")],
];
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const here = id("HEAD");
const unsaved = (git("status", "--porcelain", "--untracked-files=no") || "").split("\n").filter(Boolean).length;
const files = `${unsaved} changed file${unsaved === 1 ? "" : "s"}`;

console.log("");
for (const [name, v] of places) console.log(`  ${name.padEnd(16)} ${v ?? "(not on this computer)"}`);
console.log(`  ${"I am on".padEnd(16)} ${here} (${branch})${unsaved ? `, with ${files} not committed` : ""}`);

const want = places[1][1]; // GitHub main is the reference
const problems = [];
if (!fetched) problems.push("Could not reach GitHub, so the GitHub rows may be out of date.");
if (!want) problems.push("GitHub main was not found.");
for (const [name, v] of places) {
  // A teammate may never have checked out staging locally. That is not out of sync.
  if (v === null && name === "My staging") continue;
  if (v !== want) problems.push(`${name} is ${v ?? "missing"}, GitHub main is ${want}.`);
}
if (here !== want) problems.push(`You are working on ${here} (${branch}), not on ${want}.`);
if (unsaved) problems.push(`${files} not committed, so your code differs from every id above.`);

console.log("");
if (problems.length === 0) {
  console.log(`  Code             synced on ${want}\n`);
} else {
  console.log("  Code             NOT SYNCED");
  for (const p of problems) console.log(`   - ${p}`);
  const behind = Number(git("rev-list", "--count", "HEAD..origin/main") ?? 0);
  const ahead = Number(git("rev-list", "--count", "origin/main..HEAD") ?? 0);
  if (behind && !ahead) console.log(`\n  You are ${behind} commit${behind === 1 ? "" : "s"} behind GitHub main. To catch up:  git pull`);
  else if (ahead && !behind) console.log(`\n  You have ${ahead} commit${ahead === 1 ? "" : "s"} GitHub main does not. They are not pushed yet.`);
  else if (ahead && behind) console.log(`\n  You and GitHub main have each moved: ${ahead} of yours, ${behind} of theirs.`);
  console.log("");
}

let ok = problems.length === 0;

// ── database and edge functions: staging against production ────────────────

const layers = [];
if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.log("  Database and edge functions were NOT checked: set SUPABASE_ACCESS_TOKEN and run again.\n");
  ok = false;
} else {
  console.log("  Comparing the staging database and edge functions with production (one to a few minutes) ...\n");
  for (const [label, file] of [
    ["Database", "docs/evals/environments/database/db-eval.mjs"],
    ["Edge functions", "docs/evals/environments/functions/fn-eval.mjs"],
  ]) {
    let out = "";
    let passed = true;
    try { out = execFileSync("node", [join(ROOT, file), "--no-pdf"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { out = String(e.stdout || ""); passed = false; }
    const score = (out.split("\n").find((l) => l.startsWith("SCORE")) ?? "did not finish").replace("SCORE ", "");
    layers.push(passed);
    if (!passed) ok = false;
    console.log(`  ${label.padEnd(16)} ${passed ? "same as production" : "DIFFERENT"}   (${score})`);
  }
  console.log("");
}

console.log(ok ? `  ALL SYNCED  ${want}  code, database and edge functions\n` : "  NOT ALL SYNCED. See above.\n");
process.exit(ok ? 0 : 1);
