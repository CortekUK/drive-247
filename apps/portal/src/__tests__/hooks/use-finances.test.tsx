/**
 * useFinances: the gate, the reads, and the error rule.
 *
 * The Supabase client is replaced by a fake that APPLIES every filter and, like
 * PostgREST, never returns more than 1,000 rows per request — so a read that
 * forgot to page would be silently truncated here exactly as in production.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V2Provider } from '@/lib/v2-context';

type Row = Record<string, any>;
interface Stmt {
  table: string;
  columns: string;
  filters: string[];
  range: [number, number] | null;
}

const h = vi.hoisted(() => ({
  tenant: { id: 't1', slug: 'northwind', timezone: 'America/New_York', currency_code: 'USD' } as any,
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, { message: string; code?: string }>,
  statements: [] as any[],
}));

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: h.tenant, loading: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => {
  const read = (row: Row, col: string) => col.split('.').reduce((v: any, k) => (v == null ? v : v[k]), row);
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const stmt: Stmt = { table, columns, filters: [], range: null };
          h.statements.push(stmt);
          let rows: Row[] = [...(h.tables[table] ?? [])];
          const keep = (p: (r: Row) => boolean, note: string) => {
            stmt.filters.push(note);
            rows = rows.filter(p);
            return q;
          };
          const q: any = {
            eq: (c: string, v: unknown) => keep((r) => String(read(r, c)) === String(v), `${c}=eq.${v}`),
            in: (c: string, v: unknown[]) => keep((r) => v.map(String).includes(String(read(r, c))), `${c}=in.(${v.length})`),
            is: (c: string) => keep((r) => read(r, c) == null, `${c}=is.null`),
            order: (c: string) => {
              rows.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0));
              return q;
            },
            limit: (n: number) => {
              rows = rows.slice(0, n);
              return q;
            },
            range: (from: number, to: number) => {
              stmt.range = [from, to];
              rows = rows.slice(from, to + 1);
              return q;
            },
            then: (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) =>
              Promise.resolve().then(
                () =>
                  ok(
                    h.errors[table]
                      ? { data: null, error: h.errors[table] }
                      : // PostgREST's max-rows: never more than 1,000 per request.
                        { data: rows.slice(0, 1000), error: null },
                  ),
                no,
              ),
          };
          return q;
        },
      };
    },
  };
  return { supabase: client, supabaseUntyped: client };
});

import { useFinances } from '@/hooks/use-finances';
import type { FinanceFilters } from '@/lib/finances/types';

const make = (financesOn: boolean) =>
  function Wrapper({ children }: { children?: any }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={qc}>
        <V2Provider flags={{ finances: financesOn }}>{children}</V2Provider>
      </QueryClientProvider>
    );
  };

const filters: FinanceFilters = { period: 'all' };
const isProbe = (s: Stmt) => s.table === 'payment_plans' && s.columns === 'id';
const FINANCE_TABLES = ['rentals', 'ledger_entries', 'payments', 'payg_accruals', 'payment_applications', 'invoices', 'rental_extensions'];

beforeEach(() => {
  h.tenant = { id: 't1', slug: 'northwind', timezone: 'America/New_York', currency_code: 'USD' };
  h.errors = {};
  h.statements = [];
  h.tables = {
    payment_plans: [],
    payment_plan_occurrences: [],
    payment_plan_attempts: [],
    customers: [{ id: 'c1', tenant_id: 't1', name: 'Ada Okafor' }],
    vehicles: [],
    rentals: [],
    ledger_entries: [],
    payments: [],
    payg_accruals: [],
    payment_applications: [],
    invoices: [],
    rental_extensions: [],
  };
});

describe('the gate', () => {
  it('issues no finance query while the finances area is off', async () => {
    const { result } = renderHook(() => useFinances(filters), { wrapper: make(false) });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.statements.filter((s: Stmt) => FINANCE_TABLES.includes(s.table))).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.stats).toBeUndefined();
  });
});

describe('the reads', () => {
  it('sums a 1,001-row ledger completely (two pages, not one)', async () => {
    // 1,001 open $1.00 fines on no rental: 100100 cents. One page would say 100000.
    h.tables.ledger_entries = Array.from({ length: 1001 }, (_, i) => ({
      id: `k${String(i).padStart(4, '0')}`,
      tenant_id: 't1',
      type: 'Charge',
      rental_id: null,
      customer_id: 'c1',
      extension_id: null,
      category: 'Fine',
      amount: 1.0,
      remaining_amount: 1.0,
      due_date: '2026-09-01',
      entry_date: '2026-09-01',
    }));
    const { result } = renderHook(() => useFinances(filters), { wrapper: make(true) });
    await waitFor(() => expect(result.current.stats).toBeDefined());
    expect(result.current.stats!.outstandingCents).toBe(100100);
    expect(result.current.bills).toHaveLength(1);
    expect(result.current.bills[0].lines).toHaveLength(1001);
    const ledgerReads = h.statements.filter((s: Stmt) => s.table === 'ledger_entries').map((s: Stmt) => s.range);
    expect(ledgerReads).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("scopes every read to the tenant (allocations by this tenant's charge ids)", async () => {
    h.tables.ledger_entries = [
      { id: 'k1', tenant_id: 't1', type: 'Charge', rental_id: null, customer_id: 'c1', category: 'Fine', amount: 5, remaining_amount: 5, due_date: '2026-09-01' },
      { id: 'k2', tenant_id: 'OTHER', type: 'Charge', rental_id: null, customer_id: 'cx', category: 'Fine', amount: 900, remaining_amount: 900, due_date: '2026-09-01' },
    ];
    const { result } = renderHook(() => useFinances(filters), { wrapper: make(true) });
    await waitFor(() => expect(result.current.stats).toBeDefined());
    expect(result.current.stats!.outstandingCents).toBe(500);
    // The plan-table probe (usePaymentPlansFeature: `select('id').limit(1)`) is
    // not a finance read; every other statement is.
    for (const s of (h.statements as Stmt[]).filter((x) => !isProbe(x))) {
      if (s.table === 'payment_applications') expect(s.filters.some((f) => f.startsWith('charge_entry_id=in.') || f.startsWith('payment_id=in.'))).toBe(true);
      else expect(s.filters).toContain('tenant_id=eq.t1');
    }
  });

  it('reads the plan tables and the occurrence column only when they exist', async () => {
    const { result } = renderHook(() => useFinances(filters), { wrapper: make(true) });
    await waitFor(() => expect(result.current.stats).toBeDefined());
    expect(result.current.plansAvailable).toBe(true);
    expect((h.statements as Stmt[]).find((s) => s.table === 'payments')!.columns).toContain('payment_plan_occurrence_id');
    expect((h.statements as Stmt[]).some((s) => s.table === 'payment_plan_occurrences')).toBe(true);
  });

  it('before the plan migration: no plan read, no occurrence column, and still a result', async () => {
    h.errors.payment_plans = { code: 'PGRST205', message: "Could not find the table 'public.payment_plans' in the schema cache" };
    const { result } = renderHook(() => useFinances(filters), { wrapper: make(true) });
    await waitFor(() => expect(result.current.stats).toBeDefined());
    expect(result.current.plansAvailable).toBe(false);
    expect((h.statements as Stmt[]).find((s) => s.table === 'payments')!.columns).not.toContain('payment_plan_occurrence_id');
    expect((h.statements as Stmt[]).some((s) => s.table.startsWith('payment_plan_'))).toBe(false);
    expect(result.current.upcoming).toEqual([]);
    expect(result.current.stats!.upcomingCount).toBe(0);
  });

  it('a scope narrows every read to the rental', async () => {
    const { result } = renderHook(() => useFinances(filters, { rentalId: 'r9' }), { wrapper: make(true) });
    await waitFor(() => expect(result.current.stats).toBeDefined());
    const first = (t: string) => (h.statements as Stmt[]).find((s) => s.table === t && !isProbe(s))!.filters;
    expect(first('rentals')).toContain('id=eq.r9');
    expect(first('ledger_entries')).toContain('rental_id=eq.r9');
    expect(first('payments')).toContain('rental_id=eq.r9');
    expect(first('payg_accruals')).toContain('rental_id=eq.r9');
    expect(first('payment_plans')).toContain('rental_id=eq.r9');
  });
});

describe('an error is an error, never a zero', () => {
  it('a failed read leaves stats undefined and says why', async () => {
    h.tables.ledger_entries = [
      { id: 'k1', tenant_id: 't1', type: 'Charge', rental_id: null, customer_id: 'c1', category: 'Fine', amount: 5, remaining_amount: 5, due_date: '2026-09-01' },
    ];
    h.errors.payments = { message: 'permission denied for table payments', code: '42501' };
    const { result } = renderHook(() => useFinances(filters), { wrapper: make(true) });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error!.message).toBe('Could not load payments: permission denied for table payments');
    expect(result.current.stats).toBeUndefined();
    expect([result.current.bills, result.current.receipts, result.current.upcoming, result.current.attention]).toEqual([[], [], [], []]);
    expect(result.current.isLoading).toBe(false);
  });
});
