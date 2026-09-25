/**
 * The plan card, rendered from PLAIN rows (the same way the simulator renders
 * it): the math line is the sum of the rows on screen, every row action exists
 * and is either usable or disabled with a reason, and a provider reference gets
 * a dashboard link only when one can be proven.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PaymentPlanCard, type PaymentPlanCardActions } from '@/components/payment-plans/payment-plan-card';
import type { OccurrenceStatus } from '@/lib/payment-plans/types';
import type { AttemptView, OccurrenceView, PlanView } from '@/lib/payment-plans-ui/view-types';

const plan: PlanView = {
  id: 'p1', tenantId: 't', rentalId: 'r', customerId: 'c', status: 'active',
  rule: { freq: 'weekly', interval: 1, byWeekday: [5], anchor: '2026-10-02', firstOccurrence: 'on_anchor', end: { kind: 'count', count: 4 } },
  amount: { mode: 'split_total', totalCents: 80000 }, currency: 'usd', timezone: 'America/New_York', chargeLocalTime: '10:00',
  collectionMethod: 'auto_charge', fallbackToLink: true, maxAttempts: 3, retryAfterDays: 2, reminderOffsets: [-2, 0, 2],
  paymentProvider: 'stripe', stripePaymentMethodId: 'pm_1', extendsRental: false, version: 1,
};
const occ = (seq: number, dueDate: string, amount: number, paid: number, status: OccurrenceStatus): OccurrenceView => ({
  id: `o${seq}`, planId: 'p1', tenantId: 't', rentalId: 'r', seq, planVersion: 1, dueDate, dueAt: `${dueDate}T14:00:00.000Z`,
  periodStart: dueDate, periodEnd: dueDate, amountCents: amount, amountPaidCents: paid, collectionMethod: 'auto_charge',
  status, attemptNo: 0, nextAttemptAt: null,
});
const ROWS = [
  occ(1, '2026-10-02', 20000, 20000, 'paid'),
  occ(2, '2026-10-09', 20000, 0, 'failed'),
  occ(3, '2026-10-16', 20000, 5000, 'partially_paid'),
  occ(4, '2026-10-23', 20000, 0, 'scheduled'),
];
const attempt = (over: Partial<AttemptView>): AttemptView => ({
  id: 'a1', occurrenceId: 'o1', attemptNo: 1, method: 'auto_charge', idempotencyKey: 'pp:acct_OwnLive1234:o1:1', status: 'succeeded',
  provider: 'stripe', providerAccount: 'acct_OwnLive1234', providerMode: 'live', providerRef: 'pi_Paid1', paymentId: 'pay1',
  amountCents: 20000, declineCode: null, errorCode: null, errorMessage: null, ...over,
});
const ACCOUNTS = { ownLive: 'acct_OwnLive1234', ownTest: null, managed: 'acct_Managed9999' };

const actions = (): PaymentPlanCardActions => ({
  retry: vi.fn(async () => {}), sendLink: vi.fn(async () => {}), recordPayment: vi.fn(async () => {}), move: vi.fn(async () => {}),
  skip: vi.fn(async () => {}), edit: vi.fn(), pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
});

const renderCard = (over: Partial<Parameters<typeof PaymentPlanCard>[0]> = {}) =>
  render(
    <PaymentPlanCard
      plan={plan}
      occurrences={ROWS}
      attempts={[attempt({}), attempt({ id: 'a2', occurrenceId: 'o2', status: 'failed', providerRef: 'pi_Dec2', declineCode: 'insufficient_funds', paymentId: null })]}
      events={[]}
      today="2026-10-12"
      accounts={ACCOUNTS}
      actions={actions()}
      {...over}
    />,
  );

const figure = (c: HTMLElement, id: string) => c.querySelector(`[data-figure="${id}"] dd`)!.textContent;

describe('PaymentPlanCard — the math', () => {
  it('Charged · Paid · Failed · Remaining are sums of the rows on screen', () => {
    const { container } = renderCard();
    // By hand: asked-for rows #1–#3 = 3 × $200; paid $200 + $50; #2's $200 failed; left $200 + $150 + $200.
    expect(figure(container, 'charged')).toBe('$600.00');
    expect(figure(container, 'paid')).toBe('$250.00');
    expect(figure(container, 'failed')).toBe('$200.00');
    expect(figure(container, 'remaining')).toBe('$550.00');
    expect(container.querySelector('[data-plan-total]')!.textContent).toContain('$800.00');
    expect(container.querySelector('[data-plan-math-explained]')!.textContent).toMatch(/\$600\.00 has been asked for/);
  });

  it('writes status as coloured text, not a pill', () => {
    const { container } = renderCard();
    const cell = container.querySelector('[data-occurrence-row="1"] [data-status-text]')!;
    expect(cell.tagName).toBe('TD');
    expect(cell.className).toMatch(/text-success/);
    expect(cell.className).not.toMatch(/rounded|bg-/);
  });

  it('shows the recovery sentence with the decline reason and the ways out', () => {
    const { container } = renderCard();
    const rec = container.querySelector('[data-recovery="2"]')!;
    expect(rec.textContent).toMatch(/^Missed on Fri 9 Oct \(insufficient funds\) — \$200\.00 is outstanding\./);
    expect(within(rec as HTMLElement).getByRole('button', { name: 'Send a payment link' })).toBeTruthy();
    expect(within(rec as HTMLElement).getByRole('button', { name: 'Retry the card' })).toBeTruthy();
  });
});

describe('PaymentPlanCard — row actions', () => {
  // setup.ts's ResizeObserver is an arrow function, which floating-ui (the
  // menu's positioning) cannot construct — same workaround as
  // settings-dropdown-tone-v2.test.tsx.
  const SetupResizeObserver = globalThis.ResizeObserver;
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterAll(() => {
    globalThis.ResizeObserver = SetupResizeObserver;
  });

  const openMenu = (seq: number) => {
    const trigger = screen.getByRole('button', { name: `Actions for payment #${seq}` });
    act(() => {
      // ArrowDown OPENS (Enter would toggle); jsdom has no PointerEvent for the click path.
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    });
    const items = [...document.querySelectorAll('[data-row-action]')];
    // Never vacuous: the menu must actually be open with all five actions.
    expect(items).toHaveLength(5);
    return items;
  };

  it('a paid row lists all five actions, each disabled with its reason', () => {
    renderCard();
    const items = openMenu(1);
    expect([...items].map((i) => i.getAttribute('data-row-action'))).toEqual(['retry', 'send_link', 'record_payment', 'move_date', 'skip']);
    for (const i of items) {
      expect(i.getAttribute('data-enabled')).toBe('false');
      expect(i.querySelector('[data-reason]')?.textContent).toBe('Already paid in full.');
    }
  });

  it('a declined row offers them all', () => {
    renderCard();
    for (const i of openMenu(2)) expect(i.getAttribute('data-enabled')).toBe('true');
  });

  it('with no actions (a read-only role) there is no menu at all', () => {
    renderCard({ actions: undefined });
    expect(screen.queryByRole('button', { name: /Actions for payment/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel plan' })).toBeNull();
  });
});

describe('PaymentPlanCard — provider references', () => {
  it('links a payment on the tenant\'s own Standard account to that exact payment', () => {
    const { container } = renderCard();
    fireEvent.click(container.querySelector('[data-occurrence-row="1"]')!);
    const links = [...container.querySelectorAll('a[data-dashboard-link]')].map((a) => a.getAttribute('href'));
    expect(links).toContain('https://dashboard.stripe.com/payments/pi_Paid1');
    for (const h of links) expect(h).not.toContain('/connect/');
  });

  it('gives an Express payment its reference and a route instead of a URL', () => {
    const { container } = renderCard({ attempts: [attempt({ providerAccount: 'acct_Managed9999' })] });
    fireEvent.click(container.querySelector('[data-occurrence-row="1"]')!);
    const detail = container.querySelector('[data-occurrence-detail="1"]')!;
    expect(detail.querySelector('a')).toBeNull();
    expect(detail.textContent).toContain('pi_Paid1');
    expect(detail.querySelector('[data-dashboard-route]')!.textContent).toMatch(/Express/);
  });
});

describe('PaymentPlanCard — plan actions confirm and say what they do', () => {
  it('cancel asks first and names what will not be collected', async () => {
    const a = actions();
    renderCard({ actions: a });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel plan' }));
    const dialog = await screen.findByRole('dialog');
    // Open rows: #2 $200 + #3 $150 + #4 $200 = $550 across 3 payments.
    expect(dialog.textContent).toMatch(/3 payments still to come \(\$550\.00\)/);
    expect(a.cancel).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel the plan' }));
    });
    expect(a.cancel).toHaveBeenCalledTimes(1);
  });
});
