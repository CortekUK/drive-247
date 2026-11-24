#!/usr/bin/env node
/**
 * reseed.mjs — put the demo tenant and the logins back on staging.
 *
 * rebuild.mjs empties staging's tables, so after it staging has no tenant and
 * nobody can log in. This puts back, in one command:
 *
 *   1. The `northwind` tenant: prod northwind's settings row, with every live
 *      Stripe id and contact email cleaned and all notifications off.
 *   2. Its logo files, copied into staging's own storage, so no address on
 *      staging points at production.
 *   3. The two logins from .staging-credentials.local: the northwind head admin
 *      (STAGING_LOGIN_*) and the platform super admin (STAGING_ADMIN_*).
 *   4. The demo data (scripts/seed-northwind.mjs), dated so it is live today.
 *
 *   SUPABASE_ACCESS_TOKEN=… node docs/environments/database/reseed.mjs
 *
 * Safe to run again: everything is created only if it is missing. Production
 * is only read (one settings row and four public logo files). No customer row
 * is copied.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, PROD_REF, TARGET, sql, requireSetup, die } from "./lib.mjs";

requireSetup();
const SLUG = "northwind";
// The day scripts/seed-northwind.mjs was written around.
const STORY_DAY = "2026-09-06";

const creds = Object.fromEntries([...readFileSync(join(ROOT, ".staging-credentials.local"), "utf8").matchAll(/^([A-Z_]+)=(.+)$/gm)].map((m) => [m[1], m[2].trim()]));
if (creds.STAGING_REF !== TARGET) die("STAGING_REF in .staging-credentials.local is not the target. Refusing.");
for (const k of ["STAGING_SERVICE_ROLE_KEY", "STAGING_ANON_KEY", "STAGING_LOGIN_EMAIL", "STAGING_LOGIN_PASSWORD", "STAGING_ADMIN_EMAIL", "STAGING_ADMIN_PASSWORD"]) {
  if (!creds[k]) die(`.staging-credentials.local is missing ${k}.`);
}
const base = `https://${TARGET}.supabase.co`;
const service = { apikey: creds.STAGING_SERVICE_ROLE_KEY, Authorization: `Bearer ${creds.STAGING_SERVICE_ROLE_KEY}` };
const write = (q) => sql(TARGET, q, { write: true });
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const step = (n, text) => console.log(`\n[${n}] ${text}`);

// ── 1. the tenant ───────────────────────────────────────────────────────────

step(1, `Tenant '${SLUG}'`);
let tenant = (await sql(TARGET, `select id from public.tenants where slug = ${lit(SLUG)}`))[0];
if (tenant) {
  console.log("    already there");
} else {
  const row = (await sql(PROD_REF, `select to_jsonb(t) j from public.tenants t where slug = ${lit(SLUG)}`))[0]?.j;
  if (!row) die(`Prod has no '${SLUG}' tenant to copy settings from.`);
  const cleaned = {
    // Staging mail goes to the staging login, never to a real inbox.
    admin_email: creds.STAGING_LOGIN_EMAIL, contact_email: creds.STAGING_LOGIN_EMAIL, notification_recipient_email: creds.STAGING_LOGIN_EMAIL,
    email_notifications_enabled: false, push_notifications_enabled: false, return_reminder_enabled: false,
    // UAE account, test mode only.
    tenant_type: "test", stripe_mode: "test", payment_model: "own", subscription_account: "uae", subscription_stripe_mode: "test",
    // Nothing that names a live Stripe object, or a row that does not exist here.
    own_stripe_account_id: null, own_stripe_connected_at: null, stripe_account_id: null, stripe_account_status: null,
    stripe_onboarding_complete: false, stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_requirements_due: null,
    stripe_status_synced_at: null, stripe_account_disabled_reason: null, stripe_subscription_customer_id: null,
    boldsign_live_brand_id: null, bonzah_partner_id_set_by: null,
  };
  for (const k of Object.keys(cleaned)) if (!(k in row)) die(`tenants has no column ${k}: the cleaning list is out of date. Stopping.`);
  Object.assign(row, cleaned);
  tenant = (await write(`insert into public.tenants select * from jsonb_populate_record(null::public.tenants, $tenant$${JSON.stringify(row)}$tenant$::jsonb) returning id`))[0];
  console.log(`    created (${tenant.id})`);
}

// ── 2. files the tenant row points at ───────────────────────────────────────

step(2, "Logo files");
const pointers = await sql(TARGET, `select key, value from public.tenants t, jsonb_each_text(to_jsonb(t)) where slug = ${lit(SLUG)} and value like '%${PROD_REF}%'`);
for (const { key, value } of pointers) {
  const m = value.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (!m) die(`${key} points at production and is not a public storage file: ${value}`);
  const src = await fetch(value);
  if (!src.ok) die(`Could not read ${key} from production (HTTP ${src.status}).`);
  const bytes = Buffer.from(await src.arrayBuffer());
  const up = await fetch(`${base}/storage/v1/object/${m[1]}/${m[2]}`, { method: "POST", headers: { ...service, "Content-Type": src.headers.get("content-type") || "application/octet-stream", "x-upsert": "true" }, body: bytes });
  if (!up.ok) die(`Could not store ${key} on staging (HTTP ${up.status}).`);
  await write(`update public.tenants set ${key} = ${lit(value.replace(PROD_REF, TARGET))} where slug = ${lit(SLUG)}`);
}
const left = (await sql(TARGET, `select count(*)::int n from public.tenants t where to_jsonb(t)::text like '%${PROD_REF}%'`))[0].n;
if (left) die("The tenant row still points at production. Stopping.");
console.log(`    ${pointers.length} copied, 0 addresses point at production`);

// ── 3. logins ───────────────────────────────────────────────────────────────

step(3, "Logins");
async function login({ email, password, tenantId, superAdmin }) {
  let id = (await sql(TARGET, `select id from auth.users where email = ${lit(email)}`))[0]?.id;
  if (!id) {
    const r = await fetch(`${base}/auth/v1/admin/users`, { method: "POST", headers: { ...service, "Content-Type": "application/json" }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: "Ghulam" } }) });
    const u = await r.json();
    if (!u.id) die(`Could not create ${email}: ${u.msg || r.status}`);
    id = u.id;
  }
  await write(`insert into public.app_users (auth_user_id, email, name, role, is_active, must_change_password, tenant_id, is_super_admin, is_primary_super_admin)
    select ${lit(id)}, ${lit(email)}, 'Ghulam', 'head_admin', true, false, ${tenantId ? lit(tenantId) : "null"}, ${superAdmin}, ${superAdmin}
    where not exists (select 1 from public.app_users where email = ${lit(email)})`);
  // Prove it the way the apps do it.
  const t = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: creds.STAGING_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!t.ok) die(`${email} exists but its password in .staging-credentials.local does not log in (HTTP ${t.status}).`);
  console.log(`    ${email}: ${superAdmin ? "super admin" : `head admin of ${SLUG}`}, login works`);
}
await login({ email: creds.STAGING_LOGIN_EMAIL, password: creds.STAGING_LOGIN_PASSWORD, tenantId: tenant.id, superAdmin: false });
await login({ email: creds.STAGING_ADMIN_EMAIL, password: creds.STAGING_ADMIN_PASSWORD, tenantId: null, superAdmin: true });

// ── 4. demo data ────────────────────────────────────────────────────────────

const shift = Math.max(0, Math.round((Date.now() - new Date(`${STORY_DAY}T00:00:00Z`).getTime()) / 86400000));
step(4, `Demo data (story moved forward ${shift} days)`);
const rentals = (await sql(TARGET, `select count(*)::int n from public.rentals where tenant_id = ${lit(tenant.id)}`))[0].n;
if (rentals) {
  // The seed is date-shifted, so a second run on another day would add a second copy.
  console.log(`    ${rentals} rentals already there, left as they are`);
} else {
  try {
    const out = execFileSync("node", [join(ROOT, "scripts", "seed-northwind.mjs"), "--ref", TARGET, "--shift-days", String(shift)], { encoding: "utf8", env: process.env });
    console.log(out.split("\n").filter((l) => /found:|new,|Flagship|outstanding|vehicles │|^│ 0/.test(l)).map((l) => `    ${l.trim()}`).join("\n"));
  } catch (e) {
    die(`The demo data seed failed:\n${String(e.stdout || "").slice(-600)}\n${String(e.stderr || e.message).slice(-600)}`);
  }
}

const totals = (await sql(TARGET, `select (select count(*) from public.vehicles)::int vehicles, (select count(*) from public.customers)::int customers, (select count(*) from public.rentals)::int rentals, (select count(*) from public.payments)::int payments, (select count(*) from cron.job where active)::int crons_on`))[0];
console.log(`\nStaging now holds ${totals.vehicles} vehicles, ${totals.customers} customers, ${totals.rentals} rentals, ${totals.payments} payments. Crons switched on: ${totals.crons_on}.`);
console.log(`Portal: https://${SLUG}.portal.staging.drive-247.com   Admin: https://admin.staging.drive-247.com`);
