/**
 * A rental's or a customer's own fines (`useScopedFinanceFines`, for
 * ScopedFinances): read IN FULL for the scope and the tenant, shaped exactly
 * as the fines tab's own hook shapes them — a parity test runs both hooks over
 * the same rows and compares every computed field.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  rows: [] as Row[],
  statements: [] as { table: string; filters: string[]; range: [number, number] | null }[],
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 't1', slug: 'northwind', timezone: 'America/New_York', currency_code: 'USD' } }),
}));

/** A PostgREST stand-in for `fines`: applies eq / in / lt / gte / lte, orders, pages at most 1,000 rows. */
vi.mock('@/integrations/supabase/client', () => {
  const client = {
    from(table: string) {
      const stmt = { table, filters: [] as string[], range: null as [number, number] | null };
      h.statements.push(stmt);
      let rows = [...h.rows];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (stmt.filters.push(`${c}=eq.${v}`), (rows = rows.filter((r) => String(r[c]) === String(v))), q),
        in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.map(String).includes(String(r[c])))), q),
        lt: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) < v)), q),
        gte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) >= v)), q),
        lte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) <= v)), q),
        order: (c: string, o?: { ascending?: boolean }) => {
          rows.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (o?.ascending === false ? -1 : 1));
          return q;
        },
        range: (from: number, to: number) => ((stmt.range = [from, to]), (rows = rows.slice(from, to + 1)), q),
        then: (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) =>
          Promise.resolve().then(() => ok({ data: rows.slice(0, 1000), error: null, count: rows.length }), no),
      };
      return q;
    },
  };
  return { supabase: client, supabaseUntyped: client };
});

import { useFinesData } from '@/hooks/use-fines-data';
import { enhanceScopedFines, useScopedFinanceFines } from '@/hooks/use-finances-fines';

const wrapper = ({ children }: { children?: any }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const fine = (id: string, over: Row = {}): Row => ({
  id,
  tenant_id: 't1',
  rental_id: 'r1',
  customer_id: 'c1',
  vehicle_id: 'v1',
  type: 'PCN',
  reference_no: `REF-${id}`,
  amount: 50,
  status: 'Open',
  issue_date: '2026-09-01',
  due_date: '2026-09-20',
  created_at: `2026-09-01T10:00:0${id.length % 10}Z`,
  customers: { name: 'Ada Okafor', email: 'ada@example.com', phone: '555' },
  vehicles: { reg: 'NW-01', make: 'Kia', model: 'Rio' },
  rentals: { rental_number: 'R-1' },
  authority_payments: [],
  ...over,
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-25T18:00:00Z') });
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  h.statements = [];
  h.rows = [
    fine('f1'),
    fine('f2', { status: 'Charged', due_date: '2026-10-10', authority_payments: [{ amount: 50 }] }),
    fine('f3', { status: 'Paid', due_date: '2026-09-01', authority_payments: [{ amount: 20 }] }),
    fine('f4', { rental_id: 'r2', customer_id: 'c1' }),
    fine('f5', { rental_id: 'r9', customer_id: 'c9' }),
    fine('f6', { tenant_id: 'OTHER', rental_id: 'r1', customer_id: 'c1' }),
  ];
});

describe('useScopedFinanceFines', () => {
  it('a rental scope reads that rental’s fines, in this tenant, and nothing else', async () => {
    const { result } = renderHook(() => useScopedFinanceFines({ rentalId: 'r1' }, '', null), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.fines.map((f) => f.id).sort()).toEqual(['f1', 'f2', 'f3']);
    expect(h.statements[0].filters).toEqual(['tenant_id=eq.t1', 'rental_id=eq.r1']);
    expect(h.statements[0].range).toEqual([0, 999]);
  });

  it('a customer scope reads that customer’s fines across rentals', async () => {
    const { result } = renderHook(() => useScopedFinanceFines({ customerId: 'c1' }, '', null), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.fines.map((f) => f.id).sort()).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(h.statements[0].filters).toEqual(['tenant_id=eq.t1', 'customer_id=eq.c1']);
  });

  it('reads every page: 1,001 fines are all there, not the first 1,000', async () => {
    h.rows = Array.from({ length: 1001 }, (_, i) => fine(`z${String(i).padStart(4, '0')}`));
    const { result } = renderHook(() => useScopedFinanceFines({ rentalId: 'r1' }, '', null), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.fines).toHaveLength(1001);
    expect(h.statements.map((s) => s.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('search and status narrow in memory, one read', async () => {
    const { result, rerender } = renderHook(({ q, s }: { q: string; s: string | null }) => useScopedFinanceFines({ rentalId: 'r1' }, q, s), {
      wrapper,
      initialProps: { q: '', s: null as string | null },
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ q: 'ref-f2', s: null });
    expect(result.current.data!.fines.map((f) => f.id)).toEqual(['f2']);
    rerender({ q: '', s: 'overdue' });
    expect(result.current.data!.fines.map((f) => f.id)).toEqual(['f1']);
    rerender({ q: '', s: 'Paid' });
    expect(result.current.data!.fines.map((f) => f.id)).toEqual(['f3']);
    expect(h.statements).toHaveLength(1);
  });
});

describe('parity with the fines tab’s own hook', () => {
  it('every computed field matches useFinesData on the same rows', async () => {
    h.rows = h.rows.filter((r) => r.tenant_id === 't1' && r.rental_id === 'r1');
    const tab = renderHook(
      () => useFinesData({ filters: { status: [], vehicleSearch: '', customerSearch: '' }, sortBy: 'created_at', sortOrder: 'desc', page: 1, pageSize: 1000 }),
      { wrapper },
    );
    const scoped = renderHook(() => useScopedFinanceFines({ rentalId: 'r1' }, '', null), { wrapper });
    await waitFor(() => expect(tab.result.current.data).toBeDefined());
    await waitFor(() => expect(scoped.result.current.data).toBeDefined());
    const pick = (f: any) => [f.id, f.isOverdue, f.daysUntilDue, f.hasAuthorityPayments, f.isAuthoritySettled];
    const a = tab.result.current.data!.fines.map(pick).sort();
    const b = scoped.result.current.data!.fines.map(pick).sort();
    expect(b).toEqual(a);
    // And by hand: f1 is overdue (Open, due 20 Sep); f2 is Charged and settled at the authority; f3 is paid.
    expect(b).toEqual([
      ['f1', true, -5, false, false],
      ['f2', false, 15, true, true],
      ['f3', false, -24, true, false],
    ]);
  });

  it('newest added first, as the fines tab sorts its list', () => {
    const out = enhanceScopedFines([fine('a', { created_at: '2026-09-01T00:00:00Z' }), fine('b', { created_at: '2026-09-03T00:00:00Z' })] as any, new Date('2026-09-25T18:00:00Z'));
    expect(out.map((f) => f.id)).toEqual(['b', 'a']);
  });
});
