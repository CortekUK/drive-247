#!/usr/bin/env node
/**
 * synced.mjs — is my code the same as GitHub's main and staging?
 *
 *   npm run synced          code only (takes a second)
 *   npm run synced -- --all also checks the staging database and edge
 *                           functions against production (needs
 *                           SUPABASE_ACCESS_TOKEN; takes about a minute)
 *
 * Every commit has an id, a fingerprint of the whole codebase. Two places with
 * the same id hold exactly the same code. This prints the id of each place and
 * says SYNCED when they all match. Read the id out loud to a teammate: if
 * theirs is the same, you are on the same code.
 *
 * It only reads. It never pulls, pushes or changes a file.
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
  console.log(`  SYNCED  ${want}\n`);
} else {
  console.log("  NOT SYNCED");
  for (const p of problems) console.log(`   - ${p}`);
  const behind = Number(git("rev-list", "--count", "HEAD..origin/main") ?? 0);
  const ahead = Number(git("rev-list", "--count", "origin/main..HEAD") ?? 0);
  if (behind && !ahead) console.log(`\n  You are ${behind} commit${behind === 1 ? "" : "s"} behind GitHub main. To catch up:  git pull`);
  else if (ahead && !behind) console.log(`\n  You have ${ahead} commit${ahead === 1 ? "" : "s"} GitHub main does not. They are not pushed yet.`);
  else if (ahead && behind) console.log(`\n  You and GitHub main have each moved: ${ahead} of yours, ${behind} of theirs.`);
  console.log("");
}

let ok = problems.length === 0;

if (process.argv.includes("--all")) {
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.log("  --all needs SUPABASE_ACCESS_TOKEN to compare the staging database and functions with production.\n");
    ok = false;
  } else {
    for (const [label, file] of [
      ["Database, staging vs production", "evals/environments/database/db-eval.mjs"],
      ["Edge functions, staging vs production", "evals/environments/functions/fn-eval.mjs"],
    ]) {
      let out = "";
      try { out = execFileSync("node", [join(ROOT, file), "--no-pdf"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
      catch (e) { out = String(e.stdout || ""); ok = false; }
      const score = out.split("\n").find((l) => l.startsWith("SCORE")) ?? "did not finish";
      console.log(`  ${label}: ${score.replace("SCORE ", "")}`);
    }
    console.log("");
  }
}

process.exit(ok ? 0 : 1);
