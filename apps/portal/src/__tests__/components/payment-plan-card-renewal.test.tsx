/**
 * The plan card for a plan that keeps renewing: each payment reads its PERIOD
 * the way the rental does ("covers 9 Oct → 16 Oct") and names the extension
 * that period created, from the real extension rows handed in. Extend sits
 * beside Edit when the caller offers it, and only works on an active plan.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentPlanCard, type PaymentPlanCardActions } from '@/components/payment-plans/payment-plan-card';
import type { OccurrenceView, PlanView } from '@/lib/payment-plans-ui/view-types';
import type { ExtensionRef } from '@/lib/payment-plans-ui/renewal';

const TYPE_WORDS = /pay[\s-]*as[\s-]*you[\s-]*go|payg|instal|auto[\s-]*extend/i;

const plan: PlanView = {
  id: 'p1', tenantId: 't', rentalId: 'r', customerId: 'c', status: 'active',
  rule: { freq: 'weekly', interval: 1, byWeekday: [5], anchor: '2026-10-09', firstOccurrence: 'on_anchor', end: { kind: 'open', through: '2026-10-30' } },
  amount: { mode: 'per_period', dailyRateCents: 5000 }, currency: 'usd', timezone: 'America/New_York', chargeLocalTime: '10:00',
  collectionMethod: 'checkout_link', fallbackToLink: true, maxAttempts: 3, retryAfterDays: 2, reminderOffsets: [-2, 0, 2],
  paymentProvider: 'stripe', stripePaymentMethodId: null, extendsRental: true, version: 1,
  renewal: { extendsRental: true, periodUnit: 'week', periodCount: 1, insurance: null, sendAgreementEachPeriod: false },
};
const occ = (seq: number, start: string, end: string, extensionId: string | null): OccurrenceView => ({
  id: `o${seq}`, planId: 'p1', tenantId: 't', rentalId: 'r', seq, planVersion: 1, dueDate: start, dueAt: `${start}T14:00:00.000Z`,
  periodStart: start, periodEnd: end, amountCents: 35000, amountPaidCents: 0, collectionMethod: 'checkout_link',
  status: 'scheduled', attemptNo: 0, nextAttemptAt: null, extensionId,
});
const ROWS = [occ(1, '2026-10-09', '2026-10-16', 'e3'), occ(2, '2026-10-16', '2026-10-23', 'e4')];
const EXTENSIONS: ExtensionRef[] = [
  { id: 'e3', sequenceNumber: 3, previousEndDate: '2026-10-09', newEndDate: '2026-10-16', status: 'awaiting_payment', totalCents: 35000 },
  { id: 'e4', sequenceNumber: 4, previousEndDate: '2026-10-16', newEndDate: '2026-10-23', status: 'pending_approval', totalCents: 35000 },
];
const actions = (over: Partial<PaymentPlanCardActions> = {}): PaymentPlanCardActions => ({
  retry: vi.fn(async () => {}), sendLink: vi.fn(async () => {}), recordPayment: vi.fn(async () => {}), move: vi.fn(async () => {}),
  skip: vi.fn(async () => {}), edit: vi.fn(), pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
  ...over,
});

describe('PaymentPlanCard — renewal periods', () => {
  it('each payment says the period it pays for and names its extension', () => {
    const { container } = render(<PaymentPlanCard plan={plan} occurrences={ROWS} attempts={[]} events={[]} today="2026-10-05" extensions={EXTENSIONS} />);
    const row1 = container.querySelector('[data-occurrence-row="1"] [data-covers]')!;
    expect(row1.textContent).toContain('covers 9 Oct → 16 Oct');
    expect(row1.querySelector('[data-extension-link="e3"]')!.textContent).toBe('Extension #3 · awaiting payment');
    expect(container.querySelector('[data-occurrence-row="2"] [data-extension-link="e4"]')!.textContent).toBe('Extension #4 · days given when paid');
  });

  it('the plan sentence says it keeps renewing — and never names a plan type', () => {
    const { container } = render(<PaymentPlanCard plan={plan} occurrences={ROWS} attempts={[]} events={[]} today="2026-10-05" extensions={EXTENSIONS} />);
    expect(container.textContent).toMatch(/Keeps renewing every week from Fri 9 Oct/);
    expect(container.textContent).not.toMatch(TYPE_WORDS);
  });

  it('opening a row explains which extension it pays for', () => {
    const { container } = render(<PaymentPlanCard plan={plan} occurrences={ROWS} attempts={[]} events={[]} today="2026-10-05" extensions={EXTENSIONS} />);
    fireEvent.click(container.querySelector('[data-occurrence-row="2"]')!);
    const detail = container.querySelector('[data-extension-detail="e4"]')!;
    expect(detail.textContent).toMatch(/Pays for Extension #4 \(16 Oct → 23 Oct\)/);
    expect(detail.textContent).toMatch(/added to the rental once this payment is made/);
  });

  it('Extend is offered only when the caller wires it, and only on an active plan', () => {
    const extend = vi.fn();
    const { container, rerender } = render(
      <PaymentPlanCard plan={plan} occurrences={ROWS} attempts={[]} events={[]} today="2026-10-05" actions={actions({ extend })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Extend' }));
    expect(extend).toHaveBeenCalledTimes(1);

    rerender(<PaymentPlanCard plan={{ ...plan, status: 'paused' }} occurrences={ROWS} attempts={[]} events={[]} today="2026-10-05" actions={actions({ extend })} />);
    expect((container.querySelector('[data-plan-extend]') as HTMLButtonElement).disabled).toBe(true);

    rerender(<PaymentPlanCard plan={plan} occurrences={ROWS} attempts={[]} events={[]} today="2026-10-05" actions={actions()} />);
    expect(container.querySelector('[data-plan-extend]')).toBeNull();
  });

  it('a period Bonzah could not cover says so on its row — no premium was charged (A4)', () => {
    const rows = [{ ...ROWS[0], renews: true, insuranceStatus: 'not_insurable' as const }, ROWS[1]];
    const { container } = render(<PaymentPlanCard plan={plan} occurrences={rows} attempts={[]} events={[]} today="2026-10-05" extensions={EXTENSIONS} />);
    const flag = container.querySelector('[data-occurrence-row="1"] [data-insurance-status="not_insurable"]')!;
    expect(flag.textContent).toMatch(/no premium was charged/);
    expect(container.querySelector('[data-occurrence-row="2"] [data-insurance-status]')).toBeNull();
  });

  it('an extension ending after the return date says its days come when it is paid (A3)', () => {
    const { container } = render(
      <PaymentPlanCard plan={plan} occurrences={ROWS} attempts={[]} events={[]} today="2026-10-05" extensions={EXTENSIONS} rentalEnd="2026-10-09" />,
    );
    expect(container.querySelector('[data-extension-link="e3"]')!.textContent).toBe('Extension #3 · awaiting payment · days given when paid');
    // Days already given (the return date has reached it): no such note.
    const given = render(
      <PaymentPlanCard plan={plan} occurrences={ROWS} attempts={[]} events={[]} today="2026-10-05" extensions={EXTENSIONS} rentalEnd="2026-10-16" />,
    );
    expect(given.container.querySelector('[data-extension-link="e3"]')!.textContent).toBe('Extension #3 · awaiting payment');
  });
});
