/**
 * Tenant isolation, proven on the ACTUAL database paths — as each role.
 *
 * An isolated Postgres is built to match the DEPLOYED shape (read from the live
 * catalogue on 2026-09-18: grants, policy names, policy predicates, which tables
 * have RLS on, and which views run with owner rights), seeded with two tenants,
 * and then the remediation SQL in docs/trax/remediation/ is applied to it.
 *
 * Every assertion runs as a real role with a real `auth.uid()`, so the database
 * decides what comes back — not an application filter and not TRAX. The
 * fixture's job is to be wrong in exactly the ways production is wrong, so that
 * the "before" tests fail the same way production would.
 *
 * Acceptance cases:
 *   Tenant A asks for its vehicle count       → 2
 *   Tenant B asks for its vehicle count       → 6
 *   Tenant A's sales figures                  → only tenant A's entries
 *   Tenant A supplies tenant B's record id    → nothing, and no detail
 *   Restricted staff member asks for money    → finance permission decides
 *   Anonymous visitor uses the booking site   → public browsing works,
 *                                               private records do not
 *   Customer signs in to the portal           → their own records only
 *   Platform super admin                      → cross-tenant, by the stored flag,
 *                                               never by a display name
 *
 * The finance-permission case and TRAX's own query layer are proven in
 * tests/trax/business-storage.mjs; this file is the database beneath them, plus
 * the views and aggregates that row-level security does not reach on its own.
 *
 * No live database is touched. Nothing here is applied to production.
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { PGlite } = await import(pathToFileURL(process.env.TRAX_PGLITE_PATH ?? resolve(tmpdir(), 'drive247-trax-sql-tests/node_modules/@electric-sql/pglite/dist/index.js')));
const db = new PGlite();
const script = (name) => readFile(resolve(root, 'docs/trax/remediation', name), 'utf8');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TENANT_A = id(1), TENANT_B = id(2);
const STAFF_A = id(11), STAFF_B = id(12), OWNER_A = id(13), PLATFORM = id(14);
const CUSTOMER_A = id(21), CUSTOMER_B = id(22), CUSTOMER_A_USER = id(31);

/* ── The deployed shape ─────────────────────────────────────────────────────
   Helper definitions are the live ones: they read app_users by auth.uid(), so a
   tenant is never taken from a claim, a URL or a display name. */
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid $$;

create table public.tenants(id uuid primary key, name text);
create table public.app_users(id uuid primary key, auth_user_id uuid, tenant_id uuid, name text, role text, is_super_admin boolean default false, is_active boolean default true);
create table public.customers(id uuid primary key, tenant_id uuid, name text, status text);
create table public.customer_users(id uuid primary key, auth_user_id uuid, customer_id uuid, tenant_id uuid);
create table public.vehicles(id uuid primary key, tenant_id uuid, reg text, status text, show_on_website boolean);
create table public.rentals(id uuid primary key, tenant_id uuid, customer_id uuid, vehicle_id uuid, rental_number text, status text);
create table public.payments(id uuid primary key, tenant_id uuid, customer_id uuid, amount numeric, status text);
create table public.invoices(id uuid primary key, tenant_id uuid, rental_id uuid, total_amount numeric, status text);
create table public.ledger_entries(id uuid primary key, tenant_id uuid, customer_id uuid, type text, amount numeric);
create table public.payment_applications(id uuid primary key, tenant_id uuid, payment_id uuid);
create table public.pnl_entries(id uuid primary key, tenant_id uuid, side text, category text, amount numeric);
create table public.rental_extensions(id uuid primary key, tenant_id uuid, rental_id uuid);

create function public.get_user_tenant_id() returns uuid language sql stable security definer set search_path to 'public' as $$
  select tenant_id from app_users where auth_user_id = auth.uid() limit 1 $$;
create function public.is_super_admin() returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select is_super_admin from app_users where auth_user_id = auth.uid() limit 1), false) $$;
`);

/* Every table the remediation scripts name must exist. A superset of link
   columns stands in for the real ones; the policies only use these. */
const named = new Set();
for (const name of ['01-revoke-destructive-anon-grants.sql', '02-enable-rls-with-tenant-policies.sql', '03-restrict-remaining-tenant-tables.sql']) {
  const sql = (await script(name)).split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  // Every relation the scripts touch, however it is written: one per statement,
  // several per `revoke`, or wrapped across lines. Function calls are skipped.
  for (const m of sql.matchAll(/public\.([a-z0-9_]+)/gi)) {
    if (sql[m.index + m[0].length] === '(') continue;
    named.add(m[1].toLowerCase());
  }
}
const existing = new Set((await db.query(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`)).rows.map((r) => r.relname));
for (const table of named) {
  if (existing.has(table)) continue;
  await db.exec(`create table public.${table}(id uuid primary key default gen_random_uuid(), tenant_id uuid,
    customer_id uuid, rental_id uuid, vehicle_id uuid, user_id uuid, auth_user_id uuid, status text);`);
}
for (const table of [...named, ...existing]) {
  await db.exec(`grant select, insert, update, delete, truncate, references, trigger on public.${table} to anon, authenticated, service_role;`);
}

/* The blanket policies and RLS state, as deployed. Policy names, roles and
   predicates below were read from the live catalogue. */
await db.exec(`
create policy "Allow all operations for all users" on public.customers for all using (true);
create policy allow_all_select on public.customers for select using (auth.uid() is not null);
create policy tenant_isolation_customers on public.customers for all using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
create policy allow_all_select on public.rentals for select using (auth.uid() is not null);
create policy tenant_isolation_rentals on public.rentals for all using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
create policy "Customers can read own rentals" on public.rentals for select to authenticated
  using (exists (select 1 from public.customer_users cu where cu.customer_id = rentals.customer_id and cu.auth_user_id = auth.uid()));
create policy allow_all_select on public.payments for select using (auth.uid() is not null);
create policy "Allow all operations for app users" on public.payments for all using (true);
create policy tenant_isolation_payments on public.payments for all using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
create policy "Allow authenticated users to view invoices" on public.invoices for select to authenticated using (true);
create policy tenant_isolation_invoices on public.invoices for all using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
create policy allow_all_select on public.vehicles for select using (auth.uid() is not null);
create policy tenant_isolation_vehicles on public.vehicles for all using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
-- As deployed: granted to {anon, authenticated}, and the only test is the status.
create policy public_can_read_bookable_vehicles on public.vehicles for select to anon, authenticated
  using (coalesce(status, '') <> all (array['Disposed', 'Sold']));
alter table public.vehicles enable row level security;
-- pnl_entries and payg_accruals already have RLS on in production …
create policy "tenant manage pnl_entries" on public.pnl_entries for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
create policy "service_role manage pnl_entries" on public.pnl_entries for all to service_role using (true);
alter table public.pnl_entries enable row level security;
-- … but payg_accruals carries a policy that admits every signed-in user.
create policy allow_authenticated_read_payg on public.payg_accruals for select to authenticated using (auth.uid() is not null);
create policy payg_accruals_tenant_read on public.payg_accruals for select using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
alter table public.payg_accruals enable row level security;
-- fines: RLS off, and a policy that admits anon outright.
create policy "Allow anon access for fines" on public.fines for all to anon, authenticated using (true);
create policy tenant_isolation_fines on public.fines for all using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
create policy "Allow all operations for app users" on public.authority_payments for all using (true);
create policy "Allow all operations for app users" on public.customer_documents for all using (true);
create policy "Allow anon users read access" on public.identity_verifications for select to anon using (true);
create policy "Allow authenticated users full access" on public.identity_verifications for all to authenticated using (true);
create policy "Allow anon to create verifications for booking" on public.identity_verifications for insert to anon with check (true);
-- Already correct in production, so no stage touches them; modelled so the
-- "no tenant table left with RLS off" invariant is checked against the real state.
create policy app_users_self on public.app_users for select to authenticated using (auth_user_id = auth.uid());
create policy app_users_tenant on public.app_users for all to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
create policy app_users_service on public.app_users for all to service_role using (true);
alter table public.app_users enable row level security;
create policy "Tenant users read own rental_extensions" on public.rental_extensions for select to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
create policy "Customers read own rental_extensions" on public.rental_extensions for select to authenticated
  using (rental_id in (select r.id from public.rentals r join public.customer_users cu on cu.customer_id = r.customer_id
                       where cu.auth_user_id = auth.uid()));
create policy "Service role full access to rental_extensions" on public.rental_extensions for all to service_role using (true);
alter table public.rental_extensions enable row level security;
`);

/* Views owned by the superuser with no security_invoker: they read base tables
   with owner rights, so policies on those tables do not apply. */
await db.exec(`
create view public.view_pl_consolidated as select tenant_id, side, category, amount from public.pnl_entries;
create view public.view_payments_export as select p.tenant_id, p.amount, p.status, c.name as customer
  from public.payments p left join public.customers c on c.id = p.customer_id;
create view public.rental_extension_totals as select tenant_id, rental_id from public.payg_accruals;
`);
const viewSql = await script('04-restrict-tenant-views.sql');
for (const m of viewSql.matchAll(/^alter view public\.([a-z0-9_]+)/gim)) {
  const view = m[1];
  if (['view_pl_consolidated', 'view_payments_export', 'rental_extension_totals'].includes(view)) continue;
  await db.exec(`create view public.${view} as select tenant_id, amount from public.pnl_entries;`);
}
await db.exec(`grant select on all tables in schema public to anon, authenticated, service_role;`);

await db.query('insert into tenants values($1,$2),($3,$4)', [TENANT_A, 'Acme Hire', TENANT_B, 'Borealis Rentals']);
await db.query(`insert into app_users values
  ($1,$1,$2,'Ada (Acme staff)','admin',false,true),
  ($3,$3,$4,'Ben (Borealis staff)','admin',false,true),
  ($5,$5,$2,'Super Admin','head_admin',false,true),
  ($6,$6,null,'Platform Reviewer','head_admin',true,true)`,
  [STAFF_A, TENANT_A, STAFF_B, TENANT_B, OWNER_A, PLATFORM]);
await db.query(`insert into customers values($1,$2,'Acme customer','active'),($3,$4,'Borealis customer','active')`, [CUSTOMER_A, TENANT_A, CUSTOMER_B, TENANT_B]);
await db.query('insert into customer_users values($1,$1,$2,$3)', [CUSTOMER_A_USER, CUSTOMER_A, TENANT_A]);
// Tenant A: 2 vehicles. Tenant B: 6. One of A's is off the website; one of B's is sold.
for (let i = 0; i < 2; i++) await db.query('insert into vehicles values($1,$2,$3,$4,$5)', [id(100 + i), TENANT_A, `ACME-${i}`, 'Available', i === 0]);
for (let i = 0; i < 6; i++) await db.query('insert into vehicles values($1,$2,$3,$4,$5)', [id(200 + i), TENANT_B, `BOR-${i}`, i === 5 ? 'Sold' : 'Available', i < 2]);
await db.query(`insert into rentals values($1,$2,$3,$4,'A-1','Active'),($5,$6,$7,$8,'B-1','Active')`,
  [id(300), TENANT_A, CUSTOMER_A, id(100), id(301), TENANT_B, CUSTOMER_B, id(200)]);
await db.query(`insert into payments values($1,$2,$3,100.00,'Applied'),($4,$5,$6,999.00,'Applied')`,
  [id(400), TENANT_A, CUSTOMER_A, id(401), TENANT_B, CUSTOMER_B]);
await db.query(`insert into invoices values($1,$2,$3,120.00,'pending'),($4,$5,$6,900.00,'pending')`,
  [id(500), TENANT_A, id(300), id(501), TENANT_B, id(301)]);
await db.query(`insert into ledger_entries values($1,$2,$3,'Charge',120.00),($4,$5,$6,'Charge',900.00)`,
  [id(600), TENANT_A, CUSTOMER_A, id(601), TENANT_B, CUSTOMER_B]);
await db.query(`insert into pnl_entries values($1,$2,'Revenue','Rental',400.00),($3,$4,'Revenue','Rental',7777.00)`,
  [id(700), TENANT_A, id(701), TENANT_B]);
await db.query(`insert into fines(id,tenant_id,customer_id) values($1,$2,$3),($4,$5,$6)`, [id(800), TENANT_A, CUSTOMER_A, id(801), TENANT_B, CUSTOMER_B]);
await db.query(`insert into customer_documents(id,tenant_id,customer_id) values($1,$2,$3),($4,$5,$6)`, [id(810), TENANT_A, CUSTOMER_A, id(811), TENANT_B, CUSTOMER_B]);
await db.query(`insert into identity_verifications(id,tenant_id,customer_id) values($1,$2,$3),($4,$5,$6)`, [id(820), TENANT_A, CUSTOMER_A, id(821), TENANT_B, CUSTOMER_B]);
await db.query(`insert into payg_accruals(id,tenant_id,rental_id) values($1,$2,$3),($4,$5,$6)`, [id(830), TENANT_A, id(300), id(831), TENANT_B, id(301)]);

/** Run a statement as a role, with a real authenticated user id where one applies. */
async function as(role, authUser, query, params = []) {
  await db.exec(`set role ${role};`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [authUser ? JSON.stringify({ sub: authUser }) : '']);
  try { return await db.query(query, params); }
  finally { await db.exec('reset role;'); await db.query(`select set_config('request.jwt.claims', '', false)`); }
}
const countAs = async (role, authUser, relation) => Number((await as(role, authUser, `select count(*)::int as n from public.${relation}`)).rows[0].n);

/* ══ Before the fix ═══════════════════════════════════════════════════════ */

test('before: an anonymous visitor reads every account’s private records', async () => {
  assert.equal(await countAs('anon', null, 'customers'), 2);
  assert.equal(await countAs('anon', null, 'rentals'), 2);
  assert.equal(await countAs('anon', null, 'payments'), 2);
  assert.equal(await countAs('anon', null, 'invoices'), 2);
  assert.equal(await countAs('anon', null, 'ledger_entries'), 2);
  assert.equal(await countAs('anon', null, 'fines'), 2);
  assert.equal(await countAs('anon', null, 'customer_documents'), 2);
  assert.equal(await countAs('anon', null, 'identity_verifications'), 2);
});

test('before: staff of one account read the other account, even where RLS is on', async () => {
  assert.equal(await countAs('authenticated', STAFF_A, 'vehicles'), 8, 'the blanket vehicles policy admits everything');
  // payg_accruals has RLS ON and still leaks, because one policy tests only "is signed in".
  assert.equal(await countAs('authenticated', STAFF_A, 'payg_accruals'), 2);
  // pnl_entries is genuinely isolated at the table …
  assert.equal(await countAs('authenticated', STAFF_A, 'pnl_entries'), 1);
  // … but the view over it runs with owner rights and hands back both accounts.
  const sales = await as('authenticated', STAFF_A, `select coalesce(sum(amount),0)::numeric(12,2) as total from public.view_pl_consolidated where side='Revenue'`);
  assert.equal(String(sales.rows[0].total), '8177.00', 'the view should be leaking before stage 4');
});

/* ══ Apply the remediation ════════════════════════════════════════════════ */

test('the remediation scripts apply to this database', async () => {
  for (const name of ['01-revoke-destructive-anon-grants.sql', '02-enable-rls-with-tenant-policies.sql',
    '03-restrict-remaining-tenant-tables.sql', '04-restrict-tenant-views.sql']) {
    try { await db.exec(await script(name)); }
    catch (error) { await db.exec('rollback;').catch(() => {}); throw new Error(`${name}: ${error.message}`); }
  }
  const off = (await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' and a.attnum>0
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)).rows.map((r) => r.relname);
  assert.deepEqual(off, [], `tenant-scoped tables still have RLS off: ${off.join(', ')}`);
  // No policy may admit a signed-in user regardless of which account they belong to.
  const blanket = (await db.query(`select tablename, policyname, roles::text as roles from pg_policies
    where schemaname='public' and (qual = 'true' or qual ilike '%auth.uid() IS NOT NULL%')
      and roles::text not like '%service_role}%'
      and (roles::text like '%authenticated%' or roles::text like '%public%')`)).rows;
  assert.deepEqual(blanket, [], `policies that admit any signed-in user survived: ${blanket.map((b) => `${b.tablename}.${b.policyname}`).join(', ')}`);
  // The anonymous surface is deliberate and small: it must be exactly the booking site's.
  const anonRead = (await db.query(`select tablename from pg_policies where schemaname='public'
    and roles::text like '%anon%' and cmd in ('SELECT','ALL') order by tablename`)).rows.map((r) => r.tablename);
  assert.deepEqual(anonRead, ['agreement_templates', 'blocked_dates', 'blocked_identities', 'pickup_locations', 'promocodes', 'vehicle_photos', 'vehicles'],
    'the anonymous read surface changed');
});

/* ══ The acceptance table ═════════════════════════════════════════════════ */

test('Tenant A counts 2 vehicles, Tenant B counts 6, neither is ever told 8', async () => {
  assert.equal(await countAs('authenticated', STAFF_A, 'vehicles'), 2);
  assert.equal(await countAs('authenticated', STAFF_B, 'vehicles'), 6);
  assert.equal(Number((await db.query('select count(*)::int as n from public.vehicles')).rows[0].n), 8, 'the fixture holds eight');
});

test('Tenant A’s sales figures contain only Tenant A’s entries', async () => {
  const table = await as('authenticated', STAFF_A, `select coalesce(sum(amount),0)::numeric(12,2) as total, count(*)::int as rows from public.pnl_entries where side='Revenue'`);
  assert.equal(String(table.rows[0].total), '400.00');
  assert.equal(table.rows[0].rows, 1);
  // The same figure through the reporting view, which is what /insights reads.
  const view = await as('authenticated', STAFF_A, `select coalesce(sum(amount),0)::numeric(12,2) as total from public.view_pl_consolidated where side='Revenue'`);
  assert.equal(String(view.rows[0].total), '400.00', 'the reporting view still crosses accounts');
  // And through an export view that joins customers.
  const exportView = await as('authenticated', STAFF_A, `select count(*)::int as n from public.view_payments_export`);
  assert.equal(exportView.rows[0].n, 1);
  // Joins and aggregates are bounded, not only flat selects.
  const joined = await as('authenticated', STAFF_A, `
    select count(*)::int as n from public.rentals r
    join public.customers c on c.id = r.customer_id
    join public.vehicles v on v.id = r.vehicle_id`);
  assert.equal(joined.rows[0].n, 1, 'a join reached another account');
});

test('Tenant A supplying Tenant B’s record id gets nothing, and no detail', async () => {
  for (const [relation, foreignId] of [['rentals', id(301)], ['payments', id(401)], ['invoices', id(501)], ['customers', CUSTOMER_B], ['vehicles', id(200)], ['fines', id(801)], ['customer_documents', id(811)], ['identity_verifications', id(821)]]) {
    const result = await as('authenticated', STAFF_A, `select * from public.${relation} where id = $1`, [foreignId]);
    assert.equal(result.rows.length, 0, `${relation}: another account's record was returned by id`);
  }
  // A matching rental NUMBER does not establish ownership either.
  assert.equal((await as('authenticated', STAFF_A, `select id from public.rentals where rental_number = 'B-1'`)).rows.length, 0);
  // Writes are bounded by the same policy, not just reads.
  await assert.rejects(
    as('authenticated', STAFF_A, `insert into public.payments values($1,$2,$3,50.00,'Applied')`, [id(999), TENANT_B, CUSTOMER_B]),
    /row-level security/i, 'a staff member could write into another account');
  // Nor can a visible row be moved into another account: the WITH CHECK refuses it.
  await assert.rejects(
    as('authenticated', STAFF_A, `update public.payments set tenant_id = $1 where id = $2 returning id`, [TENANT_B, id(400)]),
    /row-level security/i, 'a row was moved into another account');
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  assert.equal(Number((await db.query(`select count(*)::int as n from public.payments where tenant_id = $1`, [TENANT_B])).rows[0].n), 1,
    'the refused update still changed the other account');
});

test('an anonymous visitor gets the booking website, and nothing private', async () => {
  // Public browsing still works: bookable vehicles, as the booking site lists them.
  const browsable = await as('anon', null, `select reg from public.vehicles order by reg`);
  assert.deepEqual(browsable.rows.map((r) => r.reg), ['ACME-0', 'ACME-1', 'BOR-0', 'BOR-1', 'BOR-2', 'BOR-3', 'BOR-4']);
  assert.ok(!browsable.rows.some((r) => r.reg === 'BOR-5'), 'a sold vehicle was published');
  // The booking widget keeps the lookups it needs.
  for (const relation of ['blocked_dates', 'pickup_locations', 'promocodes', 'vehicle_photos', 'agreement_templates']) {
    await as('anon', null, `select count(*) from public.${relation}`);
  }
  // Private records are gone.
  for (const relation of ['customers', 'rentals', 'payments', 'invoices', 'ledger_entries', 'fines', 'customer_documents', 'identity_verifications', 'payg_accruals', 'audit_logs', 'org_settings', 'email_logs']) {
    assert.equal(await countAs('anon', null, relation), 0, `${relation}: still readable by an anonymous visitor`);
  }
  // So are the reporting views.
  for (const view of ['view_pl_consolidated', 'view_payments_export', 'view_owner_revenue', 'view_customer_statements']) {
    await assert.rejects(as('anon', null, `select count(*) from public.${view}`), /permission denied/i, `${view}: anon can still read it`);
  }
  // Checkout keeps working: the booking flow still creates its rows.
  await as('anon', null, `insert into public.customers values($1,$2,'Walk-in','active')`, [id(900), TENANT_A]);
  await as('anon', null, `insert into public.rentals values($1,$2,$3,$4,'A-NEW','Pending')`, [id(901), TENANT_A, id(900), id(100)]);
  await as('anon', null, `insert into public.invoices values($1,$2,$3,50.00,'pending')`, [id(902), TENANT_A, id(901)]);
  await as('anon', null, `insert into public.ledger_entries values($1,$2,$3,'Charge',50.00)`, [id(903), TENANT_A, id(900)]);
  await as('anon', null, `insert into public.identity_verifications(id,tenant_id) values($1,$2)`, [id(904), TENANT_A]);
  await as('anon', null, `insert into public.contact_requests(id,tenant_id) values($1,$2)`, [id(905), TENANT_A]);
  assert.equal(Number((await db.query(`select count(*)::int as n from public.rentals where rental_number='A-NEW'`)).rows[0].n), 1, 'checkout was broken by the fix');
  // What it still cannot do: read any of it back.
  assert.equal(await countAs('anon', null, 'customers'), 0);
  // Stage 0b deliberately leaves anon's DELETE grant on customers and rentals
  // until the checkout cleanup moves server-side. Row-level security is what
  // stops it being useful: the privilege is there, the rows are not visible, so
  // the statement matches nothing instead of deleting someone's booking.
  const deleted = await as('anon', null, `delete from public.customers where id=$1 returning id`, [id(900)]);
  assert.equal(deleted.rows.length, 0, 'an anonymous caller deleted a customer row');
  assert.equal(Number((await db.query(`select count(*)::int as n from public.customers where id=$1`, [id(900)])).rows[0].n), 1,
    'the row was removed despite the policy');
  // Where the grant is gone as well, it fails outright.
  await assert.rejects(as('anon', null, `delete from public.payments where id=$1`, [id(400)]), /permission denied/i);
});

test('a signed-in customer sees their own records only', async () => {
  assert.deepEqual((await as('authenticated', CUSTOMER_A_USER, `select rental_number from public.rentals`)).rows.map((r) => r.rental_number), ['A-1'],
    'the customer portal saw someone else’s rental');
  assert.deepEqual((await as('authenticated', CUSTOMER_A_USER, `select amount from public.payments`)).rows.map((r) => String(r.amount)), ['100.00']);
  assert.equal(await countAs('authenticated', CUSTOMER_A_USER, 'customer_documents'), 1, 'the customer lost their own documents');
  assert.equal(await countAs('authenticated', CUSTOMER_A_USER, 'payg_accruals'), 1);
  // A customer is not staff: the account's other records stay invisible.
  assert.equal(await countAs('authenticated', CUSTOMER_A_USER, 'customers'), 0);
  assert.equal(await countAs('authenticated', CUSTOMER_A_USER, 'fines'), 0);
  assert.equal(await countAs('authenticated', CUSTOMER_A_USER, 'audit_logs'), 0);
  // Their own link row only.
  assert.equal(await countAs('authenticated', CUSTOMER_A_USER, 'customer_users'), 1);
});

test('platform access comes from the stored flag, never from a display name', async () => {
  // OWNER_A is called "Super Admin" and owns tenant A, but app_users.is_super_admin is false.
  assert.equal(await countAs('authenticated', OWNER_A, 'vehicles'), 2);
  assert.equal(await countAs('authenticated', OWNER_A, 'payments'), 1);
  assert.equal(await countAs('authenticated', OWNER_A, 'fines'), 1);
  // The platform reviewer carries the flag in app_users.
  assert.equal(await countAs('authenticated', PLATFORM, 'vehicles'), 8);
  assert.equal(await countAs('authenticated', PLATFORM, 'payments'), 2);
});

test('the server role still works, so edge functions and TRAX are unaffected', async () => {
  assert.equal(await countAs('service_role', null, 'vehicles'), 8);
  assert.equal(await countAs('service_role', null, 'payments'), 2);
  // TRAX uses this role and adds its own tenant predicate; business-storage.mjs
  // proves every statement it issues carries the authenticated tenant.
  assert.equal(Number((await as('service_role', null, `select count(*)::int as n from public.vehicles where tenant_id = $1`, [TENANT_A])).rows[0].n), 2);
});

test('the one-off backup tables are closed to both keys', async () => {
  for (const relation of ['_backfill_iv_link_20260817', '_recover_orphan_customers_20260817', 'zz_tenant_subscriptions_bak_20260727']) {
    await assert.rejects(as('anon', null, `select count(*) from public.${relation}`), /permission denied/i, `${relation}: anon can still read it`);
    await assert.rejects(as('authenticated', STAFF_A, `select count(*) from public.${relation}`), /permission denied/i, `${relation}: staff can still read it`);
  }
});

test('the rollback runs and returns the database to its previous behaviour', async () => {
  // Kept last: it undoes everything above. Run in reverse order, as documented.
  for (const name of ['05-rollback-stages-3-4.sql', '99-rollback.sql']) {
    try { await db.exec(await script(name)); }
    catch (error) { await db.exec('rollback;').catch(() => {}); throw new Error(`${name}: ${error.message}`); }
  }
  // Access is restored: the tables that had RLS off have it off again.
  const stillOn = (await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity
      and c.relname in ('customers','rentals','payments','invoices','ledger_entries','payment_applications','fines','audit_logs','customer_documents')`)).rows;
  assert.deepEqual(stillOn, [], `rollback left RLS on: ${stillOn.map((r) => r.relname).join(', ')}`);
  // And the views are readable by the anonymous key again, as they were.
  assert.ok(Number((await countAs('anon', null, 'view_pl_consolidated'))) >= 0);
  // The one correction the rollback keeps on purpose: vehicles stays isolated,
  // because its blanket policy is not recreated (see the header of 99-rollback.sql).
  assert.equal(await countAs('authenticated', STAFF_A, 'vehicles'), 2);
});

test.after(async () => { await db.close(); });
