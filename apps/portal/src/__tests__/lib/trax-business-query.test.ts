import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { calendarClock } from '../../../../../supabase/functions/trax-support/support/calendar-clock';
import {
  createBusinessReads, parseSpec, parseListSpec, resolvePreset, runBusinessQuery, runBusinessList, toMinorUnits, fromMinorUnits,
  type BusinessContext, type BusinessDatabase,
} from '../../../../../supabase/functions/trax-support/support/business-query';
import { BUSINESS_TOOLS } from '../../../../../supabase/functions/trax-support/support/business-tools';
import { BUSINESS_CATALOG } from '../../../../../supabase/functions/trax-support/support/business-catalog';
import type { SupportContext } from '../../../../../supabase/functions/trax-support/support/types';

/*
 * The business query layer, over an in-memory database that applies the same
 * filters PostgREST would. Nothing here is a live account.
 */
const tenant = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const clock = calendarClock(fromZonedTime, formatInTimeZone);
const now = Date.parse('2026-09-18T09:00:00Z');

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let reads: ReturnType<typeof createBusinessReads>;
const queries: { table: string; filters: string[]; head: boolean; columns: string }[] = [];

/** A minimal stand-in for the PostgREST builder: every filter is actually applied. */
function database(): BusinessDatabase {
  return {
    from(table: string) {
      return {
        select(columns: string, options?: { count?: 'exact'; head?: boolean }) {
          const log = { table, filters: [] as string[], head: !!options?.head, columns };
          queries.push(log);
          let rows = [...(tables[table] ?? [])];
          const keep = (predicate: (row: Row) => boolean, note: string) => { log.filters.push(note); rows = rows.filter(predicate); return query; };
          const query: any = {
            eq: (c: string, v: unknown) => keep((r) => String(r[c]) === String(v), `${c}=eq.${String(v)}`),
            neq: (c: string, v: unknown) => keep((r) => String(r[c]) !== String(v), `${c}=neq.${String(v)}`),
            in: (c: string, v: unknown[]) => keep((r) => v.map(String).includes(String(r[c])), `${c}=in.(${v.join(',')})`),
            gt: (c: string, v: unknown) => keep((r) => Number(r[c] ?? 0) > Number(v), `${c}=gt.${String(v)}`),
            gte: (c: string, v: unknown) => keep((r) => String(r[c]) >= String(v), `${c}=gte.${String(v)}`),
            lt: (c: string, v: unknown) => keep((r) => String(r[c]) < String(v), `${c}=lt.${String(v)}`),
            lte: (c: string, v: unknown) => keep((r) => String(r[c]) <= String(v), `${c}=lte.${String(v)}`),
            is: (c: string) => keep((r) => r[c] === null || r[c] === undefined, `${c}=is.null`),
            not: (c: string) => keep((r) => r[c] !== null && r[c] !== undefined, `${c}=not.is.null`),
            ilike: (c: string, p: string) => keep((r) => String(r[c] ?? '').toLowerCase().includes(p.replaceAll('%', '').toLowerCase()), `${c}=ilike.${p}`),
            order: () => query,
            limit: (n: number) => { rows = rows.slice(0, n); return query; },
            range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query; },
            then: (ok: (value: unknown) => unknown, no?: (e: unknown) => unknown) =>
              Promise.resolve({ data: options?.head ? null : rows, error: null, count: (tables[table] ?? []).length && rows ? undefined : undefined }).then(() => ok({ data: options?.head ? null : rows, error: null, count: countOf(table, log) }), no),
          };
          return query;
        },
      };
    },
  };
}
/** The count PostgREST reports is the filtered total, before any range. */
function countOf(table: string, log: { filters: string[] }) {
  let rows = [...(tables[table] ?? [])];
  for (const filter of log.filters) {
    const [column, rest] = filter.split('=');
    const [op, raw] = [rest.slice(0, rest.indexOf('.')), rest.slice(rest.indexOf('.') + 1)];
    rows = rows.filter((row) => {
      const value = row[column];
      if (op === 'eq') return String(value) === raw;
      if (op === 'neq') return String(value) !== raw;
      if (op === 'in') return raw.replace(/[()]/g, '').split(',').includes(String(value));
      if (op === 'gt') return Number(value ?? 0) > Number(raw);
      if (op === 'gte') return String(value) >= raw;
      if (op === 'lt') return String(value) < raw;
      if (op === 'lte') return String(value) <= raw;
      if (op === 'is') return value === null || value === undefined;
      if (op === 'not') return value !== null && value !== undefined;
      if (op === 'ilike') return String(value ?? '').toLowerCase().includes(raw.replaceAll('%', '').toLowerCase());
      return true;
    });
  }
  return rows.length;
}

const auth = (over: Partial<SupportContext> = {}): SupportContext => ({
  userId: 'user', staffId: 'staff', tenant: { id: tenant, slug: 'northwind', status: 'active' } as never,
  role: 'admin', superAdmin: false, permissions: [], scope: 'scope', ...over,
} as SupportContext);
const context = (over: Partial<BusinessContext> = {}): BusinessContext => ({
  auth: auth(), business: reads, clock, now, timezone: async () => 'Europe/London', ...over,
});
const answerOf = (result: Awaited<ReturnType<typeof runBusinessQuery>>) => result.data!.answer as { groups: { key: string; label: string; value: string; currency?: string | null; rows: number }[]; complete: boolean; period?: { from: string; to: string; timezone: string } | null; definition: string };

beforeEach(() => {
  queries.length = 0;
  tables = {
    vehicles: [
      { id: 'v1', tenant_id: tenant, reg: 'NWD-1', make: 'Toyota', model: 'Yaris', status: 'Available', is_paused: false, is_disposed: false, show_on_website: true },
      { id: 'v2', tenant_id: tenant, reg: 'NWD-2', make: 'Toyota', model: 'Corolla', status: 'Available', is_paused: true, is_disposed: false, show_on_website: false },
      { id: 'v3', tenant_id: tenant, reg: 'NWD-3', make: 'Ford', model: 'Focus', status: 'Maintenance', is_paused: false, is_disposed: true, show_on_website: false },
      { id: 'v9', tenant_id: other, reg: 'OTH-9', make: 'Ford', model: 'Focus', status: 'Available', is_paused: false, is_disposed: false, show_on_website: true },
    ],
    rentals: [
      { id: 'r1', tenant_id: tenant, vehicle_id: 'v1', rental_number: 'R-1', status: 'Active', start_date: '2026-08-04', end_date: '2026-08-09', is_pay_as_you_go: false },
      { id: 'r2', tenant_id: tenant, vehicle_id: 'v2', rental_number: 'R-2', status: 'Completed', start_date: '2026-08-20', end_date: '2026-08-26', is_pay_as_you_go: false },
      { id: 'r3', tenant_id: tenant, vehicle_id: 'v1', rental_number: 'R-3', status: 'Started', start_date: '2026-09-02', end_date: '2026-09-12', is_pay_as_you_go: true },
      { id: 'r9', tenant_id: other, vehicle_id: 'v9', rental_number: 'R-9', status: 'Active', start_date: '2026-08-05', end_date: '2026-08-08', is_pay_as_you_go: false },
    ],
  };
  reads = createBusinessReads(database());
});

describe('what the model may ask for', () => {
  it('refuses anything the catalog does not define — dataset, metric, field, comparison or value', () => {
    const cases: [unknown, RegExp][] = [
      [{ dataset: 'app_users', metric: 'count' }, /approved catalog/],
      [{ dataset: 'vehicles', metric: 'revenue' }, /not a metric/],
      [{ dataset: 'vehicles', metric: 'vehicle_count', filters: [{ field: 'notes', op: 'eq', value: 'x' }] }, /not a field/],
      [{ dataset: 'rentals', metric: 'rental_count', filters: [{ field: 'status', op: 'eq', value: 'Deleted' }] }, /accepts/],
      [{ dataset: 'rentals', metric: 'rental_count', filters: [{ field: 'status', op: 'gt', value: 'Active' }] }, /cannot use gt/],
      [{ dataset: 'rentals', metric: 'rental_count', groupBy: 'rental_number' }, /cannot be grouped/],
      [{ dataset: 'rentals', metric: 'rental_count', period: { basis: 'invoice_date', preset: 'last_month' } }, /date basis/],
      [{ dataset: 'rentals', metric: 'rental_count', period: { basis: 'start_date' } }, /preset, or both/],
      [{ dataset: 'rentals', metric: 'rental_count', limit: 500 }, /one hundred/],
      [{ dataset: 'vehicles', metric: 'vehicle_count', sql: 'select 1' }, /not available|unsupported|invalid/i],
    ];
    for (const [input, message] of cases) expect(() => parseSpec(input), JSON.stringify(input)).toThrow(message);
  });

  it('accepts a catalog-shaped request and keeps exactly what was asked', () => {
    const spec = parseSpec({ dataset: 'rentals', metric: 'rental_count', filters: [{ field: 'status', op: 'in', value: ['Active', 'Started'] }], period: { basis: 'start_date', preset: 'last_month' }, groupBy: 'status', sort: { by: 'metric', direction: 'desc' }, limit: 5 });
    expect(spec.dataset).toBe('rentals');
    expect(spec.metric).toBe('rental_count');
    expect(spec.filters).toEqual([{ field: 'status', op: 'in', value: ['Active', 'Started'] }]);
    expect(spec.period).toMatchObject({ basis: 'start_date', preset: 'last_month' });
    expect([spec.groupBy, spec.limit, spec.sort]).toEqual(['status', 5, { by: 'metric', direction: 'desc' }]);
  });

  it('tells the caller only what their role may read', () => {
    // Without the finance grant an admin sees the operational datasets only —
    // every dataset that does not exist to describe money.
    const all = BUSINESS_TOOLS.discover_business_data({}, context()) as unknown as { status: string; data: { datasets: { dataset: string; metrics: { metric: string }[] }[] } };
    expect(all.data.datasets.map((d) => d.dataset)).toEqual([
      'vehicles', 'rentals', 'customers', 'rental_extensions', 'deposits', 'maintenance', 'verifications',
    ]);
    // Inside an operational dataset, the money metrics are withheld but the counts are not.
    const extensions = all.data.datasets.find((d) => d.dataset === 'rental_extensions')!;
    expect(extensions.metrics.map((m) => m.metric)).toEqual(['extension_count', 'extension_days']);
    const deposits = all.data.datasets.find((d) => d.dataset === 'deposits')!;
    expect(deposits.metrics.map((m) => m.metric)).toEqual(['attempt_count']);
    const withFinance = BUSINESS_TOOLS.discover_business_data({}, context({ financeScopes: ['rental_payments'] })) as unknown as { status: string; data: { datasets: { dataset: string; metrics: { metric: string }[] }[] } };
    expect(withFinance.data.datasets.map((d) => d.dataset)).toEqual(BUSINESS_CATALOG.datasets.map((d) => d.name));
    const paidExtensions = withFinance.data.datasets.find((d) => d.dataset === 'rental_extensions')!;
    expect(paidExtensions.metrics.map((m) => m.metric)).toContain('extension_value');
    const manager = context({ auth: auth({ role: 'manager', permissions: [{ tab_key: 'rentals', access_level: 'viewer' }] as never }) });
    const some = BUSINESS_TOOLS.discover_business_data({}, manager) as unknown as { status: string; data: { datasets: { dataset: string; metrics: { metric: string }[] }[] } };
    // Rentals reach vehicles, so a rentals-only manager cannot use the rentals dataset
    // itself. Extensions and deposit attempts are rentals data that link to nothing
    // else, so they are readable — without their money metrics.
    expect(some.data.datasets.map((d) => d.dataset)).toEqual(['rental_extensions', 'deposits']);
    for (const dataset of some.data.datasets) {
      expect(dataset.metrics.every((m) => /count|days/.test(m.metric))).toBe(true);
    }
    expect(some.status).toBe('verified');
  });
});

describe('answers measured in the backend', () => {
  it('counts with the database’s own exact count, for this tenant only', async () => {
    const result = await runBusinessQuery(parseSpec({ dataset: 'vehicles', metric: 'vehicle_count' }), context());
    expect(answerOf(result).groups[0].value).toBe('3');
    expect(result.status).toBe('verified');
    // A head count: no rows were read to produce it, and the tenant was applied.
    expect(queries[0].head).toBe(true);
    expect(queries[0].filters).toContain(`tenant_id=eq.${tenant}`);
  });

  it('applies filters as asked, and never another account’s rows', async () => {
    const result = await runBusinessQuery(parseSpec({ dataset: 'vehicles', metric: 'vehicle_count', filters: [{ field: 'disposed', op: 'eq', value: false }, { field: 'paused', op: 'eq', value: false }] }), context());
    expect(answerOf(result).groups[0].value).toBe('1');
    const rentals = await runBusinessQuery(parseSpec({ dataset: 'rentals', metric: 'rental_count', filters: [{ field: 'status', op: 'in', value: ['Active', 'Started'] }] }), context());
    expect(answerOf(rentals).groups[0].value).toBe('2');
  });

  it('groups and ranks, and separates a group with no value from a zero', async () => {
    const result = await runBusinessQuery(parseSpec({ dataset: 'vehicles', metric: 'vehicle_count', groupBy: 'make', sort: { by: 'metric', direction: 'desc' } }), context());
    expect(answerOf(result).groups.map((g) => [g.label, g.value])).toEqual([['Toyota', '2'], ['Ford', '1']]);
    const ascending = await runBusinessQuery(parseSpec({ dataset: 'vehicles', metric: 'vehicle_count', groupBy: 'make', sort: { by: 'metric', direction: 'asc' } }), context());
    expect(answerOf(ascending).groups.map((g) => g.label)).toEqual(['Ford', 'Toyota']);
    const empty = await runBusinessQuery(parseSpec({ dataset: 'vehicles', metric: 'vehicle_count', filters: [{ field: 'make', op: 'eq', value: 'Tesla' }] }), context());
    expect(answerOf(empty).groups[0].value).toBe('0');
    expect(empty.findings.map((f) => f.code)).not.toContain('no_matching_records');
    const emptyGroups = await runBusinessQuery(parseSpec({ dataset: 'vehicles', metric: 'vehicle_count', filters: [{ field: 'make', op: 'eq', value: 'Tesla' }], groupBy: 'make' }), context());
    expect(emptyGroups.findings[0].code).toBe('no_matching_records');
    expect(emptyGroups.findings[0].summary).toMatch(/not a zero total/);
  });

  it('resolves a period in the tenant’s timezone, and refuses to guess one', async () => {
    const result = await runBusinessQuery(parseSpec({ dataset: 'rentals', metric: 'rental_count', period: { basis: 'start_date', preset: 'last_month' } }), context());
    const answer = answerOf(result);
    expect(answer.period).toEqual({ basis: 'start_date', from: '2026-08-01', to: '2026-08-31', timezone: 'Europe/London' });
    expect(answer.groups[0].value).toBe('2');
    await expect(runBusinessQuery(parseSpec({ dataset: 'rentals', metric: 'rental_count', period: { basis: 'start_date', preset: 'last_month' } }), context({ timezone: async () => null })))
      .rejects.toThrow(/timezone is not configured/);
  });

  it('carries the definition and the scope with every answer', async () => {
    const result = await runBusinessQuery(parseSpec({ dataset: 'rentals', metric: 'rental_count', period: { basis: 'start_date', from: '2026-08-01', to: '2026-08-31' } }), context());
    const scope = result.data!.scope as Record<string, unknown>;
    expect(String(scope.definition)).toMatch(/counted by the database/);
    expect(scope.period).toBe('2026-08-01 to 2026-08-31 (start_date, Europe/London)');
    expect(result.sources[0].table).toBe('business_query');
  });
});

describe('permissions and tenancy', () => {
  it('refuses a dataset the role cannot read, and one whose related entity it cannot read', async () => {
    const viewerWithoutVehicles = context({ auth: auth({ role: 'manager', permissions: [{ tab_key: 'rentals', access_level: 'viewer' }] as never }) });
    await expect(runBusinessQuery(parseSpec({ dataset: 'vehicles', metric: 'vehicle_count' }), viewerWithoutVehicles)).rejects.toThrow(/cannot read vehicles/i);
    await expect(runBusinessQuery(parseSpec({ dataset: 'rentals', metric: 'rental_count' }), viewerWithoutVehicles)).rejects.toThrow(/cannot read the vehicle/i);
  });

  it('never trusts a row from another account, even if the database returned one', async () => {
    tables.vehicles = tables.vehicles.map((row) => ({ ...row, tenant_id: tenant }));
    const leaking = { ...reads, page: async () => ({ rows: [{ id: 'v9', tenant_id: other, make: 'Ford' }], total: 1 }) };
    await expect(runBusinessQuery(parseSpec({ dataset: 'vehicles', metric: 'vehicle_count', groupBy: 'make' }), context({ business: leaking as never })))
      .rejects.toThrow(/outside this account/);
  });

  it('re-checks access before it reads', async () => {
    const reauthorize = vi.fn(async () => {});
    await runBusinessQuery(parseSpec({ dataset: 'vehicles', metric: 'vehicle_count' }), context({ reauthorize }));
    expect(reauthorize).toHaveBeenCalled();
  });
});

describe('money datasets', () => {
  const financeAuth = () => context({ financeScopes: ['rental_payments'], currency: async () => 'GBP' });
  beforeEach(() => {
    tables.payments = [
      // Collected: 100.00 and 55.50 (75.50 less a 20.00 refund).
      { id: 'p1', tenant_id: tenant, status: 'Applied', capture_status: 'captured', amount: '100.00', refund_amount: null, payment_date: '2026-08-10', customer_id: 'c1' },
      { id: 'p2', tenant_id: tenant, status: 'Partial Refund', capture_status: null, amount: '75.50', refund_amount: '20.00', payment_date: '2026-08-20', customer_id: 'c1' },
      // Not collected: an authorization awaiting capture, a reversed row, and another tenant's.
      { id: 'p3', tenant_id: tenant, status: 'Applied', capture_status: 'requires_capture', amount: '500.00', refund_amount: null, payment_date: '2026-08-21', customer_id: 'c2' },
      { id: 'p4', tenant_id: tenant, status: 'Reversed', capture_status: 'captured', amount: '900.00', refund_amount: null, payment_date: '2026-08-22', customer_id: 'c2' },
      { id: 'p5', tenant_id: tenant, status: 'Applied', capture_status: 'captured', amount: '40.00', refund_amount: null, payment_date: '2026-08-25', customer_id: 'c2' },
      { id: 'p9', tenant_id: other, status: 'Applied', capture_status: 'captured', amount: '777.00', refund_amount: null, payment_date: '2026-08-10', customer_id: 'c9' },
    ];
    tables.pnl_entries = [
      { id: 'e1', tenant_id: tenant, side: 'Revenue', category: 'Rental', amount: '400.00', entry_date: '2026-08-05', vehicle_id: 'v1' },
      { id: 'e2', tenant_id: tenant, side: 'Revenue', category: 'Tax', amount: '80.00', entry_date: '2026-08-05', vehicle_id: 'v1' },
      { id: 'e3', tenant_id: tenant, side: 'Revenue', category: 'Security Deposit', amount: '300.00', entry_date: '2026-08-06', vehicle_id: 'v2' },
      { id: 'e4', tenant_id: tenant, side: 'Cost', category: 'Acquisition', amount: '9000.00', entry_date: '2026-08-07', vehicle_id: 'v2' },
      { id: 'e5', tenant_id: tenant, side: 'Cost', category: 'Service', amount: '150.00', entry_date: '2026-08-08', vehicle_id: 'v1' },
      { id: 'e6', tenant_id: tenant, side: 'Revenue', category: 'Rental', amount: '250.00', entry_date: '2026-09-03', vehicle_id: 'v2' },
    ];
  });

  it('needs the finance grant, and says so plainly without it', async () => {
    await expect(runBusinessQuery(parseSpec({ dataset: 'payments', metric: 'collected' }), context())).rejects.toThrow(/finance permission/i);
    const visible = BUSINESS_TOOLS.discover_business_data({}, context()) as unknown as { status: string; data: { datasets: { dataset: string }[] } };
    expect(visible.data.datasets.map((d) => d.dataset)).not.toContain('payments');
    const granted = BUSINESS_TOOLS.discover_business_data({}, financeAuth()) as unknown as { status: string; data: { datasets: { dataset: string }[] } };
    expect(granted.data.datasets.map((d) => d.dataset)).toEqual(expect.arrayContaining(['payments', 'profit_and_loss']));
  });

  it('counts only money the application says arrived, net of refunds, in the account currency', async () => {
    const result = await runBusinessQuery(parseSpec({ dataset: 'payments', metric: 'collected', period: { basis: 'payment_date', preset: 'last_month' } }), financeAuth());
    const answer = answerOf(result);
    // 100.00 + (75.50 - 20.00) + 40.00, in one account currency.
    expect(answer.groups[0]).toMatchObject({ value: '195.50', currency: 'GBP' });
    // The uncaptured authorization and the reversed payment are absent, not zeroed.
    expect(answer.groups[0].rows).toBe(3);
    expect((result.data!.scope as { alwaysApplied: string[] }).alwaysApplied.join(' ')).toMatch(/awaiting capture/i);
  });

  it('measures sales by the corrected revenue model, not by every Revenue row', async () => {
    const revenue = await runBusinessQuery(parseSpec({ dataset: 'profit_and_loss', metric: 'operating_revenue', period: { basis: 'entry_date', preset: 'last_month' } }), financeAuth());
    // 400 Rental only: tax and the security deposit are collected for someone else.
    expect(answerOf(revenue).groups[0]).toMatchObject({ value: '400.00', currency: 'GBP' });
    const cost = await runBusinessQuery(parseSpec({ dataset: 'profit_and_loss', metric: 'operating_cost', period: { basis: 'entry_date', preset: 'last_month' } }), financeAuth());
    // 150 Service only: the 9,000 vehicle purchase is capital, not running cost.
    expect(answerOf(cost).groups[0].value).toBe('150.00');
    expect(String((cost.data!.scope as { definition: string }).definition)).toMatch(/Acquisition and Disposal/);
  });

  it('compares one period with another on the same definition', async () => {
    const august = await runBusinessQuery(parseSpec({ dataset: 'profit_and_loss', metric: 'operating_revenue', period: { basis: 'entry_date', from: '2026-08-01', to: '2026-08-31' } }), financeAuth());
    const september = await runBusinessQuery(parseSpec({ dataset: 'profit_and_loss', metric: 'operating_revenue', period: { basis: 'entry_date', preset: 'this_month' } }), financeAuth());
    expect([answerOf(august).groups[0].value, answerOf(september).groups[0].value]).toEqual(['400.00', '250.00']);
  });

  it('ranks by a money metric per group', async () => {
    const ranked = await runBusinessQuery(parseSpec({ dataset: 'payments', metric: 'collected', groupBy: 'customer_id', sort: { by: 'metric', direction: 'desc' } }), financeAuth());
    expect(answerOf(ranked).groups.map((g) => [g.key, g.value])).toEqual([['c1', '155.50'], ['c2', '40.00']]);
    const top = await runBusinessQuery(parseSpec({ dataset: 'payments', metric: 'collected', groupBy: 'customer_id', sort: { by: 'metric', direction: 'desc' }, limit: 1 }), financeAuth());
    expect(answerOf(top).groups).toHaveLength(1);
    expect(answerOf(top).groups[0]).toMatchObject({ key: 'c1', value: '155.50' });
    expect(top.limitations.join(' ')).toMatch(/highest/);
  });
});

describe('money and completeness', () => {
  it('reads amounts exactly, in minor units', () => {
    expect(toMinorUnits('10.10')).toBe(1010);
    expect(toMinorUnits(0.1) + toMinorUnits(0.2)).toBe(toMinorUnits('0.30'));
    expect(fromMinorUnits(toMinorUnits('1234.56'))).toBe('1234.56');
    expect(fromMinorUnits(toMinorUnits('-7.005'))).toBe('-7.01');
    expect(() => toMinorUnits('abc')).toThrow(/could not be read exactly/);
  });

  it('resolves each period preset to whole days', () => {
    expect(resolvePreset('last_month', '2026-09-18')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(resolvePreset('this_month', '2026-09-18')).toEqual({ from: '2026-09-01', to: '2026-09-18' });
    expect(resolvePreset('last_week', '2026-09-18')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(resolvePreset('last_7_days', '2026-09-18')).toEqual({ from: '2026-09-12', to: '2026-09-18' });
    expect(resolvePreset('last_year', '2026-09-18')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('says a capped result is partial instead of presenting a short total', async () => {
    const dataset = BUSINESS_CATALOG.datasets.find((d) => d.name === 'vehicles')!;
    const cap = Object.getOwnPropertyDescriptor(dataset, 'rowCap');
    Object.defineProperty(dataset, 'rowCap', { ...cap, value: 2 });
    try {
      tables.vehicles = Array.from({ length: 2500 }, (_, i) => ({ id: `v${i}`, tenant_id: tenant, make: 'Toyota', reg: `R${i}`, is_paused: false, is_disposed: false }));
      const result = await runBusinessQuery(parseSpec({ dataset: 'vehicles', metric: 'vehicle_count', groupBy: 'make' }), context());
      expect(result.status).toBe('partial');
      expect(result.limitations.join(' ')).toMatch(/partial/);
      expect(answerOf(result).complete).toBe(false);
    } finally {
      Object.defineProperty(dataset, 'rowCap', cap!);
    }
  });
});

/*
 * Grouped answers name the record.
 *
 * A group's label was the raw column value, so "which car earned what" answered
 * with uuids — technically correct and unusable. These pin the name, pin that the
 * id survives as the key a follow-up addresses, and pin that naming never reaches
 * outside the account.
 */
describe('grouped answers use names, not ids', () => {
  it('names the vehicle instead of printing its id', async () => {
    const result = await runBusinessQuery(parseSpec({ dataset: 'rentals', metric: 'rental_count', groupBy: 'vehicle_id' }), context());
    const groups = answerOf(result).groups;
    expect(groups.map((g) => g.label)).toEqual(['NWD-1 Toyota Yaris', 'NWD-2 Toyota Corolla']);
    // The id stays as the key: it is how a follow-up addresses the record.
    expect(groups.map((g) => g.key)).toEqual(['v1', 'v2']);
  });

  it('never borrows a name from another account', async () => {
    const result = await runBusinessQuery(parseSpec({ dataset: 'rentals', metric: 'rental_count', groupBy: 'vehicle_id' }), context());
    expect(JSON.stringify(answerOf(result).groups)).not.toContain('OTH-9');
  });

  it('keeps the id when the record cannot be named, and leaves the measurement alone', async () => {
    tables.vehicles = [];   // the name lookup finds nothing
    const result = await runBusinessQuery(parseSpec({ dataset: 'rentals', metric: 'rental_count', groupBy: 'vehicle_id' }), context());
    const groups = answerOf(result).groups;
    expect(groups.map((g) => g.label)).toEqual(['v1', 'v2']);
    expect(groups.map((g) => g.value)).toEqual(['2', '1']);
  });
});

/*
 * Listing the records themselves.
 *
 * "How many rentals" and "which rentals, for whom, and when" are different
 * questions, and until now only the first could be answered. These pin the second:
 * real rows, names rather than ids, this account only, and an honest statement when
 * more matched than were shown.
 */
describe('listing records', () => {
  const listing = (result: Awaited<ReturnType<typeof runBusinessList>>) => result.data!.listing as {
    records: Record<string, string | null>[]; columns: { field: string; label: string }[]; matched: number; shown: number;
  };

  it('returns the rows with dates and resolved names', async () => {
    const result = await runBusinessList(parseListSpec({ dataset: 'rentals' }), context());
    const rows = listing(result).records;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ rental_number: 'R-1', status: 'Active', start_date: '2026-08-04', end_date: '2026-08-09', vehicle_id: 'NWD-1 Toyota Yaris' });
    expect(JSON.stringify(rows)).not.toContain('OTH-9');
  });

  it('filters to what was asked for — cancelled, active, a date window', async () => {
    tables.rentals.push({ id: 'r4', tenant_id: tenant, vehicle_id: 'v2', rental_number: 'R-4', status: 'Cancelled', start_date: '2026-08-15', end_date: '2026-08-18', is_pay_as_you_go: false });
    const cancelled = await runBusinessList(parseListSpec({ dataset: 'rentals', filters: [{ field: 'status', op: 'eq', value: 'Cancelled' }] }), context());
    expect(listing(cancelled).records.map((r) => r.rental_number)).toEqual(['R-4']);
  });

  it('never returns another account’s records', async () => {
    const result = await runBusinessList(parseListSpec({ dataset: 'rentals' }), context());
    expect(listing(result).records.every((r) => r.rental_number !== 'R-9')).toBe(true);
  });

  it('says how many matched when it shows fewer', async () => {
    const result = await runBusinessList(parseListSpec({ dataset: 'rentals', limit: 1 }), context());
    expect(listing(result).shown).toBe(1);
    expect(listing(result).matched).toBe(3);
    expect(result.limitations.join(' ')).toMatch(/3 records match/);
  });

  it('refuses a dataset that has no reviewed listing, and names the ones that do', () => {
    expect(() => parseListSpec({ dataset: 'profit_and_loss' })).toThrow(/cannot be listed/);
    expect(() => parseListSpec({ dataset: 'rentals', limit: 500 })).toThrow(/between 1 and 25/);
  });
});

/*
 * The catalog must describe itself correctly.
 *
 * listFields was written by hand against remembered field names, and two of them
 * did not exist: `payment_date` is a date BASIS rather than a field, and `amount`
 * and customer `name` were not in the catalog at all. Nothing caught it, so the
 * listing compiled a select over columns the table did not expose and every
 * payments listing failed with "the live read failed" — a message that blames the
 * database for a typo in this file.
 */
describe('catalog integrity', () => {
  for (const dataset of BUSINESS_CATALOG.datasets.filter((d) => d.listFields?.length)) {
    it(`${dataset.name}: every listed field exists and is readable`, () => {
      for (const name of dataset.listFields!) {
        const field = dataset.fields.find((f) => f.name === name);
        expect(field, `${dataset.name}.listFields names "${name}", which is not a field of that dataset`).toBeDefined();
        // A listing selects this column by name, so it has to be a real column.
        expect(typeof field!.column).toBe('string');
        expect(field!.column.length).toBeGreaterThan(0);
      }
    });
  }

  it('every dataset a listing offers can actually be listed', () => {
    const listable = BUSINESS_CATALOG.datasets.filter((d) => d.listFields?.length).map((d) => d.name);
    expect(listable).toEqual(expect.arrayContaining(['rentals', 'vehicles', 'customers', 'payments']));
  });
});

describe('a period without a basis', () => {
  it('uses the dataset’s primary date and reports which one it used', async () => {
    const result = await runBusinessQuery(parseSpec({ dataset: 'rentals', metric: 'rental_count', period: { preset: 'last_month' } }), context());
    // Stated, not assumed: the answer carries the date it actually filtered on.
    expect(answerOf(result).period?.from).toBe('2026-08-01');
    expect((result.data!.answer as { period: { basis: string } }).period.basis).toBe('start_date');
  });

  it('still refuses a basis that was asked for and does not exist', () => {
    expect(() => parseSpec({ dataset: 'rentals', metric: 'rental_count', period: { basis: 'business', preset: 'last_month' } }))
      .toThrow(/has no "business" date basis. Use one of: start_date/);
  });
});
