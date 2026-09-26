/**
 * The Finances screen, rendered (docs/FINANCES_DESIGN.md §2, §4, §5).
 *
 * `useFinances` is mocked with fixture rows (the model agent owns and tests the
 * numbers); what is proved here is that the SCREEN tells the truth about them:
 *
 *  - the overview is the hero row (one graph, one card), and a failed read
 *    shows dashes — never $0 — with the failing read named in development;
 *  - the top bar's filter button turns the overview over to the filter panel,
 *    whose chips write to the URL; with a figure chosen ("Show") the hook is
 *    asked for exactly those rows, which are listed and added up underneath;
 *  - Needs attention renders each item's fixes, wired to the existing paths;
 *  - a bill that does not tie out says "Doesn't add up by $X";
 *  - the side panel tells the whole story of a bill and of a payment;
 *  - the views follow the manager's grants, and viewers get no actions;
 *  - on a phone the rows collapse and the side panel is full width.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem, FinanceFilters, FinanceStats } from '@/lib/finances/types';
import { DRIFT, R1_BOOKING, R1_EXTENSION, receipt, upcoming } from '../helpers/finances-ui-fixtures';

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
  upcomingCents: 20000,
  upcomingCount: 1,
  upcomingAuto: 1,
  upcomingLinks: 0,
};

const m = vi.hoisted(() => ({
  search: '',
  replace: vi.fn(),
  calls: [] as unknown[],
  fin: {} as any,
  isManager: false,
  grants: {} as Record<string, 'viewer' | 'editor'>,
  approve: vi.fn(),
  reject: vi.fn(),
  finesData: { data: { fines: [], serverCount: 0 }, isLoading: false, error: null, refetch: () => {}, isRefetching: false } as any,
  finesCalls: 0,
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
  usePaymentVerificationActions: () => ({ approvePayment: { mutate: m.approve }, rejectPayment: { mutate: m.reject }, isLoading: false }),
}));
vi.mock('@/hooks/use-void-payment-link', () => ({ useVoidPaymentLink: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/hooks/use-payment-plan', () => ({
  usePaymentPlan: () => ({ data: undefined, isLoading: true, error: null }),
  usePaymentPlanActions: () => ({}),
}));
vi.mock('@/hooks/use-fines-data', () => ({
  useFinesData: () => {
    m.finesCalls++;
    return m.finesData;
  },
}));
vi.mock('@/components/shared/layout/page-search-slot', () => ({
  usePageSearch: (reg: any) => {
    m.pageSearch = reg;
  },
}));
vi.mock('@/components/shared/dialogs/add-payment-dialog', () => ({
  AddPaymentDialog: (p: any) => (
    <div data-testid="add-payment-dialog" data-rental={p.rental_id ?? ''} data-extension={p.extensionId ?? ''} data-amount={p.defaultAmount ?? ''} />
  ),
}));
vi.mock('@/components/shared/dialogs/refund-dialog', () => ({
  RefundDialog: (p: any) => <div data-testid="refund-dialog" data-payment={p.paymentId} data-category={p.category} data-paid={p.paidAmount} />,
}));
vi.mock('@/components/invoices/send-invoice-email-dialog', () => ({ SendInvoiceEmailDialog: () => null }));
vi.mock('@/components/fines/add-fine-dialog', () => ({ default: () => null }));
vi.mock('@/components/fines/bulk-action-bar', () => ({ BulkActionBar: () => null }));
vi.mock('@/components/payment-plans/payment-plan-card', () => ({ PaymentPlanCard: () => <div data-testid="plan-card" /> }));
vi.mock('@/integrations/supabase/client', () => {
  const tenantRow = { own_stripe_account_id: 'acct_OWN123', own_stripe_test_account_id: null, stripe_account_id: 'acct_MANAGED9' };
  const chain = (data: unknown) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) });
  return {
    supabase: {},
    supabaseUntyped: { from: (table: string) => chain(table === 'tenants' ? tenantRow : { name: 'Kristen' }) },
  };
});

import { FinancesView } from '@/components/finances/finances-view';
import { TooltipProvider } from '@/components/ui-v2/tooltip';

const ATTENTION: AttentionItem[] = [
  {
    key: 'declined-o3',
    kind: 'card_declined',
    title: 'Payment 3 of 5 was declined',
    detail: 'The card was declined on Fri 18 Sep.',
    amountCents: 20000,
    rentalId: 'r1',
    customerId: 'c1',
    paymentIds: [],
    occurrenceId: 'o3',
  },
  {
    key: 'review-p9',
    kind: 'awaiting_review',
    title: 'A $120.00 payment is waiting for you to check it',
    detail: 'Recorded as Zelle on 19 Sep.',
    amountCents: 12000,
    rentalId: 'r1',
    customerId: 'c1',
    paymentIds: ['p9'],
    occurrenceId: null,
  },
  {
    key: 'dup-p1-p2',
    kind: 'possible_duplicate',
    title: 'Two payments of $530.00 on the same day',
    detail: '',
    amountCents: 53000,
    rentalId: 'r1',
    customerId: 'c1',
    paymentIds: ['p1', 'p2'],
    occurrenceId: null,
  },
];

const P1 = receipt({ paymentId: 'p1', providerAccount: 'acct_OWN123', providerRef: 'pi_3PabcDEF123' });
const P2 = receipt({ paymentId: 'p2', providerRef: 'pi_3PzzzYYY999' });
const P9 = receipt({ paymentId: 'p9', status: 'pending_review', provider: 'manual', providerRef: null, method: 'Zelle', verificationStatus: 'pending', amountCents: 12000, netCents: 12000, appliedTo: [], countsAsReceived: false });
const U1 = upcoming({ occurrenceId: 'o1' });

function finWith(over: Record<string, unknown> = {}) {
  const bills = [R1_BOOKING, R1_EXTENSION, DRIFT];
  const receipts = [P1, P2, P9];
  return {
    stats: STATS,
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
    // The model's series (lib/finances/series.ts), hand-derived: R1's extension
    // 200.00 is 15 days late on 25 Sep; the booking nets to 0.
    series: {
      ageing: {
        buckets: [
          { key: 'current', label: 'Current', cents: 0 },
          { key: 'd1_30', label: '1–30 days', cents: 20000 },
          { key: 'd31_60', label: '31–60 days', cents: 0 },
          { key: 'd60_plus', label: 'Over 60 days', cents: 0 },
        ],
        totalCents: 20000,
        overdueCents: 20000,
      },
    },
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

/** The side panel (portalled into <body>) once it has opened. */
const panelOf = async (selector: string) => {
  await screen.findByRole('dialog');
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector} in the panel`);
  return el;
};

/** The query string the last `router.replace` wrote. */
const lastUrl = () => {
  const href = m.replace.mock.calls.at(-1)?.[0] as string;
  return new URLSearchParams(href.split('?')[1] ?? '');
};

beforeEach(() => {
  m.fin = finWith();
  m.calls = [];
  m.isManager = false;
  m.grants = {};
  m.finesCalls = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

/* ── the math strip ──────────────────────────────────────────────────────── */

/** Turn the overview over, as the top bar's filter button does. */
const openFilters = () => act(() => m.pageSearch.filters.onOpenChange(true));
const panelSection = (name: string) => document.querySelector<HTMLElement>(`[data-filter-section="${name}"]`);
const chips = (name: string) => [...(panelSection(name)?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim());

describe('the overview (the hero row)', () => {
  it('is one graph and one card, like the other hero tabs', () => {
    renderView();
    const overview = document.querySelector<HTMLElement>('[data-finances-overview]')!;
    expect(overview.querySelectorAll('[data-hero-chart]')).toHaveLength(1);
    expect(overview.querySelectorAll('[data-hero-card]')).toHaveLength(1);
    expect(overview.querySelector('[data-finances-owed]')).not.toBeNull();
  });

  it('the graph is Collected: p1 and p2, $530.00 each, in the last 30 days — the link waiting on review adds nothing', () => {
    renderView();
    const chart = document.querySelector<HTMLElement>('[data-hero-chart]')!;
    expect(chart.querySelector('[data-tour="finances-chart"]')!.textContent).toContain('Collected');
    expect(chart.textContent).toContain('$1,060.00');
  });

  it('the card is Outstanding, its ageing, Overdue and what is due in the next 7 days, from the stats', () => {
    renderView();
    const card = document.querySelector<HTMLElement>('[data-finances-owed]')!;
    expect(card.querySelector('[data-owed-outstanding]')!.textContent).toBe('$200.00');
    expect(card.textContent).toContain('Owed by 1 customer');
    expect(card.querySelector('[data-owed-overdue]')!.textContent).toContain('$200.00');
    expect(card.querySelector('[data-owed-overdue]')!.textContent).toContain('1 rental');
    expect(card.querySelector('[data-owed-upcoming]')!.textContent).toContain('$200.00');
    // 200.00 fell due on 10 Sep: 15 days late on 25 Sep.
    expect(card.querySelector('[data-ageing="d1_30"]')!.textContent).toContain('$200.00');
    expect(card.querySelector('[data-ageing="current"]')!.textContent).toContain('$0.00');
  });

  it('shows a failed read as dashes, never as $0, with the calm copy outside development', () => {
    m.fin = finWith({ stats: undefined, error: new Error('Could not load payments: permission denied for table payments'), bills: [], receipts: [], upcoming: [], attention: [], model: undefined });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderView();
    const overview = document.querySelector<HTMLElement>('[data-finances-overview]')!;
    expect(overview.textContent).toContain('—');
    expect(document.body.textContent).not.toContain('$0.00');
    expect(screen.getByText(/Couldn.t load your finances/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('permission denied for table payments');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('in development, names the read that failed and what the database said', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      m.fin = finWith({ stats: undefined, error: new Error('Could not load payments: column payments.payment_plan_occurrence_id does not exist'), bills: [], receipts: [], upcoming: [], attention: [], model: undefined });
      renderView();
      expect(screen.getByText('Could not load payments: column payments.payment_plan_occurrence_id does not exist')).toBeInTheDocument();
      expect(spy.mock.calls.some((c) => String(c[0]).includes('[finances]'))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      spy.mockRestore();
    }
  });

  it('leaves out what is due on a plan when payment plans are not available', () => {
    m.fin = finWith({ plansAvailable: false });
    renderView();
    expect(document.querySelector('[data-owed-upcoming]')).toBeNull();
    expect(document.querySelector('[data-finance-view="upcoming"]')).toBeNull();
  });

  it('is not a filter: nothing in the row changes the list', () => {
    renderView();
    const overview = document.querySelector<HTMLElement>('[data-finances-overview]')!;
    fireEvent.click(overview.querySelector('[data-finances-owed]')!);
    expect(m.replace).not.toHaveBeenCalled();
  });
});

describe('the filter panel, on the back of the overview', () => {
  it('lends the top bar its search and a filter button carrying the active count', () => {
    renderView('view=billed&status=open&card=overdue&q=smith');
    expect(m.pageSearch.value).toBe('smith');
    expect(m.pageSearch.filters.open).toBe(false);
    // status + card; the search is never counted.
    expect(m.pageSearch.filters.activeCount).toBe(2);
  });

  it('turns over from the filter button and back from its ✕', () => {
    renderView();
    const flip = () => document.querySelector<HTMLElement>('[data-finances-overview]')!;
    expect(panelSection('show')).not.toBeNull(); // mounted, on the hidden face
    openFilters();
    expect(m.pageSearch.filters.open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(m.pageSearch.filters.open).toBe(false);
    expect(flip()).not.toBeNull();
  });

  it('offers the figures, the view’s statuses and the period — no method on Billed', () => {
    renderView('view=billed');
    openFilters();
    expect(chips('show')).toEqual(['Everything', 'Outstanding', 'Overdue', 'Collected', 'Due next 7 days']);
    expect(chips('status')).toEqual(['All', 'Open', 'Overdue', 'Paid', 'In credit']);
    expect(chips('period')).toEqual(['Today', '7 days', 'This month', 'All', 'Custom']);
    expect(panelSection('method')).toBeNull();
  });

  it('adds Method on Received, and drops Period on Fines', () => {
    renderView('view=received');
    openFilters();
    expect(chips('method')?.slice(0, 3)).toEqual(['All', 'Stripe', 'Square']);
    expect(chips('method')).toContain('Card');
  });

  it('writes a chosen figure, and the view its rows live in, to the URL', () => {
    renderView('view=received');
    openFilters();
    fireEvent.click(within(panelSection('show')!).getByText('Overdue'));
    expect(lastUrl().get('card')).toBe('overdue');
    expect(lastUrl().get('view')).toBe('billed');
  });

  it('writes a status', () => {
    renderView('view=billed');
    openFilters();
    fireEvent.click(within(panelSection('status')!).getByText('Overdue'));
    expect(lastUrl().get('status')).toBe('overdue');
  });

  it('Reset clears the panel and keeps the search', () => {
    renderView('view=billed&status=open&card=overdue&period=7d&q=smith');
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    const url = lastUrl();
    expect(url.get('q')).toBe('smith');
    expect(url.get('status')).toBeNull();
    expect(url.get('card')).toBeNull();
    expect(url.get('period')).toBeNull();
  });

  it('with a figure in the URL, asks the model for it, lists what came back, and adds it up again', () => {
    // The model returns the Overdue figure's rows: the extension bill only.
    m.fin = finWith({ bills: [R1_EXTENSION] });
    renderView('view=billed&card=overdue');
    expect(m.calls.at(-1)).toMatchObject({ card: 'overdue', period: 'month' });
    const rows = document.querySelectorAll('tr[data-bill-key]');
    expect([...rows].map((r) => r.getAttribute('data-bill-key'))).toEqual(['r1:ext:e1']);
    const sum = document.querySelector('[data-finance-sum]')!;
    expect(sum.textContent).toContain('Overdue on these bills');
    // …and it is the figure's own number.
    expect(sum.querySelector('[data-finance-sum-value]')!.textContent).toBe('$200.00');
  });

  it('has no Period on the Fines view, which keeps every fine on screen', () => {
    renderView('view=fines');
    openFilters();
    expect(panelSection('period')).toBeNull();
    expect(chips('status')).toContain('Overdue');
  });
});

describe('the view switch', () => {
  it('is the v2 in-page tab strip, one pill per view the user may see', () => {
    renderView('view=received');
    const list = screen.getByRole('tablist', { name: 'Finances views' });
    expect(list.className).toContain('flex-wrap');
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('data-finance-view'))).toEqual(['billed', 'received', 'upcoming', 'fines']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });

  it('switching view writes it, and drops the other view’s status', () => {
    renderView('view=received&status=pending_review');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Billed' }));
    const url = lastUrl();
    expect(url.get('view')).toBe('billed');
    expect(url.get('status')).toBeNull();
  });
});

describe('Needs attention', () => {
  it('renders each item with its fixes', () => {
    renderView();
    const item = (kind: string) => document.querySelector<HTMLElement>(`[data-attention-kind="${kind}"]`)!;
    const fixes = (kind: string) => [...item(kind).querySelectorAll('button, a')].map((b) => b.textContent?.trim());
    expect(fixes('card_declined')).toEqual(['Send link', 'Retry', 'Record payment']);
    expect(fixes('awaiting_review')).toEqual(['Approve', 'Reject', 'Details']);
    expect(fixes('possible_duplicate')).toEqual(['Review']);
    expect(item('card_declined').textContent).toContain('$200.00');
  });

  it('Approve runs the Payments tab’s own approve', () => {
    renderView();
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-attention-kind="awaiting_review"]')!).getByText('Approve'));
    expect(m.approve).toHaveBeenCalledWith('p9', expect.anything());
  });

  it('Reject warns that it closes the rental before anything happens', () => {
    renderView();
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-attention-kind="awaiting_review"]')!).getByText('Reject'));
    expect(screen.getByText(/closes the entire rental/)).toBeInTheDocument();
    expect(m.reject).not.toHaveBeenCalled();
  });

  it('Review opens the payments side by side in the panel', () => {
    renderView();
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-attention-kind="possible_duplicate"]')!).getByText('Review'));
    expect(lastUrl().get('panel')).toBe('payments:p1,p2');
  });

  it('a read-only user sees every item and no money-moving fix', () => {
    m.isManager = true;
    m.grants = { payments: 'viewer', invoices: 'viewer', fines: 'viewer' };
    renderView();
    expect(document.querySelectorAll('[data-attention-kind]')).toHaveLength(3);
    expect(screen.queryByText('Send link')).toBeNull();
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.getByText('Details')).toBeInTheDocument();
  });

  it('is not drawn when nothing needs attention', () => {
    m.fin = finWith({ attention: [] });
    renderView();
    expect(document.querySelector('[data-finances-attention]')).toBeNull();
  });
});

/* ── Billed: the tie-out marker ──────────────────────────────────────────── */

describe('Billed', () => {
  it('writes Total · Paid · Credited · Balance for each bill', () => {
    renderView('view=billed');
    const row = document.querySelector<HTMLElement>('tr[data-bill-key="r1:booking"]')!;
    const cells = [...row.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells).toEqual(expect.arrayContaining(['$550.00', '$530.00', '$20.00']));
    expect(row.getAttribute('data-tie-out')).toBe('ok');
    expect(row.querySelector('[data-tie-out-marker]')).toBeNull();
  });

  it('flags a bill that does not add up, instead of quietly showing a number', () => {
    renderView('view=billed');
    const row = document.querySelector<HTMLElement>('tr[data-bill-key="r2:booking"]')!;
    expect(row.getAttribute('data-tie-out')).toBe('mismatch');
    expect(row.querySelector('[data-tie-out-marker]')!.textContent).toBe("Doesn't add up by $100.00");
  });

  it('opens a bill in the side panel', () => {
    renderView('view=billed');
    fireEvent.click(within(document.querySelector<HTMLElement>('tr[data-bill-key="r1:booking"]')!).getAllByRole('cell')[0]);
    expect(lastUrl().get('panel')).toBe('bill:r1:booking');
  });
});

/* ── the side panel ──────────────────────────────────────────────────────── */

describe('the side panel', () => {
  it('tells a bill’s whole story: every line, who paid, and the math written out', async () => {
    renderView('view=billed&panel=bill:r1:booking');
    const body = await panelOf('[data-bill-panel="r1:booking"]');
    for (const category of ['Rental', 'Tax', 'Adjustment']) expect(within(body).getByText(category)).toBeInTheDocument();
    expect(body.querySelector('[data-bill-math]')!.textContent).toBe(
      'Total $550.00 − Paid $530.00 − Credited $20.00 = Balance $0.00',
    );
    // p1 paid 500.00 + 30.00 of it.
    expect(within(body).getByText('$530.00 here')).toBeInTheDocument();
  });

  it('shows why a bill does not tie out', async () => {
    renderView('view=billed&panel=bill:r2:booking');
    const body = await panelOf('[data-bill-panel="r2:booking"]');
    expect(body.querySelector('[data-tie-out-marker]')!.textContent).toContain("Doesn't add up by $100.00");
    expect(body.querySelector('[data-bill-math]')!.textContent).toContain("but the ledger's balance is $0.00");
  });

  it('offers to collect what is left on an owed bill, through the existing payment window', async () => {
    renderView('view=billed&panel=bill:r1:ext:e1');
    fireEvent.click(await screen.findByText('Send payment link'));
    const dialog = screen.getByTestId('add-payment-dialog');
    expect(dialog.getAttribute('data-rental')).toBe('r1');
    expect(dialog.getAttribute('data-extension')).toBe('e1');
    expect(dialog.getAttribute('data-amount')).toBe('200');
  });

  it('tells a payment’s story: the Stripe reference with a verified link, and what it paid off', async () => {
    renderView('view=received&panel=payment:p1');
    const body = await panelOf('[data-payment-panel="p1"]');
    expect(within(body).getByText('$530.00 from Ghulam Ilyas')).toBeInTheDocument();
    expect(within(body).getByText('pi_3PabcDEF123')).toBeInTheDocument();
    const link = await within(body).findByRole('link', { name: /Open in Stripe/ });
    expect(link.getAttribute('href')).toBe('https://dashboard.stripe.com/payments/pi_3PabcDEF123');
    expect(within(body).getByText('Rental')).toBeInTheDocument();
    expect(within(body).getByText('$500.00')).toBeInTheDocument();
    expect(body.querySelector('[data-payment-math]')!.textContent).toBe('$530.00 received = $530.00 applied');
  });

  it('never guesses a link when the account is not proved — it says how to find it', async () => {
    renderView('view=received&panel=payment:p2');
    const body = await panelOf('[data-payment-panel="p2"]');
    expect(body.querySelector('[data-reference-kind]')!.getAttribute('data-reference-kind')).toBe('route');
    expect(within(body).queryByRole('link', { name: /Open in Stripe/ })).toBeNull();
    expect(body.textContent).toContain('Search your Stripe dashboard for this reference');
  });

  it('refunds through the existing refund window, on the category most of it went to', async () => {
    renderView('view=received&panel=payment:p1');
    fireEvent.click(await screen.findByRole('button', { name: /Refund \(up to \$530\.00\)/ }));
    const dialog = screen.getByTestId('refund-dialog');
    expect(dialog.getAttribute('data-payment')).toBe('p1');
    expect(dialog.getAttribute('data-category')).toBe('Rental');
    expect(dialog.getAttribute('data-paid')).toBe('530');
  });

  it('lists possible duplicates side by side, each with its own refund', async () => {
    renderView('view=received&panel=payments:p1,p2');
    const body = await panelOf('[data-payments-panel]');
    expect(within(body).getByText('Possible duplicate')).toBeInTheDocument();
    expect(within(body).getAllByText('Refund this one')).toHaveLength(2);
  });

  it('says so when the row is not in the list, and offers to clear the filters', async () => {
    renderView('view=received&panel=payment:nope');
    const sheet = await panelOf('[data-finance-panel="payment"]');
    expect(within(sheet).getByRole('heading', { name: "This payment isn't in the list" })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Clear the filters' })).toBeInTheDocument();
  });

  it('is full width on a phone', async () => {
    renderView('view=billed&panel=bill:r1:booking');
    const sheet = await panelOf('[data-finance-panel="bill"]');
    expect(sheet.className).toContain('data-[side=right]:w-full');
    expect(sheet.className).toContain('data-[side=right]:sm:max-w-[520px]');
  });
});

/* ── views follow grants ─────────────────────────────────────────────────── */

describe('views follow the manager’s grants', () => {
  it('fines only: the Fines view alone, no strip, no money actions', () => {
    m.isManager = true;
    m.grants = { fines: 'editor' };
    renderView();
    expect(document.querySelector('[data-finances-view="fines"]')).not.toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.querySelector('[data-finances-overview]')).toBeNull();
    expect(screen.queryByText('Record payment')).toBeNull();
    expect(m.finesCalls).toBeGreaterThan(0);
  });

  it('invoices only: Billed, and the owed card with no graph of money received', () => {
    m.isManager = true;
    m.grants = { invoices: 'viewer' };
    renderView('view=received');
    expect(document.querySelector('[data-finances-view="billed"]')).not.toBeNull();
    const overview = document.querySelector<HTMLElement>('[data-finances-overview]')!;
    expect(overview.querySelector('[data-finances-owed]')).not.toBeNull();
    expect(overview.querySelector('[data-tour="finances-chart"]')).toBeNull();
    // What is due on a plan is Payments' — not shown on an invoices-only grant.
    expect(overview.querySelector('[data-owed-upcoming]')).toBeNull();
  });

  it('payments as a viewer: Received and Upcoming, every figure, no Record payment', () => {
    m.isManager = true;
    m.grants = { payments: 'viewer' };
    renderView('view=received');
    const tabs = [...document.querySelectorAll('[data-finance-view]')].map((t) => t.getAttribute('data-finance-view'));
    expect(tabs).toEqual(['received', 'upcoming']);
    expect(screen.queryByRole('button', { name: /Record payment/ })).toBeNull();
    expect(document.querySelector('[data-tour="finances-chart"]')!.textContent).toContain('$1,060.00');
    // Outstanding is Billed's: no owed card on a payments-only grant.
    expect(document.querySelector('[data-finances-owed]')).toBeNull();
  });

  it('the Fines view is not read at all until it is opened', () => {
    renderView('view=billed');
    expect(m.finesCalls).toBe(0);
  });
});

/* ── a phone ─────────────────────────────────────────────────────────────── */

describe('on a phone', () => {
  it('hides the table and shows each row’s key facts, with no fixed grid of three or more', () => {
    renderView('view=billed');
    const table = document.querySelector('table')!;
    expect(table.closest('.hidden.sm\\:block')).not.toBeNull();
    const phone = document.querySelector('[data-finance-mobile-rows]')!;
    expect(phone.className.split(/\s+/)).toContain('sm:hidden');
    expect(phone.querySelectorAll('li')).toHaveLength(3);
    expect(phone.textContent).toContain("Doesn't add up by $100.00");
    // The hero row stacks below lg, as on every hero tab.
    const row = document.querySelector('[data-hero-chart]')!.parentElement!;
    expect(row.className.split(/\s+/)).toContain('grid-cols-1');
  });
});
