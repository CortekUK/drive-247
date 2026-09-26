/**
 * The Finances tab tour — registered, found on its route, pointed only at the
 * agreed anchors, split into an empty and a full run, and the Payments tour
 * left exactly as it was for every tenant still on `/payments`.
 *
 * Finances is canary-only by slug, so both tours must coexist: `/payments`
 * keeps its own tour for everyone else (including the real v2 tenants, who get
 * the tour button), and `/finances` gets this one.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildTour,
  isTourWorthRunning,
  type TourBuildContext,
  type TourStep,
} from '@/lib/first-rental-tour';
import {
  FINANCES_ATTENTION_SECTION,
  FINANCES_EMPTY_STATE,
  TAB_TOUR_IDS,
  getTabTour,
  readEmptyTabs,
  tabTourForPath,
  tabTourVariant,
} from '@/lib/tab-tours';
import { FINANCES_ANCHORS, FINANCES_TAB_TOUR } from '@/lib/tab-tours/finances';
import { PAYMENTS_TAB_TOUR } from '@/lib/tab-tours/payments';
import { codeOnly, readPortalSource } from '../helpers/edge-source';

const sel = (name: string) => `[data-tour="${name}"]`;
const FIXED = new Set(FINANCES_ANCHORS.map(sel));
const HEADER = sel('finances-header');
/** The empty run's one non-fixed anchor: the teaching card the guard reads. */
const EMPTY_HEADLINE = FINANCES_EMPTY_STATE.map((card) => `${card} h3`).join(', ');

const ctx = (over: Partial<TourBuildContext> = {}): TourBuildContext => ({
  canAccessRoute: () => true,
  canEdit: () => true,
  canViewSettings: () => true,
  isMobile: false,
  rentalCreationBlocked: false,
  emptyTabs: [],
  ...over,
});

const ids = (steps: readonly TourStep[]) => steps.map((s) => s.id);
const steps = FINANCES_TAB_TOUR.steps;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('finances tab tour — registration', () => {
  it('is one of the tab tours, by id', () => {
    expect(TAB_TOUR_IDS).toContain('finances');
    expect(getTabTour('finances')).toBe(FINANCES_TAB_TOUR);
    expect(FINANCES_TAB_TOUR).toMatchObject({ id: 'finances', label: 'Finances', homeRoute: '/finances' });
    expect(FINANCES_TAB_TOUR.emptyMessage).toMatch(/Finances/);
  });

  it('is the tour tabTourForPath finds on /finances, and only there', () => {
    expect(tabTourForPath('/finances')?.id).toBe('finances');
    expect(tabTourForPath('/finances/anything')?.id).toBe('finances');
    // A segment boundary, not a prefix.
    expect(tabTourForPath('/finances-archive')).toBeNull();
    // Payments keeps its own route, for every tenant still on it.
    expect(tabTourForPath('/payments')?.id).toBe('payments');
    expect(tabTourForPath('/payments/analytics')?.id).toBe('payments');
    expect(tabTourForPath('/invoices')).toBeNull();
    expect(tabTourForPath('/fines')).toBeNull();
  });

  it('gives every tab tour exactly one home route', () => {
    const homes = TAB_TOUR_IDS.map((id) => getTabTour(id)!.homeRoute);
    expect(new Set(homes).size).toBe(homes.length);
  });
});

describe('finances tab tour — the steps', () => {
  it('has unique ids, all namespaced, all on /finances', () => {
    expect(new Set(ids(steps)).size).toBe(steps.length);
    for (const step of steps) {
      expect(step.id.startsWith('finances.'), step.id).toBe(true);
      expect(step.route, step.id).toBe('/finances');
      expect(step.routeFor, step.id).toBeUndefined();
    }
  });

  it('points every spotlight at one of the fixed anchor names', () => {
    for (const step of steps) {
      expect(step.anchors.length, step.id).toBeGreaterThan(0);
      for (const anchor of step.anchors) {
        // The one exception is the empty run's teaching card — the element the
        // empty guard itself reads, so the step and its guard cannot disagree.
        if (step.id === 'finances.empty.what' && anchor === EMPTY_HEADLINE) continue;
        expect(FIXED.has(anchor), `${step.id}: ${anchor}`).toBe(true);
      }
      for (const note of step.notes ?? []) {
        for (const anchor of note.anchors ?? []) expect(FIXED.has(anchor), `${step.id} note: ${anchor}`).toBe(true);
      }
    }
    expect(steps.find((s) => s.id === 'finances.empty.what')!.anchors[0]).toBe(EMPTY_HEADLINE);
  });

  it('ends every anchor list on the header, except Needs attention, which has no honest fallback', () => {
    for (const step of steps) {
      if (step.id === 'finances.attention') {
        expect(step.anchors).toEqual([sel('finances-attention')]);
        continue;
      }
      expect(step.anchors[step.anchors.length - 1], step.id).toBe(HEADER);
    }
  });

  it('walks the page top to bottom: header, record, overview, filter, attention, views, row, side panel', () => {
    const order = ids(steps);
    const at = (id: string) => order.indexOf(id);
    const walk = [
      'finances.header',
      'finances.record',
      'finances.overview',
      'finances.filter',
      'finances.attention',
      'finances.views',
      'finances.row',
      'finances.panel',
    ];
    for (let i = 1; i < walk.length; i++) expect(at(walk[i - 1]), walk[i]).toBeLessThan(at(walk[i]));
    expect(steps[0].showOutline).toBe(true);
    expect(steps.filter((s) => s.showOutline)).toHaveLength(1);
    const anchorOf = (id: string) => steps.find((s) => s.id === id)!.anchors[0];
    expect(anchorOf('finances.header')).toBe(sel('finances-header'));
    expect(anchorOf('finances.record')).toBe(sel('finances-record-payment'));
    expect(anchorOf('finances.overview')).toBe(sel('finances-overview'));
    expect(anchorOf('finances.filter')).toBe(sel('finances-filter'));
    expect(anchorOf('finances.views')).toBe(sel('finances-views'));
    expect(anchorOf('finances.row')).toBe(sel('finances-row'));
    expect(anchorOf('finances.panel')).toBe(sel('finances-side-panel'));
  });

  it('never points two consecutive steps of a run at the same first choice', () => {
    for (const empty of [false, true]) {
      const built = buildTour(ctx({ emptyTabs: empty ? ['finances'] : [] }), steps);
      for (let i = 1; i < built.length; i++) {
        expect(built[i].anchors[0], `${built[i - 1].id} → ${built[i].id}`).not.toBe(built[i - 1].anchors[0]);
      }
    }
  });

  it('steps aside on the controls that open something (Record payment, a row, its panel)', () => {
    const pausing = steps.filter((s) => s.pauseOnAnchorClick).map((s) => s.id);
    expect(pausing).toEqual(['finances.record', 'finances.row', 'finances.panel', 'finances.empty.record']);
    // Never spotlight a money control for someone who cannot use it.
    for (const id of ['finances.record', 'finances.empty.record']) {
      expect(steps.find((s) => s.id === id)!.requires).toMatchObject({ tab: 'payments', edit: true });
    }
  });

  it('keeps the copy short and plain — no PAYG, installment or FIFO', () => {
    for (const step of steps) {
      expect(step.title.length, step.id).toBeLessThan(40);
      expect(step.body.length, step.id).toBeLessThan(170);
      for (const note of step.notes ?? []) expect(note.text.length, step.id).toBeLessThan(120);
      const words = [step.label, step.title, step.body, ...(step.notes ?? []).map((n) => n.text)].join(' ');
      expect(words, step.id).not.toMatch(/payg|pay[- ]as[- ]you[- ]go|instal+ments?|fifo/i);
    }
  });

  it('describes the four views by the question each answers', () => {
    const views = steps.find((s) => s.id === 'finances.views')!;
    for (const name of ['Billed', 'Received', 'Upcoming', 'Fines']) expect(views.body).toContain(name);
    const panel = steps.find((s) => s.id === 'finances.panel')!;
    expect(panel.body).toMatch(/Stripe reference/);
  });
});

describe('finances tab tour — variants', () => {
  const FULL = [
    'finances.header',
    'finances.record',
    'finances.overview',
    'finances.filter',
    'finances.attention',
    'finances.views',
    'finances.row',
    'finances.panel',
  ];
  const EMPTY = [
    'finances.header',
    'finances.overview',
    'finances.attention',
    'finances.views',
    'finances.empty.what',
    'finances.empty.record',
  ];

  it('full: a tab with money in it, Needs attention on screen', () => {
    expect(ids(buildTour(ctx(), steps))).toEqual(FULL);
  });

  it('empty: a tab with no money yet', () => {
    expect(ids(buildTour(ctx({ emptyTabs: ['finances'] }), steps))).toEqual(EMPTY);
  });

  it('drops Needs attention when the section is not on screen, in either run', () => {
    const none = [FINANCES_ATTENTION_SECTION];
    expect(ids(buildTour(ctx({ emptyTabs: none }), steps))).toEqual(FULL.filter((id) => id !== 'finances.attention'));
    expect(ids(buildTour(ctx({ emptyTabs: ['finances', ...none] }), steps))).toEqual(
      EMPTY.filter((id) => id !== 'finances.attention'),
    );
  });

  it('builds the full run when emptiness is not known (fails closed to "has data")', () => {
    expect(ids(buildTour(ctx({ emptyTabs: undefined }), steps))).toEqual(FULL);
  });

  it('a view-only manager keeps a run worth starting in both states, without the Record payment step', () => {
    const viewer = { canEdit: () => false };
    const full = buildTour(ctx({ ...viewer, emptyTabs: [FINANCES_ATTENTION_SECTION] }), steps);
    const empty = buildTour(ctx({ ...viewer, emptyTabs: ['finances', FINANCES_ATTENTION_SECTION] }), steps);
    for (const run of [full, empty]) {
      expect(ids(run)).not.toContain('finances.record');
      expect(ids(run)).not.toContain('finances.empty.record');
      expect(isTourWorthRunning(run)).toBe(true);
    }
  });

  it('builds nothing for someone who cannot open /finances', () => {
    const built = buildTour(ctx({ canAccessRoute: (p) => p !== '/finances' }), steps);
    expect(built).toEqual([]);
    expect(isTourWorthRunning(built)).toBe(false);
  });
});

describe('finances tab tour — reading the page', () => {
  const mount = (html: string) => {
    document.body.innerHTML = html;
  };

  it('reads the Billed and Received teaching states as an empty tab', () => {
    for (const view of ['billed', 'received']) {
      mount(`<div data-finances-view="${view}"><div data-settings-state="empty"><h3>Nothing</h3></div></div>`);
      expect(readEmptyTabs(), view).toContain('finances');
      expect(tabTourVariant('finances'), view).toBe('empty');
      expect(document.querySelector(EMPTY_HEADLINE), view).not.toBeNull();
    }
  });

  it('does not read Upcoming or Fines being empty as a tab with no money', () => {
    for (const view of ['upcoming', 'fines']) {
      mount(`<div data-finances-view="${view}"><div data-settings-state="empty"><h3>Nothing</h3></div></div>`);
      expect(readEmptyTabs(), view).not.toContain('finances');
      expect(tabTourVariant('finances'), view).toBe('full');
    }
  });

  it('does not read a list filtered to nothing, loading, or failed as empty', () => {
    for (const state of ['no-match', 'loading', 'error']) {
      mount(`<div data-finances-view="billed"><div data-settings-state="${state}"></div></div>`);
      expect(readEmptyTabs(), state).not.toContain('finances');
    }
  });

  it('honours a lifetime-empty marker if the page draws one', () => {
    mount('<div data-tour="finances-empty"></div>');
    expect(readEmptyTabs()).toContain('finances');
  });

  it('reports Needs attention absent until the section is drawn', () => {
    mount('<div data-finances-view="billed"></div>');
    expect(readEmptyTabs()).toContain(FINANCES_ATTENTION_SECTION);
    mount('<div data-finances-view="billed"><section data-tour="finances-attention"></section></div>');
    expect(readEmptyTabs()).not.toContain(FINANCES_ATTENTION_SECTION);
    // A section key is never a tab id, so it cannot make any tab look empty.
    expect(TAB_TOUR_IDS as readonly string[]).not.toContain(FINANCES_ATTENTION_SECTION);
  });

  it('leaves the Payments signal exactly as it was', () => {
    mount('<div data-tour="payments-empty"></div>');
    expect(readEmptyTabs()).toContain('payments');
    expect(readEmptyTabs()).not.toContain('finances');
    expect(tabTourVariant('payments')).toBe('empty');
    // The Finances empty state says nothing about the Payments tab.
    mount(`<div data-finances-view="received"><div data-settings-state="empty"></div></div>`);
    expect(readEmptyTabs()).not.toContain('payments');
    expect(tabTourVariant('payments')).toBe('full');
  });
});

describe('payments tab tour — unchanged for every tenant still on /payments', () => {
  it('keeps its id, route, label and message', () => {
    expect(getTabTour('payments')).toBe(PAYMENTS_TAB_TOUR);
    expect(PAYMENTS_TAB_TOUR).toMatchObject({ id: 'payments', label: 'Payments', homeRoute: '/payments' });
    expect(PAYMENTS_TAB_TOUR.emptyMessage).toBe(
      'There is not enough on your Payments tab to walk through yet. Take a payment, or record one yourself, and I will show you around it.',
    );
  });

  it('keeps every step, its route, its guard and its first anchor', () => {
    const shape = PAYMENTS_TAB_TOUR.steps.map((s) => ({
      id: s.id,
      route: s.route,
      requires: s.requires ?? null,
      pause: !!s.pauseOnAnchorClick,
      first: s.anchors[0] ?? null,
    }));
    expect(shape).toEqual([
      { id: 'payments.welcome', route: '/payments', requires: null, pause: false, first: null },
      { id: 'payments.empty.what', route: '/payments', requires: { tabIsEmpty: 'payments' }, pause: false, first: '[data-tour="payments-empty"] h3' },
      { id: 'payments.empty.arrive', route: '/payments', requires: { tabIsEmpty: 'payments' }, pause: false, first: sel('payments-empty-points') },
      { id: 'payments.money-in', route: '/payments', requires: null, pause: false, first: sel('payments-stat-today') },
      { id: 'payments.period', route: '/payments', requires: null, pause: false, first: sel('payments-period') },
      { id: 'payments.search', route: '/payments', requires: null, pause: false, first: sel('payments-search') },
      { id: 'payments.method', route: '/payments', requires: { tabHasData: 'payments' }, pause: false, first: sel('payments-method') },
      { id: 'payments.status', route: '/payments', requires: { tabHasData: 'payments' }, pause: false, first: sel('payments-status') },
      { id: 'payments.dates', route: '/payments', requires: null, pause: false, first: sel('payments-dates') },
      { id: 'payments.row', route: '/payments', requires: { tabHasData: 'payments' }, pause: false, first: sel('payment-row') },
      { id: 'payments.actions', route: '/payments', requires: { tabHasData: 'payments' }, pause: false, first: sel('payments-row-actions') },
      { id: 'payments.export', route: '/payments', requires: null, pause: false, first: sel('payments-export') },
      {
        id: 'payments.record',
        route: '/payments',
        requires: { tab: 'payments', edit: true, tabHasData: 'payments' },
        pause: true,
        first: sel('payments-record'),
      },
      {
        id: 'payments.empty.record',
        route: '/payments',
        requires: { tabIsEmpty: 'payments', tab: 'payments', edit: true },
        pause: true,
        first: '[data-tour="payments-empty"] button',
      },
    ]);
  });

  it('shares no anchor with the Finances tour', () => {
    const named = (t: typeof PAYMENTS_TAB_TOUR) =>
      new Set(t.steps.flatMap((s) => [...s.anchors, ...(s.notes ?? []).flatMap((n) => n.anchors ?? [])]));
    const payments = named(PAYMENTS_TAB_TOUR);
    for (const anchor of named(FINANCES_TAB_TOUR)) expect(payments.has(anchor), anchor).toBe(false);
  });
});

describe('finances tab tour — the anchors are drawn where the tour looks for them', () => {
  const FINANCES_SOURCES = [
    'components/finances/finances-view.tsx',
    'components/finances/finances-view-switch.tsx',
    'components/finances/needs-attention.tsx',
    'components/finances/finance-side-panel.tsx',
    'components/finances/billed-table.tsx',
    'components/finances/received-table.tsx',
    'components/finances/upcoming-table.tsx',
    'components/finances/fines-view.tsx',
  ];
  const code = FINANCES_SOURCES.map((f) => codeOnly(readPortalSource(f))).join('\n');

  it.each(FINANCES_ANCHORS.filter((a) => a !== 'finances-filter'))('%s is stamped by a Finances component', (name) => {
    expect(code).toMatch(new RegExp(`data-tour=(?:\\{[^}]*)?"${name}"`));
  });

  it('finances-filter is handed to the top bar, which stamps it on the filter button', () => {
    expect(codeOnly(readPortalSource('components/finances/finances-view.tsx'))).toMatch(
      /tourAnchor:\s*"finances-filter"/,
    );
    expect(codeOnly(readPortalSource('components/shared/layout/top-bar-v2.tsx'))).toContain(
      'data-tour={slot.filters.tourAnchor}',
    );
  });

  it('the header carries the launch button for this tour', () => {
    expect(codeOnly(readPortalSource('components/finances/finances-view.tsx'))).toMatch(
      /<TabTourButton\s+tour="finances"/,
    );
  });

  it('the empty signal still has something to read: the view on the page root, and the empty state stamp', () => {
    expect(codeOnly(readPortalSource('components/finances/finances-view.tsx'))).toContain(
      'data-finances-view={view}',
    );
    expect(codeOnly(readPortalSource('components/settings-v2/section-states.tsx'))).toContain(
      'data-settings-state="empty"',
    );
  });
});
