/**
 * The live customer-balance hooks, end to end over a fake database, after the
 * refactor that moved their rule into lib/finances/balance.ts. The parity suite
 * (lib/finances-balance-parity) proves the functions equal the old inline code;
 * this proves the hooks still hand them the right rows. Figures by hand below.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  tenant: { id: 't1', slug: 'acme' } as any,
  tables: {} as Record<string, Row[]>,
}));

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: h.tenant, loading: false }) }));
vi.mock('@/integrations/supabase/client', () => {
  const read = (row: Row, col: string) => col.split('.').reduce((v: any, k) => (v == null ? v : v[k]), row);
  const client = {
    from(table: string) {
      return {
        select() {
          let rows: Row[] = [...(h.tables[table] ?? [])];
          const q: any = {
            eq: (c: string, v: unknown) => ((rows = rows.filter((r) => String(read(r, c)) === String(v))), q),
            is: (c: string) => ((rows = rows.filter((r) => read(r, c) == null)), q),
            // Only the one shape the hook uses: "a.eq.X,b.eq.Y".
            or: (expr: string) => {
              const parts = expr.split(',').map((p) => p.split('.eq.'));
              rows = rows.filter((r) => parts.some(([c, v]) => String(r[c]) === v));
              return q;
            },
            then: (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) => Promise.resolve().then(() => ok({ data: rows, error: null }), no),
          };
          return q;
        },
      };
    },
  };
  return { supabase: client, supabaseUntyped: client };
});

import { useCustomerBalance, useCustomerBalanceWithStatus } from '@/hooks/use-customer-balance';

const wrapper = ({ children }: { children?: any }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  const L = (x: Row) => ({ tenant_id: 't1', customer_id: 'c1', ...x });
  h.tables = {
    rentals: [
      { id: 'r-active', tenant_id: 't1', customer_id: 'c1', status: 'Active', approval_status: 'approved', is_pay_as_you_go: false },
      { id: 'r-cancel', tenant_id: 't1', customer_id: 'c1', status: 'Cancelled', approval_status: 'approved', is_pay_as_you_go: false },
      { id: 'r-payg', tenant_id: 't1', customer_id: 'c1', status: 'Active', approval_status: 'approved', is_pay_as_you_go: true },
      { id: 'r-other', tenant_id: 't1', customer_id: 'c2', status: 'Cancelled', approval_status: 'approved', is_pay_as_you_go: false },
    ],
    ledger_entries: [
      L({ type: 'Charge', category: 'Rental', amount: 100, remaining_amount: 100, due_date: '2026-09-01', rental_id: 'r-active' }),
      L({ type: 'Charge', category: 'Rental', amount: 200, remaining_amount: 200, due_date: '2099-01-01', rental_id: 'r-active' }),
      L({ type: 'Charge', category: 'Fine', amount: 30, remaining_amount: 30, due_date: '2099-01-01', rental_id: null }),
      L({ type: 'Charge', category: 'Adjustment', amount: -10, remaining_amount: -10, due_date: null, rental_id: 'r-active' }),
      L({ type: 'Charge', category: 'Rental', amount: 500, remaining_amount: 500, due_date: '2026-09-01', rental_id: 'r-cancel' }),
      L({ type: 'Charge', category: 'Rental', amount: 111, remaining_amount: 111, due_date: '2026-09-01', rental_id: 'r-payg' }),
      L({ type: 'Payment', category: 'Rental', amount: -50, remaining_amount: 0, due_date: null, rental_id: 'r-active' }),
      { tenant_id: 't1', customer_id: 'c2', type: 'Charge', category: 'Rental', amount: 999, remaining_amount: 999, due_date: '2026-09-01', rental_id: 'r-other' },
    ],
    payg_accruals: [
      { tenant_id: 't1', rental_id: 'r-payg', invoice_status: 'open', daily_rate: 100, tax_amount: 8, service_fee_amount: 3, rentals: { customer_id: 'c1', payg_closed_at: null } },
      { tenant_id: 't1', rental_id: 'r-cancel', invoice_status: 'open', daily_rate: 999, tax_amount: 0, service_fee_amount: 0, rentals: { customer_id: 'c1', payg_closed_at: null } },
      { tenant_id: 't1', rental_id: 'r-payg', invoice_status: 'paid', daily_rate: 70, tax_amount: 0, service_fee_amount: 0, rentals: { customer_id: 'c1', payg_closed_at: null } },
    ],
    payments: [
      { tenant_id: 't1', customer_id: 'c1', status: 'Credit', capture_status: 'captured', remaining_amount: 20 },
      { tenant_id: 't1', customer_id: 'c1', status: 'Pending', capture_status: 'requires_capture', remaining_amount: 147 },
      { tenant_id: 't1', customer_id: 'c1', status: 'Credit', capture_status: 'requires_capture', remaining_amount: 1577 },
    ],
  };
});

describe('useCustomerBalance', () => {
  it('is the due ledger remainder plus open PAYG accruals', async () => {
    const { result } = renderHook(() => useCustomerBalance('c1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Ledger: 100 (due) + 30 (fine, any date) − 10 = 120. Not: 200 (due 2099),
    // 500 (cancelled), 111 (PAYG ledger row). Accruals: 100 + 8 + 3 = 111
    // (the cancelled rental's 999 and the paid 70 are out). 120 + 111 = 231.
    expect(result.current.data).toBe(231);
  });
});

describe('useCustomerBalanceWithStatus', () => {
  it('debt, credit and status, by hand', async () => {
    const { result } = renderHook(() => useCustomerBalanceWithStatus('c1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // totalCharges: 100 + 200 + 30 − 10 + 111 = 431 (cancelled 500 out), + PAYG 111 = 542.
    // outstandingDebt: 120 + 111 = 231. Credit: 20 only (both holds are not money).
    // Net 231 − 20 = 211 → In Debt 211. totalPayments: |−50| = 50.
    expect(result.current.data).toEqual({
      balance: 211,
      status: 'In Debt',
      totalCharges: 542,
      totalPayments: 50,
      outstandingDebt: 231,
      availableCredit: 20,
    });
  });
});
