/**
 * The create flow's booking-mode cards, with and without payment plans.
 *
 * Every tenant but the canary must see EXACTLY the cards it always saw. Pinned
 * by SHAPE (the mode ids behind each card, via `data-mode`) and by the pure
 * list function the create flow now calls — never by literal copy.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('with payment plans it is exactly two cards — fixed and payment plan — whatever the settings say (payg %s, auto-extend %s)', (payg, auto) => {
    // Wave 3: PAYG, installments AND auto-extend are answers inside the one
    // plan form ("keeps renewing until stopped"), never cards of their own.
    expect(bookingModesFor({ paygEnabled: payg, autoExtendEnabled: auto, paymentPlans: true })).toEqual(['fixed', 'payment_plan']);
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

  it('the canary gets two cards — Fixed dates · Payment plan — and the plan card never names the old plan types', () => {
    const { container } = render(
      <BookingModeGrid selected={null} onSelect={vi.fn()} available={bookingModesFor({ paygEnabled: true, autoExtendEnabled: true, paymentPlans: true })} />,
    );
    expect(cards(container)).toEqual(['fixed', 'payment_plan']);
    expect(container.querySelector('[data-mode="auto_extend"]')).toBeNull();
    expect(container.querySelector('[data-mode="payment_plan"]')!.textContent).not.toMatch(/pay[\s-]*as[\s-]*you[\s-]*go|payg|instal|auto[\s-]*extend/i);
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

describe('the create flow wires the list in (shape, not copy)', () => {
  // The create flow is 7,000 lines of hooks; rendering it here would test the
  // mocks. What matters is that it asks `bookingModesFor` with the plan gate,
  // and that its in-form Payment Mode never offers the old renewal choice on
  // the canary — both pinned by shape, tolerant of formatting.
  const src = readFileSync(resolve(process.cwd(), 'src/components/rentals-v2/rental-create-v2.tsx'), 'utf8');

  it('the intake grid gets its cards from bookingModesFor, gated on payment plans', () => {
    expect(src).toMatch(/bookingModesFor\(\{[^}]*paymentPlans:\s*paymentPlansOn/);
    expect(src).toMatch(/available=\{availableBookingModes\}/);
  });

  it('the in-form Auto-Extend radio is not offered once payment plans are on', () => {
    expect(src).toMatch(/auto_extend_enabled\s*&&\s*!paymentPlansOn\s*&&\s*\(\s*<label[^>]*>[\s\S]{0,400}?value="auto_extend"/);
  });
});
