/**
 * Finances polish — the screen (Sep 26 2026).
 *
 *  1  The graph FOLLOWS the view: the Fines view opens it on "Fines issued"
 *     (from the Fines list's own rows), every other view on "Collected"; the
 *     fine metrics are in the picker only there. (The header's two analytics
 *     icons are gone — pinned in finances-parity-actions.test.tsx.)
 *  2  Every invoice is reachable (D2): a bill's panel lists EVERY invoice of
 *     its rental, each with Send email and Delete; an invoice with no bill is
 *     an "Invoice only" row with the same two.
 *  3  The Billed and Received empty states carry the old tabs' explainers (D3).
 *  4  Auto-approved is its own Received chip; a payment on no rental opens the
 *     customer's payments tab, as the old "View Ledger" did (D4).
 *  5  An off-platform payment is badged and never sent to look for itself at
 *     Stripe or Square.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillRow, FinanceFilters, FinanceStats } from '@/lib/finances/types';
import { bill, R1_BOOKING, R1_EXTENSION, receipt } from '../helpers/finances-ui-fixtures';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const STATS: FinanceStats = {
  outstandingCents: 20000,
  outstandingCustomers: 1,
  overdueCents: 20000,
  overdueRentals: 1,
  collectedCents: 53000,
  collectedCount: 1,
  refundedCents: 0,
  upcomingCents: 0,
  upcomingCount: 0,
  upcomingAuto: 0,
  upcomingLinks: 0,
};

const m = vi.hoisted(() => ({
  search: '',
  replace: vi.fn(),
  calls: [] as unknown[],
  fin: {} as any,
  finesData: {} as any,
  invoiceReads: [] as unknown[][],
  deleteDialog: null as any,
  emailDialog: null as any,
  pageSearch: null as any,
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
  useManagerPermissions: () => ({ isManager: false, canView: () => true, canEdit: () => true }),
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
vi.mock('@/components/explainers/explainer', () => ({
  ExplainerChip: (p: any) => (
    <button type="button" data-explainer-chip={p.id}>
      {p.label}
    </button>
  ),
}));
vi.mock('@/components/shared/dialogs/add-payment-dialog', () => ({ AddPaymentDialog: () => null }));
vi.mock('@/components/shared/dialogs/refund-dialog', () => ({ RefundDialog: () => null }));
vi.mock('@/components/invoices/send-invoice-email-dialog', () => ({
  SendInvoiceEmailDialog: (p: any) => {
    if (p.open) m.emailDialog = p;
    return p.open ? <div data-testid="send-invoice-dialog" /> : null;
  },
}));
vi.mock('@/components/invoices/delete-invoice-dialog', () => ({
  DeleteInvoiceDialog: (p: any) => {
    if (p.open) m.deleteDialog = p;
    return p.open ? <div data-testid="delete-invoice-dialog" /> : null;
  },
}));
vi.mock('@/components/fines/add-fine-dialog', () => ({ default: () => null }));
vi.mock('@/components/fines/bulk-action-bar', () => ({ BulkActionBar: () => null }));
vi.mock('@/components/payment-plans/payment-plan-card', () => ({ PaymentPlanCard: () => null }));
vi.mock('@/components/onboarding/tab-tour-button', () => ({ TabTourButton: () => null }));
vi.mock('@/integrations/supabase/client', () => {
  const tenantRow = { own_stripe_account_id: 'acct_OWN', own_stripe_test_account_id: null, stripe_account_id: null };
  const untyped = (data: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
  const invoices = () => {
    let id: unknown = null;
    const b: any = {
      select: () => b,
      eq: (col: string, v: unknown) => {
        m.invoiceReads.push(['eq', col, v]);
        if (col === 'id') id = v;
        return b;
      },
      maybeSingle: async () => ({ data: { id, invoice_number: `N-${id}`, total_amount: 1 }, error: null }),
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

/* ── rows ────────────────────────────────────────────────────────────────── */

const INV_NEW = { id: 'i-new', number: 'INV-0002', date: '2026-09-05', totalCents: 14000, status: 'pending', rentalId: 'r1', customerId: 'c1', createdAt: '2026-09-05T10:00:00Z' };
const INV_OLD = { id: 'i-old', number: 'INV-0001', date: '2026-09-01', totalCents: 10000, status: 'paid', rentalId: 'r1', customerId: 'c1', createdAt: '2026-09-01T10:00:00Z' };
const BOOKING: BillRow = { ...R1_BOOKING, invoiceNumber: 'INV-0002', invoiceId: 'i-new', invoices: [INV_NEW, INV_OLD] };
const INVOICE_ONLY: BillRow = bill({
  key: 'invoice:i-r2',
  rentalId: 'r2',
  rentalRef: 'R-1002',
  label: 'Invoice only',
  customerId: 'c2',
  customerName: 'Kristen Moss',
  invoiceNumber: 'INV-0003',
  invoiceId: 'i-r2',
  invoices: [{ id: 'i-r2', number: 'INV-0003', date: '2026-09-03', totalCents: 7550, status: 'paid', rentalId: 'r2', customerId: 'c2', createdAt: '2026-09-03T10:00:00Z' }],
  invoiceOnly: true,
  invoiceTotalCents: 7550,
  status: 'draft',
  issuedOn: '2026-09-03',
  dueOn: null,
});

const P_RENTAL = receipt({ paymentId: 'p1' });
const P_NO_RENTAL = receipt({ paymentId: 'p2', rentalId: null, rentalRef: null, provider: 'manual', providerRef: null, method: 'Cash', references: [] });
const P_OFF = receipt({
  paymentId: 'p-off',
  provider: 'manual',
  providerRef: null,
  providerMode: null,
  method: 'Cash',
  references: [],
  isOffPlatform: true,
  verificationStatus: 'approved',
});

const FINE = (id: string, amount: number, issue_date: string, status = 'Open') => ({
  id,
  reference_no: `PCN-${id}`,
  type: 'Toll',
  status,
  amount,
  issue_date,
  due_date: '2026-10-30',
  isOverdue: false,
  daysUntilDue: 30,
  rental_id: 'r1',
  customer_id: 'c1',
  vehicle_id: 'v1',
  customers: { name: 'Ghulam Ilyas' },
  vehicles: { reg: 'NW-01', make: 'Kia', model: 'Rio' },
  rentals: { rental_number: 'R-1001' },
  notes: null,
  resolved_at: status === 'Paid' ? '2026-09-21T15:00:00Z' : null,
  created_at: `${issue_date}T10:00:00Z`,
});

function finWith(over: Record<string, unknown> = {}) {
  const bills = (over.bills as BillRow[]) ?? [BOOKING, R1_EXTENSION, INVOICE_ONLY];
  const receipts = (over.receipts as any[]) ?? [P_RENTAL, P_NO_RENTAL, P_OFF];
  return {
    stats: STATS,
    attention: [],
    bills,
    receipts,
    upcoming: [],
    plansAvailable: false,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    model: { bills, receipts, upcoming: [], attention: [] },
    today: '2026-09-25',
    series: undefined,
    ...over,
  };
}

function renderView(search = '') {
  m.search = search;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <FinancesView />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const panel = async () => {
  await screen.findByRole('dialog');
  return document.querySelector<HTMLElement>('[data-tour="finances-side-panel"]')!;
};
const lastUrl = () => new URLSearchParams(((m.replace.mock.calls.at(-1)?.[0] as string) ?? '').split('?')[1] ?? '');
const chart = () => document.querySelector<HTMLElement>('[data-tour="finances-chart"]');
const pickerItems = () => {
  const trigger = screen.getByRole('button', { name: /^Metric:/ });
  act(() => {
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  });
  return within(screen.getByRole('menu'))
    .getAllByRole('menuitemradio')
    .map((i) => i.textContent?.trim());
};

beforeEach(() => {
  m.fin = finWith();
  m.calls = [];
  m.invoiceReads = [];
  m.deleteDialog = null;
  m.emailDialog = null;
  m.finesData = {
    data: { fines: [FINE('f1', 75, '2026-09-10', 'Paid'), FINE('f2', 30, '2026-09-20')], serverCount: 2 },
    isLoading: false,
    error: null,
    refetch: () => {},
    isRefetching: false,
  };
});
afterEach(() => vi.clearAllMocks());

/* ── 1 · the graph follows the view ──────────────────────────────────────── */

describe('the graph follows the view', () => {
  it('Billed opens on Collected, and offers no fine metric (the fines are not read here)', () => {
    renderView('view=billed');
    expect(chart()!.textContent).toContain('Collected');
    expect(pickerItems()).toEqual(['Collected', 'Payments collected']);
  });

  it('Received opens on Collected too', () => {
    renderView('view=received');
    expect(chart()!.textContent).toContain('Collected');
  });

  it('the Fines view opens on Fines issued — $105.00 from the list’s own two fines — with Fines paid in the picker', () => {
    renderView('view=fines');
    expect(chart()!.textContent).toContain('Fines issued');
    // f1 75.00 (10 Sep) + f2 30.00 (20 Sep), both in the last 30 days.
    expect(chart()!.textContent).toContain('$105.00');
    expect(pickerItems()).toEqual(['Collected', 'Payments collected', 'Fines issued', 'Fines issued (count)', 'Fines paid']);
  });

  it('waits for the fines list rather than draw no fines', () => {
    m.finesData = { data: undefined, isLoading: true, error: null, refetch: () => {}, isRefetching: false };
    renderView('view=fines');
    const placeholder = document.querySelector<HTMLElement>('[data-finances-chart-placeholder]')!;
    expect(placeholder.getAttribute('aria-label')).toBe('Fines issued');
    expect(placeholder.getAttribute('aria-busy')).toBe('true');
    expect(chart()).toBeNull();
  });

  it('a failed fines read is a dash, never $0', () => {
    m.finesData = { data: undefined, isLoading: false, error: new Error('boom'), refetch: () => {}, isRefetching: false };
    renderView('view=fines');
    const placeholder = document.querySelector<HTMLElement>('[data-finances-chart-placeholder]')!;
    expect(placeholder.textContent).toContain('—');
    expect(placeholder.textContent).not.toContain('$0');
  });
});

/* ── 2 · every invoice reachable ─────────────────────────────────────────── */

describe('every invoice is reachable', () => {
  it('the bill row names the newest invoice, and says there is one more', () => {
    renderView('view=billed');
    const row = document.querySelector<HTMLElement>('tr[data-bill-key="r1:booking"]')!;
    expect(row.textContent).toContain('INV-0002');
    expect(row.querySelector('[data-more-invoices]')!.textContent).toBe('+1');
  });

  it('the bill’s panel lists every invoice of the rental, newest first, each with Send email and Delete', async () => {
    renderView('view=billed&panel=bill:r1:booking');
    const p = await panel();
    const rows = [...p.querySelectorAll<HTMLElement>('[data-invoice-row]')];
    expect(rows.map((r) => r.getAttribute('data-invoice-row'))).toEqual(['i-new', 'i-old']);
    for (const r of rows) {
      expect(r.querySelector('[data-panel-action="email_invoice"]')).not.toBeNull();
      expect(r.querySelector('[data-panel-action="delete_invoice"]')).not.toBeNull();
    }
    expect(rows[1].textContent).toContain('INV-0001');
  });

  it('Delete on the OLDER invoice opens the Invoices tab’s dialog with that row, read by its id', async () => {
    renderView('view=billed&panel=bill:r1:booking');
    const p = await panel();
    const older = p.querySelector<HTMLElement>('[data-invoice-row="i-old"]')!;
    await act(async () => {
      fireEvent.click(older.querySelector('[data-panel-action="delete_invoice"]')!);
    });
    expect(m.invoiceReads).toEqual([
      ['eq', 'tenant_id', 't1'],
      ['eq', 'id', 'i-old'],
    ]);
    expect(m.deleteDialog.invoice).toMatchObject({ id: 'i-old' });
  });

  it('Send email on the older invoice sends that one', async () => {
    renderView('view=billed&panel=bill:r1:booking');
    const p = await panel();
    await act(async () => {
      fireEvent.click(p.querySelector('[data-invoice-row="i-old"] [data-panel-action="email_invoice"]')!);
    });
    expect(m.emailDialog.invoice).toMatchObject({ id: 'i-old' });
  });

  it('an invoice with no bill is an "Invoice only" row: its own total, no math, Draft', () => {
    renderView('view=billed');
    const row = document.querySelector<HTMLElement>('tr[data-bill-key="invoice:i-r2"]')!;
    expect(row.hasAttribute('data-invoice-only')).toBe(true);
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent?.trim());
    expect(cells[0]).toContain('R-1002');
    expect(cells[0]).toContain('Invoice only');
    expect(cells[0]).toContain('INV-0003');
    // Total · Paid · Credited · Balance · Status
    expect(cells.slice(3, 8)).toEqual(['$75.50', '—', '—', '—', 'Draft']);
  });

  it('its panel is the invoice’s own, with Send email and Delete, and claims no Paid or Balance', async () => {
    renderView('view=billed&panel=bill:invoice:i-r2');
    const p = await panel();
    const body = p.querySelector<HTMLElement>('[data-invoice-only-panel]')!;
    expect(body.textContent).toContain('Invoice INV-0003');
    expect(body.textContent).toContain('$75.50');
    expect(body.querySelector('[data-invoice-only-note]')).not.toBeNull();
    expect(body.querySelector('[data-bill-math]')).toBeNull();
    await act(async () => {
      fireEvent.click(body.querySelector('[data-panel-action="delete_invoice"]')!);
    });
    expect(m.invoiceReads.at(-1)).toEqual(['eq', 'id', 'i-r2']);
    expect(body.querySelector('[data-panel-action="email_invoice"]')).not.toBeNull();
  });

  it('offers a Draft status chip — only while an invoice-only row exists', () => {
    const r = renderView('view=billed');
    act(() => m.pageSearch.filters.onOpenChange(true));
    const chips = () => [...document.querySelectorAll('[data-filter-section="status"] button')].map((b) => b.textContent?.trim());
    expect(chips()).toEqual(['All', 'Open', 'Overdue', 'Paid', 'In credit', 'Draft']);
    r.unmount();
    m.fin = finWith({ bills: [BOOKING, R1_EXTENSION] });
    renderView('view=billed');
    act(() => m.pageSearch.filters.onOpenChange(true));
    expect(chips()).not.toContain('Draft');
  });
});

/* ── 3 · the empty states carry the old tabs' explainers ─────────────────── */

describe('empty states', () => {
  it('Received: payments.overview, the old Payments empty state’s own', () => {
    m.fin = finWith({ receipts: [] });
    renderView('view=received');
    const host = document.querySelector<HTMLElement>('[data-finance-explainer="payments.overview"]')!;
    expect(host.querySelector('[data-explainer-chip="payments.overview"]')!.textContent).toBe('Watch how');
    // The Finances tour still finds its empty state and headline.
    expect(document.querySelector('[data-finances-view="received"] [data-settings-state="empty"] h3')).not.toBeNull();
  });

  it('Billed: invoices.overview, the old Invoices empty state’s own', () => {
    m.fin = finWith({ bills: [] });
    renderView('view=billed');
    expect(document.querySelector('[data-finance-explainer="invoices.overview"] [data-explainer-chip="invoices.overview"]')).not.toBeNull();
    expect(document.querySelector('[data-finances-view="billed"] [data-settings-state="empty"] h3')).not.toBeNull();
  });
});

/* ── 4 · filter gaps ─────────────────────────────────────────────────────── */

describe('filters the old tabs had', () => {
  it('Received offers Auto-approved, after the statuses and before Payment requests, and writes it', () => {
    renderView('view=received');
    act(() => m.pageSearch.filters.onOpenChange(true));
    const labels = [...document.querySelectorAll('[data-filter-section="status"] button')].map((b) => b.textContent?.trim());
    expect(labels).toEqual(['All', 'Received', 'Awaiting review', 'Rejected', 'Refunded', 'Partly refunded', 'Not paid yet', 'Auto-approved', 'Payment requests']);
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-filter-section="status"]')!).getByText('Auto-approved'));
    expect(lastUrl().get('status')).toBe('auto_approved');
  });

  it('asks the model for exactly that filter', () => {
    renderView('view=received&status=auto_approved');
    expect(m.calls.at(-1)).toMatchObject({ statuses: ['auto_approved'] });
  });

  it('a payment on NO rental opens the customer’s payments tab, as the old View Ledger did — panel and row menu', async () => {
    renderView('view=received&panel=payment:p2');
    const p = await panel();
    expect(p.querySelector('[data-panel-link="customer"]')!.getAttribute('href')).toBe('/customers/c1?tab=payments');
  });

  it('…and a payment on a rental still opens the customer record', async () => {
    renderView('view=received&panel=payment:p1');
    const p = await panel();
    expect(p.querySelector('[data-panel-link="customer"]')!.getAttribute('href')).toBe('/customers/c1');
  });

  it('the row menu of a payment on no rental links the same way', () => {
    renderView('view=received');
    const buttons = screen.getAllByRole('button', { name: /Actions for the payment from/ });
    // Rows in the order given: p1, p2, p-off.
    act(() => {
      fireEvent.keyDown(buttons[1], { key: 'ArrowDown' });
    });
    expect(screen.getByRole('menu').querySelector('[data-row-link="customer"]')!.getAttribute('href')).toBe('/customers/c1?tab=payments');
  });
});

/* ── 5 · off-platform ────────────────────────────────────────────────────── */

describe('an off-platform payment', () => {
  it('is badged on its row', () => {
    renderView('view=received');
    const row = document.querySelector<HTMLElement>('tr[data-payment-id="p-off"]')!;
    expect(row.querySelector('[data-off-platform]')!.textContent).toBe('Off-platform');
    expect(document.querySelector('tr[data-payment-id="p1"] [data-off-platform]')).toBeNull();
  });

  it('its panel says so, and never sends anyone to Stripe or Square for it', async () => {
    renderView('view=received&panel=payment:p-off');
    const p = await panel();
    expect(p.querySelector('[data-off-platform]')!.textContent).toContain('Off-platform');
    expect(p.querySelector('[data-reference-kind="off_platform"]')).not.toBeNull();
    expect(p.querySelector('a[target="_blank"]')).toBeNull();
    expect(p.textContent).not.toMatch(/At Stripe|At Square/);
  });

  it('a card payment keeps its Stripe section', async () => {
    renderView('view=received&panel=payment:p1');
    const p = await panel();
    expect(p.textContent).toContain('At Stripe');
    expect(p.querySelector('[data-reference-kind="off_platform"]')).toBeNull();
  });
});
