import { describe, expect, it } from 'vitest';

import { isLeanTenant } from '@/lib/lean-areas';
import {
  BLOCKED_RENTAL_STEP,
  FIRST_RENTAL_TOUR,
  FIRST_RENTAL_TOUR_VERSION,
  MAX_RESUME_PROMPTS,
  MIN_TOUR_STOPS,
  buildTour,
  clearTourProgress,
  countAnchoredSteps,
  decideResume,
  findAnchor,
  hasSeenTour,
  isTourWorthRunning,
  markTourSeen,
  readTourProgress,
  resolveStep,
  resolveStops,
  routePathname,
  routeSearch,
  shouldAutostartTour,
  stepIsOnRoute,
  tourProgressKey,
  tourSeenKey,
  writeTourProgress,
  type TourBuildContext,
  type TourGateInput,
  type TourProgress,
} from '@/lib/first-rental-tour';

/**
 * The first-rental walkthrough: its gate, its step filter, its anchor
 * resolver, and its progress store.
 *
 * These are the things in the feature that can be wrong in a way nothing else
 * catches. Portal builds with `ignoreBuildErrors: true`, so a type error here
 * would ship; and every failure mode is SILENT — a broken gate shows a canary
 * screen to 56 live operators with no error, a missing anchor stalls the tour
 * on a card pointing at nothing, and a bad progress record resumes the wrong
 * step on the wrong page.
 */

/** Everything green. Individual tests flip exactly one field. */
const OPEN: TourGateInput = {
  isCanary: true,
  hasV2Chrome: true,
  onDashboard: true,
  authReady: true,
  blockingGateOpen: false,
  wizardPending: false,
  alreadySeen: false,
};

/** A head admin on a desktop with Stripe connected: nothing gated. */
const FULL_CTX: TourBuildContext = {
  canAccessRoute: () => true,
  canEdit: () => true,
  canViewSettings: () => true,
  isMobile: false,
  rentalCreationBlocked: false,
  bookingUrl: 'https://northwind.drive-247.com',
};

const ids = (steps: readonly { id: string }[]) => steps.map((s) => s.id);

/**
 * The gate as the HOOK composes it — slug in, decision out.
 *
 * Deliberately routed through `isLeanTenant` rather than passing `isCanary`
 * by hand. The bug this guards against is not "does the boolean work"; it is
 * "does the SLUG reach the boolean correctly", which a test that hand-feeds
 * `isCanary: false` would pass while proving nothing.
 */
const autostartsFor = (slug: string | null | undefined): boolean =>
  shouldAutostartTour({ ...OPEN, isCanary: isLeanTenant(slug) });

describe('first-rental walkthrough — the steps', () => {
  it('walks eight shallow steps, in order, from welcome to done', () => {
    // Was eleven, and deliberately is not any more: the lead ruled the deep
    // walkthrough out for a first login ("woh abhi woh tour nahi hai"), naming
    // the walk through payments. Depth moved to `lib/tab-tours/*`. Adding a
    // step back here should mean asking whether it belongs in a tab tour.
    expect(ids(FIRST_RENTAL_TOUR)).toEqual([
      'welcome',
      'sidebar',
      'vehicles',
      'customers',
      'rental',
      'tours',
      'booking-site',
      'done',
    ]);
  });

  it('never walks INTO the New Rental form — that is the whole ruling', () => {
    for (const step of FIRST_RENTAL_TOUR) {
      expect(step.route, step.id).not.toBe('/rentals/new');
    }
    expect(BLOCKED_RENTAL_STEP.route).not.toBe('/rentals/new');
  });

  it('hands off to the per-tab tours instead of going deep itself', () => {
    const tours = FIRST_RENTAL_TOUR.find((s) => s.id === 'tours')!;
    // The step that makes an eight-step orientation an honest one: the depth
    // it no longer carries is reachable, and this says where.
    expect(tours.anchors[0]).toBe('[data-tour="take-tab-tour"]');
    // The button only renders on the tab pages, so this one must land on a tab
    // page rather than the dashboard or settings.
    expect(tours.route).toBe('/rentals');
    // And it must not be the last word — a step that pauses the tour when
    // clicked has to have somewhere to hand back to.
    expect(ids(FIRST_RENTAL_TOUR).indexOf('tours')).toBeLessThan(FIRST_RENTAL_TOUR.length - 1);
  });

  it('crosses five pages, FORWARD ONLY, and the finale stays wherever you are', () => {
    const routes = FIRST_RENTAL_TOUR.filter((s) => s.route !== null).map((s) =>
      routePathname(s.route!),
    );
    expect([...new Set(routes)]).toEqual(['/', '/vehicles', '/customers', '/rentals', '/settings']);
    expect(FIRST_RENTAL_TOUR.at(-1)!.route).toBeNull();

    // Order matters as much as the set does. A tour that goes to Settings and
    // then back to a tab reads as lost, and every extra push is another chance
    // for an anchor to arrive late. Each route must be contiguous: once the
    // list leaves a page it never returns to it.
    const firstSeen = [...new Set(routes)];
    expect(routes).toEqual(
      firstSeen.flatMap((r) => routes.filter((x) => x === r)),
    );
  });

  it('still gets them to a first rental — the spine survives', () => {
    // The walkthrough shows the house on the way; it never stopped being about
    // the first rental. Vehicle → customer → rental must stay in that order.
    const order = ids(FIRST_RENTAL_TOUR);
    expect(order.indexOf('vehicles')).toBeLessThan(order.indexOf('customers'));
    expect(order.indexOf('customers')).toBeLessThan(order.indexOf('rental'));
  });

  it('names the sidebar ONCE, not once per item', () => {
    const navSteps = FIRST_RENTAL_TOUR.filter((s) => s.anchors.some((a) => a.includes('data-sidebar')));
    expect(navSteps.map((s) => s.id)).toEqual(['sidebar']);
  });

  it('keeps every card short — one sentence, two at most', () => {
    for (const step of FIRST_RENTAL_TOUR) {
      expect(step.body.length, step.id).toBeLessThan(170);
      expect(step.title.length, step.id).toBeLessThan(40);
      for (const note of step.notes ?? []) expect(note.text.length).toBeLessThan(120);
    }
  });

  it('carries no video — videos live in the checklist and the empty states', () => {
    const text = FIRST_RENTAL_TOUR.map((s) => `${s.title} ${s.body}`).join(' ').toLowerCase();
    expect(text).not.toMatch(/\bwatch\b|\bplay\b|\bvideo\b(?! when you want)/);
  });

  it('the intro and the finale point at nothing; everything between points at something', () => {
    const [first, ...rest] = FIRST_RENTAL_TOUR;
    const last = rest.pop()!;
    expect(first.anchors).toHaveLength(0);
    expect(last.anchors).toHaveLength(0);
    for (const step of rest) expect(step.anchors.length, step.id).toBeGreaterThan(0);
  });

  it('every sidebar-anchored selector has an href-based fallback beside it', () => {
    // The explicit `data-tour` attribute lives in a large file under concurrent
    // edit. Losing it must degrade the tour, not break it.
    expect(BLOCKED_RENTAL_STEP.anchors).toContain('[data-sidebar="sidebar"] a[href="/rentals"]');
    const sidebar = FIRST_RENTAL_TOUR.find((s) => s.id === 'sidebar')!;
    expect(sidebar.anchors.length).toBeGreaterThanOrEqual(2);
  });

  it('every step that can be clicked THROUGH steps aside', () => {
    // Was ['vehicles', 'customers'] — the two Add buttons the old walkthrough
    // told you to press. The orientation presses nothing, so the rule is now
    // about anchors that take the screen away: New Rental navigates to a form,
    // and the tab-tour button launches a second tour that would otherwise draw
    // its cards on top of this one.
    const pausing = FIRST_RENTAL_TOUR.filter((s) => s.pauseOnAnchorClick).map((s) => s.id);
    expect(pausing).toEqual(['rental', 'tours']);
    expect(BLOCKED_RENTAL_STEP.pauseOnAnchorClick).toBe(true);

    // `rental` and `tours` share a page, and the renderer ADVANCES on a click
    // when the next step is same-page. Without the pause, clicking New Rental
    // would move the card to `tours` while the browser left for the form.
    const order = ids(FIRST_RENTAL_TOUR);
    expect(order[order.indexOf('rental') + 1]).toBe('tours');
  });

  it('the booking-site step shows the tenant’s real URL, host only', () => {
    const step = FIRST_RENTAL_TOUR.find((s) => s.id === 'booking-site')!;
    expect(step.detail!(FULL_CTX)).toBe('northwind.drive-247.com');
    expect(step.detail!({ ...FULL_CTX, bookingUrl: null })).toBeNull();
  });
});

describe('first-rental walkthrough — routes', () => {
  it('splits a route into pathname and search', () => {
    expect(routePathname('/settings?tab=branding')).toBe('/settings');
    expect(routeSearch('/settings?tab=branding')).toBe('?tab=branding');
    expect(routePathname('/vehicles')).toBe('/vehicles');
    expect(routeSearch('/vehicles')).toBe('');
  });

  it('a step is on its route by pathname alone; a null route is on every route', () => {
    expect(stepIsOnRoute({ route: '/settings?tab=branding' }, '/settings')).toBe(true);
    expect(stepIsOnRoute({ route: '/settings?tab=branding' }, '/settings/users')).toBe(false);
    expect(stepIsOnRoute({ route: null }, '/anything')).toBe(true);
    expect(stepIsOnRoute({ route: '/' }, undefined)).toBe(false);
  });
});

describe('first-rental walkthrough — building THIS user’s tour (gated steps are dropped up front)', () => {
  it('a head admin with Stripe connected gets every step', () => {
    expect(ids(buildTour(FULL_CTX))).toEqual(ids(FIRST_RENTAL_TOUR));
  });

  it('drops a step whose page is hidden for this manager', () => {
    // A manager without the Customers tab: the layout would bounce them to /.
    const ctx = { ...FULL_CTX, canAccessRoute: (p: string) => p !== '/customers' };
    expect(ids(buildTour(ctx))).not.toContain('customers');
    expect(ids(buildTour(ctx))).toContain('vehicles');
  });

  it('a viewer who can press nothing still gets the WHOLE orientation', () => {
    // The reverse of what this asserted while the tour was a walkthrough: it
    // used to point at Add Vehicle and Add Customer, so `canEdit: false` cost a
    // viewer three steps and could drop them under MIN_TOUR_STOPS. Knowing
    // where the fleet is kept is a read, so no step here asks for an edit
    // grant, and everyone who can open a page is shown it.
    const ctx = { ...FULL_CTX, canEdit: () => false };
    expect(ids(buildTour(ctx))).toEqual(ids(FIRST_RENTAL_TOUR));
    for (const step of FIRST_RENTAL_TOUR) expect(step.requires?.edit, step.id).toBeFalsy();
  });

  it('drops the settings step when the branding sub-tab is not granted', () => {
    const ctx = { ...FULL_CTX, canViewSettings: (v: string) => v !== 'branding' };
    expect(ids(buildTour(ctx))).not.toContain('booking-site');
  });

  it('drops the sidebar step on a phone — the sidebar is an off-canvas Sheet there', () => {
    const ctx = { ...FULL_CTX, isMobile: true };
    expect(ids(buildTour(ctx))).not.toContain('sidebar');
    expect(ids(buildTour(ctx))).toContain('welcome');
  });

  it('reroutes the rental steps when the New Rental flow is gated on Stripe', () => {
    // A brand-new lean operator without Connect gets a "connect Stripe first"
    // dialog when they press New Rental. The step stays on the same page and
    // the same button; what changes is the sentence, which must not promise a
    // rental the button will refuse. It carries insurance and the agreement as
    // one-liners because that operator cannot go and see them for themselves.
    const built = buildTour({ ...FULL_CTX, rentalCreationBlocked: true });
    // Nothing is DROPPED any more — the orientation never entered the form, so
    // there is no in-flow step to lose. Same eight steps, one swapped body.
    expect(ids(built)).toEqual(ids(FIRST_RENTAL_TOUR));
    const rental = built.find((s) => s.id === 'rental')!;
    expect(rental).toBe(BLOCKED_RENTAL_STEP);
    expect(rental.route).toBe('/rentals');
    const notes = (rental.notes ?? []).map((n) => n.text.toLowerCase());
    expect(notes.some((n) => n.includes('insurance'))).toBe(true);
    expect(notes.some((n) => n.includes('agreement'))).toBe(true);
  });

  it('does not run at all for a user left with fewer than two anchored steps', () => {
    const ctx: TourBuildContext = {
      ...FULL_CTX,
      canAccessRoute: (p) => p === '/',
      isMobile: true,
    };
    const built = buildTour(ctx);
    // Welcome and done, and nothing that points at anything. Not a tour.
    expect(countAnchoredSteps(built)).toBeLessThan(MIN_TOUR_STOPS);
    expect(isTourWorthRunning(built)).toBe(false);
    expect(isTourWorthRunning(buildTour(FULL_CTX))).toBe(true);
  });
});

describe('first-rental walkthrough — tenant gate (slug-keyed, never id-keyed)', () => {
  // The positive case FIRST, and asserted loudly. Every "absent" expectation
  // below is only meaningful because this one passes: an equality test that
  // returns false for everything would otherwise look like a perfect gate.
  it('northwind autostarts', () => {
    expect(autostartsFor('northwind')).toBe(true);
  });

  it.each(['goniko', 'revtek', 'jangram', 'globalmotiontransport', 'eastpeakrentalsllc', 'test'])(
    'live non-canary tenant %s never autostarts',
    (slug) => {
      expect(autostartsFor(slug)).toBe(false);
    },
  );

  it.each([
    'nosuchtenant',
    'northwind-staging',
    'northwinds',
    'NORTHWIND',
    'north wind',
    '',
  ])('bogus slug %j fails safe', (slug) => {
    expect(autostartsFor(slug)).toBe(false);
  });

  it('an unresolved slug fails safe — no flash before TenantContext lands', () => {
    expect(autostartsFor(null)).toBe(false);
    expect(autostartsFor(undefined)).toBe(false);
  });

  it('a tenant UUID is never mistaken for a slug', () => {
    // northwind is 6e5c544f-… in production and 8e6bc88f-… on staging. Neither
    // may ever open the gate; only the slug can.
    expect(autostartsFor('6e5c544f-0000-0000-0000-000000000000')).toBe(false);
    expect(autostartsFor('8e6bc88f-0000-0000-0000-000000000000')).toBe(false);
  });
});

describe('first-rental walkthrough — every other gate blocks on its own', () => {
  it('v1 chrome blocks it (there are no anchors to point at)', () => {
    expect(shouldAutostartTour({ ...OPEN, hasV2Chrome: false })).toBe(false);
  });

  it('off the dashboard it does not autostart', () => {
    expect(shouldAutostartTour({ ...OPEN, onDashboard: false })).toBe(false);
  });

  it('an open subscription gate blocks it', () => {
    expect(shouldAutostartTour({ ...OPEN, blockingGateOpen: true })).toBe(false);
  });

  it('the first-run wizard blocks it — including while it is still deciding', () => {
    expect(shouldAutostartTour({ ...OPEN, wizardPending: true })).toBe(false);
  });

  it('unsettled auth blocks it', () => {
    expect(shouldAutostartTour({ ...OPEN, authReady: false })).toBe(false);
  });

  it('having seen it blocks it — skipping never re-prompts', () => {
    expect(shouldAutostartTour({ ...OPEN, alreadySeen: true })).toBe(false);
  });
});

/** Build a DOM the anchor resolver can be pointed at. */
function domWith(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

// jsdom gives every element a zero-size bounding box, so the real `isVisible`
// would reject the whole document. Tests inject their own predicate instead —
// which is precisely why the resolvers take one.
const allVisible = () => true;

const FULL_SIDEBAR = `
  <div data-sidebar="sidebar">
    <div data-sidebar="content">
      <li data-tour="nav-rentals"><a href="/rentals">Rentals</a></li>
      <li data-tour="nav-vehicles"><a href="/vehicles">Vehicles</a></li>
      <li data-tour="nav-customers"><a href="/customers">Customers</a></li>
      <li data-tour="nav-group-finance"><button>Finance</button></li>
    </div>
  </div>
`;

const step = (id: string) => FIRST_RENTAL_TOUR.find((s) => s.id === id)!;

describe('first-rental walkthrough — anchor resolution', () => {
  it('an anchorless step resolves at once, with no element', () => {
    const r = resolveStep(step('welcome'), domWith('<div></div>'), allVisible);
    expect(r).not.toBeNull();
    expect(r!.element).toBeNull();
  });

  it('a step whose anchor is absent resolves to NULL — it must not render', () => {
    // This is the failure mode that killed the previous attempt: a card
    // anchored to nowhere. The hook waits, then skips; it never shows.
    expect(resolveStep(step('vehicles'), domWith(FULL_SIDEBAR), allVisible)).toBeNull();
  });

  it('resolves the sidebar step to the nav CONTENT, falling back to the rail', () => {
    const r = resolveStep(step('sidebar'), domWith(FULL_SIDEBAR), allVisible)!;
    expect(r.element.getAttribute('data-sidebar')).toBe('content');
    const bare = resolveStep(step('sidebar'), domWith('<div data-sidebar="sidebar"></div>'), allVisible)!;
    expect(bare.element.getAttribute('data-sidebar')).toBe('sidebar');
  });

  it('EVERY step falls back to markup its page cannot render without', () => {
    // The `data-tour` attributes live in large files under concurrent edit, and
    // an attribute that goes missing does not fail loudly — the step just waits
    // out its anchor budget and skips. So no anchored step may depend on a
    // single selector, and the last one must be structural rather than a
    // `data-tour` somebody could delete while tidying.
    for (const s of FIRST_RENTAL_TOUR) {
      if (s.anchors.length === 0) continue;
      expect(s.anchors.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.anchors.at(-1), s.id).not.toMatch(/^\[data-tour=/);
    }
  });

  it('falls back to the page title when a tab page has not drawn its tiles yet', () => {
    // The Vehicles step points at ONE stat tile; a page still fetching has only
    // its header. Spotlighting the title is a worse card than the tile, and a
    // far better one than no card at all.
    const r = resolveStep(
      step('vehicles'),
      domWith('<div data-slot="sidebar-inset"><h1>Fleet Management</h1></div>'),
      allVisible,
    )!;
    expect(r.element.tagName).toBe('H1');
    const withTile = resolveStep(
      step('vehicles'),
      domWith('<div data-slot="sidebar-inset"><h1>Fleet</h1><div data-tour="fleet-stat-total-vehicles"></div></div>'),
      allVisible,
    )!;
    expect(withTile.element.getAttribute('data-tour')).toBe('fleet-stat-total-vehicles');
  });

  it('the handoff step prefers the real tab-tour button over the header', () => {
    const shell = domWith(`
      <div data-slot="sidebar-inset">
        <div data-tour="rentals-header"><h1>Rentals</h1></div>
        <button data-tour="take-tab-tour">Take the tour</button>
      </div>
    `);
    expect(resolveStep(step('tours'), shell, allVisible)!.element.getAttribute('data-tour')).toBe(
      'take-tab-tour',
    );
    // Replay reaches pages where the canary-gated button is absent; the step
    // must still draw a card rather than stall.
    const noButton = domWith('<div data-slot="sidebar-inset"><div data-tour="rentals-header"><h1>Rentals</h1></div></div>');
    expect(resolveStep(step('tours'), noButton, allVisible)!.element.getAttribute('data-tour')).toBe(
      'rentals-header',
    );
  });

  it('carries the settings note only when the settings rail is on screen', () => {
    const panel = '<div data-tour="settings-tab-branding">Branding</div>';
    const withRail = resolveStep(step('booking-site'), domWith(panel + FULL_SIDEBAR), allVisible)!;
    expect(withRail.notes).toHaveLength(1);
    const without = resolveStep(step('booking-site'), domWith(panel), allVisible)!;
    // Pointing at "this list" when no list is drawn is worse than saying
    // nothing — the same rule the Finance note used to carry.
    expect(without.notes).toHaveLength(0);
  });

  it('resolveStops drops the absent ones and keeps the rest, in order', () => {
    const resolved = resolveStops(FIRST_RENTAL_TOUR, domWith(FULL_SIDEBAR), allVisible);
    expect(ids(resolved.map((r) => r.step))).toEqual(['welcome', 'sidebar', 'done']);
  });

  it('skips an invisible match in favour of a visible one', () => {
    // The v2 sidebar renders a desktop rail AND a mobile Sheet from the same
    // primitives; both carry data-sidebar="sidebar". Only one is on screen.
    const root = domWith(`
      <div data-sidebar="sidebar" id="ghost"></div>
      <div data-sidebar="sidebar" id="real"></div>
    `);
    const found = findAnchor(['[data-sidebar="sidebar"]'], root, (el) => (el as HTMLElement).id !== 'ghost');
    expect((found as HTMLElement)?.id).toBe('real');
  });

  it('survives a malformed selector instead of taking the tour down', () => {
    const root = domWith(FULL_SIDEBAR);
    expect(findAnchor(['((((', '[data-tour="nav-vehicles"]'], root, allVisible)).not.toBeNull();
  });
});

describe('first-rental walkthrough — "seen" storage', () => {
  it('keys per user, so a shared machine still gives the next person their run', () => {
    expect(tourSeenKey('user-a')).not.toBe(tourSeenKey('user-b'));
    expect(tourSeenKey('user-a')).toContain(`v${FIRST_RENTAL_TOUR_VERSION}`);
  });

  it('is version 3 — the orientation is a different tour from the walkthrough', () => {
    // v3 re-arms the tour for everyone who saw v2, and makes `isProgress`
    // discard a v2 progress record rather than resuming somebody onto a step
    // this list no longer has.
    expect(FIRST_RENTAL_TOUR_VERSION).toBe(3);
    expect(tourSeenKey('u')).toBe('d247.tour.first-rental.v3.u');
  });

  it('stays inside the d247.tour. namespace the developer reset clears', () => {
    // `lib/dev-actions.ts` forgets the tour by prefix. Both records must live
    // under it, or a "first-time" reset leaves one of them behind.
    expect(tourSeenKey('u').startsWith('d247.tour.')).toBe(true);
    expect(tourProgressKey('u').startsWith('d247.tour.')).toBe(true);
    expect(tourProgressKey('u')).not.toBe(tourSeenKey('u'));
  });

  it('falls back to a stable key rather than refusing to store', () => {
    // Storing nothing would re-fire the tour on every dashboard mount.
    expect(tourSeenKey(null)).toBe(tourSeenKey(undefined));
    expect(tourSeenKey(null)).toContain('anon');
  });

  it('round-trips through a working store', () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(hasSeenTour('u1', fake)).toBe(false);
    markTourSeen('u1', fake);
    expect(hasSeenTour('u1', fake)).toBe(true);
    // Marking one user seen must not silence another.
    expect(hasSeenTour('u2', fake)).toBe(false);
  });

  it('assumes SEEN when storage throws — Safari private mode, blocked site data', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    // Fails closed: one operator replaying from the menu beats a tour that
    // returns on every single page load.
    expect(hasSeenTour('u1', throwing)).toBe(true);
    expect(hasSeenTour('u1', null)).toBe(true);
  });

  it('never throws out of markTourSeen', () => {
    const throwing = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => markTourSeen('u1', throwing)).not.toThrow();
    expect(() => markTourSeen('u1', null)).not.toThrow();
  });
});

function fakeStore() {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

describe('first-rental walkthrough — progress (survives navigation and a reload)', () => {
  it('round-trips a step and its status', () => {
    const { api } = fakeStore();
    expect(readTourProgress('u', api)).toBeNull();
    writeTourProgress('u', { stepId: 'vehicles', status: 'active' }, api);
    const p = readTourProgress('u', api)!;
    expect(p.stepId).toBe('vehicles');
    expect(p.status).toBe('active');
    expect(p.version).toBe(FIRST_RENTAL_TOUR_VERSION);
    expect(p.prompts).toBe(0);
    clearTourProgress('u', api);
    expect(readTourProgress('u', api)).toBeNull();
  });

  it('is per user, like the seen flag', () => {
    const { api } = fakeStore();
    writeTourProgress('a', { stepId: 'money', status: 'paused' }, api);
    expect(readTourProgress('b', api)).toBeNull();
  });

  it('refuses a record from another version or a mangled one', () => {
    const { api, store } = fakeStore();
    store.set(tourProgressKey('u'), JSON.stringify({ version: 1, stepId: 'vehicle', status: 'active', updatedAt: 'x', prompts: 0 }));
    expect(readTourProgress('u', api)).toBeNull();
    store.set(tourProgressKey('u'), '{not json');
    expect(readTourProgress('u', api)).toBeNull();
    store.set(tourProgressKey('u'), JSON.stringify({ version: 2, stepId: '', status: 'active', updatedAt: 'x', prompts: 0 }));
    expect(readTourProgress('u', api)).toBeNull();
    store.set(tourProgressKey('u'), JSON.stringify({ version: 2, stepId: 'money', status: 'dancing', updatedAt: 'x', prompts: 0 }));
    expect(readTourProgress('u', api)).toBeNull();
  });

  it('never throws — a blocked store just means no resume offer', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readTourProgress('u', throwing)).toBeNull();
    expect(() => writeTourProgress('u', { stepId: 'money', status: 'active' }, throwing)).not.toThrow();
    expect(() => clearTourProgress('u', throwing)).not.toThrow();
    expect(readTourProgress('u', null)).toBeNull();
  });
});

const progress = (stepId: string, status: TourProgress['status'], prompts = 0): TourProgress => ({
  version: FIRST_RENTAL_TOUR_VERSION,
  stepId,
  status,
  updatedAt: '2026-09-05T00:00:00Z',
  prompts,
});

describe('first-rental walkthrough — resume (wandering off, closing the tab, reloading)', () => {
  const steps = buildTour(FULL_CTX);

  it('nothing saved → nothing to do', () => {
    expect(decideResume(null, '/', steps)).toEqual({ kind: 'none' });
  });

  it('a reload on the step’s own page resumes silently, right there', () => {
    // The tour navigated to /vehicles (or they hit refresh on it). No prompt —
    // they never left.
    expect(decideResume(progress('vehicles', 'active'), '/vehicles', steps)).toEqual({
      kind: 'resume',
      index: steps.findIndex((s) => s.id === 'vehicles'),
    });
  });

  it('an interrupted run is OFFERED on the dashboard — never silently restarted from step 1', () => {
    const d = decideResume(progress('vehicles', 'active'), '/', steps);
    expect(d.kind).toBe('prompt');
    expect(d.kind === 'prompt' && steps[d.index].id).toBe('vehicles');
  });

  it('a pause (they clicked Add Vehicle) is offered on the dashboard even from that page', () => {
    // Paused on /vehicles, still on /vehicles: the dialog is open, leave them
    // alone. Back on the dashboard: offer.
    expect(decideResume(progress('vehicles', 'paused'), '/vehicles', steps)).toEqual({ kind: 'none' });
    expect(decideResume(progress('vehicles', 'paused'), '/', steps).kind).toBe('prompt');
  });

  it('never nags on any other page', () => {
    expect(decideResume(progress('vehicles', 'active'), '/invoices', steps)).toEqual({ kind: 'none' });
    // A real id, deliberately: `money` used to sit here and is no longer a
    // step, so this would have passed down the unknown-id path and proved
    // nothing about the rule it is named for.
    expect(decideResume(progress('rental', 'paused'), '/invoices', steps)).toEqual({ kind: 'none' });
  });

  it('a saved step this user no longer has lands on the next one they do', () => {
    // Grant revoked between visits: /customers is gone. Resume at the step
    // AFTER it — never before it, which would replay what they already saw.
    const narrowed = buildTour({ ...FULL_CTX, canAccessRoute: (p) => p !== '/customers' });
    const d = decideResume(progress('customers', 'active'), '/', narrowed);
    expect(d.kind).toBe('prompt');
    expect(d.kind === 'prompt' && narrowed[d.index].id).toBe('rental');
  });

  it('an unknown step id is treated as nothing saved', () => {
    expect(decideResume(progress('nonsense', 'active'), '/', steps)).toEqual({ kind: 'none' });
  });

  it('caps the offer — the hook drops the record after MAX_RESUME_PROMPTS', () => {
    expect(MAX_RESUME_PROMPTS).toBe(3);
  });
});
