#!/usr/bin/env node
/**
 * wipe-northwind.mjs — teardown for scripts/seed-northwind.mjs.
 *
 * Removes exactly and only what the seed inserted, plus the rows the database's
 * own triggers derived from those inserts (chat channels, notifications, RAG
 * queue entries, P&L lines, financial events, reminder events, allocations).
 *
 *   # staging (what local dev reads)
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/wipe-northwind.mjs --ref staging
 *   # production
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/wipe-northwind.mjs --ref prod
 *
 * The tenant is resolved by `slug = 'northwind'`, never by a hardcoded id —
 * prod and staging have different northwind ids, and a wipe pointed at the wrong
 * one is not a recoverable mistake.
 *
 * SCOPING. Every DELETE carries BOTH:
 *   1. `tenant_id = <the id resolved from the slug on THIS project>`, and
 *   2. an id / foreign-key restriction taken from that project's manifest,
 * so anything a human — or another agent — added to northwind survives. Tables
 * with no tenant_id column (payment_applications, pnl_entries) are restricted
 * through their tenant-scoped parent instead.
 *
 * WHAT IT DELIBERATELY NEVER TOUCHES: vehicles, customers and pickup locations
 * that already existed when the seed ran. The seed records those separately, as
 * manifest.reused.*, precisely so this script can leave them alone — on staging
 * the fleet and the customer book are shared with other people's work.
 *
 * Deletion order follows the foreign keys. The three that actually bite:
 *   reminder_events -> rentals / customers / ledger_entries   RESTRICT
 *   payments        -> rentals                                RESTRICT
 *   rentals         -> pickup_locations                       RESTRICT
 * hence reminder_events first, payments before rentals, rentals before locations.
 *
 * Flags:
 *   --ref <project-ref|prod|staging>   which Supabase project
 *   --dry-run                          print the SQL, change nothing
 *   --force-sweep                      IGNORE the manifest and delete EVERY row
 *                                      in these tables for northwind. This will
 *                                      destroy other people's data on a shared
 *                                      environment. Only for a lost manifest on
 *                                      a tenant you know is exclusively seed data.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TENANT_SLUG = "northwind";
const KNOWN_REFS = { prod: "hviqoaokxvlancmftwuo", staging: "ksmreaadhbirzakkxqrq" };

const argRef = (() => {
  const i = process.argv.indexOf("--ref");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const PROJECT_REF = KNOWN_REFS[argRef] || argRef || process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const DRY_RUN = process.argv.includes("--dry-run");
const SWEEP_ALL = process.argv.includes("--force-sweep");

if (!PROJECT_REF) {
  console.error("Which project? Pass --ref <project-ref|prod|staging> or set SUPABASE_PROJECT_REF.");
  process.exit(1);
}
if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN is required (Supabase Management API token).");
  process.exit(1);
}

const MANIFEST_PATH = path.join(__dirname, `northwind-seed-manifest.${PROJECT_REF}.json`);

async function runSql(label, sql) {
  if (DRY_RUN && !label.startsWith("read:")) {
    console.log(`\n-- [dry-run] ${label}\n${sql}`);
    return [];
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      // Default fetch/curl UAs get Cloudflare error 1010 on this endpoint.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
    body: JSON.stringify({ query: sql }),
  });
  const json = await res.json();
  if (!res.ok || (json && json.message)) {
    console.error(`\nFAILED: ${label}`);
    console.error(json?.message || JSON.stringify(json));
    process.exit(1);
  }
  if (!label.startsWith("read:")) console.log(`  ok  ${label}`);
  return json;
}

async function main() {
  const envLabel = Object.entries(KNOWN_REFS).find(([, v]) => v === PROJECT_REF)?.[0] || "unknown";

  // Resolve the tenant by slug on THIS project — never a hardcoded id.
  const found = await runSql(
    "read: resolve tenant",
    `SELECT id, slug, company_name, tenant_type FROM public.tenants WHERE slug = '${TENANT_SLUG}';`
  );
  if (!found.length) {
    console.error(`No tenant with slug '${TENANT_SLUG}' on project ${PROJECT_REF}.`);
    process.exit(1);
  }
  const TENANT_ID = found[0].id;
  const T = `'${TENANT_ID}'`;
  console.log(
    `Wiping '${TENANT_SLUG}' (${TENANT_ID}) on ${PROJECT_REF} (${envLabel}) — ${SWEEP_ALL ? "FORCED TENANT SWEEP" : "manifest mode"}${DRY_RUN ? " [DRY RUN]" : ""}`
  );

  let manifest = null;
  if (!SWEEP_ALL) {
    if (!fs.existsSync(MANIFEST_PATH)) {
      console.error(`\nNo manifest at ${MANIFEST_PATH}.`);
      console.error("Re-run the seed for this project (it writes one), or pass --force-sweep.");
      console.error("Note --force-sweep deletes EVERYTHING in these tables for northwind, including rows this seed did not create.");
      process.exit(1);
    }
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    if (manifest.tenant_id !== TENANT_ID) {
      console.error(`\nManifest is for tenant ${manifest.tenant_id}, but slug '${TENANT_SLUG}' on ${PROJECT_REF} is ${TENANT_ID}.`);
      console.error("That manifest belongs to a different environment. Refusing.");
      process.exit(1);
    }
    const reused = manifest.reused || {};
    console.log(
      `  manifest: ${manifest.rentals.length} rentals, ${manifest.payments.length} payments, ${manifest.ledger_entries.length} ledger rows`
    );
    console.log(
      `  leaving alone ${reused.vehicles?.length || 0} pre-existing vehicles, ${reused.customers?.length || 0} pre-existing customers, ${reused.pickup_locations?.length || 0} pre-existing locations`
    );
  } else {
    console.log("  WARNING: --force-sweep ignores the manifest and deletes every row in these tables for northwind.");
  }

  const list = (arr) => (arr && arr.length ? arr.map((v) => `'${v}'`).join(",") : "'00000000-0000-0000-0000-000000000000'");
  const m = manifest || {};
  const rentalIds = (m.rentals || []).map((r) => r.id);
  const customerIds = m.customers || [];      // NEW customers only; reused ones are excluded by design
  const vehicleIds = m.vehicles || [];        // NEW vehicles only
  const locIds = m.pickup_locations || [];    // NEW locations only
  const paymentIds = m.payments || [];
  const ledgerIds = m.ledger_entries || [];
  const extIds = m.rental_extensions || [];
  const accrualIds = m.payg_accruals || [];
  const reviewIds = m.rental_reviews || [];

  /** [label, manifest-mode SQL, sweep SQL] — FK-safe order. */
  const STEPS = [
    ["reminder_events (raised by the daily-reminders cron off seeded charges)",
      `DELETE FROM public.reminder_events WHERE tenant_id = ${T} AND rental_id IN (${list(rentalIds)});`,
      `DELETE FROM public.reminder_events WHERE tenant_id = ${T};`],
    ["payg_reminder_log",
      `DELETE FROM public.payg_reminder_log WHERE tenant_id = ${T} AND rental_id IN (${list(rentalIds)});`,
      `DELETE FROM public.payg_reminder_log WHERE tenant_id = ${T};`],
    ["payg_accruals",
      `DELETE FROM public.payg_accruals WHERE tenant_id = ${T} AND id IN (${list(accrualIds)});`,
      `DELETE FROM public.payg_accruals WHERE tenant_id = ${T};`],
    ["payment_applications (no tenant_id column — scoped through the seeded payments)",
      `DELETE FROM public.payment_applications WHERE payment_id IN (
         SELECT id FROM public.payments WHERE tenant_id = ${T} AND id IN (${list(paymentIds)}));`,
      `DELETE FROM public.payment_applications WHERE payment_id IN (
         SELECT id FROM public.payments WHERE tenant_id = ${T});`],
    ["pnl_entries (written by payment_apply_fifo_v2 and pnl_post_acquisition)",
      `DELETE FROM public.pnl_entries WHERE tenant_id = ${T}
         AND (rental_id IN (${list(rentalIds)}) OR payment_id IN (${list(paymentIds)}) OR vehicle_id IN (${list(vehicleIds)}));`,
      `DELETE FROM public.pnl_entries WHERE tenant_id = ${T};`],
    ["financial_events (written by enqueue_financial_event_for_ledger_entry)",
      `DELETE FROM public.financial_events WHERE tenant_id = ${T} AND (rental_id IN (${list(rentalIds)}) OR source_id IN (${list(ledgerIds)}));`,
      `DELETE FROM public.financial_events WHERE tenant_id = ${T};`],
    ["rental_reviews",
      `DELETE FROM public.rental_reviews WHERE tenant_id = ${T} AND id IN (${list(reviewIds)});`,
      `DELETE FROM public.rental_reviews WHERE tenant_id = ${T};`],
    ["payments (before rentals — that FK is RESTRICT)",
      `DELETE FROM public.payments WHERE tenant_id = ${T} AND id IN (${list(paymentIds)});`,
      `DELETE FROM public.payments WHERE tenant_id = ${T};`],
    ["ledger_entries",
      `DELETE FROM public.ledger_entries WHERE tenant_id = ${T} AND id IN (${list(ledgerIds)});`,
      `DELETE FROM public.ledger_entries WHERE tenant_id = ${T};`],
    // Charges the rental_charges_trigger generated for seeded monthly rentals:
    // written by the DB, not by the seed, so they are not in the manifest — but
    // they are still scoped to seeded rental ids and nothing else.
    ["ledger_entries (trigger-generated charges on seeded rentals)",
      `DELETE FROM public.ledger_entries WHERE tenant_id = ${T} AND rental_id IN (${list(rentalIds)});`,
      `DELETE FROM public.ledger_entries WHERE tenant_id = ${T};`],
    ["rental_extensions",
      `DELETE FROM public.rental_extensions WHERE tenant_id = ${T} AND id IN (${list(extIds)});`,
      `DELETE FROM public.rental_extensions WHERE tenant_id = ${T};`],
    ["rentals",
      `DELETE FROM public.rentals WHERE tenant_id = ${T} AND id IN (${list(rentalIds)});`,
      `DELETE FROM public.rentals WHERE tenant_id = ${T};`],
    ["chat_channels (created by the customers_create_chat_channel trigger, for SEEDED customers only)",
      `DELETE FROM public.chat_channels WHERE tenant_id = ${T} AND customer_id IN (${list(customerIds)});`,
      `DELETE FROM public.chat_channels WHERE tenant_id = ${T};`],
    ["customers (seed-created only — pre-existing ones are left alone)",
      `DELETE FROM public.customers WHERE tenant_id = ${T} AND id IN (${list(customerIds)});`,
      `DELETE FROM public.customers WHERE tenant_id = ${T};`],
    ["vehicle_health_cache (seed-created vehicles only)",
      `DELETE FROM public.vehicle_health_cache WHERE vehicle_id IN (
         SELECT id FROM public.vehicles WHERE tenant_id = ${T} AND id IN (${list(vehicleIds)}));`,
      `DELETE FROM public.vehicle_health_cache WHERE vehicle_id IN (
         SELECT id FROM public.vehicles WHERE tenant_id = ${T});`],
    ["vehicles (seed-created only — a reused fleet is left alone)",
      `DELETE FROM public.vehicles WHERE tenant_id = ${T} AND id IN (${list(vehicleIds)});`,
      `DELETE FROM public.vehicles WHERE tenant_id = ${T};`],
    ["pickup_locations (seed-created only)",
      `DELETE FROM public.pickup_locations WHERE tenant_id = ${T} AND id IN (${list(locIds)});`,
      `DELETE FROM public.pickup_locations WHERE tenant_id = ${T};`],
    ["notifications (in-app bells from notify_new_rental / notify_payment_received / notify_refund_processed)",
      `DELETE FROM public.notifications WHERE tenant_id = ${T}
         AND (metadata->>'rental_id' IN (${list(rentalIds)}) OR metadata->>'payment_id' IN (${list(paymentIds)}) OR metadata->>'dedupe_key' IN (${list(paymentIds)}));`,
      `DELETE FROM public.notifications WHERE tenant_id = ${T};`],
    ["rag_sync_queue (queued by the *_rag_trigger triggers)",
      `DELETE FROM public.rag_sync_queue WHERE tenant_id = ${T} AND source_id = ANY(ARRAY[${
        [...rentalIds, ...customerIds, ...vehicleIds, ...paymentIds].map((v) => `'${v}'`).join(",") || "''"
      }]);`,
      `DELETE FROM public.rag_sync_queue WHERE tenant_id = ${T};`],
  ];

  for (const [label, exactSql, sweepSql] of STEPS) await runSql(label, SWEEP_ALL ? sweepSql : exactSql);

  if (DRY_RUN) return;

  const counts = await runSql(
    "verify",
    `SELECT
       (SELECT count(*) FROM public.vehicles WHERE tenant_id = ${T}) AS vehicles,
       (SELECT count(*) FROM public.customers WHERE tenant_id = ${T}) AS customers,
       (SELECT count(*) FROM public.pickup_locations WHERE tenant_id = ${T}) AS locations,
       (SELECT count(*) FROM public.rentals WHERE tenant_id = ${T}) AS rentals,
       (SELECT count(*) FROM public.rental_extensions WHERE tenant_id = ${T}) AS extensions,
       (SELECT count(*) FROM public.ledger_entries WHERE tenant_id = ${T}) AS ledger,
       (SELECT count(*) FROM public.payments WHERE tenant_id = ${T}) AS payments,
       (SELECT count(*) FROM public.payg_accruals WHERE tenant_id = ${T}) AS payg_accruals,
       (SELECT count(*) FROM public.rental_reviews WHERE tenant_id = ${T}) AS reviews;`
  );
  console.log(`\nRemaining rows for ${TENANT_SLUG} on ${envLabel} (anything left is not the seed's):`);
  console.table(counts);

  if (!SWEEP_ALL && fs.existsSync(MANIFEST_PATH)) {
    fs.renameSync(MANIFEST_PATH, `${MANIFEST_PATH}.wiped`);
    console.log(`Manifest moved to ${path.basename(MANIFEST_PATH)}.wiped`);
  }
}

main();
