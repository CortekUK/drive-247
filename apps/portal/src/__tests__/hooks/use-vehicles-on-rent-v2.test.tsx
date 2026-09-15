/**
 * The Vehicles hero graph, "Cars on rent" (hooks/use-vehicles-on-rent-v2.ts and
 * components/vehicles-v2/vehicles-overview.tsx).
 *
 * Every expected number below was worked out BY HAND from the fixture, day by
 * day, before the code ran; none was copied from the code's output. A chart that
 * passes against numbers it computed for itself proves nothing.
 *
 * "Today" is Tue 15 Sep 2026, 14:00 local. The table shows cars A, B, C, D and
 * E (E disposed); F is filtered out of the table. Per car, the days on rent:
 *   A  r1 Active  Sep 1..today (end Sep 10 passed: overdue, still out)
 *      r2 Closed  Aug 20..Aug 31
 *      r10 Closed Sep 3..Sep 6 (overlaps r1: A still counts once)
 *   B  r3 Closed  Sep 10..Sep 14 (ended today, so NOT today: the car is back)
 *      r14 Closed Jul 20..Aug 5
 *      r4 Pending, r15 Rejected: never
 *   C  r5 Active  starts Sep 20 (keys handed early): today only
 *      r12 Closed Sep 2..Sep 4
 *   D  r13 Active Aug 25..today (no end date: pay-as-you-go)
 *      r6 Cancelled: never; r7 Closed with no end date: cannot be placed
 *   E  disposed: never, though r8 is Active
 *   F  not in the table: never, though r9 is Active
 *   r11 has no car: never
 *
 * The page's active-rental signal (every Active rental with a car) is
 * {A, C, D, E, F}; within the table's non-disposed cars that is {A, C, D}: 3.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const db = vi.hoisted(() => ({
  rows: [] as unknown[],
  cap: 1000,
  fail: false,
  calls: [] as { table: string; filters: unknown[][] }[],
}));
const gate = vi.hoisted(() => ({
  availability: true,
  permissionsLoading: false,
  canAccess: true,
  canEdit: true,
}));

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: { id: 'tenant-a' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, filters: [] as unknown[][] };
      db.calls.push(call);
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'not', 'or', 'order']) {
        query[method] = (...args: unknown[]) => {
          call.filters.push([method, ...args]);
          return query;
        };
      }
      query.range = (from: number, through: number) => {
        call.filters.push(['range', from, through]);
        const size = Math.min(through - from + 1, db.cap);
        return Promise.resolve(
          db.fail
            ? { data: null, error: new Error('Unavailable') }
            : { data: db.rows.slice(from, from + size), error: null },
        );
      };
      return query;
    },
  },
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: unknown) => options }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/v2-context', () => ({
  useV2: (area: string) => (area === 'availability' ? gate.availability : true),
}));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({
    isLoading: gate.permissionsLoading,
    canAccessRoute: (path: string) => path === '/blocked-dates' && gate.canAccess,
    canEdit: (tab: string) => tab === 'availability' && gate.canEdit,
  }),
}));

import {
  carsOnRentCounter,
  fetchOnRentRentals,
  onRentHistoryStart,
  useVehiclesOnRentV2,
  type OnRentRental,
} from '@/hooks/use-vehicles-on-rent-v2';
import { stockSeries } from '@/lib/hero-series';
import { resolveVehicleStatus } from '@/components/vehicles/vehicle-status-badge';
import { VehiclesOverview } from '@/components/vehicles-v2/vehicles-overview';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const TODAY = new Date(2026, 8, 15, 14, 0);
const day = (m: number, d: number) => new Date(2026, m - 1, d);
const R = (vehicle_id: string | null, status: string, start_date: string, end_date: string | null): OnRentRental => ({
  vehicle_id,
  status,
  start_date,
  end_date,
});

const RENTALS: OnRentRental[] = [
  R('A', 'Active', '2026-09-01', '2026-09-10'), // r1
  R('A', 'Closed', '2026-08-20', '2026-08-31'), // r2
  R('B', 'Closed', '2026-09-10', '2026-09-15'), // r3
  R('B', 'Pending', '2026-09-12', '2026-09-20'), // r4
  R('C', 'Active', '2026-09-20', '2026-09-25'), // r5
  R('D', 'Cancelled', '2026-09-05', '2026-09-09'), // r6
  R('D', 'Closed', '2026-09-05', null), // r7
  R('E', 'Active', '2026-09-01', null), // r8
  R('F', 'Active', '2026-09-01', null), // r9
  R('A', 'Closed', '2026-09-03', '2026-09-06'), // r10
  R(null, 'Active', '2026-09-01', null), // r11
  R('C', 'Closed', '2026-09-02', '2026-09-04'), // r12
  R('D', 'Active', '2026-08-25', null), // r13
  R('B', 'Closed', '2026-07-20', '2026-08-05'), // r14
  R('B', 'Rejected', '2026-09-01', '2026-09-03'), // r15
];

/** The table's rows. Raw statuses as the system would leave them. */
const VEHICLES = [
  { id: 'A', status: 'Rented', is_disposed: false },
  { id: 'B', status: 'Available', is_disposed: false }, // r3 closed today reset it
  { id: 'C', status: 'Rented', is_disposed: false },
  { id: 'D', status: 'Rented', is_disposed: false },
  { id: 'E', status: 'Disposed', is_disposed: true },
];
const CARS = new Set(['A', 'B', 'C', 'D']); // the non-disposed cars in the table

describe('carsOnRentCounter: the day-by-day count', () => {
  const on = carsOnRentCounter(RENTALS, CARS, TODAY);

  it('counts the cars out on each hand-checked day', () => {
    expect(on(day(9, 15))).toBe(3); // A r1, C r5, D r13; B's r3 closed today
    expect(on(day(9, 14))).toBe(3); // A, B r3, D
    expect(on(day(9, 10))).toBe(3); // A, B r3 starts, D
    expect(on(day(9, 9))).toBe(2); // A, D
    expect(on(day(9, 5))).toBe(2); // A (r1 and r10, once), D; C's r12 ended Sep 4
    expect(on(day(9, 4))).toBe(3); // A, C r12 last day, D
    expect(on(day(9, 2))).toBe(3); // A, C r12 first day, D
    expect(on(day(9, 1))).toBe(2); // A r1 first day, D
    expect(on(day(8, 31))).toBe(2); // A r2 last day, D
    expect(on(day(8, 25))).toBe(2); // A r2, D r13 first day
    expect(on(day(8, 24))).toBe(1); // A r2
    expect(on(day(8, 20))).toBe(1); // A r2 first day
    expect(on(day(8, 19))).toBe(0);
    expect(on(day(8, 5))).toBe(1); // B r14 last day
    expect(on(day(7, 20))).toBe(1); // B r14 first day
    expect(on(day(7, 19))).toBe(0);
  });

  it('counts nothing after today', () => {
    expect(on(day(9, 16))).toBe(0);
    expect(on(day(9, 20))).toBe(0); // C's r5 is dated to start here, but that is the future
  });

  it('never counts a disposed car or one outside the table', () => {
    // E and F both have an Active rental on Sep 15. Letting them in adds exactly them.
    const all = carsOnRentCounter(RENTALS, new Set([...CARS, 'E', 'F']), TODAY);
    expect(all(day(9, 15))).toBe(5);
    expect(all(day(9, 1))).toBe(4); // A r1, D, E r8 and F r9 both start Sep 1
    expect(all(day(8, 31))).toBe(2); // A r2, D: E and F are not out yet
  });

  it('places an Active rental with an unreadable start on today only, and skips such a Closed one', () => {
    const odd = carsOnRentCounter(
      [R('A', 'Active', 'not-a-date', null), R('B', 'Closed', 'not-a-date', '2026-09-10')],
      CARS,
      TODAY,
    );
    expect(odd(day(9, 15))).toBe(1);
    expect(odd(day(9, 14))).toBe(0);
    expect(odd(day(9, 10))).toBe(0);
  });
});

describe('the graph numbers over each range', () => {
  const on = carsOnRentCounter(RENTALS, CARS, TODAY);

  it('last 7 days: Sep 9..15 against Sep 2..8', () => {
    const s = stockSeries(on, '7d', TODAY);
    expect(s.points.map((p) => p.current)).toEqual([2, 3, 3, 3, 3, 3, 3]);
    expect(s.points.map((p) => p.previous)).toEqual([3, 3, 3, 2, 2, 2, 2]);
    expect(s.currentTotal).toBe(3);
    expect(s.previousTotal).toBe(2); // Sep 8: A, D
  });

  it('last 30 days: Aug 17..Sep 15 against Jul 18..Aug 16', () => {
    const s = stockSeries(on, '30d', TODAY);
    const at = (i: number) => [s.points[i].currentLabel, s.points[i].current, s.points[i].previousLabel, s.points[i].previous];
    expect(at(0)).toEqual(['Aug 17', 0, 'Jul 18', 0]);
    expect(at(2)).toEqual(['Aug 19', 0, 'Jul 20', 1]);
    expect(at(3)).toEqual(['Aug 20', 1, 'Jul 21', 1]);
    expect(at(8)).toEqual(['Aug 25', 2, 'Jul 26', 1]);
    expect(at(18)).toEqual(['Sep 4', 3, 'Aug 5', 1]);
    expect(at(19)).toEqual(['Sep 5', 2, 'Aug 6', 0]);
    expect(at(24)).toEqual(['Sep 10', 3, 'Aug 11', 0]);
    expect(at(29)).toEqual(['Sep 15', 3, 'Aug 16', 0]);
    expect(s.currentTotal).toBe(3);
    expect(s.previousTotal).toBe(0);
  });

  it('last 3 months: weekly, each week sampled on its last day', () => {
    // Jun 17..Sep 15; weeks end Jun 23, Jun 30, Jul 7, Jul 14, Jul 21, Jul 28,
    // Aug 4, Aug 11, Aug 18, Aug 25, Sep 1, Sep 8 and today.
    const s = stockSeries(on, '3m', TODAY);
    expect(s.points.map((p) => p.current)).toEqual([0, 0, 0, 0, 1, 1, 1, 0, 0, 2, 2, 2, 3]);
    expect(s.currentTotal).toBe(3);
  });

  it('last 12 months: monthly, each month sampled on its last day, this month today', () => {
    const s = stockSeries(on, '12m', TODAY);
    expect(s.points.map((p) => p.current)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);
    expect(s.points[10].currentLabel).toBe('Aug 2026');
    expect(s.points.every((p) => p.previous === 0)).toBe(true);
  });
});

describe("today's headline equals the table's Rented cars", () => {
  it('matches the page signal and the Status badge on the fixture', () => {
    // The page's query: status = Active and vehicle_id not null, no date filter.
    const signal = new Set(RENTALS.filter((r) => r.status === 'Active' && r.vehicle_id !== null).map((r) => r.vehicle_id));
    const rentedBadges = VEHICLES.filter((v) => !v.is_disposed).filter(
      (v) => resolveVehicleStatus({ ...v, has_active_rental: signal.has(v.id) }) === 'Rented',
    );
    expect(rentedBadges.map((v) => v.id)).toEqual(['A', 'C', 'D']);

    const on = carsOnRentCounter(RENTALS, CARS, TODAY);
    for (const range of ['7d', '30d', '3m', '12m'] as const) {
      expect(stockSeries(on, range, TODAY).currentTotal).toBe(3);
    }
  });
});

describe('fetchOnRentRentals: the read', () => {
  beforeEach(() => {
    db.rows = [];
    db.cap = 1000;
    db.fail = false;
    db.calls = [];
  });

  it('is tenant-scoped and asks only for what the count needs', async () => {
    await fetchOnRentRentals('tenant-a', '2024-09-01');
    const filters = db.calls[0].filters;
    expect(db.calls[0].table).toBe('rentals');
    expect(filters).toContainEqual(['select', 'vehicle_id, start_date, end_date, status']);
    expect(filters).toContainEqual(['eq', 'tenant_id', 'tenant-a']);
    expect(filters).toContainEqual(['in', 'status', ['Active', 'Closed']]);
    expect(filters).toContainEqual(['not', 'vehicle_id', 'is', null]);
    expect(filters).toContainEqual(['or', 'status.eq.Active,end_date.gte.2024-09-01']);
    expect(filters).toContainEqual(['order', 'id', { ascending: true }]);
  });

  it('pages past 1,000 rows and stops only on an empty page', async () => {
    db.rows = Array.from({ length: 2345 }, (_, i) => R(`v${i}`, 'Closed', '2026-01-01', '2026-01-02'));
    const rows = await fetchOnRentRentals('tenant-a', '2024-09-01');
    expect(rows).toHaveLength(2345);
    // 1000 + 1000 + 345, then the empty page that ends the walk.
    expect(db.calls.map((c) => c.filters.find((f) => f[0] === 'range'))).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
      ['range', 2000, 2999],
      ['range', 2345, 3344],
    ]);
  });

  it('keeps reading when the server caps a page below 1,000', async () => {
    db.cap = 500;
    db.rows = Array.from({ length: 1200 }, (_, i) => R(`v${i}`, 'Closed', '2026-01-01', '2026-01-02'));
    const rows = await fetchOnRentRentals('tenant-a', '2024-09-01');
    expect(rows).toHaveLength(1200);
    expect(db.calls).toHaveLength(4); // 500, 500, 200, then empty
  });

  it('throws on a failed read instead of charting an empty book', async () => {
    db.fail = true;
    await expect(fetchOnRentRentals('tenant-a', '2024-09-01')).rejects.toThrow('Unavailable');
  });

  it('reaches back far enough for the widest comparison', () => {
    expect(onRentHistoryStart(TODAY)).toBe('2024-09-01');
    // The earliest day "Last 12 months" against "Previous 12 months" ever samples.
    let earliest = TODAY;
    stockSeries((d) => ((earliest = d < earliest ? d : earliest), 0), '12m', TODAY);
    const [y, m, d] = onRentHistoryStart(TODAY).split('-').map(Number);
    expect(new Date(y, m - 1, d) <= earliest).toBe(true);
  });

  it('is disabled unless the page is on v2, under its own key', () => {
    const off = useVehiclesOnRentV2(false) as unknown as { enabled: boolean; queryKey: unknown[] };
    const on = useVehiclesOnRentV2(true) as unknown as { enabled: boolean; queryKey: unknown[] };
    expect(off.enabled).toBe(false);
    expect(on.enabled).toBe(true);
    expect(on.queryKey.slice(0, 2)).toEqual(['vehicles-v2-on-rent', 'tenant-a']);
    expect(String(on.queryKey[2])).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

describe('VehiclesOverview: the row', () => {
  const loaded = { data: RENTALS, isError: false, dataUpdatedAt: TODAY.getTime(), refetch: () => {} };
  const chartColumn = () => document.querySelector('[data-tour="fleet-overview"]')?.firstElementChild?.firstElementChild;

  beforeEach(() => {
    gate.availability = true;
    gate.permissionsLoading = false;
    gate.canAccess = true;
    gate.canEdit = true;
  });

  it('headlines 3 of 4 cars today against 0 on the last day of the previous 30', () => {
    render(<VehiclesOverview vehicles={VEHICLES} onRent={loaded} filtered={false} />);
    expect(document.querySelector('p.sr-only')?.textContent).toBe('Cars on rent, last 30 days: 3. Previous 30 days: 0.');
    expect(screen.getByText('of 4 cars')).toBeInTheDocument();
    expect(document.querySelector('[data-tour="vehicles-chart"]')).not.toBeNull();
    expect(screen.queryByText('Filtered')).toBeNull();
  });

  it('says Filtered when the table is narrowed', () => {
    render(<VehiclesOverview vehicles={VEHICLES} onRent={loaded} filtered />);
    expect(screen.getByText('Filtered')).toBeInTheDocument();
  });

  it('offers the Availability card to someone who may edit it', () => {
    render(<VehiclesOverview vehicles={VEHICLES} onRent={loaded} filtered={false} />);
    const card = document.querySelector('[data-tour="vehicles-featured"]');
    expect(card?.getAttribute('href')).toBe('/blocked-dates');
    expect(card?.textContent).toContain('Set when customers can book');
    expect(chartColumn()?.className).toContain('lg:col-span-3');
  });

  it('words the card for looking when the viewer may not edit', () => {
    gate.canEdit = false;
    render(<VehiclesOverview vehicles={VEHICLES} onRent={loaded} filtered={false} />);
    expect(document.querySelector('[data-tour="vehicles-featured"]')?.textContent).toContain('See when customers can book');
  });

  it.each([
    ['the v2 Availability screen is off', () => (gate.availability = false)],
    ['a manager has no Availability grant', () => (gate.canAccess = false)],
    ['the grants are still loading', () => (gate.permissionsLoading = true)],
  ])('has no card, and the graph takes the row, when %s', (_why, set) => {
    set();
    render(<VehiclesOverview vehicles={VEHICLES} onRent={loaded} filtered={false} />);
    expect(document.querySelector('[data-tour="vehicles-featured"]')).toBeNull();
    expect(chartColumn()?.className).toContain('lg:col-span-4');
  });

  it('draws no number while the rentals load, and keeps both anchors', () => {
    render(
      <VehiclesOverview vehicles={VEHICLES} onRent={{ data: undefined, isError: false, dataUpdatedAt: 0, refetch: () => {} }} filtered={false} />,
    );
    const section = document.querySelector('section');
    expect(section?.getAttribute('aria-busy')).toBe('true');
    expect((section?.textContent ?? '').replace(/(Previous|Last) 30 days/g, '')).not.toMatch(/\d/);
    expect(document.querySelector('[data-tour="fleet-overview"]')).not.toBeNull();
    expect(document.querySelector('[data-tour="vehicles-chart"]')).not.toBeNull();
  });

  it('offers a retry when the read fails', () => {
    const refetch = vi.fn();
    render(<VehiclesOverview vehicles={VEHICLES} onRent={{ data: undefined, isError: true, dataUpdatedAt: 0, refetch }} filtered={false} />);
    expect(screen.getByText("Couldn't load the rentals for this graph.")).toBeInTheDocument();
    fireEvent.click(screen.getByText('Try again'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
