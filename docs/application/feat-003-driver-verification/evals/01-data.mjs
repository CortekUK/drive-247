// Spec 01 · The data. Proves the migration's tables, types, policies and grants on staging.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { statement, cleanup, run, sql, rest, signIn, LOGINS, equal, ok } from "../../eval-kit.mjs";

const NORTHWIND = "6e5c544f-b374-451f-a662-360a634bff15";
const [{ id: OTHER }] = await sql(`select id from tenants where slug <> 'northwind' order by created_at limit 1`);
const MIGRATION = fileURLToPath(new URL("../../../../supabase/migrations/20261129100000_driver_verification_v2.sql", import.meta.url));
const STAFF = await signIn(LOGINS.portal); // northwind head admin
const SUPER = await signIn(LOGINS.admin);  // super admin
const TAG = `eval01-${Date.now().toString(36)}`;
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const token = () => `${TAG}-${crypto.randomUUID()}-${crypto.randomUUID()}`.slice(0, 64);

async function customer(tenant, name) {
  const [c] = await sql(`insert into customers (tenant_id, name, type, email) values (${q(tenant)}, ${q(name)}, 'Individual', ${q(`${TAG}-${crypto.randomUUID().slice(0, 6)}@drive-247.test`)}) returning id`);
  cleanup(() => sql(`delete from customers where id = ${q(c.id)}`));
  return c.id;
}
async function session(tenant, customerId, status = "link_sent") {
  const [s] = await sql(`insert into verification_sessions (tenant_id, customer_id, status, token, expires_at, sent_via)
    values (${q(tenant)}, ${q(customerId)}, ${q(status)}, ${q(token())}, now() + interval '24 hours', 'copy') returning id`);
  cleanup(() => sql(`delete from verification_sessions where id = ${q(s.id)}`));
  return s.id;
}
async function refused(query) {
  try { await sql(query); return false; } catch { return true; }
}

const NEW_TABLES = ["verification_services", "verification_state_fees", "verification_sessions", "verification_session_checks",
  "verification_session_events", "verification_charges", "verification_tenant_prefs"];

statement("01.1", "One migration file creates everything, and it is applied to staging", async () => {
  ok(existsSync(MIGRATION), "the migration file is in the repo");
  const rows = await sql(`select table_name from information_schema.tables where table_schema = 'public' and table_name in (${NEW_TABLES.map(q).join(",")})`);
  equal(rows.length, NEW_TABLES.length, "new tables on staging");
});

statement("01.2", "verification_status_v2 holds exactly the seven statuses", async () => {
  const rows = await sql(`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'verification_status_v2' order by e.enumsortorder`);
  equal(rows.map((r) => r.enumlabel).join(","), "not_verified,link_sent,in_progress,verified,needs_review,failed,expired", "labels");
});

statement("01.3", "verification_services has one row per service", async () => {
  const rows = await sql(`select key from verification_services order by sort_order`);
  equal(rows.map((r) => r.key).join(","), "standard,licence_status,driving_record,criminal_record,licence_watch,rideshare_proof", "keys");
});

statement("01.4", "Each service has the right kind, availability and provider", async () => {
  const rows = await sql(`select key, kind, availability, coalesce(provider,'-') as provider from verification_services order by sort_order`);
  equal(rows.map((r) => `${r.key}:${r.kind}:${r.availability}:${r.provider}`).join(" "),
    "standard:free:live:didit licence_status:premium:live:rentid driving_record:premium:switched_off:rentid criminal_record:premium:switched_off:rentid licence_watch:premium:coming_soon:- rideshare_proof:premium:coming_soon:-",
    "rows");
});

statement("01.5", "Every price column is whole cents, not null, and 0 or more", async () => {
  const cols = await sql(`select table_name, column_name, data_type, is_nullable from information_schema.columns
    where table_schema = 'public' and column_name like '%\\_cents' escape '\\' and table_name like 'verification\\_%' escape '\\'`);
  ok(cols.length >= 9, "price columns found");
  for (const c of cols) {
    equal(c.data_type, "integer", `${c.table_name}.${c.column_name} type`);
    if (!(c.table_name === "verification_session_checks" && c.column_name === "state_fee_cents")) {
      equal(c.is_nullable, "NO", `${c.table_name}.${c.column_name} not null`);
    }
  }
  ok(await refused(`update verification_services set margin_cents = -1 where key = 'standard'`), "a negative margin is refused");
});

statement("01.6", "Staff read the price list and state fees; only a super admin changes them", async () => {
  const read = await rest("verification_services?select=key", { as: STAFF });
  equal(read.data.length, 6, "staff read the price list");
  const fees = await rest("verification_state_fees?select=state", { as: STAFF });
  equal(fees.status, 200, "staff read the state fees");
  const staffEdit = await rest("verification_services?key=eq.licence_watch", { method: "PATCH", body: { description: "x" }, as: STAFF });
  ok(Array.isArray(staffEdit.data) ? staffEdit.data.length === 0 : staffEdit.status >= 400, "staff cannot change the price list");
  const [before] = await sql(`select description from verification_services where key = 'licence_watch'`);
  equal(before.description, "Tells you if the licence is suspended mid-rental.", "unchanged after the staff attempt");
  const superEdit = await rest("verification_services?key=eq.licence_watch", { method: "PATCH", body: { description: `${TAG}` }, as: SUPER });
  cleanup(() => sql(`update verification_services set description = 'Tells you if the licence is suspended mid-rental.' where key = 'licence_watch'`));
  equal(superEdit.data?.length, 1, "a super admin can change it");
});

statement("01.7", "Staff of one company cannot read another company's sessions", async () => {
  const theirs = await session(OTHER, await customer(OTHER, `${TAG} other`));
  const res = await rest(`verification_sessions?id=eq.${theirs}&select=id`, { as: STAFF });
  equal(res.data.length, 0, "northwind staff see the other company's session");
});

statement("01.8", "Staff read their own company's rows but cannot write them", async () => {
  const mine = await session(NORTHWIND, await customer(NORTHWIND, `${TAG} mine`));
  const read = await rest(`verification_sessions?id=eq.${mine}&select=id`, { as: STAFF });
  equal(read.data.length, 1, "own session readable");
  const patch = await rest(`verification_sessions?id=eq.${mine}`, { method: "PATCH", body: { status: "verified" }, as: STAFF });
  ok(patch.status >= 400 || (Array.isArray(patch.data) && patch.data.length === 0), "staff cannot update a session");
  const [s] = await sql(`select status from verification_sessions where id = ${q(mine)}`);
  equal(s.status, "link_sent", "status unchanged");
  for (const table of ["verification_session_checks", "verification_session_events", "verification_charges", "verification_tenant_prefs"]) {
    const post = await rest(table, { method: "POST", body: { tenant_id: NORTHWIND }, as: STAFF });
    ok(post.status >= 400, `staff cannot insert into ${table}`);
  }
});

statement("01.9", "The anonymous key reads nothing from any new table", async () => {
  await session(NORTHWIND, await customer(NORTHWIND, `${TAG} anon`));
  for (const table of NEW_TABLES) {
    const res = await rest(`${table}?select=*&limit=1`, { as: "anon" });
    ok(res.status >= 400 || (Array.isArray(res.data) && res.data.length === 0), `anon reads ${table}`);
  }
});

statement("01.10", "One check row per session and service", async () => {
  const s = await session(NORTHWIND, await customer(NORTHWIND, `${TAG} checks`));
  const insert = `insert into verification_session_checks (session_id, tenant_id, service_key, provider_cost_cents, margin_cents) values (${q(s)}, ${q(NORTHWIND)}, 'standard', 33, 0)`;
  await sql(insert);
  ok(await refused(insert), "a second standard row for the same session is refused");
});

statement("01.11", "One charge row per session and service", async () => {
  const s = await session(NORTHWIND, await customer(NORTHWIND, `${TAG} charge`));
  const insert = `insert into verification_charges (tenant_id, session_id, customer_name, service_key, provider_cost_cents, state_fee_cents, margin_cents) values (${q(NORTHWIND)}, ${q(s)}, 'x', 'licence_status', 299, 0, 50)`;
  await sql(insert);
  cleanup(() => sql(`delete from verification_charges where session_id = ${q(s)}`));
  ok(await refused(insert), "a second charge for the same check is refused");
  const [c] = await sql(`select total_cents from verification_charges where session_id = ${q(s)}`);
  equal(c.total_cents, 349, "total is the sum of the parts");
});

statement("01.12", "Session tokens are unique and at least 43 characters", async () => {
  const c = await customer(NORTHWIND, `${TAG} token`);
  ok(await refused(`insert into verification_sessions (tenant_id, customer_id, token, expires_at, sent_via, status) values (${q(NORTHWIND)}, ${q(c)}, 'short', now(), 'copy', 'failed')`), "a short token is refused");
  const t = token();
  const [a] = await sql(`insert into verification_sessions (tenant_id, customer_id, token, expires_at, sent_via, status) values (${q(NORTHWIND)}, ${q(c)}, ${q(t)}, now(), 'copy', 'failed') returning id`);
  cleanup(() => sql(`delete from verification_sessions where id = ${q(a.id)}`));
  ok(await refused(`insert into verification_sessions (tenant_id, customer_id, token, expires_at, sent_via, status) values (${q(NORTHWIND)}, ${q(c)}, ${q(t)}, now(), 'copy', 'failed')`), "a duplicate token is refused");
});

statement("01.13", "At most one open session per customer", async () => {
  const c = await customer(NORTHWIND, `${TAG} open`);
  await session(NORTHWIND, c, "link_sent");
  ok(await refused(`insert into verification_sessions (tenant_id, customer_id, token, expires_at, sent_via, status) values (${q(NORTHWIND)}, ${q(c)}, ${q(token())}, now(), 'copy', 'in_progress')`), "a second open session is refused");
  await session(NORTHWIND, c, "failed"); // a closed one is fine
});

statement("01.14", "customers has the new columns", async () => {
  const want = ["verification_status", "verification_session_id", "verification_warning", "licence_expiry_date", "licence_document_type",
    "licence_document_subtype", "licence_issuing_country", "identity_details_source"];
  const rows = await sql(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name in (${want.map(q).join(",")})`);
  equal(rows.length, want.length, "columns");
  const [d] = await sql(`select column_default from information_schema.columns where table_name = 'customers' and column_name = 'verification_status'`);
  ok(String(d.column_default).includes("not_verified"), "defaults to not_verified");
});

statement("01.15", "Existing customers are Not verified and otherwise unchanged", async () => {
  const [r] = await sql(`select count(*)::int as n from customers where verification_session_id is null and verification_status <> 'not_verified'`);
  equal(r.n, 0, "customers with a status but no session");
});

statement("01.16", "Deleting a customer removes their sessions, checks and events but keeps charges", async () => {
  const [c] = await sql(`insert into customers (tenant_id, name, type) values (${q(NORTHWIND)}, ${q(`${TAG} delete`)}, 'Individual') returning id`);
  const [s] = await sql(`insert into verification_sessions (tenant_id, customer_id, token, expires_at, sent_via, status) values (${q(NORTHWIND)}, ${q(c.id)}, ${q(token())}, now(), 'copy', 'verified') returning id`);
  await sql(`insert into verification_session_checks (session_id, tenant_id, service_key, provider_cost_cents, margin_cents) values (${q(s.id)}, ${q(NORTHWIND)}, 'standard', 33, 0)`);
  await sql(`insert into verification_session_events (session_id, tenant_id, kind) values (${q(s.id)}, ${q(NORTHWIND)}, 'session_created')`);
  const [ch] = await sql(`insert into verification_charges (tenant_id, session_id, customer_id, customer_name, service_key, provider_cost_cents, state_fee_cents, margin_cents) values (${q(NORTHWIND)}, ${q(s.id)}, ${q(c.id)}, 'Delete Me', 'licence_status', 299, 0, 50) returning id`);
  cleanup(() => sql(`delete from verification_charges where id = ${q(ch.id)}`));
  await sql(`delete from customers where id = ${q(c.id)}`);
  const [left] = await sql(`select (select count(*) from verification_sessions where id = ${q(s.id)})::int as s,
    (select count(*) from verification_session_checks where session_id = ${q(s.id)})::int as k,
    (select count(*) from verification_session_events where session_id = ${q(s.id)})::int as e`);
  equal(`${left.s}/${left.k}/${left.e}`, "0/0/0", "sessions/checks/events left");
  const [kept] = await sql(`select customer_id, session_id, customer_name from verification_charges where id = ${q(ch.id)}`);
  equal(kept.customer_id, null, "charge customer_id");
  equal(kept.customer_name, "Delete Me", "charge keeps the name");
});

statement("01.17", "Company prefs are read by that company's staff and written only by the service role", async () => {
  const [had] = await sql(`select count(*)::int as n from verification_tenant_prefs where tenant_id = ${q(NORTHWIND)}`);
  if (!had.n) {
    await sql(`insert into verification_tenant_prefs (tenant_id) values (${q(NORTHWIND)})`);
    cleanup(() => sql(`delete from verification_tenant_prefs where tenant_id = ${q(NORTHWIND)}`));
  }
  const read = await rest(`verification_tenant_prefs?tenant_id=eq.${NORTHWIND}&select=last_ticks`, { as: STAFF });
  equal(read.data.length, 1, "staff read their prefs");
  const write = await rest(`verification_tenant_prefs?tenant_id=eq.${NORTHWIND}`, { method: "PATCH", body: { last_ticks: ["standard", "licence_status"] }, as: STAFF });
  ok(write.status >= 400 || (Array.isArray(write.data) && write.data.length === 0), "staff cannot write prefs");
});

statement("01.18", "No column stores a provider key or secret", async () => {
  const rows = await sql(`select table_name, column_name from information_schema.columns where table_schema = 'public'
    and (table_name like 'verification\\_%' escape '\\') and column_name ~ '(api_key|secret|password|webhook)'`);
  equal(rows.length, 0, "key-like columns");
});

await run(import.meta.url);
