#!/usr/bin/env node
/**
 * seed-northwind.mjs — seed the `northwind` canary tenant with coherent demo data.
 *
 * northwind is the v2 design canary. This gives it a fleet, a customer book and a
 * spread of rentals whose dates, ledger, payments and extensions all tell one
 * consistent story — in particular the extension timeline, deposits, a refund and
 * exactly one identifiable outstanding balance.
 *
 * WORKS AGAINST EITHER ENVIRONMENT, and resolves everything at runtime:
 *
 *   # staging (what local dev reads — see .env.local)
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/seed-northwind.mjs --ref ksmreaadhbirzakkxqrq
 *   # production
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/seed-northwind.mjs --ref hviqoaokxvlancmftwuo
 *
 * The tenant is looked up by `slug = 'northwind'` — NEVER by a hardcoded id. The
 * two environments have different northwind ids (prod 6e5c544f-…, staging
 * 8e6bc88f-…) and an id-keyed reference silently resolves wrong in the
 * environment it was not written against; apps/portal/src/lib/v2.ts carries a
 * long comment on exactly that failure.
 *
 * IDEMPOTENT AND ADDITIVE. Safe to run twice, and safe to run on a tenant that
 * already has data:
 *   * every INSERT carries ON CONFLICT DO NOTHING against a deterministic
 *     (UUID v5) id, so a second run writes nothing;
 *   * existing pickup locations, vehicles and customers are REUSED rather than
 *     duplicated — a parallel fleet is never created alongside a real one;
 *   * rentals already in the tenant are read first, and each seeded live/upcoming
 *     rental is placed on a vehicle whose dates are actually free, so the
 *     prevent_rental_overlap trigger never fires and nothing existing is touched.
 * Nothing here UPDATEs or DELETEs a pre-existing row. The only UPDATEs are the
 * refund follow-ups and the deposit deduction, both on rows this script inserted
 * moments earlier, and both mirroring what the real edge functions do.
 *
 * SAFETY — this can run against PRODUCTION.
 *   * Every statement is scoped to the resolved tenant id. Nothing global.
 *   * A pre-flight refuses to seed unless the tenant is notification-inert, so
 *     a config change cannot quietly turn a seed run into a mailshot.
 *
 * NOTIFICATION GATES (re-checked at run time by the pre-flight, per environment):
 *   tenants.email_notifications_enabled must be false. This is the load-bearing
 *     one: notify_new_rental / notify_payment_received / notify_refund_processed
 *     write `notifications` rows, and notify_operator_email_dispatch turns the
 *     transactional ones into real email via net.http_post. On STAGING that POST
 *     is hardcoded to the PRODUCTION functions host, so a true value there would
 *     mail live operators from a staging seed.
 *   tenants.push_notifications_enabled must be false (no web push).
 *   tenants.return_reminder_enabled must be false (send-return-reminders skips).
 *   private.notify_platform_rental must be unable to fire: it returns early when
 *     tenant_type = 'test' (prod northwind) OR when private.platform_config has
 *     no functions_base_url (staging, where the table is empty). The pre-flight
 *     requires one of those to hold.
 *   Customer-facing notify_customer_rental_status_change only fires on UPDATE and
 *     needs a customer_users row; this script only INSERTs, and seeds none.
 *
 * CRON AVOIDANCE (why some fields are set the way they are). Every cron is
 * currently INACTIVE on staging but ALL ARE LIVE ON PROD, so these hold anyway:
 *   * deposit_hold_status is only ever a TERMINAL value ('released', 'captured').
 *     'held'/'failed'/'processing' would be picked up every 6h by
 *     reconcile-deposit-holds, which would probe Stripe with a fabricated
 *     PaymentIntent id forever.
 *   * The PAYG rental has payg_paused = true, payg_next_accrual_at = NULL and
 *     payg_auto_reminders_enabled = false, so accrue-payg-charges (every 5 min)
 *     and send-payg-reminders both skip it. Its accrual history is seeded by hand.
 *   * auto_extend_enabled is left false, so auto-extend-rentals skips.
 *   * delivery_method is left NULL, so send-lockbox-scheduled skips (staging
 *     northwind has lockbox_enabled = true).
 *
 * Flags:
 *   --ref <project-ref>   which Supabase project (or SUPABASE_PROJECT_REF)
 *   --dry-run             print the SQL, change nothing
 *
 * Teardown: scripts/wipe-northwind.mjs (same --ref, reads the manifest this writes).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TENANT_SLUG = "northwind";
const KNOWN_REFS = { prod: "hviqoaokxvlancmftwuo", staging: "ksmreaadhbirzakkxqrq" };

const argRef = (() => {
  const i = process.argv.indexOf("--ref");
  return i >= 0 ? process.argv[i + 1] : null;
})();
const PROJECT_REF = KNOWN_REFS[argRef] || argRef || process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const DRY_RUN = process.argv.includes("--dry-run");

if (!PROJECT_REF) {
  console.error("Which project? Pass --ref <project-ref|prod|staging> or set SUPABASE_PROJECT_REF.");
  console.error(`  prod    = ${KNOWN_REFS.prod}`);
  console.error(`  staging = ${KNOWN_REFS.staging}   (what local dev reads)`);
  process.exit(1);
}
if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN is required (Supabase Management API token).");
  process.exit(1);
}

const MANIFEST_PATH = path.join(__dirname, `northwind-seed-manifest.${PROJECT_REF}.json`);

// The "today" the story is written around. A constant, so a re-run reproduces
// the same rows rather than silently drifting with the wall clock.
const TODAY = "2026-09-06";

// ---------------------------------------------------------------------------
// Deterministic ids — UUID v5 over a fixed namespace, so a re-run reuses the
// same ids, ON CONFLICT DO NOTHING makes it a no-op, and the manifest keeps
// meaning. The two environments are separate databases, so identical ids across
// them are harmless (and make a URL portable between the two).
// ---------------------------------------------------------------------------
const NAMESPACE = "1f0b6a6e-4f21-4a0e-9c2b-6e5c544f0000";
function uuid5(name) {
  const nsBytes = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const h = crypto.createHash("sha1").update(nsBytes).update(Buffer.from(`northwind:${name}`, "utf8")).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------
const N = "NULL";
const s = (v) => (v === null || v === undefined ? N : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? N : String(v));
const b = (v) => (v === null || v === undefined ? N : v ? "true" : "false");

async function runSql(label, sql) {
  if (DRY_RUN && !label.startsWith("read:")) {
    console.log(`\n-- [dry-run] ${label}\n${sql}\n`);
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

const round2 = (x) => Math.round(x * 100) / 100;
const addDays = (iso, d) => {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + d);
  return dt.toISOString().slice(0, 10);
};
const daysBetween = (a, z) => Math.round((new Date(`${z}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart <= (bEnd || "9999-12-31") && (aEnd || "9999-12-31") >= bStart;

// ---------------------------------------------------------------------------
// Default fleet / locations, used ONLY when the tenant has none of its own.
// ---------------------------------------------------------------------------
const DEFAULT_LOCATIONS = [
  { key: "loc-downtown", name: "Northwind Downtown Depot", address: "1200 Market Street, Springfield, IL 62701",
    description: "Main counter. Staffed 7am-8pm, keys handed over in person.", delivery_fee: 0, sort_order: 1 },
  { key: "loc-airport", name: "Northwind Airport Counter", address: "Capital Regional Airport, Terminal B Arrivals, Springfield, IL 62707",
    description: "Kerbside pickup outside Terminal B. Airport surcharge applies.", delivery_fee: 35, sort_order: 2 },
];

// `reg` is globally unique across the whole platform, hence the NWD- prefix.
const DEFAULT_VEHICLES = [
  { key: "v1", reg: "NWD-1042", year: 2023, make: "Toyota",    model: "Corolla",   colour: "Silver",        category: "sedan",    fuel: "Petrol",   daily: 55,  weekly: 330, monthly: 1150, deposit: 300, mileage: 24180, acq: 21500 },
  { key: "v2", reg: "NWD-2087", year: 2022, make: "Honda",     model: "Civic",     colour: "Metallic Blue", category: "sedan",    fuel: "Petrol",   daily: 58,  weekly: 348, monthly: 1200, deposit: 300, mileage: 31760, acq: 20400 },
  { key: "v3", reg: "NWD-3311", year: 2024, make: "Tesla",     model: "Model 3",   colour: "Pearl White",   category: "electric", fuel: "Electric", daily: 95,  weekly: 570, monthly: 2100, deposit: 750, mileage: 9840,  acq: 41900 },
  { key: "v4", reg: "NWD-4526", year: 2023, make: "Ford",      model: "Explorer",  colour: "Graphite",      category: "suv",      fuel: "Petrol",   daily: 89,  weekly: 534, monthly: 1950, deposit: 500, mileage: 18320, acq: 38750 },
  { key: "v5", reg: "NWD-5190", year: 2021, make: "Nissan",    model: "Versa",     colour: "Red",           category: "economy",  fuel: "Petrol",   daily: 45,  weekly: 270, monthly: 950,  deposit: 250, mileage: 46210, acq: 14200 },
  { key: "v6", reg: "NWD-6733", year: 2023, make: "Chevrolet", model: "Malibu",    colour: "Black",         category: "sedan",    fuel: "Petrol",   daily: 62,  weekly: 372, monthly: 1300, deposit: 300, mileage: 20890, acq: 23100 },
  { key: "v7", reg: "NWD-7408", year: 2024, make: "Kia",       model: "Telluride", colour: "Dark Green",    category: "suv",      fuel: "Petrol",   daily: 105, weekly: 630, monthly: 2300, deposit: 600, mileage: 7430,  acq: 44600 },
  { key: "v8", reg: "NWD-8215", year: 2022, make: "Hyundai",   model: "Elantra",   colour: "White",         category: "economy",  fuel: "Petrol",   daily: 48,  weekly: 288, monthly: 1000, deposit: 250, mileage: 35470, acq: 17300,
    paused: true, paused_reason: "Off the road for a windscreen replacement — back on fleet 12 Sep." },
];

// Customers. Names are obviously fictional; every email is on example.com
// (RFC 2606 reserved, cannot deliver) and every phone is in the +1555 range.
const CUSTOMERS = [
  { key: "c1",  name: "Ada Whitfield",       email: "ada.whitfield@example.com",      phone: "+15555550101", verif: "verified",          city: "Springfield", state: "IL", zip: "62701", dob: "1988-03-14", lic: "NWD-DL-1001" },
  { key: "c2",  name: "Marcus Bellweather",  email: "marcus.bellweather@example.com", phone: "+15555550102", verif: "verified",          city: "Springfield", state: "IL", zip: "62704", dob: "1979-11-02", lic: "NWD-DL-1002" },
  { key: "c3",  name: "Priya Raman",         email: "priya.raman@example.com",        phone: "+15555550103", verif: "verified",          city: "Decatur",     state: "IL", zip: "62521", dob: "1992-07-25", lic: "NWD-DL-1003" },
  { key: "c4",  name: "Diego Santoro",       email: "diego.santoro@example.com",      phone: "+15555550104", verif: "unverified",        city: "Springfield", state: "IL", zip: "62703", dob: "1995-01-30", lic: "NWD-DL-1004" },
  { key: "c5",  name: "Nina Kowalski",       email: "nina.kowalski@example.com",      phone: "+15555550105", verif: "pending",           city: "Bloomington", state: "IL", zip: "61701", dob: "1990-09-08", lic: "NWD-DL-1005" },
  { key: "c6",  name: "Theo Okafor",         email: "theo.okafor@example.com",        phone: "+15555550106", verif: "verified",          city: "Springfield", state: "IL", zip: "62702", dob: "1986-05-19", lic: "NWD-DL-1006", gig: true },
  { key: "c7",  name: "Camille Duval",       email: "camille.duval@example.com",      phone: "+15555550107", verif: "manually_verified", city: "Peoria",      state: "IL", zip: "61602", dob: "1983-12-11", lic: "NWD-DL-1007" },
  { key: "c8",  name: "Sven Halvorsen",      email: "sven.halvorsen@example.com",     phone: "+15555550108", verif: "unverified",        city: "Springfield", state: "IL", zip: "62704", dob: "1998-02-27", lic: "NWD-DL-1008" },
  { key: "c9",  name: "Rosalind Achebe",     email: "rosalind.achebe@example.com",    phone: "+15555550109", verif: "verified",          city: "Champaign",   state: "IL", zip: "61820", dob: "1981-08-04", lic: "NWD-DL-1009" },
  { key: "c10", name: "Hector Vasquez",      email: "hector.vasquez@example.com",     phone: "+15555550110", verif: "verified",          city: "Springfield", state: "IL", zip: "62701", dob: "1993-04-16", lic: "NWD-DL-1010", gig: true },
  { key: "c11", name: "Larkspur Freight Co", email: "ops.larkspur@example.com",       phone: "+15555550111", verif: "verified",          city: "Springfield", state: "IL", zip: "62711", dob: null,         lic: null, company: true },
];

/**
 * The rental story.
 *
 * `status` is the DB value. rentals_status_check allows only
 * Pending/Active/Closed/Rejected/Cancelled — there is NO 'Completed'. The portal
 * derives its label in apps/portal/src/lib/rental-utils.ts:
 *   Closed -> "Completed" | Active + future start -> "Upcoming"
 *   Active + past end -> "Completed" | Active otherwise -> "Active"
 *
 * `vslot` is a PREFERENCE, not a decision: live/upcoming rentals are reassigned
 * at run time to whichever fleet vehicle is genuinely free for their window, so
 * this never collides with rentals already in the tenant.
 *
 * Money is derived from the assigned vehicle's own rates, so the figures stay
 * coherent whatever fleet the environment happens to have.
 *
 * `pay`: full | part:<fraction> | none | refund | partial-refund:<fraction>
 */
const RENTALS = [
  // ---- Completed history (status Closed; exempt from the overlap trigger) ---
  { key: "r01", c: "c1",  vslot: 0, start: "2026-04-12", end: "2026-04-19", type: "Weekly", created: "2026-04-08", status: "Closed", pay: "full", review: 9 },
  { key: "r02", c: "c2",  vslot: 1, start: "2026-04-15", end: "2026-04-18", type: "Daily",  created: "2026-04-14", status: "Closed", pay: "full", review: 8 },
  { key: "r03", c: "c3",  vslot: 2, start: "2026-04-20", end: "2026-04-27", type: "Weekly", created: "2026-04-11", status: "Closed", pay: "full", review: 10 },
  { key: "r04", c: "c4",  vslot: 4, start: "2026-05-02", end: "2026-05-09", type: "Weekly", created: "2026-04-29", status: "Closed", pay: "full" },
  { key: "r05", c: "c5",  vslot: 3, start: "2026-05-05", end: "2026-05-12", type: "Weekly", created: "2026-04-30", status: "Closed", pay: "full", deposit: { outcome: "released" }, review: 7 },
  { key: "r06", c: "c6",  vslot: 5, start: "2026-05-14", end: "2026-05-17", type: "Daily",  created: "2026-05-12", status: "Closed", pay: "full" },
  { key: "r07", c: "c7",  vslot: 6, start: "2026-05-20", end: "2026-05-27", type: "Weekly", created: "2026-05-09", status: "Closed", pay: "full",
    deposit: { outcome: "captured", deductFraction: 0.3, reason: "Excess mileage — 620 miles over the weekly allowance." }, review: 5 },
  { key: "r08", c: "c8",  vslot: 0, start: "2026-06-01", end: "2026-06-08", type: "Weekly", created: "2026-05-26", status: "Closed", pay: "full" },
  { key: "r09", c: "c9",  vslot: 1, start: "2026-06-03", end: "2026-06-06", type: "Daily",  created: "2026-06-02", status: "Closed", pay: "full", review: 9 },
  { key: "r10", c: "c10", vslot: 2, start: "2026-06-10", end: "2026-06-17", type: "Weekly", created: "2026-06-01", status: "Closed", pay: "full", review: 8 },
  { key: "r11", c: "c11", vslot: 3, start: "2026-06-15", end: "2026-07-15", type: "Monthly", created: "2026-06-05", status: "Closed", pay: "full",
    origEnd: "2026-07-15", prevEnd: "2026-07-15", newEnd: "2026-07-22",
    extensions: [{ seq: 1, from: "2026-07-15", to: "2026-07-22", days: 7, status: "paid" }] },
  { key: "r12", c: "c1",  vslot: 5, start: "2026-07-01", end: "2026-07-08", type: "Weekly", created: "2026-06-24", status: "Closed", pay: "full", review: 6 },
  { key: "r13", c: "c2",  vslot: 4, start: "2026-07-05", end: "2026-07-12", type: "Weekly", created: "2026-07-02", status: "Closed", pay: "part:0.65" },
  { key: "r14", c: "c3",  vslot: 6, start: "2026-07-18", end: "2026-07-25", type: "Weekly", created: "2026-07-09", status: "Closed", pay: "full", review: 10 },
  { key: "r15", c: "c6",  vslot: 7, start: "2026-08-01", end: "2026-08-05", type: "Daily",  created: "2026-07-30", status: "Closed", pay: "full" },
  { key: "r16", c: "c4",  vslot: 0, start: "2026-08-10", end: "2026-08-17", type: "Weekly", created: "2026-08-06", status: "Closed", pay: "none" },

  // ---- Live rentals (status Active, started, not yet finished) --------------
  // r17 is the flagship: extended three times, part paid, deposit collected.
  { pri: 0, key: "r17", c: "c1", vslot: 0, start: "2026-08-30", end: "2026-09-06", type: "Weekly", created: "2026-08-24", status: "Active",
    pay: "full", paymentStatus: "pending", deposit: { outcome: "ledger" },
    origEnd: "2026-09-06", prevEnd: "2026-09-11", newEnd: "2026-09-13",
    extensions: [
      { seq: 1, from: "2026-09-06", to: "2026-09-09", days: 3, status: "paid" },
      { seq: 2, from: "2026-09-09", to: "2026-09-11", days: 2, status: "paid" },
      // approved but NOT paid — the single identifiable outstanding balance
      { seq: 3, from: "2026-09-11", to: "2026-09-13", days: 2, status: "approved" },
    ] },
  { key: "r18", c: "c3",  vslot: 2, start: "2026-09-01", end: "2026-09-15", type: "Weekly", created: "2026-08-21", status: "Active", pay: "full" },
  { pri: 0, key: "r19", c: "c5",  vslot: 3, start: "2026-08-25", end: "2026-09-10", type: "Monthly", created: "2026-08-18", status: "Active", pay: "part:0.6",
    origEnd: "2026-09-10", newEnd: "2026-09-25",
    extensions: [{ seq: 1, from: "2026-09-10", to: "2026-09-25", days: 15, status: "paid" }] },
  { key: "r20", c: "c7",  vslot: 5, start: "2026-09-02", end: "2026-09-09", type: "Weekly", created: "2026-08-27", status: "Active", pay: "full" },
  { pri: 1, key: "r21", c: "c9",  vslot: 6, start: "2026-09-04", end: "2026-09-11", type: "Weekly", created: "2026-09-01", status: "Active", pay: "none" },
  { pri: 0, key: "r22", c: "c10", vslot: 4, start: "2026-08-28", end: "2026-09-20", type: "Daily",  created: "2026-08-27", status: "Active", pay: "payg", payg: true },

  // ---- Upcoming (status Active, start in the future) -----------------------
  { key: "r23", c: "c2",  vslot: 0, start: "2026-09-20", end: "2026-09-27", type: "Weekly", created: "2026-09-01", status: "Active", pay: "full" },
  { pri: 1, key: "r24", c: "c4",  vslot: 2, start: "2026-09-18", end: "2026-09-25", type: "Weekly", created: "2026-09-02", status: "Active", pay: "part:0.45" },
  { key: "r25", c: "c6",  vslot: 5, start: "2026-09-14", end: "2026-09-21", type: "Weekly", created: "2026-09-03", status: "Active", pay: "full" },
  { key: "r26", c: "c11", vslot: 3, start: "2026-09-28", end: "2026-10-28", type: "Monthly", created: "2026-09-04", status: "Active", pay: "none" },

  // ---- Awaiting approval (status Pending) ----------------------------------
  { key: "r27", c: "c8", vslot: 6, start: "2026-09-25", end: "2026-10-02", type: "Weekly", created: "2026-09-05", status: "Pending", pay: "none" },
  { key: "r28", c: "c5", vslot: 4, start: "2026-09-28", end: "2026-10-05", type: "Weekly", created: "2026-09-05", status: "Pending", pay: "none" },
  { key: "r29", c: "c3", vslot: 1, start: "2026-09-22", end: "2026-09-29", type: "Weekly", created: "2026-09-06", status: "Pending", pay: "none" },

  // ---- Cancelled / rejected (exempt from the overlap trigger) ---------------
  { key: "r30", c: "c9",  vslot: 7, start: "2026-09-08", end: "2026-09-15", type: "Weekly", created: "2026-08-29", status: "Cancelled", pay: "refund",
    cancelReason: "Customer cancelled — trip called off, cancelled inside the free window." },
  { key: "r31", c: "c10", vslot: 5, start: "2026-08-20", end: "2026-08-27", type: "Weekly", created: "2026-08-14", status: "Cancelled", pay: "partial-refund:0.48",
    cancelReason: "Cancelled two days out — one day's hire retained per the cancellation policy." },
  { key: "r32", c: "c8",  vslot: 2, start: "2026-09-30", end: "2026-10-07", type: "Weekly", created: "2026-09-05", status: "Rejected", pay: "none",
    cancelReason: "rejected_by_admin" },
];

const TAX_RATE = 0.08;
const SERVICE_FEE_RATE = 0.05;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const envLabel = Object.entries(KNOWN_REFS).find(([, v]) => v === PROJECT_REF)?.[0] || "unknown";
  console.log(`Seeding '${TENANT_SLUG}' on project ${PROJECT_REF} (${envLabel})${DRY_RUN ? " [DRY RUN]" : ""}`);

  // -- 1. Resolve the tenant BY SLUG, and prove it cannot notify anyone -------
  const pre = await runSql(
    "read: resolve tenant + notification gates",
    `SELECT t.id, t.slug, t.company_name, t.tenant_type,
            t.email_notifications_enabled, t.push_notifications_enabled,
            t.return_reminder_enabled, t.currency_code,
            (SELECT count(*) FROM private.platform_config WHERE key = 'functions_base_url' AND value IS NOT NULL) AS platform_notify_configured,
            (SELECT count(*) FROM public.customer_users cu JOIN public.customers c ON c.id = cu.customer_id WHERE c.tenant_id = t.id) AS customer_users
       FROM public.tenants t WHERE t.slug = '${TENANT_SLUG}';`
  );
  if (!pre.length) {
    console.error(`No tenant with slug '${TENANT_SLUG}' on project ${PROJECT_REF}.`);
    process.exit(1);
  }
  const tenant = pre[0];
  const TENANT_ID = tenant.id;
  const T = `'${TENANT_ID}'`;
  console.log(`  tenant: ${tenant.slug} / ${tenant.company_name} / id ${TENANT_ID} / type ${tenant.tenant_type ?? "null"}`);

  const platformNotifyLive = Number(tenant.platform_notify_configured) > 0 && tenant.tenant_type !== "test";
  const gateProblems = [];
  if (tenant.email_notifications_enabled === true) gateProblems.push("email_notifications_enabled = true (operator email would be sent for real)");
  if (tenant.push_notifications_enabled === true) gateProblems.push("push_notifications_enabled = true (web push would fire)");
  if (tenant.return_reminder_enabled === true) gateProblems.push("return_reminder_enabled = true (send-return-reminders would mail customers)");
  if (platformNotifyLive) gateProblems.push("notify_platform_rental can fire (tenant_type is not 'test' AND platform_config.functions_base_url is set)");
  if (gateProblems.length) {
    console.error("\nREFUSING TO SEED — this tenant is no longer notification-inert:");
    for (const p of gateProblems) console.error(`  * ${p}`);
    console.error("Seeding now could send real messages to real people. Fix the gate or re-read the header of this file.");
    process.exit(1);
  }
  console.log(`  gates ok — email off, push off, return-reminders off, platform-notify inert${Number(tenant.customer_users) ? "" : ", no customer_users"}`);

  // -- 2. Read what the tenant already has, so we extend rather than duplicate -
  const [existingLocs, existingVehicles, existingCustomers, existingRentals] = await Promise.all([
    runSql("read: pickup_locations", `SELECT id, name, delivery_fee FROM public.pickup_locations WHERE tenant_id = ${T} AND is_active ORDER BY sort_order, name;`),
    runSql("read: vehicles", `SELECT id, reg, make, model, daily_rent, weekly_rent, monthly_rent, security_deposit, pickup_location_id FROM public.vehicles WHERE tenant_id = ${T} AND NOT COALESCE(is_disposed, false) ORDER BY reg;`),
    runSql("read: customers", `SELECT id, email FROM public.customers WHERE tenant_id = ${T} AND email IS NOT NULL;`),
    runSql(
      "read: rentals already in this tenant",
      `SELECT id, vehicle_id, start_date, end_date, status, rental_number FROM public.rentals
        WHERE tenant_id = ${T} AND vehicle_id IS NOT NULL;`
    ),
  ]);
  // check_rental_overlap guards operator blocks as well as other rentals, and a
  // clash there raises 23P05 rather than being a soft conflict — so blocked
  // dates have to be treated exactly like an occupied vehicle. Another agent
  // added maintenance blocks to prod's fleet the day this was written.
  const blocks = await runSql(
    "read: blocked_dates",
    `SELECT vehicle_id, start_date, end_date, COALESCE(reason, source_type) AS reason
       FROM public.blocked_dates WHERE tenant_id = ${T} AND vehicle_id IS NOT NULL AND end_date >= '2026-01-01';`
  );
  console.log(
    `  found: ${existingVehicles.length} vehicles, ${existingCustomers.length} customers, ${existingLocs.length} locations, ${existingRentals.length} rentals already in the tenant`
  );

  const manifest = {
    seeded_at: new Date().toISOString(),
    project_ref: PROJECT_REF,
    environment: envLabel,
    tenant_slug: TENANT_SLUG,
    tenant_id: TENANT_ID,
    today: TODAY,
    reused: { vehicles: [], customers: [], pickup_locations: [] },
    pickup_locations: [], vehicles: [], customers: [], rentals: [],
    rental_extensions: [], ledger_entries: [], payments: [], payment_applications: [],
    payg_accruals: [], rental_reviews: [],
  };

  const stmts = [];

  // -- 3. Pickup locations: reuse if the tenant has any -----------------------
  let locations;
  if (existingLocs.length) {
    locations = existingLocs.map((l) => ({ id: l.id, name: l.name, delivery_fee: Number(l.delivery_fee || 0) }));
    manifest.reused.pickup_locations = locations.map((l) => l.id);
    console.log(`  reusing ${locations.length} existing pickup location(s)`);
  } else {
    locations = DEFAULT_LOCATIONS.map((l) => ({ id: uuid5(l.key), name: l.name, delivery_fee: l.delivery_fee }));
    manifest.pickup_locations = locations.map((l) => l.id);
    stmts.push({
      label: "pickup_locations",
      sql: `INSERT INTO public.pickup_locations (id, tenant_id, name, address, description, delivery_fee, sort_order) VALUES\n${DEFAULT_LOCATIONS.map(
        (l) => `(${s(uuid5(l.key))}, ${T}, ${s(l.name)}, ${s(l.address)}, ${s(l.description)}, ${n(l.delivery_fee)}, ${n(l.sort_order)})`
      ).join(",\n")}\nON CONFLICT DO NOTHING;`,
    });
  }
  // The location that carries a delivery fee, if any — used for the fee story.
  const feeLocation = locations.find((l) => l.delivery_fee > 0) || null;

  // -- 4. Fleet: reuse if the tenant already has a real one -------------------
  let fleet;
  if (existingVehicles.length >= 6) {
    fleet = existingVehicles.map((v) => ({
      id: v.id, reg: v.reg, label: `${v.make ?? ""} ${v.model ?? ""}`.trim() || v.reg,
      daily: Number(v.daily_rent || 50), weekly: Number(v.weekly_rent || v.daily_rent * 6 || 300),
      monthly: Number(v.monthly_rent || v.daily_rent * 22 || 1100), deposit: Number(v.security_deposit || 300),
      loc: v.pickup_location_id || locations[0]?.id || null,
    }));
    manifest.reused.vehicles = fleet.map((v) => v.id);
    console.log(`  reusing the tenant's own fleet of ${fleet.length}: ${fleet.map((v) => v.reg).join(", ")}`);
  } else {
    fleet = DEFAULT_VEHICLES.map((v, i) => ({
      id: uuid5(v.key), reg: v.reg, label: `${v.make} ${v.model}`, daily: v.daily, weekly: v.weekly,
      monthly: v.monthly, deposit: v.deposit, loc: locations[i % locations.length]?.id || null,
    }));
    manifest.vehicles = fleet.map((v) => v.id);
    stmts.push({
      label: "vehicles",
      sql: `INSERT INTO public.vehicles (
  id, tenant_id, reg, make, model, colour, year, category, fuel_type,
  daily_rent, weekly_rent, monthly_rent, security_deposit, current_mileage,
  pickup_location_id, description, is_paused, paused_reason, paused_at,
  acquisition_type, purchase_price, acquisition_date,
  daily_mileage, weekly_mileage, monthly_mileage, excess_mileage_rate,
  available_daily, available_weekly, available_monthly
) VALUES\n${DEFAULT_VEHICLES.map((v, i) => {
        const desc = `${v.year} ${v.make} ${v.model} in ${v.colour}. ${
          v.category === "electric" ? "Charges to 80% in about 25 minutes on a supercharger." : "Automatic, air conditioning, Bluetooth."
        }`;
        return `(${s(uuid5(v.key))}, ${T}, ${s(v.reg)}, ${s(v.make)}, ${s(v.model)}, ${s(v.colour)}, ${n(v.year)}, ${s(v.category)}, ${s(v.fuel)}, ${n(v.daily)}, ${n(v.weekly)}, ${n(v.monthly)}, ${n(v.deposit)}, ${n(v.mileage)}, ${s(locations[i % locations.length]?.id ?? null)}, ${s(desc)}, ${b(!!v.paused)}, ${s(v.paused_reason ?? null)}, ${v.paused ? s(`${TODAY}T09:00:00Z`) : N}, 'Purchase', ${n(v.acq)}, ${s(`${v.year}-02-10`)}, 200, 1200, 4000, 0.35, true, true, true)`;
      }).join(",\n")}\nON CONFLICT DO NOTHING;`,
    });
  }

  // -- 5. Customers: only insert the ones this tenant does not already have ---
  const byEmail = new Map(existingCustomers.map((c) => [String(c.email).toLowerCase(), c.id]));
  const custId = {};
  const newCustomers = [];
  for (const c of CUSTOMERS) {
    const hit = byEmail.get(c.email.toLowerCase());
    if (hit) {
      custId[c.key] = hit;
      manifest.reused.customers.push(hit);
    } else {
      custId[c.key] = uuid5(c.key);
      manifest.customers.push(custId[c.key]);
      newCustomers.push(c);
    }
  }
  if (newCustomers.length) {
    stmts.push({
      label: `customers (${newCustomers.length} new, ${CUSTOMERS.length - newCustomers.length} already present)`,
      sql: `INSERT INTO public.customers (
  id, tenant_id, type, customer_type, name, email, phone,
  identity_verification_status, date_of_birth, license_number, license_state,
  address_street, address_city, address_state, address_zip,
  is_gig_driver, sms_consent, created_at, updated_at, company_name
) VALUES\n${newCustomers.map((c) => {
        const i = CUSTOMERS.indexOf(c);
        const createdAt = `2026-0${3 + Math.floor(i / 4)}-${String(3 + i * 2).padStart(2, "0")}T14:20:00Z`;
        return `(${s(custId[c.key])}, ${T}, ${s(c.company ? "Company" : "Individual")}, ${s(c.company ? "Company" : "Individual")}, ${s(c.name)}, ${s(c.email)}, ${s(c.phone)}, ${s(c.verif)}, ${s(c.dob)}, ${s(c.lic)}, ${s(c.state)}, ${s(`${100 + i * 7} Chestnut Avenue`)}, ${s(c.city)}, ${s(c.state)}, ${s(c.zip)}, ${b(!!c.gig)}, true, ${s(createdAt)}, ${s(createdAt)}, ${s(c.company ? c.name : null)})`;
      }).join(",\n")}\nON CONFLICT DO NOTHING;`,
    });
  } else {
    console.log("  all seed customers already present — none added");
  }

  // -- 6. Place each rental on a vehicle that is genuinely free ---------------
  // prevent_rental_overlap forbids two rentals on one vehicle with overlapping
  // dates unless one is Cancelled/Rejected/Closed. Start from what is already
  // booked in the tenant so a seeded rental can never collide with a real one.
  const TERMINAL = ["Closed", "Cancelled", "Rejected"];
  const seedIdToKey = new Map(RENTALS.map((r) => [uuid5(r.key), r.key]));

  // A rental this seed wrote on an EARLIER run is not a conflict with itself.
  // Without this, a second run sees its own live rentals occupying the fleet,
  // finds nowhere to put them, and refuses — the seed would only ever work once.
  const alreadySeeded = new Map(); // rental key -> the row already in the DB
  const busy = new Map();          // vehicle id -> [{start,end,who}]
  for (const r of existingRentals) {
    const key = seedIdToKey.get(r.id);
    if (key) alreadySeeded.set(key, r);
    // Only non-terminal rentals are guarded by prevent_rental_overlap.
    if (TERMINAL.includes(r.status)) continue;
    if (!busy.has(r.vehicle_id)) busy.set(r.vehicle_id, []);
    busy.get(r.vehicle_id).push({ start: r.start_date, end: r.end_date, who: r.rental_number || r.id });
  }
  for (const bl of blocks) {
    if (!busy.has(bl.vehicle_id)) busy.set(bl.vehicle_id, []);
    busy.get(bl.vehicle_id).push({ start: bl.start_date, end: bl.end_date, who: `block: ${bl.reason}` });
  }
  if (blocks.length) console.log(`  ${blocks.length} operator block(s) on the fleet — treated as occupied`);
  if (alreadySeeded.size) console.log(`  ${alreadySeeded.size} of these rentals are already seeded — keeping the vehicle each is already on`);
  const isFree = (vid, start, end) => !(busy.get(vid) || []).some((w) => overlaps(start, end, w.start, w.end));
  const fleetById = new Map(fleet.map((v) => [v.id, v]));

  const placed = new Map(); // rental key -> vehicle
  const skipped = [];
  const terminalOf = (r) => TERMINAL.includes(r.status);

  // Anything already seeded keeps the vehicle it is already on, whatever the
  // preference says — the row exists and will not be rewritten.
  for (const r of RENTALS) {
    const hit = alreadySeeded.get(r.key);
    const v = hit && fleetById.get(hit.vehicle_id);
    if (v) placed.set(r.key, v);
  }

  // Terminal rentals are exempt from the overlap trigger, so their preference
  // always stands and they consume nothing.
  for (const r of RENTALS.filter(terminalOf)) {
    if (!placed.has(r.key)) placed.set(r.key, fleet[r.vslot % fleet.length]);
  }

  // Live/upcoming/pending rentals compete for the same vehicles, and on a busy
  // tenant there may not be room for all of them. Place them in PRIORITY order
  // so the rentals that carry the story — the flagship, the PAYG one, the
  // extended one — get a vehicle before the filler does. Without this the
  // ordering is just array order, and a filler rental can starve the flagship.
  const contenders = RENTALS.filter((r) => !terminalOf(r) && !placed.has(r.key)).sort((a, b) => (a.pri ?? 5) - (b.pri ?? 5));
  for (const r of contenders) {
    const finalStart = r.start;
    const finalEnd = r.newEnd || r.end;
    const preferred = fleet[r.vslot % fleet.length];
    const candidates = [preferred, ...fleet.filter((v) => v.id !== preferred.id)];
    const pick = candidates.find((v) => isFree(v.id, finalStart, finalEnd));
    if (!pick) {
      skipped.push(r);
      continue;
    }
    placed.set(r.key, pick);
    if (!busy.has(pick.id)) busy.set(pick.id, []);
    busy.get(pick.id).push({ start: finalStart, end: finalEnd, who: r.key });
    if (pick.id !== preferred.id) console.log(`    ${r.key}: ${preferred.reg} was busy, placed on ${pick.reg}`);
  }
  if (skipped.length) {
    console.log(`    no free vehicle for ${skipped.map((r) => r.key).join(", ")} — skipped (the tenant's own bookings already occupy those dates)`);
  }
  const starved = skipped.filter((r) => (r.pri ?? 5) === 0);
  if (starved.length) {
    console.error(`\nREFUSING TO SEED: no free vehicle for story-critical rental(s) ${starved.map((r) => r.key).join(", ")}.`);
    console.error("Seeding would produce a half-told story. Free up fleet dates, or widen the fleet, and re-run.");
    process.exit(1);
  }
  const SEED = RENTALS.filter((r) => placed.has(r.key));

  // Money derived from the assigned vehicle, so it is coherent with any fleet.
  const rentalAmount = (r) => {
    const v = placed.get(r.key);
    const days = Math.max(1, daysBetween(r.start, r.end));
    if (r.payg) return v.daily;
    if (r.type === "Monthly") return v.monthly;
    if (r.type === "Weekly") return round2(Math.ceil(days / 7) * v.weekly);
    return round2(days * v.daily);
  };
  const extAmount = (r, e) => round2(e.days * placed.get(r.key).daily);
  const depositAmount = (r) => placed.get(r.key).deposit;

  // -- 7. Rentals ------------------------------------------------------------
  // Only rentals that are not already present. ON CONFLICT DO NOTHING does NOT
  // make this idempotent on its own: check_rental_overlap is a BEFORE INSERT
  // trigger, so on a re-run it raises 23P05 against the row's own twin (or
  // against an operator block added since) long before the conflict clause is
  // reached. Everything downstream still references every seeded rental, so a
  // re-run continues to top up any ledger/payment rows that went missing.
  const NEW_RENTALS = SEED.filter((r) => !alreadySeeded.has(r.key));
  {
    const rows = NEW_RENTALS.map((r) => {
      const rid = uuid5(r.key);
      const v = placed.get(r.key);
      manifest.rentals.push({ key: r.key, id: rid, rental_number: `R-NW${r.key.slice(1)}`, vehicle: v.reg });
      const approval = r.status === "Pending" ? "pending" : r.status === "Rejected" ? "rejected" : "approved";
      const paymentStatus =
        r.paymentStatus ??
        (r.pay === "full" ? "fulfilled" : r.pay === "refund" || r.pay.startsWith("partial-refund") ? "refunded" : "pending");
      const documentStatus =
        r.status === "Closed" ? "completed"
          : r.status === "Cancelled" || r.status === "Rejected" ? "voided"
          : r.status === "Pending" ? "pending" : "signed";
      const approvedAt = ["Pending", "Rejected", "Cancelled"].includes(r.status) ? null : `${r.created}T12:00:00Z`;
      const holdStatus = r.deposit && r.deposit.outcome !== "ledger" ? r.deposit.outcome : null;
      const extTotal = r.extensions ? round2(r.extensions.reduce((a, e) => a + extAmount(r, e) * (1 + TAX_RATE + SERVICE_FEE_RATE), 0)) : null;
      const loc = v.loc || locations[0]?.id || null;

      return `(${s(rid)}, ${T}, ${s(`R-NW${r.key.slice(1)}`)}, ${s(custId[r.c])}, ${s(v.id)}, ${s(r.start)}, ${s(r.newEnd || r.end)}, ${n(rentalAmount(r))}, ${s(r.type)}, ${s(r.status)}, ${s(approval)}, ${s(paymentStatus)}, ${s(loc)}, ${s(loc)}, '10:00', '10:00', ${s(documentStatus)}, 'not_required', 'portal', 'manual', ${b(!!r.extensions)}, ${s(r.origEnd ?? null)}, ${s(r.prevEnd ?? null)}, ${n(extTotal)}, ${s(r.cancelReason ?? null)}, ${b(!!r.payg)}, ${r.payg ? "true" : "false"}, ${r.payg ? s(`${r.start}T10:00:00Z`) : N}, ${r.payg ? s("2026-09-05T10:00:00Z") : N}, ${r.payg ? "9" : "0"}, ${r.payg ? "false" : "true"}, ${r.payg ? s("2026-09-05T10:05:00Z") : N}, ${s(holdStatus)}, ${holdStatus ? n(depositAmount(r)) : N}, ${holdStatus ? s(`${r.start}T09:30:00Z`) : N}, ${holdStatus ? s(`${TODAY}T09:30:00Z`) : N}, ${s(`${r.created}T11:15:00Z`)}, ${s(`${r.created}T11:15:00Z`)}, ${s(approvedAt)})`;
    });
    for (const r of SEED) {
      if (alreadySeeded.has(r.key)) {
        manifest.rentals.push({ key: r.key, id: uuid5(r.key), rental_number: `R-NW${r.key.slice(1)}`, vehicle: placed.get(r.key).reg });
      }
    }
    stmts.push({
      label: `rentals (${rows.length} new, ${SEED.length - rows.length} already present)`,
      sql: `INSERT INTO public.rentals (
  id, tenant_id, rental_number, customer_id, vehicle_id, start_date, end_date,
  monthly_amount, rental_period_type, status, approval_status, payment_status,
  pickup_location_id, return_location_id, pickup_time, return_time,
  document_status, insurance_status, source, payment_mode,
  is_extended, original_end_date, previous_end_date, extension_amount, cancellation_reason,
  is_pay_as_you_go, payg_paused, payg_start_ts, payg_last_accrual_at,
  payg_accrual_day_count, payg_auto_reminders_enabled, payg_paused_at,
  deposit_hold_status, deposit_hold_amount, deposit_hold_placed_at, deposit_hold_status_changed_at,
  created_at, updated_at, approved_at
) VALUES\n${rows.join(",\n")}\nON CONFLICT DO NOTHING;`,
      skip: rows.length === 0,
    });
  }

  // -- 8. Ledger charges -----------------------------------------------------
  // rental_charges_trigger pre-generates 'Rental' charges only for rentals that
  // span a whole month or more (generate_rental_charges counts whole months), so
  // daily/weekly rentals get theirs written here. Tax and fees always come here.
  const baseTotals = new Map(); // rental key -> what the card payment should cover
  {
    const rows = [];
    const addCharge = (r, category, amount, dueDate, reference, extId, countsTowardCardPayment = true) => {
      if (amount <= 0) return;
      const eid = uuid5(`${r.key}:charge:${category}:${dueDate}`);
      manifest.ledger_entries.push(eid);
      if (countsTowardCardPayment) baseTotals.set(r.key, round2((baseTotals.get(r.key) || 0) + amount));
      rows.push(
        `(${s(eid)}, ${T}, ${s(custId[r.c])}, ${s(uuid5(r.key))}, ${s(placed.get(r.key).id)}, ${s(dueDate)}, ${s(dueDate)}, 'Charge', ${s(category)}, ${n(amount)}, ${n(amount)}, ${s(reference)}, ${s(extId)}, ${s(`${r.created}T11:15:05Z`)})`
      );
    };

    for (const r of SEED) {
      // PAYG never carries a lump-sum charge — it accrues day by day, below.
      if (r.payg) continue;
      // A rejected booking never became a hire, so it has no ledger at all;
      // otherwise the customer shows a balance for a rental that was turned down.
      if (r.status === "Rejected") continue;

      const amount = rentalAmount(r);
      if (r.type !== "Monthly") addCharge(r, "Rental", amount, r.start, null, null);
      else baseTotals.set(r.key, round2((baseTotals.get(r.key) || 0) + amount)); // the trigger writes this one

      addCharge(r, "Tax", round2(amount * TAX_RATE), r.start, null, null);
      addCharge(r, "Service Fee", round2(amount * SERVICE_FEE_RATE), r.start, null, null);

      if (feeLocation && placed.get(r.key).loc === feeLocation.id) {
        addCharge(r, "Delivery Fee", feeLocation.delivery_fee, r.start, "Airport counter surcharge", null);
      }

      // A deposit taken as a real (refundable) charge rather than a Stripe hold.
      // It gets its own targeted payment below, because payment_apply_fifo_v2
      // settles 'Security Deposit' LAST — an untargeted payment would leave the
      // shortfall sitting on the deposit instead of on the unpaid extension.
      if (r.deposit?.outcome === "ledger") {
        addCharge(r, "Security Deposit", depositAmount(r), r.start, "Refundable security deposit", null, false);
      }
      // The deducted-deposit story: an excess-mileage charge the deposit paid.
      if (r.deposit?.deductFraction) {
        addCharge(r, "Excess Mileage", round2(depositAmount(r) * r.deposit.deductFraction), r.end, r.deposit.reason, null, false);
      }
    }
    stmts.push({
      label: `ledger_entries — rental charges (${rows.length})`,
      sql: `INSERT INTO public.ledger_entries (
  id, tenant_id, customer_id, rental_id, vehicle_id, entry_date, due_date,
  type, category, amount, remaining_amount, reference, extension_id, created_at
) VALUES\n${rows.join(",\n")}\nON CONFLICT DO NOTHING;`,
    });
  }

  // -- 9. Extensions and their charges ---------------------------------------
  {
    const extRows = [];
    const extLedger = [];
    for (const r of SEED) {
      if (!r.extensions) continue;
      for (const e of r.extensions) {
        const eid = uuid5(`${r.key}:ext:${e.seq}`);
        manifest.rental_extensions.push(eid);
        const rent = extAmount(r, e);
        const tax = round2(rent * TAX_RATE);
        const fee = round2(rent * SERVICE_FEE_RATE);
        const paid = e.status === "paid" ? round2(rent + tax + fee) : 0;
        const at = `${e.from}T08:30:00Z`;
        // total_amount is a GENERATED column — never write it.
        extRows.push(
          `(${s(eid)}, ${T}, ${s(uuid5(r.key))}, ${n(e.seq)}, ${s(e.status)}, ${s(e.from)}, ${s(e.to)}, ${n(e.days)}, ${n(rent)}, ${n(tax)}, ${n(fee)}, 0, ${n(paid)}, ${s(at)}, ${s(at)}, ${e.status === "paid" ? s(`${e.from}T08:45:00Z`) : N}, ${s(at)}, ${s(at)})`
        );
        // Deliberately NOT in baseTotals: an extension is settled by its own
        // payment (payments.extension_id + target_categories), which is how the
        // real extension checkout works and the only way to leave ONE specific
        // extension outstanding instead of a smear across the whole ledger.
        for (const [cat, amt] of [["Extension Rental", rent], ["Extension Tax", tax], ["Extension Service Fee", fee]]) {
          if (amt <= 0) continue;
          const lid = uuid5(`${r.key}:extcharge:${e.seq}:${cat}`);
          manifest.ledger_entries.push(lid);
          extLedger.push(
            `(${s(lid)}, ${T}, ${s(custId[r.c])}, ${s(uuid5(r.key))}, ${s(placed.get(r.key).id)}, ${s(e.from)}, ${s(e.from)}, 'Charge', ${s(cat)}, ${n(amt)}, ${n(amt)}, ${s(`Extension #${e.seq}: ${e.from} to ${e.to}`)}, ${s(eid)}, ${s(at)})`
          );
        }
      }
    }
    stmts.push({
      label: `rental_extensions (${extRows.length})`,
      sql: `INSERT INTO public.rental_extensions (
  id, tenant_id, rental_id, sequence_number, status, previous_end_date, new_end_date,
  extension_days, rental_amount, tax_amount, service_fee_amount, insurance_amount,
  paid_amount, requested_at, approved_at, paid_at, created_at, updated_at
) VALUES\n${extRows.join(",\n")}\nON CONFLICT DO NOTHING;`,
    });
    stmts.push({
      label: `ledger_entries — extension charges (${extLedger.length})`,
      sql: `INSERT INTO public.ledger_entries (
  id, tenant_id, customer_id, rental_id, vehicle_id, entry_date, due_date,
  type, category, amount, remaining_amount, reference, extension_id, created_at
) VALUES\n${extLedger.join(",\n")}\nON CONFLICT DO NOTHING;`,
    });
  }

  // -- 10. PAYG accruals -----------------------------------------------------
  // Seeded by hand because accrue-payg-charges is deliberately kept away from
  // this rental (payg_paused = true). Nine days accrued, the first eight settled.
  const paygRental = SEED.find((r) => r.payg);
  if (paygRental) {
    const r = paygRental;
    const daily = rentalAmount(r);
    const accRows = [];
    const accLedger = [];
    for (let day = 1; day <= 9; day++) {
      const winStart = `${addDays(r.start, day - 1)}T10:00:00Z`;
      const winEnd = `${addDays(r.start, day)}T10:00:00Z`;
      const tax = round2(daily * TAX_RATE);
      const fee = round2(daily * SERVICE_FEE_RATE);
      const settled = day <= 8;
      const ledgerIds = [];
      for (const [cat, amt, sfx] of [["Rental", daily, "rent"], ["Tax", tax, "tax"], ["Service Fee", fee, "fee"]]) {
        const lid = uuid5(`${r.key}:payg:${day}:${sfx}`);
        ledgerIds.push(lid);
        manifest.ledger_entries.push(lid);
        accLedger.push(
          `(${s(lid)}, ${T}, ${s(custId[r.c])}, ${s(uuid5(r.key))}, ${s(placed.get(r.key).id)}, ${s(winStart.slice(0, 10))}, ${s(winStart.slice(0, 10))}, 'Charge', ${s(cat)}, ${n(amt)}, ${n(settled ? 0 : amt)}, ${s(`payg-${uuid5(r.key)}-d${day}-${sfx}`)}, NULL, ${s(winEnd)})`
        );
      }
      const aid = uuid5(`${r.key}:accrual:${day}`);
      manifest.payg_accruals.push(aid);
      accRows.push(
        `(${s(aid)}, ${T}, ${s(uuid5(r.key))}, ${n(day)}, ${s(winStart)}, ${s(winEnd)}, ${n(daily)}, ${n(tax)}, ${n(fee)}, false, 24, ARRAY[${ledgerIds.map(s).join(",")}]::uuid[], ${s(settled ? "paid" : "open")}, ${settled ? s(winEnd) : N}, ${s(winEnd)})`
      );
    }
    stmts.push({
      label: "ledger_entries — payg accruals",
      sql: `INSERT INTO public.ledger_entries (
  id, tenant_id, customer_id, rental_id, vehicle_id, entry_date, due_date,
  type, category, amount, remaining_amount, reference, extension_id, created_at
) VALUES\n${accLedger.join(",\n")}\nON CONFLICT DO NOTHING;`,
    });
    stmts.push({
      label: "payg_accruals",
      sql: `INSERT INTO public.payg_accruals (
  id, tenant_id, rental_id, accrual_day_index, accrual_window_start, accrual_window_end,
  daily_rate, tax_amount, service_fee_amount, is_partial, hours_covered,
  ledger_entry_ids, invoice_status, paid_at, created_at
) VALUES\n${accRows.join(",\n")}\nON CONFLICT DO NOTHING;`,
    });
  }

  // -- 11. Deposit payments (targeted) ---------------------------------------
  // payment_apply_fifo_v2 honours payments.target_categories, so a deposit taken
  // up front is its own payment scoped to 'Security Deposit'. Without that,
  // FIFO's category order (deposit LAST) would push any shortfall onto the
  // deposit rather than onto the charge that is genuinely unpaid.
  {
    const rows = [];
    for (const r of SEED) {
      if (r.deposit?.outcome !== "ledger") continue;
      const pid = uuid5(`${r.key}:payment:deposit`);
      manifest.payments.push(pid);
      const when = `${r.start}T09:30:00Z`;
      rows.push(
        `(${s(pid)}, ${T}, ${s(custId[r.c])}, ${s(uuid5(r.key))}, ${s(placed.get(r.key).id)}, ${n(depositAmount(r))}, ${s(r.start)}, 'Card', 'Payment', 'Completed', ${n(depositAmount(r))}, 'auto_approved', 'admin', '["Security Deposit"]'::jsonb, ${s(when)}, ${s(when)}, ${s(when)})`
      );
    }
    if (rows.length) {
      stmts.push({
        label: "payments — security deposits",
        sql: `INSERT INTO public.payments (
  id, tenant_id, customer_id, rental_id, vehicle_id, amount, payment_date, method,
  payment_type, status, remaining_amount, verification_status, booking_source,
  target_categories, paid_at, created_at, updated_at
) VALUES\n${rows.join(",\n")}\nON CONFLICT DO NOTHING;`,
      });
    }
  }

  // -- 12. Rental payments ---------------------------------------------------
  // Inserted as 'Completed' so auto_fifo_on_payment_insert runs
  // payment_apply_fifo_v2, which allocates them onto the open charges and
  // rewrites the row to Applied / Partial / Credit — exactly what a real payment
  // does, so the ledger and the payment list agree with each other.
  const refundFollowUps = [];
  {
    const rows = [];
    const addPayment = (r, amount, method, dateIso, tag = "main") => {
      const pid = uuid5(`${r.key}:payment:${tag}`);
      manifest.payments.push(pid);
      rows.push(
        `(${s(pid)}, ${T}, ${s(custId[r.c])}, ${s(uuid5(r.key))}, ${s(placed.get(r.key).id)}, ${n(amount)}, ${s(dateIso.slice(0, 10))}, ${s(method)}, 'Payment', 'Completed', ${n(amount)}, 'auto_approved', 'admin', ${s(dateIso)}, ${s(dateIso)}, ${s(dateIso)})`
      );
      return pid;
    };

    for (const r of SEED) {
      if (r.payg) continue; // settles per accrual, below
      const total = baseTotals.get(r.key) || 0;
      const payDate = `${r.created}T15:40:00Z`;
      if (total <= 0) continue;

      if (r.pay === "full") {
        addPayment(r, total, "Card", payDate);
      } else if (r.pay.startsWith("part:")) {
        addPayment(r, round2(total * Number(r.pay.split(":")[1])), "Bank Transfer", payDate);
      } else if (r.pay === "refund") {
        refundFollowUps.push({ rental: r, paymentId: addPayment(r, total, "Card", payDate), amount: total, full: true,
          reason: "Cancelled inside the free window" });
      } else if (r.pay.startsWith("partial-refund:")) {
        const amt = round2(total * Number(r.pay.split(":")[1]));
        refundFollowUps.push({ rental: r, paymentId: addPayment(r, total, "Card", payDate), amount: amt, full: false,
          reason: "Late cancellation - one day's hire retained" });
      }
    }
    stmts.push({
      label: `payments (${rows.length})`,
      sql: `INSERT INTO public.payments (
  id, tenant_id, customer_id, rental_id, vehicle_id, amount, payment_date, method,
  payment_type, status, remaining_amount, verification_status, booking_source,
  paid_at, created_at, updated_at
) VALUES\n${rows.join(",\n")}\nON CONFLICT DO NOTHING;`,
    });
  }

  // -- 13. Extension payments ------------------------------------------------
  // A paid extension is settled by its own payment carrying extension_id plus
  // target_categories, so FIFO is confined to that extension's three charges.
  // That is what leaves R-NW17's third extension — approved but not paid — as
  // the only outstanding balance on an otherwise settled rental.
  {
    const rows = [];
    for (const r of SEED) {
      for (const e of r.extensions || []) {
        if (e.status !== "paid") continue;
        const total = round2(extAmount(r, e) * (1 + TAX_RATE + SERVICE_FEE_RATE));
        const pid = uuid5(`${r.key}:payment:ext${e.seq}`);
        manifest.payments.push(pid);
        const when = `${e.from}T08:45:00Z`;
        rows.push(
          `(${s(pid)}, ${T}, ${s(custId[r.c])}, ${s(uuid5(r.key))}, ${s(placed.get(r.key).id)}, ${s(uuid5(`${r.key}:ext:${e.seq}`))}, ${n(total)}, ${s(e.from)}, 'Card', 'Payment', 'Completed', ${n(total)}, 'auto_approved', 'website', '["Extension Rental","Extension Tax","Extension Service Fee"]'::jsonb, ${s(when)}, ${s(when)}, ${s(when)})`
        );
      }
    }
    if (rows.length) {
      stmts.push({
        label: `payments — extensions (${rows.length})`,
        sql: `INSERT INTO public.payments (
  id, tenant_id, customer_id, rental_id, vehicle_id, extension_id, amount, payment_date, method,
  payment_type, status, remaining_amount, verification_status, booking_source,
  target_categories, paid_at, created_at, updated_at
) VALUES\n${rows.join(",\n")}\nON CONFLICT DO NOTHING;`,
      });
    }
  }

  // -- 14. PAYG settlements --------------------------------------------------
  // PAYG money does not flow through FIFO: payg_settle_invoice allocates a
  // payment straight onto one accrual's ledger rows. Inserted already 'Applied'
  // (the FIFO trigger only fires on 'Completed') with allocations written by hand.
  if (paygRental) {
    const r = paygRental;
    const daily = rentalAmount(r);
    const dailyTotal = round2(daily * (1 + TAX_RATE + SERVICE_FEE_RATE));
    const payRows = [];
    const appRows = [];
    const accUpdates = [];
    for (const [tag, days, when] of [
      ["payg-1", [1, 2, 3, 4], "2026-09-01T10:05:00Z"],
      ["payg-2", [5, 6, 7, 8], "2026-09-05T10:05:00Z"],
    ]) {
      const pid = uuid5(`${r.key}:payment:${tag}`);
      manifest.payments.push(pid);
      payRows.push(
        `(${s(pid)}, ${T}, ${s(custId[r.c])}, ${s(uuid5(r.key))}, ${s(placed.get(r.key).id)}, ${n(round2(dailyTotal * days.length))}, ${s(when.slice(0, 10))}, 'Card', 'Payment', 'Applied', 0, 'auto_approved', 'website', ${s(when)}, ${s(when)}, ${s(when)})`
      );
      for (const day of days) {
        for (const [amt, sfx] of [[daily, "rent"], [round2(daily * TAX_RATE), "tax"], [round2(daily * SERVICE_FEE_RATE), "fee"]]) {
          const aid = uuid5(`${r.key}:app:${tag}:${day}:${sfx}`);
          manifest.payment_applications.push(aid);
          appRows.push(`(${s(aid)}, ${s(pid)}, ${s(uuid5(`${r.key}:payg:${day}:${sfx}`))}, ${n(amt)}, ${T})`);
        }
        accUpdates.push(
          `UPDATE public.payg_accruals SET settling_payment_id = ${s(pid)} WHERE id = ${s(uuid5(`${r.key}:accrual:${day}`))} AND tenant_id = ${T} AND settling_payment_id IS NULL;`
        );
      }
    }
    stmts.push({
      label: "payments — payg settlements",
      sql: `INSERT INTO public.payments (
  id, tenant_id, customer_id, rental_id, vehicle_id, amount, payment_date, method,
  payment_type, status, remaining_amount, verification_status, booking_source,
  paid_at, created_at, updated_at
) VALUES\n${payRows.join(",\n")}\nON CONFLICT DO NOTHING;`,
    });
    stmts.push({
      label: "payment_applications — payg",
      sql: `INSERT INTO public.payment_applications (id, payment_id, charge_entry_id, amount_applied, tenant_id) VALUES\n${appRows.join(",\n")}\nON CONFLICT DO NOTHING;\n${accUpdates.join("\n")}`,
    });
  }

  // -- 15. The deposit deduction ---------------------------------------------
  // Mirrors supabase/functions/deduct-from-deposit: a Security Deposit ledger
  // PAYMENT row that drains the excess-mileage charge it paid for.
  {
    const r = SEED.find((x) => x.deposit?.deductFraction);
    if (r) {
      const amt = round2(depositAmount(r) * r.deposit.deductFraction);
      const lid = uuid5(`${r.key}:depositdeduction`);
      manifest.ledger_entries.push(lid);
      const chargeId = uuid5(`${r.key}:charge:Excess Mileage:${r.end}`);
      stmts.push({
        label: "deposit deduction (ledger)",
        sql: `INSERT INTO public.ledger_entries (
  id, tenant_id, customer_id, rental_id, vehicle_id, entry_date, due_date,
  type, category, amount, remaining_amount, reference, created_at
) VALUES (
  ${s(lid)}, ${T}, ${s(custId[r.c])}, ${s(uuid5(r.key))}, ${s(placed.get(r.key).id)}, ${s(r.end)}, ${s(r.end)},
  'Payment', 'Security Deposit', ${n(amt)}, 0,
  ${s(`Deducted from security deposit: ${r.deposit.reason}`)}, ${s(`${r.end}T17:00:00Z`)}
) ON CONFLICT DO NOTHING;
UPDATE public.ledger_entries SET remaining_amount = 0
 WHERE id = ${s(chargeId)} AND tenant_id = ${T};`,
      });
    }
  }

  // -- 16. Refund follow-ups -------------------------------------------------
  // Second step of a refund: the payment has already been allocated by FIFO, and
  // is now flipped to Refunded / Partial Refund the way process-refund does it,
  // with a negative Refund ledger row alongside.
  if (refundFollowUps.length) {
    const parts = [];
    for (const f of refundFollowUps) {
      const r = f.rental;
      const status = f.full ? "Refunded" : "Partial Refund";
      const when = `${addDays(r.created, 3)}T09:20:00Z`;
      parts.push(
        `UPDATE public.payments SET status = ${s(status)}, refund_amount = ${n(f.amount)}, refund_status = 'completed', refund_reason = ${s(`Rental: ${f.reason}`)}, refund_processed_at = ${s(when)}, updated_at = ${s(when)} WHERE id = ${s(f.paymentId)} AND tenant_id = ${T};`
      );
      const lid = uuid5(`${r.key}:refundledger`);
      manifest.ledger_entries.push(lid);
      parts.push(
        `INSERT INTO public.ledger_entries (id, tenant_id, customer_id, rental_id, vehicle_id, entry_date, due_date, type, category, amount, remaining_amount, reference, created_at) VALUES (${s(lid)}, ${T}, ${s(custId[r.c])}, ${s(uuid5(r.key))}, ${s(placed.get(r.key).id)}, ${s(when.slice(0, 10))}, ${s(when.slice(0, 10))}, 'Refund', 'Rental', ${n(-f.amount)}, 0, ${s(`Refund: ${f.reason}`)}, ${s(when)}) ON CONFLICT DO NOTHING;`
      );
    }
    stmts.push({ label: "refunds", sql: parts.join("\n") });
  }

  // -- 17. Rental reviews ----------------------------------------------------
  {
    const rows = SEED.filter((r) => r.review).map((r) => {
      const rid = uuid5(`${r.key}:review`);
      manifest.rental_reviews.push(rid);
      const comment =
        r.review >= 9 ? "Returned early, spotless, full tank. Would rent to again without a second thought."
        : r.review >= 7 ? "Straightforward hire. Car came back clean and on time."
        : "Returned two hours late and needed a valet. Nothing broken, but chase the return time next time.";
      const tags = r.review >= 9 ? '["punctual","clean","easy to deal with"]' : r.review >= 7 ? '["punctual"]' : '["late return","needed cleaning"]';
      return `(${s(rid)}, ${T}, ${s(uuid5(r.key))}, ${s(custId[r.c])}, (SELECT id FROM public.app_users WHERE tenant_id = ${T} ORDER BY created_at LIMIT 1), ${n(r.review)}, ${s(comment)}, ${s(tags)}::jsonb, false, ${s(`${r.end}T18:00:00Z`)}, ${s(`${r.end}T18:00:00Z`)})`;
    });
    if (rows.length) {
      stmts.push({
        label: `rental_reviews (${rows.length})`,
        sql: `INSERT INTO public.rental_reviews (
  id, tenant_id, rental_id, customer_id, reviewer_id, rating, comment, tags, is_skipped, created_at, updated_at
) VALUES\n${rows.join(",\n")}\nON CONFLICT DO NOTHING;`,
      });
    }
  }

  // -- 18. Run ---------------------------------------------------------------
  for (const st of stmts) {
    if (st.skip) { console.log(`  --  ${st.label} (nothing to do)`); continue; }
    await runSql(st.label, st.sql);
  }

  if (DRY_RUN) return;

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest written to ${MANIFEST_PATH}`);

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
  console.log(`\nTenant totals for ${TENANT_SLUG} (${envLabel}) — seeded plus whatever was already there:`);
  console.table(counts);

  const flagship = manifest.rentals.find((r) => r.key === "r17");
  if (flagship) {
    const out = await runSql(
      "read: flagship outstanding",
      `SELECT round(sum(remaining_amount), 2) AS outstanding FROM public.ledger_entries
        WHERE tenant_id = ${T} AND rental_id = '${flagship.id}' AND type = 'Charge';`
    );
    console.log(`\nFlagship rental — extended x3, part paid, deposit held:`);
    console.log(`  ${flagship.rental_number}   id ${flagship.id}`);
    console.log(`  vehicle ${flagship.vehicle}, outstanding ${out[0]?.outstanding ?? "?"}`);
    console.log(`  /rentals/${flagship.id}`);
  }
}

main();
