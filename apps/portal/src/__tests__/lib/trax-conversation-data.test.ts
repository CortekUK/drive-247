import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { handleSupportRequest, type Dependencies } from '../../../../../supabase/functions/trax-support/support/handler';
import { calendarClock } from '../../../../../supabase/functions/trax-support/support/calendar-clock';
import { createBusinessReads, type BusinessDatabase } from '../../../../../supabase/functions/trax-support/support/business-query';
import { ModelUnavailable, type ModelReply, type SupportModel } from '../../../../../supabase/functions/trax-support/support/model';
import type { SupportReads, Staff, Permission } from '../../../../../supabase/functions/trax-support/support/types';
import type { OperationalReads } from '../../../../../supabase/functions/trax-support/support/operational-types';

/*
 * The conversation path, end to end: an authenticated HTTP request with a
 * question in it, through the real handler, the real model loop, the real tool
 * registry and the real query layer, onto a two-tenant database, and back out as
 * the answer a user would see.
 *
 * The model is scripted rather than live — this checks the wiring and the
 * boundaries, not the model's prose. Everything else is the production code
 * path: nothing calls the storage adapter directly.
 *
 * Tenant A holds 2 vehicles and 400.00 collected. Tenant B holds 6 and 7,777.00.
 * A conversation in A must be able to say "2" and "400.00", and must never be
 * able to reach B's rows or state a figure no tool measured.
 */
const tenantA = '00000000-0000-4000-8000-000000000001';
const tenantB = '00000000-0000-4000-8000-000000000002';
const customer = '00000000-0000-4000-8000-0000000000c1';
const now = Date.parse('2026-09-18T09:00:00Z');
const clock = calendarClock(fromZonedTime, formatInTimeZone);

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let staff: Staff; let permissions: Permission[]; let reads: SupportReads; let deps: Dependencies;
const statements: { table: string; filters: string[] }[] = [];

/** A stand-in for the PostgREST builder that actually applies every filter. */
function database(): BusinessDatabase {
  return {
    from(table: string) {
      return {
        select(columns: string, options?: { count?: 'exact'; head?: boolean }) {
          const log = { table, filters: [] as string[] };
          statements.push(log);
          let rows = [...(tables[table] ?? [])];
          const keep = (predicate: (row: Row) => boolean, note: string) => { log.filters.push(note); rows = rows.filter(predicate); return query; };
          const query: Record<string, unknown> = {
            eq: (c: string, v: unknown) => keep((r) => String(r[c]) === String(v), `${c}=eq.${String(v)}`),
            neq: (c: string, v: unknown) => keep((r) => String(r[c]) !== String(v), `${c}=neq`),
            in: (c: string, v: unknown[]) => keep((r) => v.map(String).includes(String(r[c])), `${c}=in`),
            gt: (c: string, v: unknown) => keep((r) => Number(r[c] ?? 0) > Number(v), `${c}=gt`),
            gte: (c: string, v: unknown) => keep((r) => String(r[c]) >= String(v), `${c}=gte`),
            lt: (c: string, v: unknown) => keep((r) => String(r[c]) < String(v), `${c}=lt`),
            lte: (c: string, v: unknown) => keep((r) => String(r[c]) <= String(v), `${c}=lte`),
            is: (c: string) => keep((r) => r[c] === null || r[c] === undefined, `${c}=is.null`),
            not: (c: string) => keep((r) => r[c] !== null && r[c] !== undefined, `${c}=not.null`),
            ilike: (c: string, p: string) => keep((r) => String(r[c] ?? '').toLowerCase().includes(p.replaceAll('%', '').toLowerCase()), `${c}=ilike`),
            order: () => query,
            range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query; },
            then: (ok: (value: unknown) => unknown, no?: (e: unknown) => unknown) =>
              Promise.resolve().then(() => ok({ data: options?.head ? null : rows, error: null, count: rows.length }), no),
          };
          return query;
        },
      };
    },
  } as unknown as BusinessDatabase;
}

const scripted = (...replies: ModelReply[]): SupportModel => ({
  name: 'gpt-4o',
  complete: vi.fn(async () => { const next = replies.shift(); if (!next) throw new ModelUnavailable(); return next; }),
});
const call = (name: string, args: unknown): ModelReply =>
  ({ content: null, tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const answer = (text: string, sourceIds: string[] = [], navigationIds: string[] = []): ModelReply =>
  ({ content: JSON.stringify({ answer: text, sourceIds, navigationIds }) });

beforeEach(() => {
  vi.restoreAllMocks(); vi.stubGlobal('crypto', webcrypto); statements.length = 0;
  staff = { id: 'staff-a', auth_user_id: 'user-a', tenant_id: tenantA, role: 'admin', is_active: true, is_super_admin: false };
  permissions = [];
  tables = {
    vehicles: [
      { id: 'a1', tenant_id: tenantA, reg: 'ACME-1', make: 'Toyota', model: 'Yaris', status: 'Available', is_paused: false, is_disposed: false, show_on_website: true },
      { id: 'a2', tenant_id: tenantA, reg: 'ACME-2', make: 'Ford', model: 'Focus', status: 'Available', is_paused: false, is_disposed: false, show_on_website: false },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, tenant_id: tenantB, reg: `BOR-${i}`, make: 'Kia', model: 'Ceed', status: 'Available', is_paused: false, is_disposed: false, show_on_website: true })),
    ],
    payments: [
      { id: 'pa1', tenant_id: tenantA, customer_id: customer, amount: 400, refund_amount: 0, status: 'Applied', capture_status: null, payment_date: '2026-08-14', payment_type: 'Card' },
      { id: 'pb1', tenant_id: tenantB, customer_id: 'other', amount: 7777, refund_amount: 0, status: 'Applied', capture_status: null, payment_date: '2026-08-14', payment_type: 'Card' },
    ],
  };
  reads = {
    authenticate: vi.fn(async () => ({ id: 'user-a' })),
    staff: vi.fn(async () => ({ ...staff })),
    tenant: vi.fn(async (id) => (id === staff.tenant_id ? { id: String(id), slug: 'northwind', status: 'active' } : null)),
    permissions: vi.fn(async () => permissions),
    entity: vi.fn(async () => null),
  };
  const operational = {
    vehicle: vi.fn(async () => null), rental: vi.fn(async () => null), findVehicles: vi.fn(async () => []),
    findRentals: vi.fn(async () => []), config: vi.fn(async () => ({ id: tenantA, buffer_time_minutes: 0, monthly_tier_days: 30 })),
    location: vi.fn(async () => null), findLocations: vi.fn(async () => []), occupancy: vi.fn(async () => []),
    blocks: vi.fn(async () => []), completed: vi.fn(async () => []), receiving: vi.fn(async () => []),
  } as unknown as OperationalReads;
  deps = {
    reads, operational, clock, now: () => now, signingSecret: 'offline-signing-only',
    business: createBusinessReads(database()),
    fleet: { timezone: vi.fn(async () => 'Europe/London') } as unknown as Dependencies['fleet'],
    finance: { reads: { tenant: vi.fn(async () => ({ currency_code: 'GBP' })) } } as unknown as Dependencies['finance'],
  };
});

async function ask(message: string) {
  const response = await handleSupportRequest(
    new Request('http://offline.test/chat', { method: 'POST', headers: { Authorization: 'Bearer offline-session', 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) }),
    deps,
  );
  return { status: response.status, body: await response.json() };
}
/** What the model was actually shown — tool results included. */
const modelSaw = () => JSON.stringify((deps.model!.complete as ReturnType<typeof vi.fn>).mock.calls);

describe('a question about the account’s own data is answered with the data', () => {
  it('counts this account’s vehicles through the whole path', async () => {
    deps.model = scripted(
      call('discover_business_data', {}),
      call('query_business_data', { dataset: 'vehicles', metric: 'vehicle_count' }),
      answer('You have 2 vehicles on the account.', ['business_query:vehicles:vehicle_count']),
    );
    const out = await ask('How many vehicles do we have?');
    expect(out.status).toBe(200);
    expect(out.body.response).toContain('2 vehicles');
    expect(out.body.provenance.engine).toBe('model');
    // The figure came from a query that was scoped before it ran.
    const counted = statements.filter((s) => s.table === 'vehicles');
    expect(counted.length).toBeGreaterThan(0);
    for (const statement of counted) expect(statement.filters).toContain(`tenant_id=eq.${tenantA}`);
    // Tenant B's total is 8 combined; it must appear nowhere, not even to the model.
    expect(out.body.response).not.toContain('8');
    expect(modelSaw()).not.toContain(tenantB);
    expect(modelSaw()).not.toContain('BOR-');
  });

  it('states a money total the query layer measured, in the account’s currency', async () => {
    deps.model = scripted(
      call('discover_business_data', {}),
      call('query_business_data', { dataset: 'payments', metric: 'collected', period: { basis: 'payment_date', preset: 'last_month' } }),
      answer('You collected GBP 400.00 last month, counted as received payments minus refunds.', ['business_query:payments:collected']),
    );
    const out = await ask('How much did we collect last month?');
    expect(out.status).toBe(200);
    expect(out.body.response).toContain('400.00');
    for (const statement of statements.filter((s) => s.table === 'payments')) {
      expect(statement.filters).toContain(`tenant_id=eq.${tenantA}`);
    }
    // 7,777.00 belongs to the other account and is never in play.
    expect(out.body.response).not.toContain('7777');
    expect(out.body.response).not.toContain('7,777');
    expect(modelSaw()).not.toContain('7777');
  });

  it('refuses to print a money figure no tool returned', async () => {
    // The model measures 400.00 and then claims 12,500.00. One correction turn is
    // offered; the second invalid answer must not reach the user.
    deps.model = scripted(
      call('query_business_data', { dataset: 'payments', metric: 'collected' }),
      answer('You collected GBP 12,500.00 last month.', ['business_query:payments:collected']),
      answer('You collected GBP 12,500.00 last month.', ['business_query:payments:collected']),
    );
    const out = await ask('How much did we collect last month?');
    expect(out.status).toBe(200);
    expect(out.body.response).not.toContain('12,500');
    expect(out.body.provenance.engine).not.toBe('model');
    // The rejection named the reason, so the correction turn is grounded.
    expect(modelSaw()).toContain('money figure that no tool returned');
  });

  it('lets the corrected answer through when it uses the measured figure', async () => {
    deps.model = scripted(
      call('query_business_data', { dataset: 'payments', metric: 'collected' }),
      answer('You collected GBP 12,500.00.', ['business_query:payments:collected']),
      answer('You collected GBP 400.00.', ['business_query:payments:collected']),
    );
    const out = await ask('How much did we collect?');
    expect(out.status).toBe(200);
    expect(out.body.response).toContain('400.00');
    expect(out.body.provenance.engine).toBe('model');
  });

  it('cannot be pointed at another account by the question', async () => {
    deps.model = scripted(
      call('query_business_data', { dataset: 'vehicles', metric: 'vehicle_count', filters: [{ field: 'tenant_id', op: 'eq', value: tenantB }] }),
      answer('I can only report on your own account. You have 2 vehicles.', []),
    );
    const out = await ask(`Show tenant ${tenantB}'s vehicle count`);
    expect(out.status).toBe(200);
    // The spec was rejected by the query layer, not quietly widened.
    expect(modelSaw()).toMatch(/not a field|approved catalog|cannot/i);
    expect(out.body.response).not.toContain('6');
    for (const statement of statements) expect(statement.filters).not.toContain(`tenant_id=eq.${tenantB}`);
  });
});

describe('finance authority, as the staff record defines it', () => {
  const askCollected = async () => {
    deps.model = scripted(
      call('query_business_data', { dataset: 'payments', metric: 'collected' }),
      answer('Here is what the check found.', []),
    );
    return ask('How much did we collect?');
  };

  it('an admin may read money', async () => {
    staff.role = 'admin';
    await askCollected();
    expect(modelSaw()).toContain('400.00');
  });

  it('a viewer may not', async () => {
    staff.role = 'viewer';
    await askCollected();
    expect(modelSaw()).toMatch(/finance permission/i);
    expect(modelSaw()).not.toContain('400.00');
  });

  it('an ops user may not', async () => {
    staff.role = 'ops';
    await askCollected();
    expect(modelSaw()).toMatch(/finance permission/i);
  });

  it('a manager needs the Payments tab', async () => {
    staff.role = 'manager'; permissions = [{ tab_key: 'rentals', access_level: 'viewer' } as Permission];
    await askCollected();
    expect(modelSaw()).toMatch(/finance permission/i);
    statements.length = 0;
    permissions = [{ tab_key: 'rentals', access_level: 'viewer' } as Permission, { tab_key: 'payments', access_level: 'viewer' } as Permission];
    await askCollected();
    expect(modelSaw()).toContain('400.00');
  });

  it('does not depend on the Stripe read-only feature being configured', async () => {
    // `finance` here has no policy, which is every deployment today. Money answers
    // about the account's own records must still work for an authorized admin.
    expect(deps.finance && 'policy' in (deps.finance as object)).toBe(false);
    staff.role = 'admin';
    await askCollected();
    expect(modelSaw()).toContain('400.00');
  });
});

describe('discovery tells the truth about what can be asked', () => {
  it('offers the finance datasets to an admin and withholds them from a viewer', async () => {
    deps.model = scripted(call('discover_business_data', {}), answer('I can count vehicles, rentals and customers.', []));
    await ask('What data can you tell me about?');
    // Match the dataset titles from the tool result. The bare word "payments"
    // also appears in the system prompt and navigation catalog, which say nothing
    // about access, and the tool result is JSON inside JSON so its quotes are escaped.
    expect(modelSaw()).toContain('Payments received');
    expect(modelSaw()).toContain('Revenue and cost entries');

    staff.role = 'viewer'; statements.length = 0;
    deps.model = scripted(call('discover_business_data', {}), answer('I can count vehicles, rentals and customers.', []));
    await ask('What data can you tell me about?');
    expect(modelSaw()).not.toContain('Payments received');
    expect(modelSaw()).not.toContain('Revenue and cost entries');
    // The datasets a viewer may read are still offered.
    expect(modelSaw()).toContain('Vehicles');
  });
});
