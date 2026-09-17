/**
 * The Vehicles hero graph, "Cars on rent" (hooks/use-vehicles-on-rent-v2.ts and
 * components/vehicles-v2/vehicles-overview.tsx).
 *
 * Every expected number below was worked out BY HAND from the fixture, day by
 * day, before the code ran; none was copied from the code's output. A chart that
 * passes against numbers it computed for itself proves nothing. The one
 * randomised test checks the fast counter against a plain, separately written
 * reading of the same rules, never against itself.
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
 *   E  disposed, r8 Active Sep 1..today: still out, so it counts, and the
 *      headline names it ("+ 1 disposed")
 *   F  not in the table: never, though r9 is Active
 *   r11 has no car: never
 *
 * For A, B, C and D alone, the count per day is:
 *   Jul 20..Aug 5  1 (B)          Aug 25..Sep 1  2 (A, D)
 *   Aug 6..Aug 19  0              Sep 2..Sep 4   3 (A, C, D)
 *   Aug 20..Aug 24 1 (A)          Sep 5..Sep 9   2 (A, D)
 *                                 Sep 10..Sep 14 3 (A, B, D)
 *                                 Sep 15         3 (A, C, D)
 *
 * The page's active-rental signal (every Active rental with a car) is
 * {A, C, D, E, F}; within the table that is {A, C, D, E}: 4.
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
// The deck has its own tests (featured-deck-v2.test.tsx); here it records what
// the row hands it.
const deck = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
vi.mock('@/components/shared/featured-deck-v2', () => ({
  FeaturedDeck: (props: Record<string, any>) => {
    deck.props = props;
    return <section data-testid="deck" data-tour={props.anchor} />;
  },
}));
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
import { VehiclesOverview, fleetSizeCounter, formatCars, onRentSuffix } from '@/components/vehicles-v2/vehicles-overview';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const TODAY = new Date(2026, 8, 15, 14, 0);
const day = (m: number, d: number) => new Date(2026, m - 1, d);
const R = (vehicle_id: string | null, status: string | null, start_date: string | null, end_date: string | null): OnRentRental => ({
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
const CARS = new Set(['A', 'B', 'C', 'D']); // the table's cars that are not disposed

/** The page's `vehicles-active-rental-ids`: status = Active, a car, no date filter. */
const activeSignal = () => new Set(RENTALS.filter((r) => r.status === 'Active' && r.vehicle_id !== null).map((r) => r.vehicle_id));

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

  it('counts only the cars it is given', () => {
    // E and F both have an Active rental from Sep 1. Letting them in adds exactly them.
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

  it('counts a car once through back-to-back, nested and overlapping rentals', () => {
    const on2 = carsOnRentCounter(
      [
        R('A', 'Closed', '2026-09-01', '2026-09-03'),
        R('A', 'Closed', '2026-09-04', '2026-09-06'), // starts the day after the first ends
        R('B', 'Closed', '2026-08-01', '2026-08-31'),
        R('B', 'Closed', '2026-08-10', '2026-08-12'), // inside the first
        R('B', 'Closed', '2026-08-31', '2026-09-02'), // overlaps the first's last day
      ],
      CARS,
      TODAY,
    );
    expect(on2(day(7, 31))).toBe(0);
    expect(on2(day(8, 11))).toBe(1); // B, once, though two rentals cover the day
    expect(on2(day(8, 31))).toBe(1); // B
    expect(on2(day(9, 1))).toBe(2); // A, B
    expect(on2(day(9, 2))).toBe(2); // A, B's last day
    expect(on2(day(9, 3))).toBe(1); // A
    expect(on2(day(9, 4))).toBe(1); // A, second rental
    expect(on2(day(9, 6))).toBe(1); // A
    expect(on2(day(9, 7))).toBe(0);
  });

  it('agrees with a plain day-by-day reading of the rules on 1,500 random rentals', () => {
    // A seeded generator, so a failure reproduces.
    let seed = 20260915;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const cars = Array.from({ length: 40 }, (_, i) => `c${i}`);
    const shown = new Set(cars.filter(() => rand() < 0.75));
    const statuses = ['Active', 'Closed', 'Closed', 'Closed', 'Pending', 'Cancelled', 'Rejected', null];
    const rows: OnRentRental[] = Array.from({ length: 1500 }, () => {
      const start = new Date(2024, 8, 1 + Math.floor(rand() * 780)); // Sep 2024 .. Oct 2026
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.floor(rand() * 45));
      const odd = rand();
      return R(
        odd < 0.02 ? null : pick(cars),
        pick(statuses),
        odd > 0.98 ? 'not-a-date' : iso(start),
        rand() < 0.1 ? null : iso(end),
      );
    });

    // The rules, read literally with yyyy-mm-dd strings (which sort as dates).
    const todayS = iso(TODAY);
    const yesterdayS = iso(new Date(2026, 8, 14));
    const valid = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const reference = (dayS: string) => {
      const out = new Set<string>();
      for (const r of rows) {
        if (!r.vehicle_id || !shown.has(r.vehicle_id)) continue;
        let from: string;
        let to: string;
        if (r.status === 'Active') {
          from = valid(r.start_date) && r.start_date < todayS ? r.start_date : todayS;
          to = todayS;
        } else if (r.status === 'Closed') {
          if (!valid(r.start_date) || !valid(r.end_date)) continue;
          from = r.start_date;
          to = r.end_date < yesterdayS ? r.end_date : yesterdayS;
        } else {
          continue;
        }
        if (from <= dayS && dayS <= to) out.add(r.vehicle_id);
      }
      return out.size;
    };

    const fast = carsOnRentCounter(rows, shown, TODAY);
    const mismatches: string[] = [];
    let days = 0;
    for (let d = new Date(2024, 7, 1); d <= new Date(2026, 8, 25); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const expected = reference(iso(d));
      if (fast(d) !== expected) mismatches.push(`${iso(d)}: ${fast(d)} vs ${expected}`);
      days++;
    }
    expect(days).toBeGreaterThan(780);
    expect(mismatches).toEqual([]);
    expect(fast(TODAY)).toBeGreaterThan(0); // the fixture is not trivially empty
  });
});

describe('the graph numbers over each range', () => {
  const on = carsOnRentCounter(RENTALS, CARS, TODAY);

  it('last 7 days: each day, Sep 9..15 against Sep 2..8', () => {
    const s = stockSeries(on, '7d', TODAY);
    expect(s.points.map((p) => p.current)).toEqual([2, 3, 3, 3, 3, 3, 3]);
    expect(s.points.map((p) => p.previous)).toEqual([3, 3, 3, 2, 2, 2, 2]);
    expect(s.currentTotal).toBe(3);
    expect(s.previousTotal).toBe(2); // Sep 8: A, D
    expect(s.previousDay).toEqual(day(9, 8));
  });

  it('last 30 days: each day, Aug 17..Sep 15 against Jul 18..Aug 16', () => {
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
    expect(s.previousTotal).toBe(0); // Aug 16, the one day it is read on
    expect(s.previousDay).toEqual(day(8, 16));
  });

  it('last 3 months: each week is the average cars out per day across its 7 days', () => {
    // Weeks from Jun 17: car-days per week, worked from the table in the header.
    //  0 Jun 17-23: 0    4 Jul 15-21: 2 (B Jul 20, 21)   8 Aug 12-18: 0
    //  1 Jun 24-30: 0    5 Jul 22-28: 7 (B)              9 Aug 19-25: 0+1*5+2 = 7
    //  2 Jul 1-7:   0    6 Jul 29-Aug 4: 7 (B)          10 Aug 26-Sep 1: 2*6+2 = 14
    //  3 Jul 8-14:  0    7 Aug 5-11: 1 (B Aug 5)        11 Sep 2-8: 3*3+2*4 = 17
    //                                                   12 Sep 9-15: 2+3*5+3 = 20
    const s = stockSeries(on, '3m', TODAY);
    const expected = [0, 0, 0, 0, 2 / 7, 1, 1, 1 / 7, 0, 1, 2, 17 / 7, 20 / 7];
    s.points.forEach((p, i) => expect(p.current).toBeCloseTo(expected[i], 12));
    expect(s.points[4].currentLabel).toBe('Jul 15 – Jul 21');
    expect(s.points.every((p) => p.previous === 0)).toBe(true); // Mar 18..Jun 16: nothing out
    expect(s.currentTotal).toBe(3);
    expect(s.previousTotal).toBe(0); // Jun 16
    expect(s.averaged).toBe(true);
  });

  it('last 12 months: each month is the average cars out per day, this month over Sep 1..15', () => {
    // Jul 2026: B Jul 20-31 = 12 car-days of 31. Aug: B 5 + A 12 + D 7 = 24 of 31.
    // Sep 1-15: 2 + 3*3 + 2*5 + 3*5 + 3 = 39 of 15.
    const s = stockSeries(on, '12m', TODAY);
    const expected = [0, 0, 0, 0, 0, 0, 0, 0, 0, 12 / 31, 24 / 31, 39 / 15];
    s.points.forEach((p, i) => expect(p.current).toBeCloseTo(expected[i], 12));
    expect(s.points[10].currentLabel).toBe('Aug 2026');
    expect(s.points.every((p) => p.previous === 0)).toBe(true);
    expect(s.currentTotal).toBe(3);
    expect(s.previousTotal).toBe(0); // Sep 15 2025
    expect(s.previousDay).toEqual(new Date(2025, 8, 15));
  });
});

describe("today's headline equals the cars the table shows as out", () => {
  it("is the page's active-rental signal within the table: the Rented badges, plus the disposed car it names", () => {
    const signal = activeSignal();
    const shown = new Set(VEHICLES.map((v) => v.id));
    expect([...signal].filter((id) => id && shown.has(id)).sort()).toEqual(['A', 'C', 'D', 'E']);
    const badges = VEHICLES.map((v) => resolveVehicleStatus({ ...v, has_active_rental: signal.has(v.id) }));
    expect(badges).toEqual(['Rented', 'Available', 'Rented', 'Rented', 'Disposed']);

    const on = carsOnRentCounter(RENTALS, shown, TODAY);
    for (const range of ['7d', '30d', '3m', '12m'] as const) {
      expect(stockSeries(on, range, TODAY).currentTotal).toBe(4);
    }
  });
});

describe('formatting', () => {
  it('prints a day as a whole number and an average with one decimal, never a small one as 0.0', () => {
    expect(formatCars(0)).toBe('0');
    expect(formatCars(3)).toBe('3');
    expect(formatCars(20 / 7)).toBe('2.9'); // 2.857
    expect(formatCars(12 / 31)).toBe('0.4'); // 0.387
    expect(formatCars(0.96)).toBe('1.0');
    expect(formatCars(1 / 31)).toBe('< 0.1'); // 0.032 would round to 0.0
  });

  it('names disposed cars that are out beside the fleet', () => {
    expect(onRentSuffix(7, 0)).toBe('of 7 cars');
    expect(onRentSuffix(1, 0)).toBe('of 1 car');
    expect(onRentSuffix(0, 0)).toBe('of 0 cars');
    expect(onRentSuffix(7, 1)).toBe('of 7 cars + 1 disposed');
    expect(onRentSuffix(0, 1)).toBe('of 1 disposed car');
    expect(onRentSuffix(0, 2)).toBe('of 2 disposed cars');
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
    // The earliest day "Last 12 months" against "Previous 12 months" ever reads.
    let earliest = TODAY;
    stockSeries((d) => ((earliest = d < earliest ? d : earliest), 0), '12m', TODAY);
    expect(earliest).toEqual(new Date(2024, 9, 1)); // Oct 1 2024, the previous window's first day
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
  const summary = () => document.querySelector('p.sr-only')?.textContent;

  beforeEach(() => {
    gate.availability = true;
    gate.permissionsLoading = false;
    gate.canAccess = true;
    gate.canEdit = true;
  });

  it('headlines the cars out today, naming the disposed one, against the cars out on Aug 16', () => {
    render(<VehiclesOverview vehicles={VEHICLES} onRent={loaded} filtered={false} />);
    // Fleet: A-D have no created_at, so they have always been there; E is
    // disposed with no disposal date, so it counts on no day. 4, the N in "of 4 cars".
    expect(summary()).toBe('Cars on rent today: 4 of 4 cars + 1 disposed. On Aug 16: 0. Fleet today: 4.');
    expect(screen.getByText('Cars on rent today')).toBeInTheDocument();
    expect(screen.getByText('of 4 cars + 1 disposed')).toBeInTheDocument();
    // The legend names that day with its count: "On Aug 16" then "0".
    expect(screen.getByText('On Aug 16').closest('span')?.textContent).toBe('On Aug 160');
    // A level moves by cars, not by a percentage: 4 against 0 is up 4.
    const chip = document.querySelector('[data-change]');
    expect(chip?.getAttribute('data-change')).toBe('up');
    expect(chip?.textContent).toBe('4');
    expect(screen.getByText('Fleet')).toBeInTheDocument();
    expect(screen.queryByText(/Previous/)).toBeNull();
    expect(document.querySelector('[data-tour="vehicles-chart"]')).not.toBeNull();
    expect(screen.queryByText('Filtered')).toBeNull();
  });

  it('reads the fleet alone when no disposed car is out', () => {
    render(<VehiclesOverview vehicles={VEHICLES.slice(0, 4)} onRent={loaded} filtered={false} />);
    expect(summary()).toBe('Cars on rent today: 3 of 4 cars. On Aug 16: 0. Fleet today: 4.');
  });

  it('counts a disposed car the table still badges Rented, so the headline matches the badges', () => {
    const vehicles = [...VEHICLES.slice(0, 4), { id: 'E', status: 'Rented', is_disposed: true }];
    const signal = activeSignal();
    const rented = vehicles.filter((v) => resolveVehicleStatus({ ...v, has_active_rental: signal.has(v.id) }) === 'Rented');
    expect(rented.map((v) => v.id)).toEqual(['A', 'C', 'D', 'E']);
    render(<VehiclesOverview vehicles={vehicles} onRent={loaded} filtered={false} />);
    expect(summary()).toBe('Cars on rent today: 4 of 4 cars + 1 disposed. On Aug 16: 0. Fleet today: 4.');
  });

  it('says Filtered when the table is narrowed', () => {
    render(<VehiclesOverview vehicles={VEHICLES} onRent={loaded} filtered />);
    expect(screen.getByText('Filtered')).toBeInTheDocument();
  });

  it('hands the deck the vehicles tab, its routes and anchor, beside a three-quarter graph', () => {
    render(<VehiclesOverview vehicles={VEHICLES} onRent={loaded} filtered={false} />);
    expect(deck.props?.tab).toBe('vehicles');
    expect(deck.props?.routePrefixes).toEqual(['/vehicles', '/blocked-dates', '/turo-bridge']);
    expect(deck.props?.anchor).toBe('vehicles-featured');
    expect(deck.props?.className).toBe('lg:min-h-0');
    expect(chartColumn()?.className).toContain('lg:col-span-3');
  });

  it('draws no number while the rentals load, and keeps both anchors', () => {
    render(
      <VehiclesOverview vehicles={VEHICLES} onRent={{ data: undefined, isError: false, dataUpdatedAt: 0, refetch: () => {} }} filtered={false} />,
    );
    const section = document.querySelector('section');
    expect(section?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Cars on rent today')).toBeInTheDocument();
    expect((section?.textContent ?? '').replace(/Last 30 days/g, '')).not.toMatch(/\d/);
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

describe('fleetSizeCounter: the Fleet line', () => {
  // Today is Tue 15 Sep 2026 (TODAY). Worked by hand:
  //   A created Sep 1 10:00 local        -> in the fleet from Sep 1
  //   B no created_at                     -> always
  //   C created Aug 20, disposed Sep 10   -> Aug 20 .. Sep 9
  //   D disposed, no disposal date        -> never
  //   E created '2026-09-15' (bare date)  -> Sep 15 only
  const cars = [
    { id: 'A', created_at: new Date(2026, 8, 1, 10).toISOString() },
    { id: 'B' },
    { id: 'C', created_at: '2026-08-20', is_disposed: true, disposal_date: '2026-09-10' },
    { id: 'D', created_at: '2026-01-01', is_disposed: true },
    { id: 'E', created_at: '2026-09-15' },
  ];
  const fleet = fleetSizeCounter(cars, TODAY);
  const on = (m: number, d: number) => fleet(new Date(2026, m - 1, d, 12));

  it('counts each car from the day it joined to the day it was disposed of', () => {
    expect(on(8, 19)).toBe(1); // B
    expect(on(8, 20)).toBe(2); // B, C
    expect(on(9, 1)).toBe(3); // A, B, C
    expect(on(9, 9)).toBe(3); // A, B, C
    expect(on(9, 10)).toBe(2); // A, B: C left that day
    expect(on(9, 15)).toBe(3); // A, B, E
  });

  it('matches "of N cars" today, and counts nothing after today', () => {
    expect(on(9, 15)).toBe(cars.filter((c) => !c.is_disposed).length);
    expect(on(9, 16)).toBe(0);
  });
});
