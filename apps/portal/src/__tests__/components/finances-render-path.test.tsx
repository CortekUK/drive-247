/**
 * Finances — the WHOLE render path, with nothing between the screen and the
 * database but a fake PostgREST.
 *
 * Every other Finances UI test mocks `useFinances`. This one does not: the real
 * hook reads the real loader (hooks/use-finances-data.ts), the real model
 * builds bills, receipts and stats (lib/finances), and the real screen draws
 * them. Only the Supabase client is replaced — by a fake that applies every
 * filter and, like PostgREST, never returns more than 1,000 rows. So a column
 * the loader asks for that a table does not answer, a read that throws, or a
 * render that falls over on real-shaped rows shows up here.
 *
 * The rows are the design's own worked example (FINANCES_DESIGN §3.1), and
 * every expected figure is worked out by hand from them:
 *
 *   R1 (Ghulam)   Rental 500.00, remaining 0, paid by p1
 *                 Tax 50.00, remaining 20.00, 30.00 paid by p1
 *                 Adjustment −20.00, remaining −20.00
 *                 → R-1 · Booking: Total 550.00 · Paid 530.00 · Credited 20.00 · Balance 0.00
 *   R1 extension  200.00, remaining 200.00, due 10 Sep → Balance 200.00, overdue
 *   R2 (Kristen)  100.00, remaining 0, no allocation → doesn't add up by 100.00
 *   p1            530.00 by Stripe, paid 20 Sep
 *
 *   Outstanding = 0 + 20.00 − 20.00 + 200.00 = 200.00, owed by 1 customer
 *   Overdue     = 200.00 (every due date is before 25 Sep), 1 rental
 *   Collected   = 530.00 in the last 30 days
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { V2Provider } from '@/lib/v2-context';
import { application, charge, payment, rental } from '../helpers/finances-fixture';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  search: '',
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, { message: string; code?: string }>,
  tablesRead: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/finances',
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 't1', slug: 'northwind', timezone: 'America/New_York', currency_code: 'USD' }, loading: false }),
}));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({ isManager: false, canView: () => true, canEdit: () => true }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock('@/components/shared/layout/page-search-slot', () => ({ usePageSearch: () => {} }));
// The dialogs are opened by clicks this file does not make.
vi.mock('@/components/shared/dialogs/add-payment-dialog', () => ({ AddPaymentDialog: () => null }));
vi.mock('@/components/shared/dialogs/refund-dialog', () => ({ RefundDialog: () => null }));
vi.mock('@/components/invoices/send-invoice-email-dialog', () => ({ SendInvoiceEmailDialog: () => null }));
vi.mock('@/components/fines/add-fine-dialog', () => ({ default: () => null }));

/** A PostgREST stand-in: applies eq / in / is, orders, pages, and caps a response at 1,000 rows. */
vi.mock('@/integrations/supabase/client', () => {
  const read = (row: Row, col: string) => col.split('.').reduce((v: any, k) => (v == null ? v : v[k]), row);
  const client = {
    from(table: string) {
      return {
        select(_columns: string) {
          h.tablesRead.push(table);
          let rows: Row[] = [...(h.tables[table] ?? [])];
          const q: any = {
            eq: (c: string, v: unknown) => ((rows = rows.filter((r) => String(read(r, c)) === String(v))), q),
            in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.map(String).includes(String(read(r, c))))), q),
            is: (c: string) => ((rows = rows.filter((r) => read(r, c) == null)), q),
            order: (c: string) => {
              rows.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0));
              return q;
            },
            limit: (n: number) => ((rows = rows.slice(0, n)), q),
            range: (from: number, to: number) => ((rows = rows.slice(from, to + 1)), q),
            maybeSingle: async () => (h.errors[table] ? { data: null, error: h.errors[table] } : { data: rows[0] ?? null, error: null }),
            then: (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) =>
              Promise.resolve().then(
                () => ok(h.errors[table] ? { data: null, error: h.errors[table] } : { data: rows.slice(0, 1000), error: null }),
                no,
              ),
          };
          return q;
        },
      };
    },
    functions: { invoke: vi.fn() },
    auth: { getUser: vi.fn() },
  };
  return { supabase: client, supabaseUntyped: client };
});

import { FinancesView } from '@/components/finances/finances-view';
import { TooltipProvider } from '@/components/ui-v2/tooltip';

const T = (rows: Row[]) => rows.map((r) => ({ tenant_id: 't1', ...r }));

function seed() {
  h.tables = {
    rentals: T([rental('r1', 'c1', { rental_number: 'R-1', vehicle_id: 'v1' }), rental('r2', 'c2', { rental_number: 'R-2' })]),
    ledger_entries: T([
      charge('ch-rent', 'r1', 'c1', 'Rental', 500, 0, '2026-09-01'),
      charge('ch-tax', 'r1', 'c1', 'Tax', 50, 20, '2026-09-01'),
      charge('ch-adj', 'r1', 'c1', 'Adjustment', -20, -20, '2026-09-01'),
      charge('ch-ext', 'r1', 'c1', 'Extension Rental', 200, 200, '2026-09-10', { extension_id: 'e1' }),
      charge('ch-drift', 'r2', 'c2', 'Rental', 100, 0, '2026-09-05'),
    ]),
    payment_applications: T([application('p1', 'ch-rent', 500), application('p1', 'ch-tax', 30)]),
    payments: T([
      payment('p1', 'c1', 'r1', 530, {
        payment_date: '2026-09-20',
        created_at: '2026-09-20T15:00:00Z',
        stripe_payment_intent_id: 'pi_3PabcDEF123',
        verification_status: 'auto_approved',
      }),
    ]),
    payg_accruals: [],
    invoices: T([{ id: 'inv1', rental_id: 'r1', invoice_number: 'INV-1001', created_at: '2026-09-01T10:00:00Z' }]),
    rental_extensions: T([{ id: 'e1', rental_id: 'r1', sequence_number: 1, status: 'approved', created_at: '2026-09-09T10:00:00Z' }]),
    customers: T([
      { id: 'c1', name: 'Ghulam Ilyas' },
      { id: 'c2', name: 'Kristen Moss' },
    ]),
    vehicles: T([{ id: 'v1', reg: 'NW-01' }]),
    payment_plans: [],
    payment_plan_occurrences: [],
    payment_plan_attempts: [],
    tenants: [{ id: 't1', own_stripe_account_id: null, own_stripe_test_account_id: null, stripe_account_id: null }],
  };
}

function renderView(search: string) {
  h.search = search;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <V2Provider flags={{ finances: true, chrome: true }}>
        <TooltipProvider>
          <FinancesView />
        </TooltipProvider>
      </V2Provider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  // 25 Sep 2026, mid-afternoon in New York: the day the figures above are worked for.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-25T18:00:00Z') });
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  seed();
  h.errors = {};
  h.tablesRead = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('the real read, the real model, the real screen', () => {
  it('draws the owed card and the graph from the database rows', async () => {
    renderView('view=billed&period=all');
    const outstanding = await waitFor(() => {
      const el = document.querySelector('[data-owed-outstanding]');
      if (!el) throw new Error('not yet');
      return el;
    });
    expect(outstanding.textContent).toBe('$200.00');
    const card = document.querySelector<HTMLElement>('[data-finances-owed]')!;
    expect(card.textContent).toContain('Owed by 1 customer');
    expect(card.querySelector('[data-owed-overdue]')!.textContent).toContain('$200.00');
    expect(card.querySelector('[data-owed-overdue]')!.textContent).toContain('1 rental');
    // The model's ageing: the extension's 200.00 fell due 10 Sep, 15 days late;
    // the Tax 20.00 and the Adjustment −20.00 (due 1 Sep) cancel out.
    expect(card.querySelector('[data-ageing="d1_30"]')!.textContent).toContain('$200.00');
    expect(card.querySelector('[data-ageing="current"]')!.textContent).toContain('$0.00');
    expect(document.querySelector('[data-tour="finances-chart"]')!.textContent).toContain('$530.00');
    expect(screen.queryByText(/Couldn.t load/)).toBeNull();
  });

  it('lists every bill with its math, and flags the one that does not add up', async () => {
    renderView('view=billed&period=all');
    const booking = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('tr[data-bill-key="r1:booking"]');
      if (!el) throw new Error('not yet');
      return el;
    });
    const cells = [...booking.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells).toEqual(expect.arrayContaining(['$550.00', '$530.00', '$20.00']));
    expect(booking.textContent).toContain('INV-1001');
    expect(booking.getAttribute('data-tie-out')).toBe('ok');

    const ext = document.querySelector<HTMLElement>('tr[data-bill-key="r1:ext:e1"]')!;
    expect(ext.textContent).toContain('$200.00');

    const drift = document.querySelector<HTMLElement>('tr[data-bill-key="r2:booking"]')!;
    expect(drift.getAttribute('data-tie-out')).toBe('mismatch');
    expect(drift.querySelector('[data-tie-out-marker]')!.textContent).toBe("Doesn't add up by $100.00");
  });

  it('lists the payment that came in, with its Stripe reference', async () => {
    renderView('view=received&period=all');
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('tr[data-payment-id="p1"]');
      if (!el) throw new Error('not yet');
      return el;
    });
    expect(row.textContent).toContain('$530.00');
    expect(row.textContent).toContain('Stripe');
    expect(within(row).getByTitle('pi_3PabcDEF123')).toBeInTheDocument();
  });

  it('opens a bill in the side panel from a shared link', async () => {
    renderView('view=billed&period=all&panel=bill:r1:booking');
    const panel = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-bill-panel="r1:booking"]');
      if (!el) throw new Error('not yet');
      return el;
    });
    expect(panel.querySelector('[data-bill-math]')!.textContent).toBe('Total $550.00 − Paid $530.00 − Credited $20.00 = Balance $0.00');
  });

  it('reads only from the tables it is meant to', async () => {
    renderView('view=billed&period=all');
    await waitFor(() => {
      if (!document.querySelector('[data-owed-outstanding]')) throw new Error('not yet');
    });
    expect(new Set(h.tablesRead)).toEqual(
      new Set([
        'payment_plans',
        'payment_plan_occurrences',
        'payment_plan_attempts',
        'rentals',
        'ledger_entries',
        'payments',
        'payg_accruals',
        'payment_applications',
        'invoices',
        'rental_extensions',
        'customers',
        'vehicles',
      ]),
    );
  });
});

describe('a read that fails', () => {
  it('is an error, never a $0 — calm copy outside development', async () => {
    h.errors.payments = { message: 'permission denied for table payments', code: '42501' };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderView('view=billed');
    await screen.findByText(/Couldn.t load your finances/);
    expect(document.body.textContent).not.toContain('$0.00');
    expect(document.body.textContent).not.toContain('permission denied for table payments');
    spy.mockRestore();
  });

  it('in development, says which read failed and what the database said, and logs it', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    h.errors.payments = { message: 'column payments.payment_plan_occurrence_id does not exist', code: '42703' };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderView('view=billed');
    // The model's FinanceLoadError.devText: the read, the Postgres code, the message.
    expect(await screen.findByText('payments — 42703: column payments.payment_plan_occurrence_id does not exist')).toBeInTheDocument();
    expect(spy.mock.calls.some((c) => String(c[0]).includes('[finances]'))).toBe(true);
    spy.mockRestore();
  });
});
