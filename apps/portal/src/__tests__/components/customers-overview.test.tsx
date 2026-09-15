/**
 * The Customers hero row (components/customers-v2/customers-overview.tsx).
 *
 * Every expected number was worked out by hand from the fixture, not produced
 * by running the code. "Today" is Tue 15 Sep 2026, 14:00 local, so:
 *   current window  Aug 17 .. Sep 15 (30 days)
 *   previous window Jul 18 .. Aug 16 (30 days)
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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

const CUSTOMERS = [
  // current window: 8
  { created_at: iso(9, 15, 9) }, // today
  { created_at: iso(9, 15, 9, 30) }, // today
  { created_at: iso(9, 14, 18, 30) },
  { created_at: iso(9, 1, 10) },
  { created_at: iso(9, 1, 11) },
  { created_at: iso(9, 1, 12) },
  { created_at: iso(8, 17, 0, 10) }, // first day of the current window
  { created_at: '2026-09-10' }, // a bare date: Sep 10 locally, never Sep 9
  // previous window: 4
  { created_at: iso(8, 16, 23, 50) }, // last day of the previous window
  { created_at: iso(8, 1, 12) },
  { created_at: iso(8, 1, 13) },
  { created_at: iso(7, 18, 8) }, // first day of the previous window
  // neither
  { created_at: iso(7, 17, 8) }, // before both windows
  { created_at: iso(9, 16, 10) }, // tomorrow: not history yet
  { created_at: null }, // no date
];

const summary = () => document.querySelector('p.sr-only')?.textContent;

describe('CustomersOverview — the graph', () => {
  it('headlines new customers in the last 30 days against the 30 before', () => {
    render(<CustomersOverview customers={CUSTOMERS} filtered={false} showBlocked={false} today={TODAY} />);
    expect(summary()).toBe('New customers, last 30 days: 8. Previous 30 days: 4.');
    expect(screen.getByText('New customers')).toBeInTheDocument();
    expect(screen.getByText('Aug 17')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('offers no metric picker, because there is only one real metric', () => {
    render(<CustomersOverview customers={CUSTOMERS} filtered={false} showBlocked={false} today={TODAY} />);
    expect(screen.queryByRole('button', { name: /^Metric:/ })).toBeNull();
  });

  it('draws an empty list as zero against zero, with no chip', () => {
    render(<CustomersOverview customers={[]} filtered={false} showBlocked={false} today={TODAY} />);
    expect(summary()).toBe('New customers, last 30 days: 0. Previous 30 days: 0.');
    expect(screen.queryByText('Filtered')).toBeNull();
  });

  it('says Filtered when the list is narrowed', () => {
    render(<CustomersOverview customers={CUSTOMERS.slice(0, 2)} filtered showBlocked={false} today={TODAY} />);
    expect(screen.getByText('Filtered')).toBeInTheDocument();
    expect(summary()).toBe('New customers, last 30 days: 2. Previous 30 days: 0.');
  });

  it('keeps the tour anchors on a single root and on the numbers', () => {
    const { container } = render(
      <CustomersOverview customers={CUSTOMERS} filtered={false} showBlocked={false} today={TODAY} />,
    );
    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild?.getAttribute('data-tour')).toBe('customers-stats');
    expect(container.querySelector('[data-tour="customers-chart"]')).not.toBeNull();
  });
});

describe('CustomersOverview — the featured card', () => {
  it('opens the invite dialog when the viewer may invite', () => {
    const onInvite = vi.fn();
    render(<CustomersOverview customers={CUSTOMERS} filtered={false} onInvite={onInvite} showBlocked today={TODAY} />);
    const card = screen.getByRole('button', { name: /Invite customers/ });
    expect(card.getAttribute('data-tour')).toBe('customers-featured');
    // Invite wins over Blocked when both are allowed.
    expect(screen.queryByText('Blocked customers')).toBeNull();
    fireEvent.click(card);
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('falls back to the Blocked customers page without invite rights', () => {
    render(<CustomersOverview customers={CUSTOMERS} filtered={false} showBlocked today={TODAY} />);
    const link = screen.getByRole('link', { name: /Blocked customers/ });
    expect(link.getAttribute('href')).toBe('/blocked-customers');
    expect(link.getAttribute('data-tour')).toBe('customers-featured');
    expect(screen.queryByText('Invite customers')).toBeNull();
  });

  it('shows no card with neither, and the graph takes the whole row', () => {
    const { container } = render(
      <CustomersOverview customers={CUSTOMERS} filtered={false} showBlocked={false} today={TODAY} />,
    );
    expect(container.querySelector('[data-tour="customers-featured"]')).toBeNull();
    const row = container.firstElementChild!.firstElementChild!;
    expect(row.childElementCount).toBe(1);
    expect(row.firstElementChild!.className).toContain('lg:col-span-4');
  });

  it('keeps the graph at three quarters beside a card', () => {
    const { container } = render(
      <CustomersOverview customers={CUSTOMERS} filtered={false} onInvite={() => {}} showBlocked={false} today={TODAY} />,
    );
    const row = container.firstElementChild!.firstElementChild!;
    expect(row.childElementCount).toBe(2);
    expect(row.firstElementChild!.className).toContain('lg:col-span-3');
  });
});
