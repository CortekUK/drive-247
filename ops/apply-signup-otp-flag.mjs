#!/usr/bin/env node
/**
 * Applies supabase/migrations/PENDING_20261001_signup_otp_flag.sql.txt —
 * `admin_settings.signup_otp_enabled`, the super-admin switch for signup email
 * verification.
 *
 * PowerShell:
 *   $env:SUPABASE_ACCESS_TOKEN="sbp_..."; node ops/apply-signup-otp-flag.mjs --check
 *   $env:SUPABASE_ACCESS_TOKEN="sbp_..."; node ops/apply-signup-otp-flag.mjs
 *
 * bash:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node ops/apply-signup-otp-flag.mjs --check
 *
 * `--check` writes nothing: it prints whether the column exists and what the
 * flag currently reads. Run it first, and again afterwards.
 *
 * WHAT IT CHANGES. One boolean column on one 4-row settings table, defaulting
 * to false, plus its comment. It adds nothing else, drops nothing, and alters
 * no existing column. The whole thing is one transaction, so either the column
 * and its comment both land or neither does.
 *
 * SAFE TO RUN WHILE THE CURRENT CODE IS LIVE. Default false means signup keeps
 * behaving exactly as it does today until someone ticks the switch in Super
 * Admin -> Signup Plans. The deployed `signup-begin` does not read the column
 * at all; the new one treats a failed read as "off".
 *
 * The token is read from the environment and never written anywhere. Get one at
 * https://supabase.com/dashboard/account/tokens and revoke it when done.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = "hviqoaokxvlancmftwuo";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const CHECK_ONLY = process.argv.includes("--check");
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, "..", "supabase", "migrations", "PENDING_20261001_signup_otp_flag.sql.txt");

if (!TOKEN) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is not set. In PowerShell:\n" +
      '  $env:SUPABASE_ACCESS_TOKEN="sbp_..."; node ops/apply-signup-otp-flag.mjs --check',
  );
  process.exit(1);
}

async function run(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Does the column exist, and what does the flag read right now? */
async function state(label) {
  const columns = await run(
    `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public'
        and table_name = 'admin_settings'
        and column_name = 'signup_otp_enabled';`,
  );
  console.log(`\n${label}`);
  if (!columns.length) {
    console.log("  column signup_otp_enabled: ABSENT (signup auto-confirms, today's behaviour)");
    return false;
  }
  console.log("  column signup_otp_enabled:", columns[0]);
  const rows = await run(
    `select count(*) as rows,
            coalesce(bool_or(signup_otp_enabled), false) as flag_reads_on
       from public.admin_settings;`,
  );
  console.log("  settings rows / flag:", rows[0]);
  return true;
}

const existedBefore = await state("BEFORE");

if (CHECK_ONLY) {
  console.log("\n--check: nothing was written.");
  process.exit(0);
}

if (existedBefore) {
  console.log("\nThe column already exists. Nothing to apply.");
  process.exit(0);
}

/*
 * SENT AS WRITTEN, in one transaction — not split into statements.
 *
 * The first version split the file on ";" and broke the COMMENT in half,
 * because the comment text itself contains one. The Management API takes
 * multiple statements in a single query, so there is nothing to split: the
 * file goes over as-is, SQL comments and all.
 *
 * NOTIFY is the one thing held back, and runs only after the COMMIT. Telling
 * PostgREST to reload its schema cache before the column is committed would
 * reload too early and leave it answering "column does not exist".
 */
const sql = readFileSync(MIGRATION, "utf8");
if (!/ADD COLUMN IF NOT EXISTS signup_otp_enabled boolean NOT NULL DEFAULT false/.test(sql)) {
  throw new Error(`${MIGRATION} is not the migration this script expects — read it before continuing.`);
}
const notify = sql.search(/\nNOTIFY\s+pgrst/i);
if (notify < 0) throw new Error("Expected a trailing NOTIFY pgrst in the migration.");
const body = sql.slice(0, notify);

console.log("\nApplying, in one transaction:");
console.log(
  body
    .split("\n")
    .filter((line) => line.trim() && !line.trimStart().startsWith("--"))
    .map((line) => `  ${line}`)
    .join("\n"),
);

await run(`BEGIN;
${body}
COMMIT;`);
await run(`NOTIFY pgrst, 'reload schema';`);

await state("AFTER");
console.log(
  "\nDone. The flag is OFF: signup is unchanged until someone ticks it in\n" +
    "Super Admin -> Signup Plans -> \"Verify the email address during signup\".\n" +
    "Redeploy the signup-begin function so it can read the column.\n" +
    "Revoke the access token you just used: https://supabase.com/dashboard/account/tokens",
);
