/**
 * The REAL business query layer against a REAL database, with two tenants.
 *
 * Not mocked tool output: `business-query.ts` is bundled from source and driven
 * through a PostgREST-shaped shim that compiles its filters into actual SQL and
 * runs them on an isolated PGlite Postgres. Every statement the layer issues is
 * recorded, so the test can assert what reached the database — not only what came
 * back from it.
 *
 * What it proves, per the isolation requirements:
 *  - two tenants, two vehicle fleets (2 and 6): neither is ever told 8;
 *  - the tenant predicate is in EVERY statement, before retrieval, joins,
 *    aggregation, sorting, ranking and pagination;
 *  - a tenant id cannot be supplied, forged or filtered by the caller;
 *  - another account's ids match nothing, and grouping never names its rows;
 *  - a revoked module permission refuses BEFORE any statement is issued;
 *  - switching tenant in the same process reuses no result, page or currency;
 *  - money follows the application's rules, checked against SQL-computed truth;
 *  - paging past PostgREST's 1,000-row window still totals the whole set.
 *
 * No live account, credential or production database is used.
 */
import { build } from 'esbuild';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'trax-business-sql-'));
const out = resolve(root, 'artifacts/trax-business'); await mkdir(out, { recursive: true });

const { PGlite } = await import(pathToFileURL(process.env.TRAX_PGLITE_PATH ?? resolve(tmpdir(), 'drive247-trax-sql-tests/node_modules/@electric-sql/pglite/dist/index.js')));
const db = new PGlite();

await build({ entryPoints: [resolve(root, 'supabase/functions/trax-support/support/business-query.ts')], outfile: resolve(temp, 'query.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
await build({ entryPoints: [resolve(root, 'supabase/functions/trax-support/support/business-tools.ts')], outfile: resolve(temp, 'tools.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { createBusinessReads, parseSpec, runBusinessQuery } = await import(pathToFileURL(resolve(temp, 'query.mjs')));
const { BUSINESS_TOOLS } = await import(pathToFileURL(resolve(temp, 'tools.mjs')));

/* ── the schema under test: the columns the catalog names, nothing more ─────── */
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACME = id(1), BOREALIS = id(2);
await db.exec(`
create table tenants(id uuid primary key, name text, timezone text, currency_code text);
create table vehicles(id uuid primary key, tenant_id uuid, reg text, make text, model text, status text, is_paused boolean, is_disposed boolean, show_on_website boolean);
create table customers(id uuid primary key, tenant_id uuid, status text, customer_type text, is_blocked boolean, identity_verification_status text, created_at timestamptz);
create table rentals(id uuid primary key, tenant_id uuid, vehicle_id uuid, customer_id uuid, rental_number text, status text, start_date date, end_date date, is_pay_as_you_go boolean);
create table payments(id uuid primary key, tenant_id uuid, customer_id uuid, rental_id uuid, status text, capture_status text, payment_type text, amount numeric, refund_amount numeric, payment_date date, paid_at timestamptz);
create table pnl_entries(id uuid primary key, tenant_id uuid, side text, category text, amount numeric, entry_date date, vehicle_id uuid, customer_id uuid, rental_id uuid);
`);
await db.query('insert into tenants values($1,$2,$3,$4),($5,$6,$7,$8)', [ACME, 'Acme Hire', 'Europe/London', 'GBP', BOREALIS, 'Borealis Rentals', 'America/New_York', 'USD']);

// Acme: 2 vehicles. Borealis: 6. The whole point of the example.
for (let i = 0; i < 2; i++) await db.query('insert into vehicles values($1,$2,$3,$4,$5,$6,false,false,true)', [id(100 + i), ACME, `ACME-${i}`, 'Toyota', 'Yaris', 'Available']);
for (let i = 0; i < 6; i++) await db.query('insert into vehicles values($1,$2,$3,$4,$5,$6,false,false,true)', [id(200 + i), BOREALIS, `BOR-${i}`, i < 4 ? 'Ford' : 'Kia', 'Focus', 'Available']);

await db.query('insert into customers values($1,$2,$3,$4,false,$5,$6)', [id(300), ACME, 'active', 'individual', 'verified', '2026-08-02T10:00:00Z']);
await db.query('insert into customers values($1,$2,$3,$4,false,$5,$6)', [id(301), BOREALIS, 'active', 'company', 'pending', '2026-08-03T10:00:00Z']);

await db.query("insert into rentals values($1,$2,$3,$4,'A-1','Active','2026-08-04','2026-08-09',false)", [id(400), ACME, id(100), id(300)]);
await db.query("insert into rentals values($1,$2,$3,$4,'A-2','Completed','2026-08-20','2026-08-26',false)", [id(401), ACME, id(101), id(300)]);
await db.query("insert into rentals values($1,$2,$3,$4,'B-1','Active','2026-08-05','2026-08-08',false)", [id(402), BOREALIS, id(200), id(301)]);

// Money. Acme: 100.00 + (75.50 − 20.00) received; an uncaptured hold and a reversed row must not count.
await db.query("insert into payments values($1,$2,$3,$4,'Applied','captured','Payment',100.00,null,'2026-08-10','2026-08-10T09:00:00Z')", [id(500), ACME, id(300), id(400)]);
await db.query("insert into payments values($1,$2,$3,$4,'Partial Refund',null,'Payment',75.50,20.00,'2026-08-20','2026-08-20T09:00:00Z')", [id(501), ACME, id(300), id(400)]);
await db.query("insert into payments values($1,$2,$3,$4,'Applied','requires_capture','Payment',500.00,null,'2026-08-21',null)", [id(502), ACME, id(300), id(400)]);
await db.query("insert into payments values($1,$2,$3,$4,'Reversed','captured','Payment',900.00,null,'2026-08-22',null)", [id(503), ACME, id(300), id(400)]);
await db.query("insert into payments values($1,$2,$3,$4,'Applied','captured','Payment',4321.00,null,'2026-08-11','2026-08-11T09:00:00Z')", [id(504), BOREALIS, id(301), id(402)]);
// Borealis also has a large collection history, past one PostgREST window.
for (let i = 0; i < 1500; i++) await db.query("insert into payments values($1,$2,$3,null,'Applied','captured','Payment',10.00,null,'2026-08-15','2026-08-15T09:00:00Z')", [id(600000 + i), BOREALIS, id(301)]);

await db.query("insert into pnl_entries values($1,$2,'Revenue','Rental',400.00,'2026-08-05',$3,$4,$5)", [id(700), ACME, id(100), id(300), id(400)]);
await db.query("insert into pnl_entries values($1,$2,'Revenue','Tax',80.00,'2026-08-05',$3,$4,$5)", [id(701), ACME, id(100), id(300), id(400)]);
await db.query("insert into pnl_entries values($1,$2,'Revenue','Security Deposit',300.00,'2026-08-06',$3,$4,$5)", [id(702), ACME, id(101), id(300), id(401)]);
await db.query("insert into pnl_entries values($1,$2,'Cost','Acquisition',9000.00,'2026-08-07',$3,null,null)", [id(703), ACME, id(101)]);
await db.query("insert into pnl_entries values($1,$2,'Cost','Service',150.00,'2026-08-08',$3,null,null)", [id(704), ACME, id(100)]);
await db.query("insert into pnl_entries values($1,$2,'Revenue','Rental',7777.00,'2026-08-05',$3,$4,$5)", [id(705), BOREALIS, id(200), id(301), id(402)]);

/* ── a PostgREST-shaped client that compiles to real SQL ───────────────────── */
const statements = [];
function client() {
  return {
    from(table) {
      return {
        select(columns, options = {}) {
          const where = [], params = [];
          const push = (fragment, value) => { params.push(value); where.push(fragment.replace('?', `$${params.length}`)); return query; };
          const query = {
            eq: (c, v) => push(`${c}::text = ?`, String(v)),
            neq: (c, v) => push(`(${c} is null or ${c}::text <> ?)`, String(v)),
            in: (c, v) => push(`${c}::text = any(?)`, v.map(String)),
            gt: (c, v) => push(`${c} > ?`, v), gte: (c, v) => push(`${c} >= ?`, v),
            lt: (c, v) => push(`${c} < ?`, v), lte: (c, v) => push(`${c} <= ?`, v),
            is: (c) => { where.push(`${c} is null`); return query; },
            not: (c) => { where.push(`${c} is not null`); return query; },
            ilike: (c, p) => push(`${c} ilike ?`, p),
            order: (c) => { query._order = c; return query; },
            range: (from, to) => { query._range = [from, to]; return query; },
            async run() {
              const clause = where.length ? ` where ${where.join(' and ')}` : '';
              const count = (await db.query(`select count(*)::int as n from ${table}${clause}`, params)).rows[0].n;
              let rows = null;
              if (!options.head) {
                const limit = query._range ? ` limit ${query._range[1] - query._range[0] + 1} offset ${query._range[0]}` : '';
                const sql = `select ${columns.split(',').map((c) => c.trim()).join(',')} from ${table}${clause}${query._order ? ` order by ${query._order}` : ''}${limit}`;
                statements.push({ sql, params: params.map(String), table });
                rows = (await db.query(sql, params)).rows;
              } else {
                statements.push({ sql: `select count(*) from ${table}${clause}`, params: params.map(String), table });
              }
              return { data: rows, error: null, count };
            },
            then: (ok, no) => query.run().then(ok, no),
          };
          return query;
        },
      };
    },
  };
}
const reads = createBusinessReads(client());

/* ── contexts: two tenants, and a manager whose permission was revoked ─────── */
const clock = { today: (timezone, now) => new Date(now).toLocaleDateString('sv-SE', { timeZone: timezone }), timestamp: () => 0 };
const NOW = Date.parse('2026-09-18T09:00:00Z');
const contextFor = (tenantId, over = {}) => ({
  auth: { userId: 'u', staffId: 's', tenant: { id: tenantId, slug: 'fixture', status: 'active' }, role: 'admin', superAdmin: false, permissions: [], scope: 'scope', ...(over.auth ?? {}) },
  business: reads, clock, now: NOW,
  timezone: async (t) => (await db.query('select timezone from tenants where id=$1', [t])).rows[0]?.timezone ?? null,
  currency: async (t) => (await db.query('select currency_code from tenants where id=$1', [t])).rows[0]?.currency_code ?? null,
  financeScopes: over.financeScopes ?? [],
});
const acme = () => contextFor(ACME);
const borealis = () => contextFor(BOREALIS);
const run = async (spec, context) => runBusinessQuery(parseSpec(spec), context);
const value = (result, index = 0) => result.data.answer.groups[index]?.value;
const since = () => statements.length;
/** Every statement issued after `mark` carried this tenant, whatever else it did. */
const assertScoped = (mark, tenantId, why) => {
  const issued = statements.slice(mark);
  assert.ok(issued.length, `${why}: no statement was issued`);
  for (const statement of issued) {
    assert.match(statement.sql, /tenant_id::text = \$1/, `${why}: a statement had no tenant predicate: ${statement.sql}`);
    assert.equal(statement.params[0], tenantId, `${why}: a statement carried the wrong tenant: ${statement.params[0]}`);
  }
};

test('two tenants, two fleets: neither is ever told the combined total', async () => {
  let mark = since();
  const small = await run({ dataset: 'vehicles', metric: 'vehicle_count' }, acme());
  assert.equal(value(small), '2');
  assertScoped(mark, ACME, 'Acme fleet count');

  mark = since();
  const large = await run({ dataset: 'vehicles', metric: 'vehicle_count' }, borealis());
  assert.equal(value(large), '6');
  assertScoped(mark, BOREALIS, 'Borealis fleet count');

  const { rows } = await db.query('select count(*)::int as n from vehicles');
  assert.equal(rows[0].n, 8, 'the fixture should hold eight vehicles in total');
  assert.notEqual(value(small), '8');
  assert.notEqual(value(large), '8');
});

test('a tenant cannot be supplied, forged or filtered by the caller', async () => {
  // There is no tenant input: the catalog has no such field, and an extra key is refused.
  assert.throws(() => parseSpec({ dataset: 'vehicles', metric: 'vehicle_count', filters: [{ field: 'tenant_id', op: 'eq', value: BOREALIS }] }), /not a field/);
  assert.throws(() => parseSpec({ dataset: 'vehicles', metric: 'vehicle_count', tenantId: BOREALIS }), /not available|unsupported|invalid/i);
  // Even a catalog-shaped request naming the other tenant's vehicle returns nothing for Acme.
  const mark = since();
  const foreign = await run({ dataset: 'rentals', metric: 'rental_count', filters: [{ field: 'vehicle_id', op: 'eq', value: id(200) }] }, acme());
  assert.equal(value(foreign), '0');
  assertScoped(mark, ACME, 'cross-tenant vehicle reference');
});

test('grouping, ranking and paging never reach another account', async () => {
  let mark = since();
  const grouped = await run({ dataset: 'vehicles', metric: 'vehicle_count', groupBy: 'make', sort: { by: 'metric', direction: 'desc' } }, borealis());
  assert.deepEqual(grouped.data.answer.groups.map((g) => [g.label, g.value]), [['Ford', '4'], ['Kia', '2']]);
  assertScoped(mark, BOREALIS, 'grouped fleet');

  // Acme's own grouping sees only Toyota, never Borealis's makes.
  mark = since();
  const mine = await run({ dataset: 'vehicles', metric: 'vehicle_count', groupBy: 'make' }, acme());
  assert.deepEqual(mine.data.answer.groups.map((g) => g.label), ['Toyota']);
  assertScoped(mark, ACME, 'Acme grouped fleet');

  // Rentals grouped by vehicle: only this account's vehicle ids appear.
  const rentals = await run({ dataset: 'rentals', metric: 'rental_count', groupBy: 'vehicle_id' }, acme());
  assert.deepEqual(rentals.data.answer.groups.map((g) => g.key).sort(), [id(100), id(101)]);
});

test('a revoked module permission refuses before any statement is issued', async () => {
  const manager = contextFor(ACME, { auth: { role: 'manager', permissions: [{ tab_key: 'rentals', access_level: 'viewer' }] } });
  const mark = since();
  await assert.rejects(run({ dataset: 'vehicles', metric: 'vehicle_count' }, manager), /cannot read vehicles/i);
  // Rentals reach vehicles, so the related permission is required too.
  await assert.rejects(run({ dataset: 'rentals', metric: 'rental_count' }, manager), /cannot read the vehicle/i);
  assert.equal(statements.length, mark, 'a refused query still queried the database');

  // Money needs the finance grant, and is refused without it — again before any read.
  await assert.rejects(run({ dataset: 'payments', metric: 'collected' }, acme()), /finance permission/i);
  assert.equal(statements.length, mark, 'a finance refusal still queried the database');
});

test('switching tenant in the same process reuses nothing', async () => {
  const spec = { dataset: 'vehicles', metric: 'vehicle_count' };
  const first = await run(spec, acme());
  const second = await run(spec, borealis());
  const third = await run(spec, acme());
  assert.deepEqual([value(first), value(second), value(third)], ['2', '6', '2']);

  // Currency and timezone follow the tenant too, not the previous answer.
  const finance = (tenant) => contextFor(tenant, { financeScopes: ['rental_payments'] });
  const acmeMoney = await run({ dataset: 'payments', metric: 'collected', period: { basis: 'payment_date', preset: 'last_month' } }, finance(ACME));
  const borealisMoney = await run({ dataset: 'payments', metric: 'collected', period: { basis: 'payment_date', preset: 'last_month' } }, finance(BOREALIS));
  assert.equal(acmeMoney.data.answer.groups[0].currency, 'GBP');
  assert.equal(borealisMoney.data.answer.groups[0].currency, 'USD');
  assert.notEqual(value(acmeMoney), value(borealisMoney));
});

test('money follows the application rules, and matches SQL-computed truth', async () => {
  const finance = (tenant) => contextFor(tenant, { financeScopes: ['rental_payments'] });
  const mark = since();
  const collected = await run({ dataset: 'payments', metric: 'collected', period: { basis: 'payment_date', preset: 'last_month' } }, finance(ACME));
  const truth = await db.query(`
    select coalesce(sum(greatest(amount - coalesce(refund_amount,0), 0)),0)::numeric(12,2) as total
    from payments where tenant_id=$1 and status in ('Applied','Credit','Partial','Completed','Partial Refund')
      and (capture_status is null or capture_status <> 'requires_capture')
      and payment_date between '2026-08-01' and '2026-08-31'`, [ACME]);
  assert.equal(value(collected), String(truth.rows[0].total));
  assert.equal(value(collected), '155.50');
  assertScoped(mark, ACME, 'collected payments');

  const revenue = await run({ dataset: 'profit_and_loss', metric: 'operating_revenue', period: { basis: 'entry_date', preset: 'last_month' } }, finance(ACME));
  const revenueTruth = await db.query(`select coalesce(sum(amount),0)::numeric(12,2) as total from pnl_entries
    where tenant_id=$1 and side='Revenue' and category not in ('Tax','Extension Tax','Security Deposit') and entry_date between '2026-08-01' and '2026-08-31'`, [ACME]);
  assert.equal(value(revenue), String(revenueTruth.rows[0].total));
  assert.equal(value(revenue), '400.00');

  const cost = await run({ dataset: 'profit_and_loss', metric: 'operating_cost', period: { basis: 'entry_date', preset: 'last_month' } }, finance(ACME));
  assert.equal(value(cost), '150.00', 'the vehicle purchase is capital, not operating cost');
});

test('a total past one PostgREST window still counts the whole set', async () => {
  const mark = since();
  const result = await run({ dataset: 'payments', metric: 'collected', period: { basis: 'payment_date', preset: 'last_month' } }, contextFor(BOREALIS, { financeScopes: ['rental_payments'] }));
  const truth = await db.query(`select coalesce(sum(greatest(amount - coalesce(refund_amount,0),0)),0)::numeric(12,2) as total, count(*)::int as n
    from payments where tenant_id=$1 and status in ('Applied','Credit','Partial','Completed','Partial Refund')
      and (capture_status is null or capture_status <> 'requires_capture') and payment_date between '2026-08-01' and '2026-08-31'`, [BOREALIS]);
  assert.equal(truth.rows[0].n, 1501, 'the fixture should hold more rows than one page');
  assert.equal(value(result), String(truth.rows[0].total));
  assert.equal(result.status, 'verified');
  assert.equal(result.data.answer.rowsRead, 1501);
  const pages = statements.slice(mark).filter((s) => / limit /.test(s.sql));
  assert.ok(pages.length >= 2, 'the set should have been read in pages');
  assertScoped(mark, BOREALIS, 'paged collection total');
});

test('the catalog a caller is shown matches what they may actually read', async () => {
  const plain = BUSINESS_TOOLS.discover_business_data({}, acme());
  assert.deepEqual(plain.data.datasets.map((d) => d.dataset), ['vehicles', 'rentals', 'customers']);
  const withFinance = BUSINESS_TOOLS.discover_business_data({}, contextFor(ACME, { financeScopes: ['rental_payments'] }));
  assert.ok(withFinance.data.datasets.some((d) => d.dataset === 'payments'));
});

test.after(async () => {
  await writeFile(resolve(out, 'isolation-statements.json'), JSON.stringify({
    statements: statements.length,
    everyStatementScoped: statements.every((s) => /tenant_id::text = \$1/.test(s.sql)),
    tenants: [...new Set(statements.map((s) => s.params[0]))],
    sample: statements.slice(0, 3),
  }, null, 2));
  await db.close();
});
