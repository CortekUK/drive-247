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
import {
  FEATURE_CARDS,
  SUBTITLE_MAX,
  TITLE_MAX,
  admitAnnouncement,
  buildDeck,
  compareAnnouncements,
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
import type { FeatureAnnouncement } from '@/hooks/use-feature-announcements';

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

function ann(fields: Partial<FeatureAnnouncement> & { id: string }): FeatureAnnouncement {
  return {
    title: 'An announcement',
    summary: null,
    body_html: null,
    image_url: null,
    cta_label: null,
    cta_url: null,
    severity: 'major',
    published_at: null,
    expires_at: null,
    sort_priority: 0,
    audience_filter: null,
    ...fields,
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

describe('announcements: which ones join a tab', () => {
  const RENTALS = ['/rentals'];

  it('admits a CTA under the tab, and nothing else', () => {
    expect(admitAnnouncement(ann({ id: 'a', cta_url: '/rentals?view=calendar' }), RENTALS, ctx())).toEqual({
      pathname: '/rentals',
      search: '?view=calendar',
    });
    expect(admitAnnouncement(ann({ id: 'b', cta_url: '/payments' }), RENTALS, ctx())).toBeNull();
    expect(admitAnnouncement(ann({ id: 'c', cta_url: '/rentals/../payments' }), RENTALS, ctx())).toBeNull();
    expect(admitAnnouncement(ann({ id: 'd', cta_url: null }), RENTALS, ctx())).toBeNull();
    expect(admitAnnouncement(ann({ id: 'e', cta_url: '//evil.com/rentals' }), RENTALS, ctx())).toBeNull();
    expect(admitAnnouncement(ann({ id: 'f', cta_url: 'javascript:alert(1)' }), RENTALS, ctx())).toBeNull();
    expect(admitAnnouncement(ann({ id: 'g', cta_url: 'https://drive-247.com/rentals' }), RENTALS, ctx())).toBeNull();
  });

  it('drops a blank title and the dev-only preview rows', () => {
    expect(admitAnnouncement(ann({ id: 'h', title: '  ', cta_url: '/rentals' }), RENTALS, ctx())).toBeNull();
    expect(admitAnnouncement(ann({ id: 'preview-auto-extension', cta_url: '/rentals' }), RENTALS, ctx())).toBeNull();
  });

  it('inherits the gate of the registry card at the same route', () => {
    const turo = ann({ id: 't', cta_url: '/turo-bridge?tab=review' });
    const prefixes = ['/rentals', '/turo-bridge'];
    expect(admitAnnouncement(turo, prefixes, ctx())).not.toBeNull();
    expect(admitAnnouncement(turo, prefixes, ctx({ v2: {} }))).toBeNull();
    expect(admitAnnouncement(turo, prefixes, ctx({ turoBridgeEnabled: null }))).toBeNull();
  });

  it('inherits it for a page BENEATH that route too', () => {
    // /turo-bridge/review lies under Turo Sync's /turo-bridge: same gate.
    const prefixes = ['/rentals', '/turo-bridge'];
    const off = ctx({ turoBridgeEnabled: false });
    for (const url of ['/turo-bridge', '/turo-bridge/', '/turo-bridge?tab=review', '/turo-bridge#x', '/turo-bridge/review']) {
      expect(admitAnnouncement(ann({ id: url, cta_url: url }), prefixes, off), url).toBeNull();
      expect(admitAnnouncement(ann({ id: url, cta_url: url }), prefixes, ctx()), url).not.toBeNull();
    }
    // /turo-bridgeX is a different route, not beneath it (and not under a prefix).
    expect(admitAnnouncement(ann({ id: 'x', cta_url: '/turo-bridgeX' }), prefixes, off)).toBeNull();
    expect(admitAnnouncement(ann({ id: 'x', cta_url: '/turo-bridgeX' }), ['/turo-bridgeX'], off)).toEqual({
      pathname: '/turo-bridgeX',
      search: '',
    });
  });

  it('treats a route with query parameters as a view of its page, not a tree', () => {
    // A closed feature living at /rentals?view=closed. Only URLs carrying that
    // view inherit its gate; /rentals and /rentals/new are other pages.
    const closed: FeatureCardDef = {
      id: 'calendar-view',
      tabs: ['rentals'],
      title: 'Closed view',
      subtitle: 'x',
      art: 'calendar',
      action: { kind: 'handler', handler: 'openCalendar' },
      route: '/rentals?view=closed',
      priority: 1,
      gate: () => false,
    };
    const admit = (url: string) => admitAnnouncement(ann({ id: url, cta_url: url }), RENTALS, ctx(), [closed]);
    expect(admit('/rentals?view=closed')).toBeNull();
    expect(admit('/rentals?view=closed&x=1')).toBeNull();
    expect(admit('/rentals')).toEqual({ pathname: '/rentals', search: '' });
    expect(admit('/rentals/new')).toEqual({ pathname: '/rentals/new', search: '' });
    expect(admit('/rentals/new?view=closed')).toEqual({ pathname: '/rentals/new', search: '?view=closed' });
  });

  it('needs the route check on its own path', () => {
    const a = ann({ id: 'i', cta_url: '/rentals/new' });
    expect(admitAnnouncement(a, RENTALS, ctx({ canAccessRoute: (p) => p !== '/rentals/new' }))).toBeNull();
  });
});

describe('buildDeck: de-duplication', () => {
  it('an announcement at a feature card’s route replaces that card', () => {
    const deck = buildDeck({
      tab: 'rentals',
      ctx: ctx(),
      routePrefixes: ['/rentals', '/turo-bridge'],
      announcements: [ann({ id: 'a1', cta_url: '/turo-bridge?tab=review' })],
      now: NOW,
    });
    expect(deck.map((c) => c.id)).toEqual(['announcement:a1', 'feature:calendar-view', 'feature:ask-trax']);
  });

  it('/rentals is not Calendar View, but /rentals?view=calendar is', () => {
    const plain = buildDeck({
      tab: 'rentals',
      ctx: ctx(),
      routePrefixes: ['/rentals'],
      announcements: [ann({ id: 'a2', cta_url: '/rentals' })],
      now: NOW,
    });
    expect(plain.map((c) => c.id)).toEqual([
      'announcement:a2',
      'feature:turo-sync',
      'feature:calendar-view',
      'feature:ask-trax',
    ]);

    const calendar = buildDeck({
      tab: 'rentals',
      ctx: ctx(),
      routePrefixes: ['/rentals'],
      announcements: [ann({ id: 'a3', cta_url: '/rentals?view=calendar' })],
      now: NOW,
    });
    expect(calendar.map((c) => c.id)).toEqual(['announcement:a3', 'feature:turo-sync', 'feature:ask-trax']);
  });

  it('replaces Availability on Vehicles, and keeps one copy of a repeated row', () => {
    const deck = buildDeck({
      tab: 'vehicles',
      ctx: ctx(),
      routePrefixes: ['/vehicles', '/blocked-dates'],
      announcements: [ann({ id: 'b1', cta_url: '/blocked-dates' }), ann({ id: 'b1', cta_url: '/blocked-dates' })],
      now: NOW,
    });
    expect(deck.map((c) => c.id)).toEqual(['announcement:b1', 'feature:turo-sync', 'feature:ask-trax']);
  });
});

describe('buildDeck: ordering', () => {
  it('critical, then announcements by priority and date, then recommendations, then features', () => {
    // Announcements, given scrambled:
    //   c1 critical  p0  Sep 01  -> first: critical always leads
    //   n1 minor     p9  (none)  -> second: highest sort_priority of the rest
    //   m2 major     p5  Sep 12  -> the three p5 rows, newest first
    //   m1 major     p5  Sep 10
    //   i1 info      p5  (none)  -> no publish date counts as oldest
    const announcements = [
      ann({ id: 'm1', cta_url: '/rentals', sort_priority: 5, published_at: '2026-09-10T00:00:00Z' }),
      ann({ id: 'i1', cta_url: '/rentals', sort_priority: 5, severity: 'info' }),
      ann({ id: 'n1', cta_url: '/rentals', sort_priority: 9, severity: 'minor' }),
      ann({ id: 'c1', cta_url: '/rentals', severity: 'critical', published_at: '2026-09-01T00:00:00Z' }),
      ann({ id: 'm2', cta_url: '/rentals', sort_priority: 5, published_at: '2026-09-12T00:00:00Z' }),
    ];
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
      routePrefixes: ['/rentals'],
      announcements,
      recommendations,
      now: NOW,
    });

    expect(deck.map((c) => c.id)).toEqual([
      'announcement:c1',
      'announcement:n1',
      'announcement:m2',
      'announcement:m1',
      'announcement:i1',
      'recommendation:r-high',
      'recommendation:r-low',
      'recommendation:r-none',
      'feature:turo-sync',
      'feature:calendar-view',
      'feature:ask-trax',
    ]);
    expect(deck.map((c) => c.badge)).toEqual([
      'Important',
      'New',
      'New',
      'New',
      'New',
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
    const deck = buildDeck({ tab: 'rentals', ctx: ctx(), routePrefixes: [], registry, now: NOW });
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

  it('treats an unparseable publish date as the oldest', () => {
    const dated = ann({ id: 'x', published_at: '2020-01-01T00:00:00Z' });
    const garbage = ann({ id: 'y', published_at: 'not a date' });
    expect(compareAnnouncements(dated, garbage)).toBe(-1);
    expect(compareAnnouncements(garbage, dated)).toBe(1);
  });

  it('carries summary, fallback subtitle and a vetted image onto announcement cards', () => {
    const deck = buildDeck({
      tab: 'rentals',
      ctx: ctx({ hasTrax: false, v2: {}, handlers: [] }),
      routePrefixes: ['/rentals'],
      announcements: [
        ann({ id: 'p', title: '  Deposit Holds ', summary: ' Holds refresh ', cta_url: '/rentals', image_url: 'https://x.supabase.co/a.png' }),
        ann({ id: 'q', cta_url: '/rentals', image_url: 'http://example.com/a.png' }),
      ],
      now: NOW,
    });
    expect(deck).toHaveLength(2);
    expect(deck[0]).toMatchObject({ title: 'Deposit Holds', subtitle: 'Holds refresh', imageUrl: 'https://x.supabase.co/a.png' });
    expect(deck[1]).toMatchObject({ subtitle: 'Find out more', imageUrl: null });
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
