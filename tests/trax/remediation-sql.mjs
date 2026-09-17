/**
 * The isolation remediation SQL, executed against a throwaway Postgres.
 *
 * It does not touch any real database. It builds the objects the scripts refer to
 * (the tables, the `anon`/`authenticated`/`service_role` roles, `auth.uid()`,
 * `get_user_tenant_id()`, `is_super_admin()`, `customer_users`), runs
 * docs/trax/remediation/01 and 02, and checks the outcome:
 *
 *  - both scripts execute (no syntax error, no missing object);
 *  - RLS ends up enabled on every table the stage names;
 *  - the blanket policies are gone and the tenant policies remain;
 *  - the destructive anon grants are gone while SELECT/INSERT remain;
 *  - the rollback executes and returns RLS to off.
 *
 * This is a validity and outcome check for the script. It is NOT proof that the
 * live applications still work: that needs the staging regression list in
 * docs/trax/db-isolation-remediation.md.
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

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema if not exists auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table public.tenants(id uuid primary key);
create table public.app_users(id uuid primary key, auth_user_id uuid, tenant_id uuid, is_super_admin boolean);
create table public.customers(id uuid primary key, tenant_id uuid);
create table public.customer_users(id uuid primary key, auth_user_id uuid, customer_id uuid, tenant_id uuid);
create table public.rentals(id uuid primary key, tenant_id uuid, customer_id uuid);
create table public.payments(id uuid primary key, tenant_id uuid, customer_id uuid);
create table public.invoices(id uuid primary key, tenant_id uuid, rental_id uuid);
create table public.ledger_entries(id uuid primary key, tenant_id uuid, customer_id uuid);
create table public.payment_applications(id uuid primary key, tenant_id uuid);
create table public.payg_accruals(id uuid primary key, tenant_id uuid);
create table public.rental_extensions(id uuid primary key, tenant_id uuid);
create table public.vehicles(id uuid primary key, tenant_id uuid, show_on_website boolean, is_disposed boolean, status text);
create function public.get_user_tenant_id() returns uuid language sql stable as $$ select null::uuid $$;
create function public.is_super_admin() returns boolean language sql stable as $$ select false $$;
`);

// The deployed starting point: full grants to anon, RLS off, blanket policies present.
const TABLES = ['customers', 'rentals', 'payments', 'invoices', 'ledger_entries', 'payment_applications', 'payg_accruals', 'rental_extensions', 'vehicles'];
for (const table of TABLES) await db.exec(`grant select, insert, update, delete, truncate, references, trigger on public.${table} to anon, authenticated, service_role;`);
await db.exec(`
create policy "Allow all operations for all users" on public.customers for all using (true);
create policy allow_all_select on public.customers for select using (auth.uid() is not null);
create policy tenant_isolation_customers on public.customers for all
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
create policy allow_all_select on public.rentals for select using (auth.uid() is not null);
create policy tenant_isolation_rentals on public.rentals for all
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());
create policy allow_all_select on public.payments for select using (auth.uid() is not null);
create policy "Allow authenticated users to view invoices" on public.invoices for select to authenticated using (true);
create policy allow_all_select on public.vehicles for select using (auth.uid() is not null);
create policy public_can_read_bookable_vehicles on public.vehicles for select to anon using (show_on_website = true);
alter table public.vehicles enable row level security;
`);

const rls = async (table) => (await db.query(`select relrowsecurity as on from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname=$1`, [table])).rows[0].on;
const policies = async (table) => (await db.query(`select policyname from pg_policies where schemaname='public' and tablename=$1 order by policyname`, [table])).rows.map((r) => r.policyname);
const grants = async (table, grantee) => (await db.query(`select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee=$2`, [table, grantee])).rows.map((r) => r.privilege_type);

test('stage 0 removes the destructive anon grants and nothing else', async () => {
  await db.exec(await script('01-revoke-destructive-anon-grants.sql'));
  for (const table of TABLES) {
    const anon = await grants(table, 'anon');
    assert.ok(!anon.includes('DELETE'), `${table}: anon kept DELETE`);
    assert.ok(!anon.includes('TRUNCATE'), `${table}: anon kept TRUNCATE`);
    // Reading and the checkout inserts are untouched by this stage.
    assert.ok(anon.includes('SELECT') && anon.includes('INSERT'), `${table}: stage 0 removed a read or insert grant`);
    assert.ok((await grants(table, 'authenticated')).includes('DELETE'), `${table}: staff lost DELETE`);
  }
});

test('stage 1 executes, drops the blanket policies and turns RLS on', async () => {
  await db.exec(await script('02-enable-rls-with-tenant-policies.sql'));
  for (const table of ['customers', 'rentals', 'payments', 'invoices', 'ledger_entries', 'payment_applications', 'vehicles']) {
    assert.equal(await rls(table), true, `${table}: RLS is still off`);
  }
  const customers = await policies('customers');
  assert.ok(!customers.includes('Allow all operations for all users'), 'the blanket customers policy survived');
  assert.ok(!customers.includes('allow_all_select'), 'the blanket customers select policy survived');
  assert.ok(customers.includes('tenant_isolation_customers'), 'the tenant policy was removed');
  assert.ok(customers.includes('customers_service'), 'the service-role policy is missing');
  assert.ok(!(await policies('vehicles')).includes('allow_all_select'), 'the blanket vehicles policy survived');
  assert.ok((await policies('vehicles')).includes('public_can_read_bookable_vehicles'), 'public browsing lost its policy');
  assert.ok((await policies('ledger_entries')).includes('ledger_staff'), 'the ledger had no policy added');
  // The checkout paths keep an insert policy.
  for (const table of ['customers', 'rentals', 'invoices', 'ledger_entries']) {
    assert.ok((await policies(table)).some((p) => p.endsWith('_public_insert')), `${table}: checkout lost its insert policy`);
  }
});

test('stage 1 is idempotent: applying it twice is not an error', async () => {
  await db.exec(await script('02-enable-rls-with-tenant-policies.sql'));
  assert.equal(await rls('customers'), true);
});

test('the rollback executes and returns RLS to off', async () => {
  await db.exec(await script('99-rollback.sql'));
  for (const table of ['customers', 'rentals', 'payments', 'invoices', 'ledger_entries', 'payment_applications']) {
    assert.equal(await rls(table), false, `${table}: rollback left RLS on`);
  }
  assert.ok(!(await policies('payments')).includes('payments_customer_read'), 'rollback left a stage-1 policy behind');
});

test.after(async () => { await db.close(); });
