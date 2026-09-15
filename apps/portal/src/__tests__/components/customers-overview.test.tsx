/**
 * The Customers hero row (components/customers-v2/customers-overview.tsx).
 *
 * Every expected number was worked out by hand from the fixture, not produced
 * by running the code. "Today" is Tue 15 Sep 2026, 14:00 local, so:
 *   current window  Aug 17 .. Sep 15 (30 days)
 *   previous window Jul 18 .. Aug 16 (30 days)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The deck reads tenant, auth, permissions, announcements and Trax, and has its
// own tests (featured-deck-v2.test.tsx). Here it is a stub that records what
// this row hands it.
const deck = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
vi.mock('@/components/shared/featured-deck-v2', () => ({
  FeaturedDeck: (props: Record<string, any>) => {
    deck.props = props;
    return <section data-testid="deck" data-tour={props.anchor} />;
  },
}));

import { CustomersOverview } from '@/components/customers-v2/customers-overview';

// recharts' ResponsiveContainer calls `new ResizeObserver(...)`; the shared
// setup's vi.fn() arrow mock cannot be constructed, so this file brings a class.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const TODAY = new Date(2026, 8, 15, 14, 0);
const iso = (m: number, d: number, h: number, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();

// Verified (the second line) counts `verified` and `manually_verified` among the
// current window's customers: Sep 15 09:00 and Sep 1 10:00, so 2. Sep 14 is only
// pending, Aug 1 is verified but in the previous window, and Sep 16 is verified
// but in the future.
const CUSTOMERS = [
  // current window: 8
  { created_at: iso(9, 15, 9), identity_verification_status: 'verified' }, // today
  { created_at: iso(9, 15, 9, 30) }, // today
  { created_at: iso(9, 14, 18, 30), identity_verification_status: 'pending' },
  { created_at: iso(9, 1, 10), identity_verification_status: 'manually_verified' },
  { created_at: iso(9, 1, 11) },
  { created_at: iso(9, 1, 12) },
  { created_at: iso(8, 17, 0, 10) }, // first day of the current window
  { created_at: '2026-09-10' }, // a bare date: Sep 10 locally, never Sep 9
  // previous window: 4
  { created_at: iso(8, 16, 23, 50) }, // last day of the previous window
  { created_at: iso(8, 1, 12), identity_verification_status: 'verified' },
  { created_at: iso(8, 1, 13) },
  { created_at: iso(7, 18, 8) }, // first day of the previous window
  // neither
  { created_at: iso(7, 17, 8) }, // before both windows
  { created_at: iso(9, 16, 10), identity_verification_status: 'verified' }, // tomorrow: not history yet
  { created_at: null }, // no date
];

const summary = () => document.querySelector('p.sr-only')?.textContent;

describe('CustomersOverview — the graph', () => {
  it('headlines new customers in the last 30 days against the 30 before, with Verified as the second line', () => {
    const { container } = render(<CustomersOverview customers={CUSTOMERS} filtered={false} today={TODAY} />);
    expect(summary()).toBe('New customers, last 30 days: 8. Previous 30 days: 4. Verified, last 30 days: 2.');
    // The metric label, and again in the legend beside the second line.
    expect(screen.getAllByText('New customers')).toHaveLength(2);
    expect(screen.getByText('Verified')).toBeInTheDocument();
    // 8 against 4 is up 100%, and the previous total is said in words.
    const chip = container.querySelector('[data-change]');
    expect(chip?.getAttribute('data-change')).toBe('up');
    expect(chip?.textContent).toBe('100%');
    expect(container.textContent).toContain('vs 4 previous 30 days');
  });

  it('draws no axis labels under the chart', () => {
    render(<CustomersOverview customers={CUSTOMERS} filtered={false} today={TODAY} />);
    expect(screen.queryByText('Aug 17')).toBeNull();
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('offers no metric picker, because there is only one real metric', () => {
    render(<CustomersOverview customers={CUSTOMERS} filtered={false} today={TODAY} />);
    expect(screen.queryByRole('button', { name: /^Metric:/ })).toBeNull();
  });

  it('draws an empty list as zero against zero, with no chip', () => {
    const { container } = render(<CustomersOverview customers={[]} filtered={false} today={TODAY} />);
    expect(summary()).toBe('New customers, last 30 days: 0. Previous 30 days: 0. Verified, last 30 days: 0.');
    expect(screen.queryByText('Filtered')).toBeNull();
    // A percentage of nothing is not a number.
    expect(container.querySelector('[data-change]')).toBeNull();
  });

  it('says Filtered when the list is narrowed', () => {
    render(<CustomersOverview customers={CUSTOMERS.slice(0, 2)} filtered today={TODAY} />);
    expect(screen.getByText('Filtered')).toBeInTheDocument();
    expect(summary()).toBe('New customers, last 30 days: 2. Previous 30 days: 0. Verified, last 30 days: 1.');
  });

  it('keeps the tour anchors on a single root and on the numbers', () => {
    const { container } = render(
      <CustomersOverview customers={CUSTOMERS} filtered={false} today={TODAY} />,
    );
    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild?.getAttribute('data-tour')).toBe('customers-stats');
    expect(container.querySelector('[data-tour="customers-chart"]')).not.toBeNull();
  });
});

describe('CustomersOverview — the featured deck', () => {
  it('hands the deck the customers tab, its routes and anchor', () => {
    render(<CustomersOverview customers={CUSTOMERS} filtered={false} today={TODAY} />);
    expect(deck.props?.tab).toBe('customers');
    expect(deck.props?.routePrefixes).toEqual(['/customers', '/blocked-customers']);
    expect(deck.props?.anchor).toBe('customers-featured');
    // The card is only as tall as the graph beside it on desktop.
    expect(deck.props?.className).toBe('lg:min-h-0');
  });

  it('passes invite and import only when the page gives them, and they call through', () => {
    const onInvite = vi.fn();
    const onImport = vi.fn();
    render(<CustomersOverview customers={CUSTOMERS} filtered={false} onInvite={onInvite} onImport={onImport} today={TODAY} />);
    expect(Object.keys(deck.props?.handlers ?? {}).sort()).toEqual(['openImport', 'openInvite']);
    deck.props!.handlers.openInvite();
    deck.props!.handlers.openImport();
    expect(onInvite).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('passes no handlers to a viewer who may do neither', () => {
    render(<CustomersOverview customers={CUSTOMERS} filtered={false} today={TODAY} />);
    expect(deck.props?.handlers).toEqual({});
  });

  it('keeps the graph at three quarters beside the deck slot', () => {
    const { container } = render(<CustomersOverview customers={CUSTOMERS} filtered={false} today={TODAY} />);
    const row = container.firstElementChild!.firstElementChild!;
    expect(row.childElementCount).toBe(2);
    expect(row.firstElementChild!.className).toContain('lg:col-span-3');
  });
});

describe('CustomersOverview — the day turning over', () => {
  // No `today` prop: the chart reads the clock. Mounted at Tue Sep 15 2026
  // 23:50 local, the 30-day window is Aug 17 .. Sep 15, so a customer created
  // on Sep 16 is still in the future. From Sep 16 the window is Aug 18 .. Sep 16.
  const sep16 = (h: number, min = 0) => new Date(2026, 8, 16, h, min).toISOString();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves the window on at midnight with no data change', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 8, 15, 23, 50));
    render(<CustomersOverview customers={[{ created_at: sep16(8) }]} filtered={false} />);
    expect(summary()).toBe('New customers, last 30 days: 0. Previous 30 days: 0. Verified, last 30 days: 0.');

    // 10 minutes to midnight, and the timer waits one second past it.
    act(() => {
      vi.advanceTimersByTime(601_000);
    });
    expect(summary()).toBe('New customers, last 30 days: 1. Previous 30 days: 0. Verified, last 30 days: 0.');
  });

  it('charts a refetched list against the new day, not the day it mounted', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 8, 15, 23, 50));
    const { rerender } = render(
      <CustomersOverview customers={[{ created_at: sep16(8) }]} filtered={false} />,
    );
    expect(summary()).toBe('New customers, last 30 days: 0. Previous 30 days: 0. Verified, last 30 days: 0.');

    // Next morning, before any timer runs, someone adds a customer and the list refetches.
    vi.setSystemTime(new Date(2026, 8, 16, 9, 0));
    rerender(
      <CustomersOverview
        customers={[{ created_at: sep16(8) }, { created_at: sep16(8, 30) }]}
        filtered={false}
       
      />,
    );
    expect(summary()).toBe('New customers, last 30 days: 2. Previous 30 days: 0. Verified, last 30 days: 0.');
  });
});
