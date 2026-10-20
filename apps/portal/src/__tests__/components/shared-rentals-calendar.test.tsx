/**
 * The shared rentals calendar (shared/portal-v2/timeline), as the customer
 * portal's Rentals page drives it: perspective "rental", fixed, records called
 * "rental", fed with the Northwind canary customer's six real rentals (rows as
 * read from production on Oct 20 2026; statuses through the shared
 * getRentalStatus, as the customer adapter does).
 *
 * Checks the four things the page promises: each rental is a line on its own
 * dates (current, upcoming and past), the Month window and previous / next
 * move a month at a time, and a line opens its rental.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { getRentalStatus } from '../../../../../shared/portal-v2/rental-status';
import { EMPTY_TIMELINE, type TimelineData } from '../../../../../shared/portal-v2/timeline/model';
import { TimelineBoard, type TimelineRange } from '../../../../../shared/portal-v2/timeline/timeline-board';

// Radix's popper constructs a ResizeObserver; the setup file's mock is an
// arrow function, which cannot be called with `new`.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const TODAY = '2026-10-20';

const CANARY = [
  { id: '936c5915-dba4-44a3-9800-a97f0500388f', ref: 'R-936c59', status: 'Active', start: '2026-09-28', end: '2026-10-28', car: ['Ford', 'Explorer'] },
  { id: 'fcc59648-3bd3-4a59-bf61-fc0ada1fe257', ref: 'R-fcc596', status: 'Active', start: '2026-10-22', end: '2026-10-29', car: ['Kia', 'Telluride'] },
  { id: 'd34f0830-1b8a-4c5c-81ab-0f42a475d9b5', ref: 'R-d34f08', status: 'Pending', start: '2026-11-12', end: '2026-11-26', car: ['Chevrolet', 'Malibu'] },
  { id: '791ba6e0-082c-4463-9f65-95c7ce68966f', ref: 'R-791ba6', status: 'Closed', start: '2026-08-01', end: '2026-08-05', car: ['Hyundai', 'Elantra'] },
  { id: '9b4eedb6-9768-4bef-9aca-cabf2ea72ee3', ref: 'R-9b4eed', status: 'Closed', start: '2026-07-18', end: '2026-07-25', car: ['Kia', 'Telluride'] },
  { id: 'f9f97a79-fbfd-49f8-81b0-38de7416d995', ref: 'R-f9f97a', status: 'Cancelled', start: '2026-09-08', end: '2026-09-15', car: ['Hyundai', 'Elantra'] },
];

function canaryData(): TimelineData {
  return {
    ...EMPTY_TIMELINE,
    bookings: CANARY.map((r) => ({
      id: r.id,
      rentalId: r.id,
      number: r.ref,
      start: r.start,
      end: r.end,
      status: getRentalStatus(r.start, r.end, r.status),
      customer: { id: '', name: 'Ghulam' },
      vehicle: { id: `v-${r.ref}`, reg: '', make: r.car[0], model: r.car[1], daily: null, weekly: null, monthly: null },
    })),
  };
}

function CustomerCalendar({ onOpen }: { onOpen: (id: string) => void }) {
  const [range, setRange] = useState<TimelineRange>({ start: '2026-10-18', days: 14, period: 'fortnight' });
  return (
    <TimelineBoard
      data={canaryData()}
      range={range}
      onRange={setRange}
      today={TODAY}
      currency="USD"
      perspective="rental"
      fixedPerspective
      itemLabel="rental"
      heading="Rental calendar"
      onOpenRental={onOpen}
    />
  );
}

/** The rental numbers drawn as lines right now. */
const linesShown = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button.tl-booking')].map((b) => b.getAttribute('aria-label')!.split(', ')[0]);

describe('shared rentals calendar with the canary customer', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 20, 12));

  it('reads the canary rentals the way the operator does', () => {
    expect(canaryData().bookings.map((b) => `${b.number}=${b.status}`)).toEqual([
      'R-936c59=Active',
      'R-fcc596=Upcoming',
      'R-d34f08=Pending',
      'R-791ba6=Completed',
      'R-9b4eed=Completed',
      'R-f9f97a=Cancelled',
    ]);
  });

  it('opens on the current and upcoming rentals, on their own dates', () => {
    render(<CustomerCalendar onOpen={() => {}} />);
    // Oct 18 – Oct 31: the one on rent (Sep 28 – Oct 28) and the next (Oct 22 – 29).
    expect(linesShown().sort()).toEqual(['R-936c59', 'R-fcc596']);
    const current = screen.getByRole('button', { name: /^R-936c59, R-936c59, Active, Sep 28, 2026 to Oct 28, 2026/ });
    expect(current.querySelector('.tl-continuation')).not.toBeNull(); // started before this window
    screen.getByRole('button', { name: /^R-fcc596, R-fcc596, Upcoming, Oct 22, 2026 to Oct 29, 2026/ });
    expect(screen.getByText('2 rentals in view')).toBeInTheDocument();
    expect(screen.getByText('Rental calendar')).toBeInTheDocument();
  });

  it('moves a month at a time, back to past rentals and on to the pending one', () => {
    render(<CustomerCalendar onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(screen.getByRole('button', { name: 'Choose date range' })).toHaveTextContent('Oct 1 — Oct 31, 2026');
    expect(linesShown().sort()).toEqual(['R-936c59', 'R-fcc596']);

    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(screen.getByRole('button', { name: 'Choose date range' })).toHaveTextContent('Nov 1 — Nov 30, 2026');
    expect(linesShown()).toEqual(['R-d34f08']);

    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(screen.getByRole('button', { name: 'Choose date range' })).toHaveTextContent('Sep 1 — Sep 30, 2026');
    expect(linesShown().sort()).toEqual(['R-936c59', 'R-f9f97a']);

    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(linesShown()).toEqual(['R-791ba6']);
    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(screen.getByRole('button', { name: 'Choose date range' })).toHaveTextContent('Jul 1 — Jul 31, 2026');
    expect(linesShown()).toEqual(['R-9b4eed']);
  });

  it('opens the rental from its line', () => {
    const onOpen = vi.fn();
    render(<CustomerCalendar onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /^R-fcc596,/ }));
    const card = document.querySelector<HTMLElement>('[data-slot="popover-content"]')!;
    expect(within(card).getByText('Kia Telluride')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: /Open rental/ }));
    expect(onOpen).toHaveBeenCalledWith('fcc59648-3bd3-4a59-bf61-fc0ada1fe257');
  });
});
