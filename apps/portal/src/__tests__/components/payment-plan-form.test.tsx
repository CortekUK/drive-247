/**
 * The one form, rendered: a sentence, not a plan-type menu, and nothing on
 * screen ever names "pay as you go" or "installments".
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { PaymentPlanForm } from '@/components/payment-plans/payment-plan-form';
import { PaymentPlanComposer, usePlanComposer } from '@/components/payment-plans/payment-plan-composer';
import { SchedulePreview } from '@/components/payment-plans/schedule-preview';
import { RHYTHM_CHOICES, defaultPlanForm, type PlanContext, type PlanFormState } from '@/lib/payment-plans-ui/plan-form-model';
import { computePreview } from '@/lib/payment-plans-ui/preview';

const ctx: PlanContext = { rentalStart: '2026-09-30', rentalEnd: '2026-10-28', balanceCents: 140000 };
const TYPE_WORDS = /pay[\s-]*as[\s-]*you[\s-]*go|payg|instal/i;
const label = (id: string) => RHYTHM_CHOICES.find((r) => r.id === id)!.label;

function Harness({ onState }: { onState?: (s: PlanFormState) => void }) {
  const { state, setState, preview } = usePlanComposer(ctx, '2026-09-01');
  return (
    <PaymentPlanComposer
      state={state}
      onChange={(s) => {
        setState(s);
        onState?.(s);
      }}
      preview={preview}
      ctx={ctx}
      currency="usd"
      today="2026-09-01"
    />
  );
}

describe('PaymentPlanForm', () => {
  it('renders every rhythm as a chip and never a plan-type word', () => {
    const { container } = render(<Harness />);
    for (const r of RHYTHM_CHOICES) expect(screen.getByRole('button', { name: r.label })).toBeTruthy();
    expect(container.textContent).not.toMatch(TYPE_WORDS);
  });

  it('asks for two weekdays for twice a week', () => {
    const seen: PlanFormState[] = [];
    render(<Harness onState={(s) => seen.push(s)} />);
    fireEvent.click(screen.getByRole('button', { name: label('twice_a_week') }));
    const s = seen.at(-1)!;
    expect(s.rhythm).toBe('twice_a_week');
    expect(s.weekdays).toHaveLength(2);
    expect(screen.getByText(/Pick two days/)).toBeTruthy();
  });

  it('the preview updates on the same click — no submit, no wait', () => {
    const { container } = render(<Harness />);
    const rows = () => container.querySelectorAll('[data-preview-row]').length;
    const weekly = rows();
    fireEvent.click(screen.getByRole('button', { name: label('every_2_weeks') }));
    expect(rows()).toBeLessThan(weekly);
  });

  it('shows a rule error on the line it belongs to, in plain English', () => {
    function Bad() {
      const [s, setS] = useState<PlanFormState>({ ...defaultPlanForm(ctx), rhythm: 'twice_a_week', weekdays: [1] });
      const p = computePreview(s, ctx, '2026-09-01');
      return <PaymentPlanForm state={s} onChange={setS} ctx={ctx} currency="usd" error={p.ok === false ? { field: p.field, message: p.message } : null} />;
    }
    const { container } = render(<Bad />);
    const on = container.querySelector('[data-sentence-line="on"]')!;
    expect(on.querySelector('[role="alert"]')?.textContent).toMatch(/two days/);
  });
});

describe('SchedulePreview total line', () => {
  it('reads "N payments · $X total · rental balance $Y" and warns only when they differ', () => {
    const same = computePreview(defaultPlanForm(ctx), ctx, '2026-09-01');
    const { container, rerender } = render(<SchedulePreview preview={same} ctx={ctx} currency="usd" today="2026-09-01" />);
    const total = container.querySelector('[data-preview-total]')!.textContent!;
    expect(total).toMatch(/^\d+ payments · \$1,400\.00 total · rental balance \$1,400\.00$/);
    expect(container.querySelector('[data-preview-mismatch]')).toBeNull();

    const over = computePreview({ ...defaultPlanForm(ctx), amount: 'fixed', fixedAmount: '500' }, ctx, '2026-09-01');
    rerender(<SchedulePreview preview={over} ctx={ctx} currency="usd" today="2026-09-01" />);
    expect(container.querySelector('[data-preview-mismatch="over"]')).not.toBeNull();
  });

  it('labels the short first period', () => {
    const s = { ...defaultPlanForm(ctx), weekdays: [5] as PlanFormState['weekdays'] };
    const { container } = render(<SchedulePreview preview={computePreview(s, ctx, '2026-09-01')} ctx={ctx} currency="usd" today="2026-09-01" />);
    expect(container.querySelector('[data-preview-row="1"]')!.textContent).toMatch(/short first period/);
    expect(container.querySelector('[data-preview-row="2"]')!.textContent).not.toMatch(/short first period/);
  });

  it('can move a date from the calendar: tap the payment, then the new day', () => {
    const onMove = vi.fn();
    const s = { ...defaultPlanForm(ctx), weekdays: [5] as PlanFormState['weekdays'] };
    render(<SchedulePreview preview={computePreview(s, ctx, '2026-09-01')} ctx={ctx} currency="usd" today="2026-09-01" onMove={onMove} />);
    fireEvent.click(screen.getByRole('tab', { name: /Calendar/ }));
    // The calendar opens on September; move to October.
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    fireEvent.click(screen.getByRole('button', { name: /^Fri 9 Oct: payment #3/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mon 12 Oct' }));
    expect(onMove).toHaveBeenCalledWith(3, '2026-10-12');
  });
});
