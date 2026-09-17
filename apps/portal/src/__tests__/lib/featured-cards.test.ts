/**
 * The featured deck's rules (lib/featured-cards.ts).
 *
 * Every expected value below was worked out by hand from the fixture next to
 * it, not produced by running the code. "Now" is Tue 15 Sep 2026, 12:00 UTC.
 *
 * The registry, per tab, in its declared order and priority:
 *   turo-sync          rentals, vehicles   40   new until 2026-11-01
 *   calendar-view      rentals             30
 *   availability       vehicles            30   new until 2026-11-01
 *   invite-customers   customers           30
 *   import-customers   customers           20
 *   blocked-customers  customers           15
 *   ask-trax           all three           10
 */
import { describe, expect, it } from 'vitest';
import { HERO_CARD, pickHeroCard, type DeckCard } from '@/lib/featured-cards';
import {
  FEATURE_CARDS,
  SUBTITLE_MAX,
  TITLE_MAX,
  buildDeck,
  featureRoute,
  isFeatureEligible,
  isFeatureNew,
  isRecommendationEligible,
  isSameRoute,
  isUnderRoutePrefix,
  readLastShown,
  resolveSameOriginPath,
  rotationKey,
  safeImageSrc,
  startIndex,
  writeLastShown,
  type FeatureCardDef,
  type FeatureCardId,
  type FeaturedContext,
  type FeaturedRecommendation,
  type FeaturedTab,
  type KeyValueStorage,
} from '@/lib/featured-cards';

const NOW = new Date('2026-09-15T12:00:00.000Z');

/** Everything open: every gate passes, every handler supplied. */
function ctx(overrides: Partial<FeaturedContext> = {}): FeaturedContext {
  return {
    v2: { turo: true, availability: true },
    isLean: true,
    hiddenAreas: [],
    canView: () => true,
    canEdit: () => true,
    canAccessRoute: () => true,
    turoBridgeEnabled: true,
    hasTrax: true,
    handlers: ['openCalendar', 'openTrax', 'openInvite', 'openImport'],
    adopted: {},
    ...overrides,
  };
}

const eligibleOn = (tab: FeaturedTab, c: FeaturedContext) =>
  FEATURE_CARDS.filter((d) => isFeatureEligible(d, tab, c)).map((d) => d.id);

const card = (id: FeatureCardId) => FEATURE_CARDS.find((d) => d.id === id)!;

describe('resolveSameOriginPath: what a click will really open', () => {
  it('accepts same-origin paths, normalised', () => {
    expect(resolveSameOriginPath('/rentals')).toEqual({ pathname: '/rentals', search: '' });
    expect(resolveSameOriginPath('  /rentals/new?x=1#top ')).toEqual({ pathname: '/rentals/new', search: '?x=1' });
    expect(resolveSameOriginPath('/rentals/')).toEqual({ pathname: '/rentals', search: '' });
    expect(resolveSameOriginPath('/')).toEqual({ pathname: '/', search: '' });
  });

  it('resolves dot segments the way the browser will', () => {
    expect(resolveSameOriginPath('/rentals/../payments')?.pathname).toBe('/payments');
    expect(resolveSameOriginPath('/rentals/%2e%2e/payments')?.pathname).toBe('/payments');
  });

  it('refuses anything that leaves the origin or executes', () => {
    expect(resolveSameOriginPath('//evil.com/rentals')).toBeNull();
    // A leading /\ is read as // by browsers; safeHref alone lets it through.
    expect(resolveSameOriginPath('/\\evil.com/rentals')).toBeNull();
    // Tabs are stripped before parsing, which turns this into //evil.com.
    expect(resolveSameOriginPath('/\t/evil.com/rentals')).toBeNull();
    expect(resolveSameOriginPath('javascript:alert(1)')).toBeNull();
    expect(resolveSameOriginPath('  JavaScript:alert(1)')).toBeNull();
    expect(resolveSameOriginPath('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('refuses absolute URLs, even to our own host, and relative paths', () => {
    expect(resolveSameOriginPath('https://evil.com/rentals')).toBeNull();
    expect(resolveSameOriginPath('https://northwind.portal.drive-247.com/rentals')).toBeNull();
    expect(resolveSameOriginPath('rentals')).toBeNull();
  });

  it('refuses what PostgREST can hand back that is not a string', () => {
    expect(resolveSameOriginPath(null)).toBeNull();
    expect(resolveSameOriginPath(undefined)).toBeNull();
    expect(resolveSameOriginPath(42)).toBeNull();
  });
});

describe('isUnderRoutePrefix', () => {
  it('matches the prefix itself and paths beneath it, never a longer name', () => {
    expect(isUnderRoutePrefix('/rentals', ['/rentals'])).toBe(true);
    expect(isUnderRoutePrefix('/rentals/new', ['/rentals'])).toBe(true);
    expect(isUnderRoutePrefix('/rentalsX', ['/rentals'])).toBe(false);
    expect(isUnderRoutePrefix('/vehicles/1', ['/rentals'])).toBe(false);
    expect(isUnderRoutePrefix('/blocked-dates', ['/vehicles', '/blocked-dates'])).toBe(true);
    expect(isUnderRoutePrefix('/rentals', ['/rentals/'])).toBe(true);
  });

  it('ignores a bare "/" prefix and prefixes that are not paths', () => {
    expect(isUnderRoutePrefix('/payments', ['/'])).toBe(false);
    expect(isUnderRoutePrefix('/rentals', ['rentals'])).toBe(false);
  });
});

describe('isSameRoute', () => {
  const p = (s: string) => resolveSameOriginPath(s)!;

  it('treats extra query parameters on the target as the same feature', () => {
    expect(isSameRoute(p('/turo-bridge?tab=vehicles'), p('/turo-bridge'))).toBe(true);
    expect(isSameRoute(p('/rentals?page=2&view=calendar'), p('/rentals?view=calendar'))).toBe(true);
  });

  it('needs every parameter the route names', () => {
    expect(isSameRoute(p('/rentals'), p('/rentals?view=calendar'))).toBe(false);
    expect(isSameRoute(p('/rentals?view=list'), p('/rentals?view=calendar'))).toBe(false);
    expect(isSameRoute(p('/rentals/new'), p('/rentals'))).toBe(false);
  });
});

describe('the registry', () => {
  // The brief's TYPE limits only. Characters are not pixels: "Invite customers"
  // (16) passed this and still truncated on the 162px card of a 1024px screen.
  // Whether copy FITS is measured by rendering every registry card at 162px in
  // the screenshot harness (scratchpad featured-deck/run.mjs, `fit`).
  it('keeps every title and subtitle within the brief’s character limits', () => {
    for (const d of FEATURE_CARDS) {
      expect(d.title.length, d.id).toBeLessThanOrEqual(TITLE_MAX);
      expect(d.subtitle.length, d.id).toBeLessThanOrEqual(SUBTITLE_MAX);
    }
  });

  it('has unique ids, and every destination is a same-origin path', () => {
    expect(new Set(FEATURE_CARDS.map((d) => d.id)).size).toBe(FEATURE_CARDS.length);
    for (const d of FEATURE_CARDS) {
      if (d.action.kind === 'href') expect(resolveSameOriginPath(d.action.href), d.id).not.toBeNull();
      if (d.route) expect(resolveSameOriginPath(d.route), d.id).not.toBeNull();
    }
    expect(featureRoute(card('calendar-view'))).toEqual({ pathname: '/rentals', search: '?view=calendar' });
    expect(featureRoute(card('turo-sync'))).toEqual({ pathname: '/turo-bridge', search: '' });
    expect(featureRoute(card('invite-customers'))).toBeNull();
  });
});

describe('feature eligibility, gate by gate', () => {
  it('offers each tab its own cards when everything is open', () => {
    expect(eligibleOn('rentals', ctx())).toEqual(['turo-sync', 'calendar-view', 'ask-trax']);
    expect(eligibleOn('customers', ctx())).toEqual([
      'invite-customers',
      'import-customers',
      'blocked-customers',
      'ask-trax',
    ]);
    expect(eligibleOn('vehicles', ctx())).toEqual(['turo-sync', 'availability', 'ask-trax']);
  });

  it('turo-sync: needs the v2 area AND the tenant switch known to be on', () => {
    expect(eligibleOn('rentals', ctx({ v2: { turo: false, availability: true } }))).toEqual(['calendar-view', 'ask-trax']);
    expect(eligibleOn('rentals', ctx({ v2: {} }))).toEqual(['calendar-view', 'ask-trax']);
    expect(eligibleOn('rentals', ctx({ turoBridgeEnabled: false }))).toEqual(['calendar-view', 'ask-trax']);
    // Unknown (tenant row still loading) refuses, as the route and sidebar do.
    expect(eligibleOn('vehicles', ctx({ turoBridgeEnabled: null }))).toEqual(['availability', 'ask-trax']);
  });

  it('turo-sync: needs the manager route check on /turo-bridge', () => {
    const asked: string[] = [];
    const c = ctx({
      canAccessRoute: (path) => {
        asked.push(path);
        return path !== '/turo-bridge';
      },
    });
    expect(eligibleOn('rentals', c)).toEqual(['calendar-view', 'ask-trax']);
    // The pathname is checked, never the query string.
    expect(asked).toContain('/rentals');
    expect(asked).not.toContain('/rentals?view=calendar');
  });

  it('availability: needs the v2 area and the route check on /blocked-dates', () => {
    expect(eligibleOn('vehicles', ctx({ v2: { turo: true, availability: false } }))).toEqual(['turo-sync', 'ask-trax']);
    expect(eligibleOn('vehicles', ctx({ canAccessRoute: (p) => p !== '/blocked-dates' }))).toEqual([
      'turo-sync',
      'ask-trax',
    ]);
  });

  it('calendar-view: needs its handler and access to /rentals', () => {
    expect(eligibleOn('rentals', ctx({ handlers: ['openTrax'] }))).toEqual(['turo-sync', 'ask-trax']);
    expect(eligibleOn('rentals', ctx({ canAccessRoute: (p) => p !== '/rentals' }))).toEqual(['turo-sync', 'ask-trax']);
  });

  it('invite and import: need canEdit("customers") and their own handler', () => {
    const noEdit = ctx({ canEdit: (tab) => tab !== 'customers' });
    expect(eligibleOn('customers', noEdit)).toEqual(['blocked-customers', 'ask-trax']);
    const noInvite = ctx({ handlers: ['openImport', 'openTrax'] });
    expect(eligibleOn('customers', noInvite)).toEqual(['import-customers', 'blocked-customers', 'ask-trax']);
  });

  it('blocked-customers: needs the lean product and canView("blocked_customers")', () => {
    expect(eligibleOn('customers', ctx({ isLean: false }))).toEqual(['invite-customers', 'import-customers', 'ask-trax']);
    expect(eligibleOn('customers', ctx({ canView: (tab) => tab !== 'blocked_customers' }))).toEqual([
      'invite-customers',
      'import-customers',
      'ask-trax',
    ]);
  });

  it('ask-trax: needs a mounted Trax provider and the handler', () => {
    expect(eligibleOn('vehicles', ctx({ hasTrax: false }))).toEqual(['turo-sync', 'availability']);
    expect(eligibleOn('rentals', ctx({ handlers: ['openCalendar'] }))).toEqual(['turo-sync', 'calendar-view']);
  });

  it('hides a card the page says is already adopted', () => {
    expect(eligibleOn('customers', ctx({ adopted: { 'import-customers': true } }))).toEqual([
      'invite-customers',
      'blocked-customers',
      'ask-trax',
    ]);
    expect(eligibleOn('customers', ctx({ adopted: { 'import-customers': false } }))).toHaveLength(4);
  });

  it('hides a card whose area the lean product hides', () => {
    const def: FeatureCardDef = { ...card('calendar-view'), hiddenBy: 'reports' };
    expect(isFeatureEligible(def, 'rentals', ctx({ hiddenAreas: ['reports'] }))).toBe(false);
    expect(isFeatureEligible(def, 'rentals', ctx({ hiddenAreas: [] }))).toBe(true);
  });

  it('never offers a card on a tab it does not belong to', () => {
    expect(isFeatureEligible(card('invite-customers'), 'rentals', ctx())).toBe(false);
  });
});

describe('recommendations', () => {
  const rec = (fields: Partial<FeaturedRecommendation> = {}): FeaturedRecommendation => ({
    id: 'vehicles-no-photo',
    count: 3,
    title: '3 cars have no photo',
    subtitle: 'Listings with a photo get booked',
    action: { kind: 'href', href: '/vehicles?photo=missing' },
    ...fields,
  });

  it('is hidden unless the count is a positive number', () => {
    expect(isRecommendationEligible(rec(), ctx())).toBe(true);
    expect(isRecommendationEligible(rec({ count: 0 }), ctx())).toBe(false);
    expect(isRecommendationEligible(rec({ count: -1 }), ctx())).toBe(false);
    expect(isRecommendationEligible(rec({ count: Number.NaN }), ctx())).toBe(false);
    expect(isRecommendationEligible(rec({ count: Number.POSITIVE_INFINITY }), ctx())).toBe(false);
  });

  it('needs a title, a supplied handler, or a reachable same-origin href', () => {
    expect(isRecommendationEligible(rec({ title: '   ' }), ctx())).toBe(false);
    expect(isRecommendationEligible(rec({ action: { kind: 'handler', handler: 'filterNoPhoto' } }), ctx())).toBe(false);
    expect(
      isRecommendationEligible(
        rec({ action: { kind: 'handler', handler: 'filterNoPhoto' } }),
        ctx({ handlers: ['filterNoPhoto'] }),
      ),
    ).toBe(true);
    expect(isRecommendationEligible(rec({ action: { kind: 'href', href: '//evil.com' } }), ctx())).toBe(false);
    expect(isRecommendationEligible(rec(), ctx({ canAccessRoute: () => false }))).toBe(false);
  });
});

describe('buildDeck: ordering', () => {
  it('recommendations first, then features', () => {
    // Announcements are no longer a source (they left the hero decks on
    // Sep 16 2026), so a deck is recommendations then registry cards.
    // Recommendations, given scrambled: priority 5, then 1, then unset (0);
    // the zero count never shows.
    const href = { kind: 'href', href: '/rentals?status=pending' } as const;
    const recommendations: FeaturedRecommendation[] = [
      { id: 'r-low', count: 2, priority: 1, title: 'Low', subtitle: 's', action: href },
      { id: 'r-zero', count: 0, priority: 99, title: 'Zero', subtitle: 's', action: href },
      { id: 'r-none', count: 4, title: 'None', subtitle: 's', action: href },
      { id: 'r-high', count: 1, priority: 5, title: 'High', subtitle: 's', action: href },
    ];

    const deck = buildDeck({
      tab: 'rentals',
      ctx: ctx(),
      recommendations,
      now: NOW,
    });

    expect(deck.map((c) => c.id)).toEqual([
      'recommendation:r-high',
      'recommendation:r-low',
      'recommendation:r-none',
      'feature:turo-sync',
      'feature:calendar-view',
      'feature:ask-trax',
    ]);
    expect(deck.map((c) => c.badge)).toEqual([
      'Suggested',
      'Suggested',
      'Suggested',
      'New', // turo-sync: Sep 15 is before Nov 1
      null,
      null,
    ]);
  });

  it('puts a new feature before an older one of equal priority', () => {
    const always = () => true;
    const registry: FeatureCardDef[] = [
      { ...card('calendar-view'), priority: 20, isNewUntil: undefined, gate: always },
      { ...card('ask-trax'), priority: 20, isNewUntil: '2026-10-01', gate: always },
      { ...card('turo-sync'), priority: 50, isNewUntil: '2026-09-01', gate: always }, // expired
    ];
    const deck = buildDeck({ tab: 'rentals', ctx: ctx(), registry, now: NOW });
    expect(deck.map((c) => c.id)).toEqual(['feature:turo-sync', 'feature:ask-trax', 'feature:calendar-view']);
    expect(deck.map((c) => c.badge)).toEqual([null, 'New', null]);
  });

  it('counts "new" up to, not including, isNewUntil', () => {
    const def = { isNewUntil: '2026-11-01' };
    expect(isFeatureNew(def, new Date('2026-10-31T23:59:59.999Z'))).toBe(true);
    expect(isFeatureNew(def, new Date('2026-11-01T00:00:00.000Z'))).toBe(false);
    expect(isFeatureNew({ isNewUntil: 'soon' }, NOW)).toBe(false);
    expect(isFeatureNew({}, NOW)).toBe(false);
  });
});

describe('safeImageSrc', () => {
  it('loads https and same-origin paths only', () => {
    expect(safeImageSrc('https://x.supabase.co/storage/v1/object/public/a.png')).toBe(
      'https://x.supabase.co/storage/v1/object/public/a.png',
    );
    expect(safeImageSrc('/images/a.png')).toBe('/images/a.png');
    expect(safeImageSrc('http://example.com/a.png')).toBeNull();
    expect(safeImageSrc('//evil.com/a.png')).toBeNull();
    expect(safeImageSrc('/\\evil.com/a.png')).toBeNull();
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBeNull();
    expect(safeImageSrc(null)).toBeNull();
  });
});

describe('rotation by visit', () => {
  const three = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('starts on the card after the one shown last, wrapping', () => {
    expect(startIndex(three, 'a')).toBe(1);
    expect(startIndex(three, 'b')).toBe(2);
    expect(startIndex(three, 'c')).toBe(0);
  });

  it('starts at the first card with no record, a card that has gone, or one card', () => {
    expect(startIndex(three, null)).toBe(0);
    expect(startIndex(three, 'gone')).toBe(0);
    expect(startIndex([{ id: 'a' }], 'a')).toBe(0);
    expect(startIndex([], 'a')).toBe(0);
  });

  it('keys by tab and app user', () => {
    expect(rotationKey('rentals', 'u-1')).toBe('portal:featured-deck:last-shown:rentals:u-1');
    expect(rotationKey('vehicles', null)).toBe('portal:featured-deck:last-shown:vehicles:anonymous');
  });

  it('reads back what it wrote', () => {
    const map = new Map<string, string>();
    const storage: KeyValueStorage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
    };
    expect(readLastShown(storage, 'k')).toBeNull();
    writeLastShown(storage, 'k', 'feature:calendar-view');
    expect(readLastShown(storage, 'k')).toBe('feature:calendar-view');
    map.set('k', '');
    expect(readLastShown(storage, 'k')).toBeNull();
  });

  it('survives a storage that throws, or none at all', () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readLastShown(throwing, 'k')).toBeNull();
    expect(() => writeLastShown(throwing, 'k', 'x')).not.toThrow();
    expect(readLastShown(null, 'k')).toBeNull();
    expect(() => writeLastShown(undefined, 'k', 'x')).not.toThrow();
  });
});

describe('pickHeroCard — one card per tab (team lead, Sep 16 2026)', () => {
  const feat = (featureId: FeatureCardId): DeckCard => ({
    source: 'feature',
    id: `feature:${featureId}`,
    featureId,
    title: featureId,
    subtitle: '',
    art: 'calendar',
    badge: null,
    action: { kind: 'handler', handler: 'openCalendar' },
  });
  const rec: DeckCard = {
    source: 'recommendation',
    id: 'recommendation:no-photo',
    title: '3 cars have no photo',
    subtitle: '',
    art: 'suggestion',
    badge: 'Suggested',
    action: { kind: 'href', href: '/vehicles' },
  };
  const ids = (cards: DeckCard[]) => cards.map((c) => c.id);

  it('names Calendar View on Rentals', () => {
    expect(HERO_CARD.rentals).toBe('calendar-view');
  });

  it('returns the named card alone, even when others rank above it', () => {
    expect(ids(pickHeroCard('rentals', [rec, feat('turo-sync'), feat('calendar-view'), feat('ask-trax')]))).toEqual([
      'feature:calendar-view',
    ]);
  });

  it('stands in the first feature card when the named one is not eligible', () => {
    expect(ids(pickHeroCard('vehicles', [rec, feat('turo-sync'), feat('ask-trax')]))).toEqual(['feature:turo-sync']);
  });

  it('falls back to whatever the deck built first when there is no feature card', () => {
    expect(ids(pickHeroCard('customers', [rec]))).toEqual(['recommendation:no-photo']);
  });

  it('is empty for an empty deck', () => {
    expect(pickHeroCard('rentals', [])).toEqual([]);
  });
});
