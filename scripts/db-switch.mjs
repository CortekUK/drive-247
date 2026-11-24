#!/usr/bin/env node
/**
 * db-switch.mjs — point every app's local settings at the staging or production database.
 *
 * THE RULE (Ghulam, 2026-11-24): local development always uses STAGING. The dev
 * scripts enforce it (scripts/guard-db-env.mjs switches a production setting
 * back before a server starts). `prod` exists only for a deliberate look at
 * live data, and a dev server then needs ALLOW_PROD_LOCAL=1 to start.
 *
 * Usage:
 *   node scripts/db-switch.mjs staging   # the normal state
 *   node scripts/db-switch.mjs prod      # deliberate, temporary
 *   node scripts/db-switch.mjs status    # which database each app targets
 *
 * How it works:
 *   - Switching to staging rewrites the Supabase variables in each app's
 *     .env.local from the gitignored .staging-credentials.local. No key lives
 *     in this file.
 *   - Whenever an app is found on production, its .env.local is first saved to
 *     .env.local.prod.bak, so the backup is always the latest production
 *     settings. `prod` restores that backup.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPS = ["portal", "booking", "admin", "web", "developer"];

// --- Staging values ---
// Staging is its own Supabase project. Its ref and keys live in the gitignored
// .staging-credentials.local at the repo root, never in this file.
function readStagingCredentials() {
  const p = join(ROOT, ".staging-credentials.local");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const CREDS = readStagingCredentials();
const STAGING_HOST = CREDS.STAGING_REF ?? "";
const STAGING = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_HOST}.supabase.co`,
  // Must be rewritten too: left on the prod ref, anything reading PROJECT_ID
  // on staging silently addresses production.
  NEXT_PUBLIC_SUPABASE_PROJECT_ID: STAGING_HOST,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: CREDS.STAGING_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: CREDS.STAGING_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: CREDS.STAGING_SERVICE_ROLE_KEY,
};

function envPath(app) {
  return join(ROOT, "apps", app, ".env.local");
}
function bakPath(app) {
  return join(ROOT, "apps", app, ".env.local.prod.bak");
}

/** Replace KEY="..." or KEY=... lines; add the key if it's missing. */
function setVar(content, key, value) {
  const re = new RegExp(`^(\\s*)${key}\\s*=.*$`, "m");
  const line = `${key}="${value}"`;
  if (re.test(content)) return content.replace(re, `$1${line}`);
  return content.trimEnd() + `\n${line}\n`;
}

function currentHost(app) {
  const p = envPath(app);
  if (!existsSync(p)) return "(no .env.local)";
  const m = readFileSync(p, "utf8").match(/^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!m) return "(unset)";
  return STAGING_HOST && m[1].includes(STAGING_HOST) ? "STAGING" : "production";
}

const target = (process.argv[2] || "").toLowerCase();

if (target === "status") {
  console.log("Current Supabase target per app:");
  for (const app of APPS) console.log(`  ${app.padEnd(8)} -> ${currentHost(app)}`);
  process.exit(0);
}

if (target !== "staging" && target !== "prod") {
  console.error("Usage: node scripts/db-switch.mjs <staging|prod|status>");
  process.exit(1);
}

if (target === "staging" && Object.values(STAGING).some((v) => !v || !STAGING_HOST)) {
  console.error("Staging keys not found. .staging-credentials.local needs STAGING_REF, STAGING_ANON_KEY,\nSTAGING_PUBLISHABLE_KEY and STAGING_SERVICE_ROLE_KEY.");
  process.exit(1);
}

for (const app of APPS) {
  const p = envPath(app);
  const bak = bakPath(app);
  if (!existsSync(p)) {
    console.log(`  ${app.padEnd(8)} -> skipped (no .env.local)`);
    continue;
  }

  if (target === "staging") {
    let content = readFileSync(p, "utf8");
    // Save production's settings each time we leave them, so the backup is never
    // an older copy missing keys that were added since.
    const onProd = /^\s*NEXT_PUBLIC_SUPABASE_URL\s*=.*hviqoaokxvlancmftwuo/m.test(content);
    if (onProd || !existsSync(bak)) copyFileSync(p, bak);
    for (const [k, v] of Object.entries(STAGING)) content = setVar(content, k, v);
    // The push key pair is per project: a staging server must hand out staging's public half.
    if (CREDS.STAGING_VAPID_PUBLIC_KEY && /^\s*NEXT_PUBLIC_VAPID_PUBLIC_KEY\s*=/m.test(content)) {
      content = setVar(content, "NEXT_PUBLIC_VAPID_PUBLIC_KEY", CREDS.STAGING_VAPID_PUBLIC_KEY);
    }
    writeFileSync(p, content);
    console.log(`  ${app.padEnd(8)} -> STAGING`);
  } else {
    if (!existsSync(bak)) {
      console.log(`  ${app.padEnd(8)} -> no backup found, left unchanged`);
      continue;
    }
    copyFileSync(bak, p); // restore prod
    console.log(`  ${app.padEnd(8)} -> production (restored)`);
  }
}

if (target === "prod") {
  console.log("\nLocal settings now point at PRODUCTION. That breaks the local-uses-staging rule:");
  console.log("a dev server will switch back to staging unless started with ALLOW_PROD_LOCAL=1.");
  console.log("When you are done:  npm run db:switch staging");
} else {
  console.log(`\nDone. Restart the dev server for changes to take effect (npm run dev).`);
}
