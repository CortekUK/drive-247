#!/usr/bin/env node
/**
 * guard-db-env.mjs — local development always uses the STAGING database.
 *
 * THE RULE (Ghulam, 2026-11-24, a hard rule)
 * -----------------------------------------
 * Anything running on a developer's machine talks to staging, on every branch.
 * Only the deployed `main` talks to production. A half-finished feature, a
 * wrong delete, a test payment or a test email then costs nothing.
 *
 * THE FAILURE THIS PREVENTS
 * -------------------------
 * A branch and a database are independent: each app's `.env.local` keeps
 * pointing wherever it last pointed. For months that was production, so every
 * local server ran its queries against real customers with no warning.
 *
 * Runs before every dev server start (wired into the root `dev:*` scripts).
 *
 *   any app's .env.local points at production  ->  switched to staging, loudly
 *   every app points at staging                ->  one quiet line
 *
 * To look at production from your machine on purpose, for one run:
 *   ALLOW_PROD_LOCAL=1 npm run dev:portal
 * It is refused without that, and it is never the default.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_REF = "csjouxrkblpsoihyejel";
const PROD_REF = "hviqoaokxvlancmftwuo";
const APPS = ["portal", "booking", "admin", "web", "developer"];

const RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", DIM = "\x1b[2m", OFF = "\x1b[0m";

/** Where one app's local settings point: "staging", "prod", "other" or null (no file). */
function targetOf(app) {
  const file = join(ROOT, "apps", app, ".env.local");
  if (!existsSync(file)) return null;
  // The URL variable specifically, not the whole file: the prod ref can
  // legitimately appear elsewhere in it (a webhook URL, a comment).
  const line = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL=") && !l.startsWith("#"));
  const url = line ? line.slice(line.indexOf("=") + 1).replace(/["']/g, "").trim() : "";
  if (url.includes(STAGING_REF)) return "staging";
  if (url.includes(PROD_REF)) return "prod";
  return "other";
}

const onProd = APPS.filter((app) => targetOf(app) === "prod");

if (onProd.length === 0) {
  console.log(`${GRN}[db-guard] local → staging database ✓${OFF}`);
  process.exit(0);
}

if (process.env.ALLOW_PROD_LOCAL === "1") {
  console.log(`${RED}[db-guard] LOCAL SERVER ON THE PRODUCTION DATABASE (${onProd.join(", ")}) — allowed by ALLOW_PROD_LOCAL=1.${OFF}`);
  console.log(`${YEL}           Real customers. Read, do not write. Switch back with:  npm run db:switch staging${OFF}`);
  process.exit(0);
}

console.log(`${RED}[db-guard] ${onProd.join(", ")} pointed at PRODUCTION. Local development uses staging: switching.${OFF}`);
try {
  execSync("node scripts/db-switch.mjs staging", { cwd: ROOT, stdio: "inherit" });
} catch {
  console.log(`${RED}[db-guard] could not switch to staging, so the dev server is not started.${OFF}`);
  console.log(`${DIM}           .staging-credentials.local must be in the repo root. Ask Ghulam for it.${OFF}`);
  process.exit(1);
}
const still = APPS.filter((app) => targetOf(app) === "prod");
if (still.length) {
  console.log(`${RED}[db-guard] ${still.join(", ")} still pointed at production. Not starting.${OFF}`);
  process.exit(1);
}
console.log(`${GRN}[db-guard] now on the staging database.${OFF}`);
