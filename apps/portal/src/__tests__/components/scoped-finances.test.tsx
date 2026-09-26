/**
 * ScopedFinances — the Finances views for ONE rental or ONE customer, as
 * pinned between the POLISH and BALANCE builders:
 *
 *   props { scope: { rentalId } | { customerId }; views; defaultView?; heading?; compact? }
 *
 * What is proved: the rows come from `useFinances(filters, scope)` with the
 * scope passed through (and fines from the scope's own read, never the
 * tenant-wide fines list); the SAME tables, side panel and actions as the page
 * (a row opens the panel; Collect opens the portal's payment window aimed at
 * the bill); compact means status only; views follow the host AND the
 * viewer's grants; every state is said (loading, error — never $0 — empty with
 * the explainer, no match); and embedding it never touches the host page's URL
 * or the top bar's search.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceFilters, FinanceScope } from '@/lib/finances/types';
import { R1_BOOKING, R1_EXTENSION, receipt } from '../helpers/finances-ui-fixtures';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const m = vi.hoisted(() => ({
  financesOn: true,
  calls: [] as { filters: FinanceFilters; scope: FinanceScope | undefined }[],
  fin: {} as any,
  isManager: false,
  grants: {} as Record<string, 'viewer' | 'editor'>,
  replace: vi.fn(),
  push: vi.fn(),
  pageSearch: vi.fn(),
  tenantFinesCalls: 0,
  scopedFines: [] as unknown[][],
  scopedFinesResult: { data: { fines: [], serverCount: 0 }, isLoading: false, error: null, refetch: () => {}, isRefetching: false } as any,
  addPayment: null as any,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: m.replace, push: m.push }),
  usePathname: () => '/rentals/r1',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => React.createElement('a', { href, ...props }, children),
}));
vi.mock('@/lib/v2-context', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/v2-context')>();
  return { ...real, useV2: (area: string) => (area === 'finances' ? m.financesOn : false) };
});
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
  useFinances: (filters: FinanceFilters, scope?: FinanceScope) => {
    m.calls.push({ filters, scope });
    return m.fin;
  },
}));
vi.mock('@/hooks/use-fines-data', () => ({
  useFinesData: () => {
    m.tenantFinesCalls++;
    return { data: { fines: [], serverCount: 0 }, isLoading: false, error: null, refetch: () => {}, isRefetching: false };
  },
}));
vi.mock('@/hooks/use-finances-fines', () => ({
  useScopedFinanceFines: (...args: unknown[]) => {
    m.scopedFines.push(args);
    return m.scopedFinesResult;
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
vi.mock('@/components/shared/layout/page-search-slot', () => ({ usePageSearch: m.pageSearch }));
vi.mock('@/components/explainers/explainer', () => ({
  ExplainerChip: (p: any) => <button type="button" data-explainer-chip={p.id}>{p.label}</button>,
}));
vi.mock('@/components/shared/dialogs/add-payment-dialog', () => ({
  AddPaymentDialog: (p: any) => {
    m.addPayment = p;
    return <div data-testid="add-payment-dialog" />;
  },
}));
vi.mock('@/components/shared/dialogs/refund-dialog', () => ({ RefundDialog: () => null }));
vi.mock('@/components/invoices/send-invoice-email-dialog', () => ({ SendInvoiceEmailDialog: () => null }));
vi.mock('@/components/invoices/delete-invoice-dialog', () => ({ DeleteInvoiceDialog: () => null }));
vi.mock('@/components/fines/add-fine-dialog', () => ({ default: () => null }));
vi.mock('@/components/fines/bulk-action-bar', () => ({ BulkActionBar: () => null }));
vi.mock('@/components/payment-plans/payment-plan-card', () => ({ PaymentPlanCard: () => null }));
vi.mock('@/integrations/supabase/client', () => {
  const untyped = (data: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
  return { supabase: { from: () => untyped(null) }, supabaseUntyped: { from: () => untyped(null) } };
});

import { ScopedFinances, financeScopeOf, scopedFiltersOf, scopedViewsFor, SCOPED_DEFAULT_FILTERS, type ScopedFinancesProps } from '@/components/finances/scoped-finances';
import { TooltipProvider } from '@/components/ui-v2/tooltip';

const P1 = receipt({ paymentId: 'p1' });

function finWith(over: Record<string, unknown> = {}) {
  const bills = (over.bills as any[]) ?? [R1_BOOKING, R1_EXTENSION];
  const receipts = (over.receipts as any[]) ?? [P1];
  return {
    stats: undefined,
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

function renderScoped(props: Partial<ScopedFinancesProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <ScopedFinances scope={{ rentalId: 'r1' }} views={['billed', 'received', 'fines']} {...props} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const root = () => document.querySelector<HTMLElement>('[data-scoped-finances]');
const tabs = () => [...document.querySelectorAll('[data-finance-view]')].map((t) => t.getAttribute('data-finance-view'));
const chipLabels = (name: string) => [...document.querySelectorAll(`[data-scoped-filter="${name}"] button`)].map((b) => b.textContent?.trim());

beforeEach(() => {
  m.financesOn = true;
  m.calls = [];
  m.fin = finWith();
  m.isManager = false;
  m.grants = {};
  m.tenantFinesCalls = 0;
  m.scopedFines = [];
  m.addPayment = null;
  m.scopedFinesResult = { data: { fines: [], serverCount: 0 }, isLoading: false, error: null, refetch: () => {}, isRefetching: false };
});
afterEach(() => vi.clearAllMocks());

describe('the pure parts', () => {
  it('the scope becomes the model’s scope', () => {
    expect(financeScopeOf({ rentalId: 'r1' })).toEqual({ rentalId: 'r1' });
    expect(financeScopeOf({ customerId: 'c1' })).toEqual({ customerId: 'c1' });
  });

  it('opens on the whole history; compact filters by status only', () => {
    expect(SCOPED_DEFAULT_FILTERS).toEqual({ q: '', status: null, method: null, period: 'all' });
    const s = { q: 'smith', status: 'open', method: 'Cash', period: 'month' as const };
    expect(scopedFiltersOf(s, false)).toEqual({ search: 'smith', statuses: ['open'], methods: ['Cash'], period: 'month', card: null });
    expect(scopedFiltersOf(s, true)).toEqual({ period: 'all', statuses: ['open'], card: null });
  });

  it('views: the host’s, in the host’s order, that the viewer may see', () => {
    const can = (keys: string[]) => (k: string) => keys.includes(k);
    expect(scopedViewsFor(['fines', 'billed', 'received'], can(['payments', 'invoices', 'fines']))).toEqual(['fines', 'billed', 'received']);
    expect(scopedViewsFor(['billed', 'received', 'fines'], can(['fines']))).toEqual(['fines']);
    expect(scopedViewsFor(['billed', 'billed'], can(['invoices']))).toEqual(['billed']);
  });
});

describe('the rows are the scope’s', () => {
  it('passes the rental scope, and the whole history, to useFinances', () => {
    renderScoped();
    expect(m.calls.at(-1)).toEqual({ scope: { rentalId: 'r1' }, filters: { search: undefined, statuses: undefined, methods: undefined, period: 'all', card: null } });
    expect(root()!.getAttribute('data-scope-kind')).toBe('rental');
  });

  it('passes a customer scope', () => {
    renderScoped({ scope: { customerId: 'c1' }, views: ['billed', 'received'] });
    expect(m.calls.at(-1)!.scope).toEqual({ customerId: 'c1' });
    expect(root()!.getAttribute('data-scope-kind')).toBe('customer');
  });

  it('draws the page’s own Billed table, and a row opens the page’s own side panel', async () => {
    renderScoped();
    const rows = [...document.querySelectorAll('tr[data-bill-key]')].map((r) => r.getAttribute('data-bill-key'));
    expect(rows).toEqual(['r1:booking', 'r1:ext:e1']);
    fireEvent.click(document.querySelector('tr[data-bill-key="r1:ext:e1"]')!);
    await screen.findByRole('dialog');
    const panel = document.querySelector<HTMLElement>('[data-bill-panel="r1:ext:e1"]')!;
    expect(panel).not.toBeNull();
    // …with the page's actions: collect the 200.00 through the portal's own payment window.
    fireEvent.click(within(panel.parentElement!).getByRole('button', { name: 'Record payment' }));
    expect(m.addPayment).toMatchObject({ rental_id: 'r1', extensionId: 'e1', defaultAmount: 200 });
  });

  it('never touches the host page’s URL or the top bar’s search', async () => {
    renderScoped();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Received' }));
    fireEvent.click(document.querySelector('tr[data-payment-id="p1"]')!);
    await screen.findByRole('dialog');
    expect(m.replace).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
    expect(m.pageSearch).not.toHaveBeenCalled();
  });
});

describe('views', () => {
  it('opens on the host’s defaultView, and switches', () => {
    renderScoped({ defaultView: 'received' });
    expect(root()!.getAttribute('data-scoped-view')).toBe('received');
    expect(document.querySelector('tr[data-payment-id="p1"]')).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Billed' }));
    expect(root()!.getAttribute('data-scoped-view')).toBe('billed');
  });

  it('shows only the views the viewer may see', () => {
    m.isManager = true;
    m.grants = { payments: 'viewer' };
    renderScoped();
    // One view: no switch; Received alone.
    expect(tabs()).toEqual([]);
    expect(root()!.getAttribute('data-scoped-view')).toBe('received');
  });

  it('asks for Upcoming only where payment plans exist', () => {
    renderScoped({ views: ['billed', 'upcoming'] });
    expect(tabs()).toEqual([]);
    expect(root()!.getAttribute('data-scoped-view')).toBe('billed');
  });

  it('nothing to show → nothing drawn', () => {
    m.isManager = true;
    m.grants = { rentals: 'editor' };
    renderScoped();
    expect(root()).toBeNull();
  });

  it('renders nothing unless the tenant is on the finances area (canary only, like the page)', () => {
    m.financesOn = false;
    renderScoped();
    expect(root()).toBeNull();
    expect(m.calls).toHaveLength(0);
  });
});

describe('fines, scoped', () => {
  it('reads the scope’s own fines — never the tenant-wide fines list', () => {
    m.scopedFinesResult = {
      data: {
        fines: [
          { id: 'f1', reference_no: 'PCN-1', type: 'Toll', status: 'Open', amount: 75, issue_date: '2026-09-01', due_date: '2026-09-30', isOverdue: false, daysUntilDue: 5, rental_id: 'r1', customer_id: 'c1', vehicle_id: 'v1', customers: { name: 'Ghulam' }, vehicles: { reg: 'NW-01' }, rentals: { rental_number: 'R-1001' } },
        ],
        serverCount: 1,
      },
      isLoading: false,
      error: null,
      refetch: () => {},
      isRefetching: false,
    };
    renderScoped({ defaultView: 'fines' });
    expect(m.scopedFines.at(-1)).toEqual([{ rentalId: 'r1' }, '', null]);
    expect(m.tenantFinesCalls).toBe(0);
    expect(document.querySelector('tr[data-fine-id="f1"]')).not.toBeNull();
  });

  it('says so when the scope has no fines', () => {
    renderScoped({ defaultView: 'fines' });
    expect(screen.getByText('No fines')).toBeInTheDocument();
  });
});

describe('filters', () => {
  it('full: search, status, method (Received) and period', () => {
    renderScoped({ defaultView: 'received' });
    expect(document.querySelector('[data-scoped-search]')).not.toBeNull();
    expect(chipLabels('status')).toContain('Auto-approved');
    expect(chipLabels('method')!.slice(0, 3)).toEqual(['All', 'Stripe', 'Square']);
    expect(chipLabels('period')).toEqual(['All', 'This month', '7 days', 'Today']);
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-scoped-filter="status"]')!).getByText('Awaiting review'));
    expect(m.calls.at(-1)!.filters.statuses).toEqual(['pending_review']);
    fireEvent.change(document.querySelector('[data-scoped-search]')!, { target: { value: 'pi_3P' } });
    expect(m.calls.at(-1)!.filters.search).toBe('pi_3P');
  });

  it('compact: status only', () => {
    renderScoped({ compact: true });
    expect(document.querySelector('[data-scoped-search]')).toBeNull();
    expect(document.querySelector('[data-scoped-filter="method"]')).toBeNull();
    expect(document.querySelector('[data-scoped-filter="period"]')).toBeNull();
    expect(chipLabels('status')).toEqual(['All', 'Open', 'Overdue', 'Paid', 'In credit']);
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-scoped-filter="status"]')!).getByText('Overdue'));
    expect(m.calls.at(-1)!.filters).toEqual({ period: 'all', statuses: ['overdue'], card: null });
  });

  it('a filter that matches nothing says so — not "nothing yet" — and clears', () => {
    m.fin = finWith({ bills: [] });
    renderScoped();
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-scoped-filter="status"]')!).getByText('Overdue'));
    const noMatch = document.querySelector<HTMLElement>('[data-settings-state="no-match"]')!;
    expect(noMatch).not.toBeNull();
    expect(document.querySelector('[data-finance-explainer]')).toBeNull();
    fireEvent.click(within(noMatch).getByRole('button'));
    expect(m.calls.at(-1)!.filters).toEqual({ search: undefined, statuses: undefined, methods: undefined, period: 'all', card: null });
  });
});

describe('every state is said', () => {
  it('loading', () => {
    m.fin = finWith({ isLoading: true, bills: [], receipts: [], model: undefined });
    renderScoped();
    expect(screen.getByText('Loading billed')).toBeInTheDocument();
  });

  it('a failed read is an error, never $0', () => {
    m.fin = finWith({ error: new Error('permission denied'), bills: [], receipts: [], model: undefined });
    renderScoped();
    expect(screen.getByText(/Couldn.t load this rental.s money/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('$0.00');
  });

  it('nothing yet: Billed and Received carry the old tabs’ explainers', () => {
    m.fin = finWith({ bills: [], receipts: [] });
    renderScoped();
    expect(screen.getByText('Nothing billed to this rental yet')).toBeInTheDocument();
    expect(document.querySelector('[data-explainer-chip="invoices.overview"]')).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Received' }));
    expect(screen.getByText('No payments from this rental yet')).toBeInTheDocument();
    expect(document.querySelector('[data-explainer-chip="payments.overview"]')).not.toBeNull();
  });

  it('a heading, when the host gives one', () => {
    renderScoped({ heading: 'Money on this rental' });
    expect(screen.getByRole('heading', { name: 'Money on this rental' })).toBeInTheDocument();
    expect(root()!.getAttribute('aria-label')).toBe('Money on this rental');
  });
});
