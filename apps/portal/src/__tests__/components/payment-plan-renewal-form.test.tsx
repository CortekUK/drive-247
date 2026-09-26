/**
 * The one form, renewing: "keeps renewing until stopped" is an answer to
 * "until", and it reveals — in the same sentence style — renew every, cover
 * each renewal (only when the tenant sells Bonzah, with Bonzah's own start
 * rule said plainly) and send an extension agreement (default no). No new
 * card, no plan-type label anywhere.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaymentPlanComposer, usePlanComposer } from '@/components/payment-plans/payment-plan-composer';
import type { PlanContext, PlanFormState } from '@/lib/payment-plans-ui/plan-form-model';
import { BONZAH_START_RULE } from '@/lib/payment-plans-ui/renewal';

const TYPE_WORDS = /pay[\s-]*as[\s-]*you[\s-]*go|payg|instal|auto[\s-]*extend/i;

const base: PlanContext = {
  rentalStart: '2026-10-02',
  rentalEnd: '2026-10-09',
  balanceCents: 35000,
  renewal: { bonzahSellable: true, rentalCoverage: { cdw: true }, defaultUnit: 'week' },
};

let last: PlanFormState | null = null;
function Harness({ ctx }: { ctx: PlanContext }) {
  const { state, setState, preview } = usePlanComposer(ctx, '2026-10-01');
  last = state;
  return <PaymentPlanComposer state={state} onChange={setState} preview={preview} ctx={ctx} currency="usd" today="2026-10-01" />;
}

const line = (c: HTMLElement, id: string) => c.querySelector(`[data-sentence-line="${id}"]`);
const choose = () => fireEvent.click(screen.getByRole('button', { name: 'keeps renewing until stopped' }));

describe('keeps renewing until stopped', () => {
  it('is one more answer to "until" — and reveals renew, cover and send in the same sentence', () => {
    const { container } = render(<Harness ctx={base} />);
    expect(line(container, 'renew')).toBeNull();
    choose();
    expect(last!.endBy).toBe('renewing');
    expect(line(container, 'renew')).not.toBeNull();
    expect(line(container, 'cover')).not.toBeNull();
    expect(line(container, 'agreement')).not.toBeNull();
    // The rhythm lines give way to "renew every"; "Collect" is not a choice.
    expect(line(container, 'every')).toBeNull();
    expect(container.querySelector('[data-renewal-amount]')).not.toBeNull();
    expect(line(container, 'cover')!.textContent).toContain(BONZAH_START_RULE);
  });

  it('the agreement defaults to no; the answers land in the state', () => {
    const { container } = render(<Harness ctx={base} />);
    choose();
    const agreement = line(container, 'agreement')!;
    const no = [...agreement.querySelectorAll('button')].find((b) => b.textContent === 'no')!;
    expect(no.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click([...agreement.querySelectorAll('button')].find((b) => b.textContent === 'yes')!);
    fireEvent.click(screen.getByRole('button', { name: 'months' }));
    fireEvent.click(screen.getByRole('button', { name: 'no insurance' }));
    expect(last).toMatchObject({ renewAgreement: true, renewUnit: 'month', renewInsurance: 'none' });
  });

  it('the preview lists the first periods, what each covers, and "priced when it starts" instead of an amount', () => {
    const { container } = render(<Harness ctx={base} />);
    choose();
    expect(container.querySelector('[data-preview-renewing]')).not.toBeNull();
    const rows = container.querySelectorAll('[data-preview-row]');
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('Fri 9 Oct');
    expect(rows[0].textContent).toContain('covers 9 Oct → 16 Oct');
    expect(container.querySelectorAll('[data-preview-priced-later]')).toHaveLength(4);
    expect(container.querySelector('[data-preview-total]')!.textContent).toMatch(/^Keeps renewing every week · first renewal Fri 9 Oct/);
    // The rental's own balance is said to be separate — never folded into renewals.
    expect(container.querySelector('[data-preview-balance-note]')).not.toBeNull();
  });

  it('no insurance question when the tenant does not sell Bonzah', () => {
    const { container } = render(<Harness ctx={{ ...base, renewal: { bonzahSellable: false, rentalCoverage: null } }} />);
    choose();
    expect(line(container, 'renew')).not.toBeNull();
    expect(line(container, 'cover')).toBeNull();
  });

  it('not offered at all where the caller does not offer it (the simulator)', () => {
    const { renewal: _r, ...plain } = base;
    render(<Harness ctx={plain} />);
    expect(screen.queryByRole('button', { name: 'keeps renewing until stopped' })).toBeNull();
  });

  it('never names a plan type, before or after renewing is chosen', () => {
    const { container } = render(<Harness ctx={base} />);
    expect(container.textContent).not.toMatch(TYPE_WORDS);
    choose();
    expect(container.textContent).not.toMatch(TYPE_WORDS);
  });
});
