/**
 * The create flow's booking-mode cards, with and without payment plans.
 *
 * Every tenant but the canary must see EXACTLY the cards it always saw. Pinned
 * by SHAPE (the mode ids behind each card, via `data-mode`) and by the pure
 * list function the create flow now calls — never by literal copy.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BookingModeGrid, bookingModesFor, type BookingMode } from '@/components/rentals-v2/booking-mode-selector';

/** The expression `rental-create-v2.tsx` used before payment plans, verbatim in meaning. */
const legacyList = (payg: boolean, auto: boolean): BookingMode[] => [
  'fixed',
  ...(payg ? (['payg'] as const) : []),
  ...(auto ? (['auto_extend'] as const) : []),
];

const cards = (c: HTMLElement) => [...c.querySelectorAll('[data-mode]')].map((e) => e.getAttribute('data-mode'));

describe('bookingModesFor', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('without payment plans it is the old list (payg %s, auto-extend %s)', (payg, auto) => {
    expect(bookingModesFor({ paygEnabled: payg, autoExtendEnabled: auto, paymentPlans: false })).toEqual(legacyList(payg, auto));
  });

  it('with payment plans: fixed, payment plan, then auto-extend if on — PAYG is folded in, installments never a card', () => {
    expect(bookingModesFor({ paygEnabled: true, autoExtendEnabled: true, paymentPlans: true })).toEqual(['fixed', 'payment_plan', 'auto_extend']);
    expect(bookingModesFor({ paygEnabled: true, autoExtendEnabled: false, paymentPlans: true })).toEqual(['fixed', 'payment_plan']);
  });
});

describe('BookingModeGrid', () => {
  it('renders exactly the offered modes, in the grid\'s own order (unchanged: fixed, auto-extend, then PAYG)', () => {
    const { container } = render(<BookingModeGrid selected={null} onSelect={vi.fn()} available={legacyList(true, true)} />);
    expect(cards(container)).toEqual(['fixed', 'auto_extend', 'payg']);
    const one = render(<BookingModeGrid selected={null} onSelect={vi.fn()} available={legacyList(false, false)} />);
    expect(cards(one.container)).toEqual(['fixed']);
  });

  it('with no `available` it shows the original four cards — the payment plan card is only reached by naming it', () => {
    const { container } = render(<BookingModeGrid selected={null} onSelect={vi.fn()} />);
    expect(cards(container)).toEqual(['fixed', 'auto_extend', 'installments', 'payg']);
  });

  it('the canary gets three cards, and its payment plan card never names the old plan types', () => {
    const { container } = render(
      <BookingModeGrid selected={null} onSelect={vi.fn()} available={bookingModesFor({ paygEnabled: true, autoExtendEnabled: true, paymentPlans: true })} />,
    );
    expect(cards(container)).toEqual(['fixed', 'payment_plan', 'auto_extend']);
    expect(container.querySelector('[data-mode="payment_plan"]')!.textContent).not.toMatch(/pay[\s-]*as[\s-]*you[\s-]*go|payg|instal/i);
  });

  it('copy overrides reach only the card they name', () => {
    const { container } = render(
      <BookingModeGrid selected={null} onSelect={vi.fn()} available={['fixed', 'payment_plan']} copy={{ fixed: { title: 'Fixed dates' } }} />,
    );
    expect(container.querySelector('[data-mode="fixed"] h3')!.textContent).toBe('Fixed dates');
    const plain = render(<BookingModeGrid selected={null} onSelect={vi.fn()} available={['fixed']} />);
    expect(plain.container.querySelector('[data-mode="fixed"] h3')!.textContent).not.toBe('Fixed dates');
  });
});
