#!/usr/bin/env node
/**
 * fix-env-target.mjs — repair apps whose .env.local still points at staging.
 *
 * WHY THIS EXISTS
 *
 * db-switch.mjs backs each app's .env.local up to .env.local.prod.bak on the
 * FIRST switch to staging, and `prod` restores that backup. For portal and admin
 * those backups were themselves captured while the app was already on staging,
 * so `db-switch.mjs prod` restores staging and the app never comes back.
 *
 * This copies the four Supabase vars from a known-good app (booking, whose
 * backup was captured correctly) into the broken ones, and refreshes their
 * .prod.bak so db-switch works properly from here on.
 *
 * It never prints a key.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "booking";
const STAGING_HOST = "ksmreaadhbirzakkxqrq";
const VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const envPath = (app) => join(ROOT, "apps", app, ".env.local");
const bakPath = (app) => join(ROOT, "apps", app, ".env.local.prod.bak");

function readVar(content, key) {
  const m = content.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]*)"?\\s*$`, "m"));
  return m ? m[1] : null;
}

function setVar(content, key, value) {
  const re = new RegExp(`^(\\s*)${key}\\s*=.*$`, "m");
  const line = `${key}="${value}"`;
  if (re.test(content)) return content.replace(re, `$1${line}`);
  return content.trimEnd() + `\n${line}\n`;
}

const src = readFileSync(envPath(SOURCE), "utf8");
const srcUrl = readVar(src, "NEXT_PUBLIC_SUPABASE_URL") || "";
if (srcUrl.includes(STAGING_HOST)) {
  console.error(`Refusing to copy: ${SOURCE} is itself on staging. Fix it first.`);
  process.exit(1);
}

const good = {};
for (const k of VARS) {
  const v = readVar(src, k);
  if (v) good[k] = v;
}

for (const app of ["portal", "admin"]) {
  const p = envPath(app);
  if (!existsSync(p)) {
    console.log(`  ${app}: no .env.local, skipped`);
    continue;
  }
  let content = readFileSync(p, "utf8");
  const before = readVar(content, "NEXT_PUBLIC_SUPABASE_URL") || "";
  if (!before.includes(STAGING_HOST)) {
    console.log(`  ${app}: already on production, untouched`);
    continue;
  }

  // Drop the stale banner that marked this as a temporary staging override.
  content = content.replace(/^#\s*TEMPORARY.*staging.*$\n?/gim, "");
  for (const [k, v] of Object.entries(good)) content = setVar(content, k, v);

  writeFileSync(p, content.replace(/^\n+/, ""));
  // Refresh the corrupted backup so `db-switch.mjs prod` behaves next time.
  copyFileSync(p, bakPath(app));
  console.log(`  ${app}: repointed to production, .prod.bak refreshed`);
}
