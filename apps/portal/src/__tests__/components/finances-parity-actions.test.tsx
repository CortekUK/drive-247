/**
 * Finances parity — every button the old Payments, Invoices and Fines screens
 * had has a home on Finances, and each one calls the SAME existing dialog or
 * function with the same arguments (docs/FINANCES_DESIGN.md: no new money path).
 *
 *   Payments   the tab's guided tour · the row's customer and vehicle links
 *   Invoices   Delete invoice (its own DeleteInvoiceDialog) · the "Payment
 *              Requests" sub-tab (one status chip)
 *   Fines      Record Payment · Waive Fine (the fines tab's own row actions,
 *              `useFineRowActions`)
 *
 * Payment analytics and Fine analytics are NOT linked (Sep 26 2026: two
 * identical chart icons made no sense): the overview graph replaces them, as
 * on Customers, Vehicles and Rentals, and both routes still answer by URL.
 *
 * And the tour anchors the Finances tour steps point at. Shapes, not copy.
 */
import React from 'react';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceFilters } from '@/lib/finances/types';
import { financesRedirectFor } from '@/lib/finances-nav';
import { R1_BOOKING, R1_EXTENSION, receipt, upcoming } from '../helpers/finances-ui-fixtures';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const m = vi.hoisted(() => ({
  search: '',
  replace: vi.fn(),
  calls: [] as unknown[],
  fin: {} as any,
  isManager: false,
  grants: {} as Record<string, 'viewer' | 'editor'>,
  finesData: { data: { fines: [], serverCount: 0 }, isLoading: false, error: null, refetch: () => {}, isRefetching: false } as any,
  pageSearch: null as any,
  invoiceReads: [] as unknown[][],
  deleteDialog: null as any,
  fineHookOptions: null as any,
  openPaymentDialog: vi.fn(),
  waive: vi.fn(),
  waivePending: false,
  invalidated: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: m.replace, push: vi.fn() }),
  usePathname: () => '/finances',
  useSearchParams: () => new URLSearchParams(m.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 't1', slug: 'northwind', currency_code: 'USD', timezone: 'America/New_York' } }),
}));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({
    isManager: m.isManager,
    canView: (k: string) => !m.isManager || k in m.grants,
    canEdit: (k: string) => !m.isManager || m.grants[k] === 'editor',
  }),
}));
vi.mock('@/hooks/use-finances', () => ({
  useFinances: (filters: FinanceFilters) => {
    m.calls.push(filters);
    return m.fin;
  },
}));
vi.mock('@/hooks/use-payment-verification', () => ({
  usePaymentVerificationActions: () => ({ approvePayment: { mutate: vi.fn() }, rejectPayment: { mutate: vi.fn() }, isLoading: false }),
}));
vi.mock('@/hooks/use-void-payment-link', () => ({ useVoidPaymentLink: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/hooks/use-payment-plan', () => ({
  usePaymentPlan: () => ({ data: undefined, isLoading: true, error: null }),
  usePaymentPlanActions: () => ({}),
}));
vi.mock('@/hooks/use-fines-data', () => ({ useFinesData: () => m.finesData }));
vi.mock('@/components/shared/layout/page-search-slot', () => ({
  usePageSearch: (reg: any) => {
    m.pageSearch = reg;
  },
}));
vi.mock('@/components/shared/dialogs/add-payment-dialog', () => ({ AddPaymentDialog: () => null }));
vi.mock('@/components/shared/dialogs/refund-dialog', () => ({ RefundDialog: () => null }));
vi.mock('@/components/invoices/send-invoice-email-dialog', () => ({ SendInvoiceEmailDialog: () => null }));
vi.mock('@/components/invoices/delete-invoice-dialog', () => ({
  DeleteInvoiceDialog: (p: any) => {
    if (p.open) m.deleteDialog = p;
    return p.open ? <div data-testid="delete-invoice-dialog" /> : null;
  },
}));
vi.mock('@/components/fines/add-fine-dialog', () => ({ default: () => null }));
vi.mock('@/components/fines/bulk-action-bar', () => ({ BulkActionBar: () => null }));
vi.mock('@/components/payment-plans/payment-plan-card', () => ({ PaymentPlanCard: () => null }));
vi.mock('@/components/onboarding/tab-tour-button', () => ({
  TabTourButton: (p: any) => <button type="button" data-testid="tab-tour-button" data-tour-id={p.tour} data-size={p.size} />,
}));
vi.mock('@/components/fines/use-fine-row-actions', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/components/fines/use-fine-row-actions')>();
  return {
    ...real,
    useFineRowActions: (options: any) => {
      m.fineHookOptions = options;
      return {
        waiveFineAction: { mutate: m.waive, isPending: m.waivePending },
        openPaymentDialog: m.openPaymentDialog,
        paymentFine: null,
        setPaymentFine: vi.fn(),
        syncFineStatusAfterPayment: vi.fn(),
      };
    },
    FinePaymentDialog: () => <div data-testid="fine-payment-dialog-host" />,
  };
});
vi.mock('@/integrations/supabase/client', () => {
  const tenantRow = { own_stripe_account_id: null, own_stripe_test_account_id: null, stripe_account_id: null };
  const untyped = (data: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
  /** The Invoices tab's read, recorded step by step. */
  const invoices = () => {
    const b: any = {
      select: (cols: string) => {
        m.invoiceReads.push(['select', cols]);
        return b;
      },
      eq: (col: string, v: unknown) => {
        m.invoiceReads.push(['eq', col, v]);
        return b;
      },
      maybeSingle: async () => ({
        data: { id: 'inv-1', invoice_number: 'INV-1001', total_amount: 550, customers: { name: 'Ghulam Ilyas' }, vehicles: { reg: 'NW-01', make: 'Kia', model: 'Rio' } },
        error: null,
      }),
    };
    return b;
  };
  return {
    supabase: { from: (t: string) => (t === 'invoices' ? invoices() : untyped(null)) },
    supabaseUntyped: { from: (t: string) => untyped(t === 'tenants' ? tenantRow : { name: 'Kristen' }) },
  };
});

import { FinancesView } from '@/components/finances/finances-view';
import { TooltipProvider } from '@/components/ui-v2/tooltip';

const BOOKING = { ...R1_BOOKING, invoiceId: 'inv-1', vehicleId: 'v1', status: 'open' as const, balanceCents: 2000 };
const P1 = receipt({ paymentId: 'p1', vehicleId: 'v1' });
const P_NO_VEHICLE = receipt({ paymentId: 'p2', vehicleId: null, rentalId: null, rentalRef: null });
const U1 = upcoming({ occurrenceId: 'o1' });
const ATTENTION = [
  { key: 'review-p9', kind: 'awaiting_review', title: 'A payment is waiting', detail: '', amountCents: 100, rentalId: 'r1', customerId: 'c1', paymentIds: ['p9'], occurrenceId: null },
];

const OPEN_FINE = {
  id: 'f1',
  reference_no: 'PCN-1',
  type: 'Toll',
  status: 'Open',
  amount: 75,
  issue_date: '2026-09-01',
  due_date: '2026-09-30',
  isOverdue: false,
  daysUntilDue: 5,
  rental_id: 'r1',
  customer_id: 'c1',
  vehicle_id: 'v1',
  customers: { name: 'Ghulam Ilyas' },
  vehicles: { reg: 'NW-01', make: 'Kia', model: 'Rio' },
  rentals: { rental_number: 'R-1001' },
  notes: null,
};
const PAID_FINE = { ...OPEN_FINE, id: 'f2', reference_no: 'PCN-2', status: 'Paid' };

function finWith(over: Record<string, unknown> = {}) {
  const bills = [BOOKING, R1_EXTENSION];
  const receipts = [P1, P_NO_VEHICLE];
  return {
    stats: undefined,
    attention: ATTENTION,
    bills,
    receipts,
    upcoming: [U1],
    plansAvailable: true,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    model: { bills, receipts, upcoming: [U1], attention: ATTENTION },
    today: '2026-09-25',
    series: undefined,
    ...over,
  };
}

function renderView(search = '') {
  m.search = search;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(qc, 'invalidateQueries').mockImplementation(async (f: any) => {
    m.invalidated.push(f?.queryKey);
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <FinancesView />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const lastUrl = () => {
  const href = m.replace.mock.calls.at(-1)?.[0] as string;
  return new URLSearchParams(href.split('?')[1] ?? '');
};
const panel = async () => {
  await screen.findByRole('dialog');
  return document.querySelector<HTMLElement>('[data-tour="finances-side-panel"]')!;
};
/** Open a row menu the way a keyboard does (jsdom has no PointerEvent). */
const openMenu = (name: RegExp | string) => {
  act(() => {
    fireEvent.keyDown(screen.getAllByRole('button', { name })[0], { key: 'ArrowDown' });
  });
  return screen.getByRole('menu');
};
const asManager = (grants: Record<string, 'viewer' | 'editor'>) => {
  m.isManager = true;
  m.grants = grants;
};

beforeEach(() => {
  m.fin = finWith();
  m.calls = [];
  m.isManager = false;
  m.grants = {};
  m.finesData = { data: { fines: [OPEN_FINE, PAID_FINE], serverCount: 2 }, isLoading: false, error: null, refetch: () => {}, isRefetching: false };
  m.invoiceReads = [];
  m.deleteDialog = null;
  m.fineHookOptions = null;
  m.waivePending = false;
  m.invalidated = [];
});
afterEach(() => {
  vi.clearAllMocks();
});

/* ── the header ──────────────────────────────────────────────────────────── */

describe('the header', () => {
  it('leads its actions with the Finances tab tour, placed as the Customers, Vehicles and Payments headers place theirs', () => {
    renderView();
    const tour = screen.getByTestId('tab-tour-button');
    expect([tour.getAttribute('data-tour-id'), tour.getAttribute('data-size')]).toEqual(['finances', 'h-10']);
    expect(tour.parentElement!.firstElementChild).toBe(tour);
  });

  // UPDATED Sep 26 2026. These two tests used to pin the header's "Payment
  // analytics" and "Fine analytics" icon links. The lead removed both (two
  // identical chart icons made no sense), matching Customers, Vehicles and
  // Rentals v2, whose overview graph replaced their analytics link; so they
  // now pin that the icons are GONE, for every grant, and the routes below
  // still resolve.
  it('carries no Payment analytics or Fine analytics link — the overview graph replaces them', () => {
    renderView();
    expect(screen.queryByRole('link', { name: 'Payment analytics' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Fine analytics' })).toBeNull();
    expect(document.querySelector('a[href="/payments/analytics"]')).toBeNull();
    expect(document.querySelector('a[href="/fines/analytics"]')).toBeNull();
    expect(document.querySelector('[data-tour="finances-payment-analytics"], [data-tour="finances-fine-analytics"]')).toBeNull();
  });

  it('shows neither for any grant, on any view', () => {
    for (const grants of [{ payments: 'viewer' }, { fines: 'viewer' }, { invoices: 'editor' }] as Record<string, 'viewer' | 'editor'>[]) {
      for (const search of ['', 'view=received', 'view=fines']) {
        asManager(grants);
        const r = renderView(search);
        expect(screen.queryByRole('link', { name: /analytics/i }), `${JSON.stringify(grants)} ${search}`).toBeNull();
        r.unmount();
      }
    }
  });

  it('the proxy leaves both analytics routes alone (exact list paths only), so they still resolve by URL', () => {
    expect(financesRedirectFor('/payments/analytics')).toBeNull();
    expect(financesRedirectFor('/fines/analytics')).toBeNull();
    expect(financesRedirectFor('/payments/analytics/')).toBeNull();
    expect(financesRedirectFor('/payments')).toBe('/finances?view=received');
  });

  it('both analytics pages still exist as routes', () => {
    for (const route of ['payments', 'fines']) {
      const page = path.resolve(__dirname, `../../app/(dashboard)/${route}/analytics/page.tsx`);
      expect(existsSync(page), page).toBe(true);
    }
  });
});

/* ── Invoices: Delete invoice ────────────────────────────────────────────── */

describe('Delete invoice, from the bill', () => {
  it('reads the bill’s invoices row as the Invoices tab does and opens that tab’s own delete dialog with it', async () => {
    renderView('view=billed&panel=bill:r1:booking');
    const p = await panel();
    const button = p.querySelector<HTMLElement>('[data-panel-action="delete_invoice"]')!;
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button);
    });
    // The Invoices tab's own select, narrowed to the tenant and to this bill's row.
    expect(m.invoiceReads[0][0]).toBe('select');
    expect(String(m.invoiceReads[0][1])).toContain('customers:customer_id (name, email, phone)');
    expect(m.invoiceReads.slice(1)).toEqual([
      ['eq', 'tenant_id', 't1'],
      ['eq', 'id', 'inv-1'],
    ]);
    expect(screen.getByTestId('delete-invoice-dialog')).toBeInTheDocument();
    expect(m.deleteDialog.invoice).toMatchObject({ id: 'inv-1', invoice_number: 'INV-1001', total_amount: 550 });
    expect(m.deleteDialog.onOpenChange).toBeTypeOf('function');
    // Once it is gone, Finances reads its bills again.
    m.deleteDialog.onDeleted();
    expect(m.invalidated).toContainEqual(['finances']);
  });

  it('is offered only to someone who may edit invoices', async () => {
    asManager({ invoices: 'viewer' });
    renderView('view=billed&panel=bill:r1:booking');
    const p = await panel();
    expect(p.querySelector('[data-panel-action="delete_invoice"]')).toBeNull();
  });

  it('is not offered on a bill with no invoices row (an extension)', async () => {
    renderView('view=billed&panel=bill:r1:ext:e1');
    const p = await panel();
    expect(p.querySelector('[data-bill-panel]')).not.toBeNull();
    expect(p.querySelector('[data-panel-action="delete_invoice"]')).toBeNull();
  });
});

/* ── Payments: the customer and vehicle a payment names ──────────────────── */

describe('customer and vehicle links', () => {
  it('a payment’s panel opens its customer and its vehicle, as the Payments row did', async () => {
    renderView('view=received&panel=payment:p1');
    const p = await panel();
    expect(p.querySelector('[data-panel-link="customer"]')!.getAttribute('href')).toBe('/customers/c1');
    expect(p.querySelector('[data-panel-link="vehicle"]')!.getAttribute('href')).toBe('/vehicles/v1');
  });

  it('no vehicle, no vehicle link', async () => {
    renderView('view=received&panel=payment:p2');
    const p = await panel();
    expect(p.querySelector('[data-panel-link="customer"]')).not.toBeNull();
    expect(p.querySelector('[data-panel-link="vehicle"]')).toBeNull();
  });

  it('a bill’s panel carries the same two links', async () => {
    renderView('view=billed&panel=bill:r1:booking');
    const p = await panel();
    expect(p.querySelector('[data-panel-link="customer"]')!.getAttribute('href')).toBe('/customers/c1');
    expect(p.querySelector('[data-panel-link="vehicle"]')!.getAttribute('href')).toBe('/vehicles/v1');
  });

  it('the Received row menu offers them too', () => {
    renderView('view=received');
    const menu = openMenu(/Actions for the payment from/);
    expect(menu.querySelector('[data-row-link="customer"]')!.getAttribute('href')).toBe('/customers/c1');
    expect(menu.querySelector('[data-row-link="vehicle"]')!.getAttribute('href')).toBe('/vehicles/v1');
  });
});

/* ── Invoices: the Payment Requests sub-tab ──────────────────────────────── */

describe('Payment requests (the old Invoices sub-tab)', () => {
  it('is one status chip on Received that shows every request over all time', () => {
    renderView('view=received');
    act(() => m.pageSearch.filters.onOpenChange(true));
    const status = document.querySelector<HTMLElement>('[data-filter-section="status"]')!;
    fireEvent.click(within(status).getByText('Payment requests'));
    const url = lastUrl();
    expect([url.get('view'), url.get('status'), url.get('period')]).toEqual(['received', 'payment_request', 'all']);
  });

  it('asks the model for exactly that filter', () => {
    renderView('view=received&status=payment_request&period=all');
    expect(m.calls.at(-1)).toMatchObject({ statuses: ['payment_request'], period: 'all' });
  });
});

/* ── Fines: Record Payment and Waive Fine ────────────────────────────────── */

describe('a fine’s Record payment and Waive fine', () => {
  it('Finances runs the fines tab’s own row actions, refreshing its read when they finish', () => {
    renderView('view=fines');
    expect(m.fineHookOptions.onChanged).toBeTypeOf('function');
    m.fineHookOptions.onChanged();
    expect(m.invalidated).toContainEqual(['finances']);
    // The payment window is mounted once, for whichever fine is chosen.
    expect(screen.getByTestId('fine-payment-dialog-host')).toBeInTheDocument();
  });

  it('the row menu calls them with the fine, as the fines tab’s menu did', () => {
    renderView('view=fines');
    let menu = openMenu('Actions for fine PCN-1');
    fireEvent.click(menu.querySelector('[data-fine-action="record_payment"]')!);
    expect(m.openPaymentDialog).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));

    menu = openMenu('Actions for fine PCN-1');
    fireEvent.click(menu.querySelector('[data-fine-action="waive"]')!);
    expect(m.waive).toHaveBeenCalledWith('f1');
  });

  it('are not offered on a fine that is no longer Open', () => {
    renderView('view=fines');
    const menu = openMenu('Actions for fine PCN-2');
    expect(menu.querySelector('[data-fine-action]')).toBeNull();
    expect(within(menu).getByText('Open the fine').closest('a')!.getAttribute('href')).toBe('/fines/f2');
  });

  it('the fine’s panel offers the same two, calling the same functions', async () => {
    renderView('view=fines&panel=fine:f1');
    const p = await panel();
    fireEvent.click(p.querySelector('[data-panel-action="fine_record_payment"]')!);
    expect(m.openPaymentDialog).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
    fireEvent.click(p.querySelector('[data-panel-action="fine_waive"]')!);
    expect(m.waive).toHaveBeenCalledWith('f1');
    expect(p.querySelector('[data-panel-link="vehicle"]')!.getAttribute('href')).toBe('/vehicles/v1');
  });

  it('a waive on its way holds the button, as on the fines tab', async () => {
    m.waivePending = true;
    renderView('view=fines&panel=fine:f1');
    const p = await panel();
    expect(p.querySelector<HTMLButtonElement>('[data-panel-action="fine_waive"]')!.disabled).toBe(true);
  });

  it('a fines viewer sees neither, in the menu or the panel', async () => {
    asManager({ fines: 'viewer' });
    renderView('view=fines&panel=fine:f1');
    const p = await panel();
    expect(p.querySelector('[data-panel-action]')).toBeNull();
    expect(p.querySelector('a[href="/fines/f1"]')).not.toBeNull();
  });
});

/* ── the tour's anchors ──────────────────────────────────────────────────── */

describe('tour anchors', () => {
  const one = (name: string) => document.querySelectorAll(`[data-tour="${name}"]`);

  it('each page anchor is drawn once', () => {
    renderView('view=billed');
    for (const name of ['finances-header', 'finances-record-payment', 'finances-overview', 'finances-attention', 'finances-views', 'finances-list']) {
      expect(one(name).length, name).toBe(1);
    }
    expect(one('finances-header')[0].querySelector('h1')).not.toBeNull();
    expect(one('finances-list')[0].querySelector('table')).not.toBeNull();
  });

  it('finances-row is the first data row of the table (and of the phone list), never another', () => {
    renderView('view=billed');
    const rows = [...document.querySelectorAll('tr[data-bill-key]')];
    const anchored = [...document.querySelectorAll('tr[data-tour="finances-row"]')];
    expect(anchored).toEqual([rows[0]]);
    const phone = document.querySelector('[data-finance-mobile-rows]')!;
    expect(phone.querySelectorAll('[data-tour="finances-row"]')).toHaveLength(1);
    expect(phone.firstElementChild!.getAttribute('data-tour')).toBe('finances-row');
  });

  it.each([
    ['received', 'tr[data-payment-id]'],
    ['upcoming', 'tr[data-occurrence-id]'],
    ['fines', 'tr[data-fine-id]'],
  ])('%s: the first row carries finances-row', (view, rowSel) => {
    renderView(`view=${view}`);
    const first = document.querySelector(rowSel)!;
    expect(first.getAttribute('data-tour')).toBe('finances-row');
    expect(document.querySelectorAll('tr[data-tour="finances-row"]')).toHaveLength(1);
  });

  it('finances-filter is handed to the top bar’s filter button', () => {
    renderView();
    expect(m.pageSearch.filters.tourAnchor).toBe('finances-filter');
  });

  it('finances-side-panel is the open sheet', async () => {
    renderView('view=billed&panel=bill:r1:booking');
    const p = await panel();
    expect(p.getAttribute('role')).toBe('dialog');
  });

  it('finances-attention is absent when nothing needs attention', () => {
    m.fin = finWith({ attention: [], model: { ...finWith().model, attention: [] } });
    renderView();
    expect(one('finances-attention')).toHaveLength(0);
  });
});
