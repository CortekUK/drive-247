import { describe, expect, it } from 'vitest';

import { isLeanTenant } from '@/lib/lean-areas';
import {
  FIRST_RENTAL_TOUR,
  FIRST_RENTAL_TOUR_VERSION,
  MIN_TOUR_STOPS,
  findAnchor,
  hasSeenTour,
  markTourSeen,
  resolveStops,
  shouldAutostartTour,
  tourSeenKey,
  type TourGateInput,
} from '@/lib/first-rental-tour';

/**
 * The first-rental tour: its gate, and its anchor filter.
 *
 * These are the only two things in the feature that can be wrong in a way
 * nothing else catches. Portal builds with `ignoreBuildErrors: true`, so a type
 * error here would ship; and both failure modes are SILENT — a broken gate
 * shows a canary screen to 56 live operators with no error, and a missing
 * anchor stalls the tour on a card pointing at nothing.
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

describe('first-rental tour — the three stops', () => {
  it('has exactly three stops, in order', () => {
    expect(FIRST_RENTAL_TOUR.map((s) => s.id)).toEqual([
      'vehicle',
      'customer',
      'rental',
    ]);
  });

  it('teaches no chrome — no stop points at search, the sidebar or the dock', () => {
    const text = FIRST_RENTAL_TOUR.map((s) => `${s.title} ${s.body}`)
      .join(' ')
      .toLowerCase();
    for (const chrome of ['sidebar', 'search', 'dock', 'navigation bar']) {
      expect(text).not.toContain(chrome);
    }
  });

  it('mentions agreements and insurance only as quiet notes on the last stop', () => {
    const [vehicle, customer, rental] = FIRST_RENTAL_TOUR;
    expect(vehicle.notes ?? []).toHaveLength(0);
    expect(customer.notes ?? []).toHaveLength(0);

    const notes = (rental.notes ?? []).map((n) => n.text.toLowerCase());
    expect(notes).toHaveLength(2);
    expect(notes.some((n) => n.includes('agreement'))).toBe(true);
    expect(notes.some((n) => n.includes('insurance'))).toBe(true);
    // One line each. A note that runs long is a lesson, and lessons belong to
    // the setup checklist and the empty states, not to a 60-second tour.
    for (const note of rental.notes ?? []) {
      expect(note.text.length).toBeLessThan(120);
    }
  });

  it('every stop offers more than one anchor candidate', () => {
    // The explicit `data-tour` attribute lives in a large file under concurrent
    // edit. Losing it must degrade the tour, not break it.
    for (const stop of FIRST_RENTAL_TOUR) {
      expect(stop.anchors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('first-rental tour — tenant gate (slug-keyed, never id-keyed)', () => {
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

describe('first-rental tour — every other gate blocks on its own', () => {
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
// which is precisely why `resolveStops` takes one.
const allVisible = () => true;

const FULL_SIDEBAR = `
  <div data-sidebar="sidebar">
    <li data-tour="nav-rentals"><a href="/rentals">Rentals</a></li>
    <li data-tour="nav-vehicles"><a href="/vehicles">Vehicles</a></li>
    <li data-tour="nav-customers"><a href="/customers">Customers</a></li>
    <li data-tour="nav-group-records"><button>Records</button></li>
  </div>
`;

describe('first-rental tour — anchor resolution', () => {
  it('resolves all three stops against a complete sidebar', () => {
    const resolved = resolveStops(FIRST_RENTAL_TOUR, domWith(FULL_SIDEBAR), allVisible);
    expect(resolved.map((r) => r.stop.id)).toEqual(['vehicle', 'customer', 'rental']);
  });

  it('DROPS a stop whose target is absent rather than stalling on it', () => {
    // A manager without the Customers tab: the nav row is simply not rendered.
    const html = FULL_SIDEBAR.replace(
      '<li data-tour="nav-customers"><a href="/customers">Customers</a></li>',
      '',
    );
    const resolved = resolveStops(FIRST_RENTAL_TOUR, domWith(html), allVisible);
    expect(resolved.map((r) => r.stop.id)).toEqual(['vehicle', 'rental']);
    expect(resolved.length).toBeGreaterThanOrEqual(MIN_TOUR_STOPS);
  });

  it('falls back to the href selector when the data-tour attribute is gone', () => {
    const html = `
      <div data-sidebar="sidebar">
        <li><a href="/rentals">Rentals</a></li>
        <li><a href="/vehicles">Vehicles</a></li>
        <li><a href="/customers">Customers</a></li>
      </div>
    `;
    const resolved = resolveStops(FIRST_RENTAL_TOUR, domWith(html), allVisible);
    expect(resolved.map((r) => r.stop.id)).toEqual(['vehicle', 'customer', 'rental']);
    // The closing notes point at the rental FLOW rather than at a nav row, so
    // they survive the loss of every `data-tour` attribute along with the stops.
    expect(resolved[2].notes).toHaveLength(2);
  });

  it('carries both closing notes, which depend on no nav row of their own', () => {
    const resolved = resolveStops(FIRST_RENTAL_TOUR, domWith(FULL_SIDEBAR), allVisible);
    expect(resolved[2].notes).toHaveLength(2);
  });

  it('drops a note whose own anchor is missing, rather than pointing nowhere', () => {
    // The mechanism, exercised directly: telling a manager a feature "lives
    // under X" when X is hidden from them is worse than saying nothing.
    const stops = [
      {
        id: 'probe',
        title: 'Probe',
        body: 'Probe',
        side: 'right' as const,
        anchors: ['[data-tour="nav-vehicles"]'],
        notes: [
          { text: 'present', anchors: ['[data-tour="nav-group-records"]'] },
          { text: 'absent', anchors: ['[data-tour="nav-group-nowhere"]'] },
          { text: 'unanchored' },
        ],
      },
    ];
    const resolved = resolveStops(stops, domWith(FULL_SIDEBAR), allVisible);
    expect(resolved[0].notes).toEqual(['present', 'unanchored']);
  });

  it('yields fewer than the minimum when the sidebar is closed — the tour must not start', () => {
    const resolved = resolveStops(FIRST_RENTAL_TOUR, domWith('<div></div>'), allVisible);
    expect(resolved).toHaveLength(0);
    expect(resolved.length < MIN_TOUR_STOPS).toBe(true);
  });

  it('skips an invisible match in favour of a visible one', () => {
    // The v2 sidebar renders a desktop rail AND a mobile Sheet from the same
    // primitives; both carry data-sidebar="sidebar". Only one is on screen.
    const root = domWith(`
      <div data-sidebar="sidebar" id="hidden">
        <li data-tour="nav-vehicles" id="ghost"><a href="/vehicles">Vehicles</a></li>
      </div>
      <div data-sidebar="sidebar" id="shown">
        <li data-tour="nav-vehicles" id="real"><a href="/vehicles">Vehicles</a></li>
      </div>
    `);
    const found = findAnchor(
      FIRST_RENTAL_TOUR[0].anchors,
      root,
      (el) => (el as HTMLElement).id !== 'ghost',
    );
    expect((found as HTMLElement)?.id).toBe('real');
  });

  it('survives a malformed selector instead of taking the tour down', () => {
    const root = domWith(FULL_SIDEBAR);
    expect(findAnchor(['((((', '[data-tour="nav-vehicles"]'], root, allVisible)).not.toBeNull();
  });
});

describe('first-rental tour — "seen" storage', () => {
  it('keys per user, so a shared machine still gives the next person their run', () => {
    expect(tourSeenKey('user-a')).not.toBe(tourSeenKey('user-b'));
    expect(tourSeenKey('user-a')).toContain(`v${FIRST_RENTAL_TOUR_VERSION}`);
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
