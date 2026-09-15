/**
 * Tour anchors on the hero rows, checked against the files that draw them.
 *
 * WHY THIS READS SOURCE. A step whose `data-tour` nobody renders does not fail.
 * `findAnchor` moves on to the next selector, the step lands on the page title,
 * and every other test stays green while the tour points at the wrong thing.
 * The Customers, Vehicles and Rentals hero rows (one graph and one featured
 * card each) replaced the stat cards the old anchors lived on, so this pins
 * each new anchor to the component that draws it, and the steps to the anchors.
 *
 * Comments are stripped first, so a doc comment that mentions an anchor cannot
 * stand in for the attribute. `HeroChart` takes its anchor as a prop and writes
 * it out as `data-tour={anchor}`, so a chart anchor appears in its caller as
 * `anchor="…"`; that hand-off is pinned as well.
 */
import { describe, expect, it } from 'vitest';

import { FIRST_RENTAL_TOUR } from '@/lib/first-rental-tour';
import { getTabTour } from '@/lib/tab-tours';
import { codeOnly, readPortalSource } from '../helpers/edge-source';

/** Where each anchor is drawn. */
const DRAWN_IN: Record<string, readonly string[]> = {
  'components/customers-v2/customers-overview.tsx': ['customers-stats', 'customers-chart', 'customers-featured'],
  'components/vehicles-v2/vehicles-overview.tsx': ['fleet-overview', 'vehicles-chart', 'vehicles-featured'],
  'components/rentals-v2/rentals-overview.tsx': ['rentals-chart', 'rentals-calendar'],
};

const sel = (id: string) => `[data-tour="${id}"]`;

function tabStep(tourId: string, stepId: string) {
  const step = getTabTour(tourId)?.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`the ${tourId} tab tour has no step ${stepId}`);
  return step;
}

const firstRunStep = (id: string) => FIRST_RENTAL_TOUR.find((s) => s.id === id)!;

describe('hero-row tour anchors: drawn where the tours look for them', () => {
  it('HeroChart writes its anchor prop out as data-tour', () => {
    expect(codeOnly(readPortalSource('components/shared/hero-chart-v2.tsx'))).toContain('data-tour={anchor}');
  });

  for (const [file, anchors] of Object.entries(DRAWN_IN)) {
    it(`${file} draws ${anchors.join(', ')}`, () => {
      const code = codeOnly(readPortalSource(file));
      for (const id of anchors) {
        // `data-tour="id"` on an element, or `anchor="id"` handed to HeroChart.
        expect(code, id).toMatch(new RegExp(`(?:data-tour|anchor)="${id}"`));
      }
    });
  }
});

describe('hero-row tour anchors: the steps point at them first', () => {
  it('Customers: the list step and the empty tab both open on the graph, then the overview, then the title', () => {
    for (const id of ['customers.list', 'customers.empty.arrive']) {
      const { anchors } = tabStep('customers', id);
      expect(anchors, id).toEqual([sel('customers-chart'), sel('customers-stats'), '[data-slot="sidebar-inset"] h1']);
    }
  });

  it('Vehicles: the fleet step opens on the graph, keeps the v1 tiles behind it, and is still the outline step', () => {
    const fleet = tabStep('vehicles', 'vehicles.fleet');
    expect(fleet.anchors).toEqual([
      sel('vehicles-chart'),
      sel('fleet-overview'),
      sel('fleet-stat-available'),
      sel('fleet-stat-unavailable'),
      '[data-slot="sidebar-inset"] h1',
      'main h1',
    ]);
    // The only step carrying the outline, and the first stop of the empty run
    // as well as the full one. See the note on the step.
    expect(fleet.showOutline).toBe(true);
    expect(fleet.requires).toBeUndefined();
    expect(getTabTour('vehicles')!.steps[0].id).toBe('vehicles.fleet');
  });

  it('first run: the Vehicles and Customers stops open on their graphs and keep the old anchors behind them', () => {
    expect(firstRunStep('vehicles').anchors).toEqual([
      sel('vehicles-chart'),
      sel('fleet-overview'),
      sel('fleet-stat-total-vehicles'),
      '[data-slot="sidebar-inset"] h1',
    ]);
    expect(firstRunStep('customers').anchors).toEqual([
      sel('customers-chart'),
      sel('customers-stats'),
      '[data-slot="sidebar-inset"] h1',
    ]);
  });

  it('Rentals: the calendar note still names the card that opens calendar view', () => {
    const find = tabStep('rentals', 'rentals.find');
    expect(find.notes?.some((n) => n.anchors?.includes(sel('rentals-calendar')))).toBe(true);
  });

  it('every hero-row anchor any of these tours names is one a component draws', () => {
    const drawn = Object.values(DRAWN_IN).flat();
    const hero = /^\[data-tour="((?:customers|vehicles|rentals)-(?:stats|chart|featured|calendar)|fleet-overview)"\]$/;
    const steps = [...FIRST_RENTAL_TOUR, ...['customers', 'vehicles', 'rentals'].flatMap((t) => getTabTour(t)!.steps)];
    const named = steps
      .flatMap((s) => [...s.anchors, ...(s.notes ?? []).flatMap((n) => n.anchors ?? [])])
      .map((a) => hero.exec(a)?.[1])
      .filter((id): id is string => !!id);
    expect(named.length).toBeGreaterThan(0);
    for (const id of named) expect(drawn, id).toContain(id);
  });
});
