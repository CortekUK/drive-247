#!/usr/bin/env node
/**
 * guard-db-env.mjs — make the branch↔database binding structural.
 *
 * THE FAILURE THIS PREVENTS
 * -------------------------
 * Branch and database are independent: `.env.local` keeps pointing wherever it
 * last pointed, across every branch switch. So it is entirely possible to sit on
 * the `staging` branch and run every query against PRODUCTION — same code, real
 * customers, no warning. That is the one combination that must never happen.
 *
 * Runs before every dev server start (wired into the root `dev:*` scripts).
 *
 *   on `staging`, env points at prod  ->  auto-corrects to staging, loudly
 *   not on `staging`, env points at staging -> warns (may well be deliberate)
 *   anything else                     ->  silent
 *
 * Bypass with ALLOW_DB_MISMATCH=1 (there is no good reason; it exists so the
 * guard can never be the thing blocking a release).
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_REF = "ksmreaadhbirzakkxqrq";
const PROD_REF = "hviqoaokxvlancmftwuo";

const branch = (() => {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, stdio: ["pipe", "pipe", "ignore"] })
      .toString().trim();
  } catch { return null; }
})();
if (!branch) process.exit(0);

const envFile = join(ROOT, "apps", "portal", ".env.local");
if (!existsSync(envFile)) process.exit(0);
const env = readFileSync(envFile, "utf8");

// Check the URL variable specifically, NOT the whole file: db-switch rewrites
// only the 4 Supabase vars, so the prod ref legitimately survives elsewhere
// (NEXT_PUBLIC_SUPABASE_PROJECT_ID, webhook URLs). A whole-file `includes`
// reports a mismatch that isn't one.
const urlLine = env
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL=") && !l.startsWith("#"));
const url = urlLine ? urlLine.split("=", 2)[1].replace(/["']/g, "").trim() : "";
const pointsAtStaging = url.includes(STAGING_REF);
const pointsAtProd = url.includes(PROD_REF);

const RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", DIM = "\x1b[2m", OFF = "\x1b[0m";
const onStaging = branch === "staging";

if (onStaging && pointsAtProd) {
  if (process.env.ALLOW_DB_MISMATCH === "1") {
    console.log(`${RED}[db-guard] on 'staging' but pointed at PRODUCTION — allowed via ALLOW_DB_MISMATCH${OFF}`);
    process.exit(0);
  }
  console.log(`${RED}[db-guard] branch 'staging' but .env points at PRODUCTION — correcting.${OFF}`);
  execSync("node scripts/db-switch.mjs staging", { cwd: ROOT, stdio: "inherit" });
  console.log(`${GRN}[db-guard] now on the staging database.${OFF}`);
  process.exit(0);
}

if (!onStaging && pointsAtStaging) {
  console.log(`${YEL}[db-guard] branch '${branch}' but .env points at the STAGING database.${OFF}`);
  console.log(`${DIM}           if that is not deliberate:  node scripts/db-switch.mjs prod${OFF}`);
  process.exit(0);
}

if (onStaging && pointsAtStaging) {
  console.log(`${GRN}[db-guard] staging branch → staging database ✓${OFF}`);
}
