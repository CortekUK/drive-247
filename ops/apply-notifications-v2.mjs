#!/usr/bin/env node
/**
 * Applies ops/notifications_v2.sql to production through the Management API.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... node ops/apply-notifications-v2.mjs          # apply
 *   SUPABASE_ACCESS_TOKEN=sbp_... node ops/apply-notifications-v2.mjs --check  # read-only
 *
 * It sends only the file's own BEGIN…COMMIT block, so either every statement
 * lands or none does. That block is additive: three NEW tables, their RLS and
 * policies, and triggers on those tables only. It alters no existing table and
 * puts no trigger on one — check for yourself with --check, which prints what
 * exists before and after without writing anything.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = "hviqoaokxvlancmftwuo";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const HERE = dirname(fileURLToPath(import.meta.url));

if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN is not set. Run:\n  SUPABASE_ACCESS_TOKEN=sbp_... node ops/apply-notifications-v2.mjs");
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

const TABLES = "'tenant_notification_settings','tenant_email_sender','notification_test_sends_v2'";

const state = async (label) => {
  const rows = await run(
    `select c.relname, c.relrowsecurity as rls,
            (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
       from pg_class c
      where c.relnamespace='public'::regnamespace and c.relname in (${TABLES})
      order by 1;`
  );
  console.log(`\n${label}:`);
  console.log(rows.length ? rows : "  (none of the three tables exist)");
  return rows;
};

const sql = readFileSync(join(HERE, "notifications_v2.sql"), "utf8");
const begin = sql.indexOf("\nBEGIN;");
const commit = sql.indexOf("\nCOMMIT;");
if (begin < 0 || commit < 0) throw new Error("Could not find the BEGIN…COMMIT block in notifications_v2.sql");
const block = sql.slice(begin, commit + "\nCOMMIT;".length);

await state("Before");

if (process.argv.includes("--check")) {
  console.log(`\n--check: nothing was written. The block is ${block.length} characters.`);
  process.exit(0);
}

console.log(`\nApplying ${block.length} characters as one transaction…`);
await run(block);
console.log("Applied.");

await state("After");

const counts = await run(
  `select (select count(*) from public.tenant_notification_settings) as settings,
          (select count(*) from public.tenant_email_sender)          as senders,
          (select count(*) from public.notification_test_sends_v2)   as test_sends;`
);
console.log("\nRow counts (all should be 0):", counts);

const triggers = await run(
  `select tgrelid::regclass::text as table, tgname
     from pg_trigger
    where not tgisinternal
      and tgrelid in (${TABLES.replaceAll("'", "'public.")
        .replaceAll(",", "::regclass,")}::regclass)
    order by 1,2;`
);
console.log("Triggers on the new tables only:", triggers);

console.log("\nNext: deploy the test sender, then press Send test in the portal.");
console.log(`  SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN npx supabase@latest functions deploy notification-test-v2 --project-ref ${PROJECT}`);
