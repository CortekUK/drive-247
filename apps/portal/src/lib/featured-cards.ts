/**
 * The featured deck on the hero tabs (Rentals, Customers, Vehicles): what may
 * go in it, in what order, and which card a visit starts on.
 *
 * Every function here is PURE. The deck component
 * (components/shared/featured-deck-v2.tsx) gathers the inputs from hooks and
 * hands them to `buildDeck`; nothing in this file reads React, Supabase, the
 * tenant or the clock on its own. That is what lets the tests pin every rule
 * with hand-worked expectations.
 *
 * ---------------------------------------------------------------------------
 * THREE SOURCES, IN THIS ORDER
 *
 *   (a) Platform announcements (`feature_announcements`, via
 *       useFeatureAnnouncements) whose CTA is a same-origin path under this
 *       tab's route prefixes. Critical ones first, then by sort_priority and
 *       publish date.
 *   (b) Recommendations the page derives from data it already holds
 *       ("3 cars have no photo"). Hidden at a count of 0.
 *   (c) Feature cards from `FEATURE_CARDS` below, by priority, newer first at
 *       equal priority.
 *
 * An announcement pointing at the same route as a feature card REPLACES that
 * card, so the same feature is never advertised twice in one deck.
 *
 * ---------------------------------------------------------------------------
 * THE RULE EVERY CARD OBEYS
 *
 * A card that points at something the viewer cannot open reads as a broken
 * portal, not a teaser (the sidebar promo learned this first). So:
 *   - a feature card is eligible only if its destination exists on this branch
 *     AND its gate can be evaluated from `FeaturedContext` — the same gate the
 *     destination itself enforces;
 *   - a card whose handler the tab did not supply is ineligible;
 *   - an announcement inherits the gate of any registry card at the same route,
 *     so "Turo Sync is here" can never show to a tenant who cannot reach
 *     /turo-bridge;
 *   - every destination must pass `canAccessRoute`, the manager route check the
 *     dashboard layout enforces.
 *
 * v2 only: imported by the v2 deck, never by v1 code.
 */

import type { V2Area } from '@/lib/v2';
import type { LeanHiddenArea } from '@/lib/lean-areas';
import type { FeatureAnnouncement } from '@/hooks/use-feature-announcements';
import { safeHref } from '@/lib/safe-href';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type FeaturedTab = 'rentals' | 'customers' | 'vehicles';

/** One small animated art per key; see components/shared/featured-card-art-v2.tsx. */
export type FeaturedArtKey =
  | 'calendar'
  | 'trax'
  | 'turo'
  | 'invite'
  | 'import'
  | 'blocked'
  | 'availability'
  | 'announcement'
  | 'suggestion';

/** Handlers the registry knows about. Tabs may supply more for recommendations. */
export type FeaturedHandlerKey = 'openCalendar' | 'openTrax' | 'openInvite' | 'openImport';

export type FeaturedAction =
  | { kind: 'href'; href: string }
  // `string & {}` keeps autocomplete for the known keys while letting a
  // recommendation name a handler of its own.
  | { kind: 'handler'; handler: FeaturedHandlerKey | (string & {}) };

/** The callbacks a tab supplies, by handler name. */
export type FeaturedHandlers = Partial<Record<FeaturedHandlerKey | (string & {}), (() => void) | undefined>>;

export const TITLE_MAX = 22;
export const SUBTITLE_MAX = 44;

export type FeatureCardId =
  | 'calendar-view'
  | 'turo-sync'
  | 'availability'
  | 'invite-customers'
  | 'import-customers'
  | 'blocked-customers'
  | 'ask-trax';

/**
 * Everything a gate may read. Built by the deck from hooks; built by hand in
 * tests.
 */
export interface FeaturedContext {
  /** v2 area flags as `useV2` resolves them. A missing area reads as off. */
  v2: Partial<Record<V2Area, boolean>>;
  /** `isLeanTenant(slug)`. */
  isLean: boolean;
  /** Lean-hidden areas for this tenant: `LEAN_HIDDEN_AREAS` when lean, else none. */
  hiddenAreas: readonly LeanHiddenArea[];
  /** From useManagerPermissions. */
  canView: (tabKey: string) => boolean;
  canEdit: (tabKey: string) => boolean;
  /** The manager route check the dashboard layout redirects on. */
  canAccessRoute: (pathname: string) => boolean;
  /**
   * `tenants.turo_bridge_enabled`: true or false once the tenant row has
   * loaded, `null` while it is unknown. Gates want `=== true`, so unknown
   * refuses, exactly as the /turo-bridge route and the sidebar do.
   */
  turoBridgeEnabled: boolean | null;
  /** A TraxProvider is mounted above the deck (`useTraxOptional() !== null`). */
  hasTrax: boolean;
  /** Names of the handlers actually supplied. */
  handlers: readonly string[];
  /**
   * "Already adopted" signals from the page. `true` hides that feature card:
   * there is no point advertising Import to a tenant with a full list.
   */
  adopted: Partial<Record<FeatureCardId, boolean>>;
}

export interface FeatureCardDef {
  id: FeatureCardId;
  tabs: readonly FeaturedTab[];
  /** Plain text, at most TITLE_MAX characters. */
  title: string;
  /** Plain text, at most SUBTITLE_MAX characters. */
  subtitle: string;
  art: FeaturedArtKey;
  action: FeaturedAction;
  /**
   * The same-origin URL where this feature lives, when a handler card has one
   * (Calendar View is `/rentals?view=calendar`). An href card's route is its
   * href. Used for de-duplication against announcements, gate inheritance and
   * the route check.
   */
  route?: string;
  /** Higher shows first. */
  priority: number;
  /**
   * ISO date or instant. The card carries a "New" badge, and leads cards of
   * equal priority, while `now` is before it. A bare date means 00:00 UTC.
   */
  isNewUntil?: string;
  /** Hidden for tenants whose lean product hides this area. */
  hiddenBy?: LeanHiddenArea;
  /** The destination's own gate, evaluated from the context only. */
  gate: (ctx: FeaturedContext) => boolean;
}

/** A card the page computes from rows it already holds. */
export interface FeaturedRecommendation {
  /** Stable, e.g. "vehicles-no-photo". Rotation remembers it. */
  id: string;
  /** How many things need attention. Not a positive number: not shown. */
  count: number;
  /**
   * Plain text, e.g. "3 cars have no photo". Truncated to one line (full text
   * in a tooltip): keep it to about 18 characters to read whole on the
   * narrowest desktop card (HeroRow's 15rem column floor, 240px).
   */
  title: string;
  /** Plain text, clamped to two lines. */
  subtitle: string;
  art?: FeaturedArtKey;
  action: FeaturedAction;
  /** Higher shows first among recommendations; ties keep the order given. */
  priority?: number;
}

export type DeckBadge = 'New' | 'Important' | 'Suggested';

interface DeckCardBase {
  /** Namespaced by source, so an announcement id can never collide with a card id. */
  id: string;
  title: string;
  subtitle: string;
  art: FeaturedArtKey;
  badge: DeckBadge | null;
}

export type DeckCard =
  | (DeckCardBase & {
      source: 'announcement';
      announcement: FeatureAnnouncement;
      /** A vetted image for the art slot, or null for the generic art. */
      imageUrl: string | null;
    })
  | (DeckCardBase & { source: 'recommendation'; action: FeaturedAction })
  | (DeckCardBase & { source: 'feature'; featureId: FeatureCardId; action: FeaturedAction });

/* ─── The registry ──────────────────────────────────────────────────────── */

/**
 * Every entry was checked against the code before it was added:
 *
 * - calendar-view: the Rentals page switches to its calendar through
 *   `handleViewChange("calendar")`, which pushes `?view=calendar`; the hero row
 *   already receives that as `onOpenCalendar`. Anyone on the Rentals tab can
 *   use it, so the route check on /rentals is the only gate.
 * - turo-sync: /turo-bridge renders the screen only when `useV2("turo")` AND
 *   `tenants.turo_bridge_enabled === true` (app/(dashboard)/turo-bridge/page.tsx);
 *   anyone else gets a refusal screen. ROUTE_TO_TAB maps it to 'rentals'.
 * - availability: /blocked-dates renders the v2 week calendar only under
 *   `useV2("availability")`; ROUTE_TO_TAB maps it to 'availability'. The v2
 *   screen is a READ-ONLY preview, so the copy promises seeing, not editing.
 * - invite-customers / import-customers: the Customers header shows Invite and
 *   Import CSV under `canEdit('customers')`.
 * - blocked-customers: the Customers header shows Blocked under
 *   `isLeanTenant && canView('blocked_customers')`.
 * - ask-trax: `TraxProvider` is mounted only under the v2 chrome gate, and the
 *   top bar's own Trax button renders on nothing but its presence.
 *
 * COPY FITS A 162px CARD, MEASURED. That was the card on a 1024px screen (a
 * 720px hero row) before HeroRow gave its column a 15rem floor; it is kept as
 * the worst case, which leaves room for about 12 characters of title and two
 * ~19-character subtitle lines. TITLE_MAX / SUBTITLE_MAX are the brief's type
 * limits, not a fit check: "Invite customers" (16) passed them and still read
 * "Invite custo…" there. So the titles use the Customers header's
 * own words ("Import CSV", the blocked page's "Blocklist"), and the harness
 * (scratchpad featured-deck/run.mjs, `fit`) renders every registry card at
 * 162px and fails on a truncated title or a clamped subtitle.
 *
 * `isNewUntil` on turo-sync and availability is a product choice (both reached
 * the canary in September 2026), not a fact read from the code: revisit it.
 */
export const FEATURE_CARDS: readonly FeatureCardDef[] = [
  {
    id: 'turo-sync',
    tabs: ['rentals', 'vehicles'],
    title: 'Turo Sync',
    subtitle: 'Bring your Turo trips into Drive247',
    art: 'turo',
    action: { kind: 'href', href: '/turo-bridge' },
    priority: 40,
    isNewUntil: '2026-11-01',
    gate: (ctx) => ctx.v2.turo === true && ctx.turoBridgeEnabled === true,
  },
  {
    id: 'calendar-view',
    tabs: ['rentals'],
    title: 'Calendar View',
    subtitle: 'See your fleet on a timeline',
    art: 'calendar',
    action: { kind: 'handler', handler: 'openCalendar' },
    route: '/rentals?view=calendar',
    priority: 30,
    gate: () => true,
  },
  {
    id: 'availability',
    tabs: ['vehicles'],
    title: 'Availability',
    subtitle: 'Your hours and blocked dates',
    art: 'availability',
    action: { kind: 'href', href: '/blocked-dates' },
    priority: 30,
    isNewUntil: '2026-11-01',
    gate: (ctx) => ctx.v2.availability === true,
  },
  {
    id: 'invite-customers',
    tabs: ['customers'],
    title: 'Invite link',
    subtitle: 'Customers sign themselves up',
    art: 'invite',
    action: { kind: 'handler', handler: 'openInvite' },
    priority: 30,
    gate: (ctx) => ctx.canEdit('customers'),
  },
  {
    id: 'import-customers',
    tabs: ['customers'],
    title: 'Import CSV',
    subtitle: 'Bring your list across',
    art: 'import',
    action: { kind: 'handler', handler: 'openImport' },
    priority: 20,
    gate: (ctx) => ctx.canEdit('customers'),
  },
  {
    id: 'blocked-customers',
    tabs: ['customers'],
    title: 'Blocklist',
    subtitle: "Customers you won't rent to",
    art: 'blocked',
    action: { kind: 'href', href: '/blocked-customers' },
    priority: 15,
    gate: (ctx) => ctx.isLean && ctx.canView('blocked_customers'),
  },
  {
    id: 'ask-trax',
    tabs: ['rentals', 'customers', 'vehicles'],
    title: 'Ask Trax',
    subtitle: 'Your AI assistant, one question away',
    art: 'trax',
    action: { kind: 'handler', handler: 'openTrax' },
    route: '/trax',
    priority: 10,
    gate: (ctx) => ctx.hasTrax,
  },
];

/* ─── Routes ────────────────────────────────────────────────────────────── */

/** A placeholder origin: only ever compared with itself, never fetched. */
const ORIGIN = 'https://portal.invalid';

export interface ResolvedPath {
  /** Normalised: dot segments resolved, trailing slashes dropped ("/" stays). */
  pathname: string;
  /** "" or "?a=1". The hash is dropped. */
  search: string;
}

/**
 * A same-origin path, resolved the way a browser will resolve the href, or
 * `null`.
 *
 * `safeHref` first, so everything the dashboard refuses is refused here too.
 * Then only paths (never absolute URLs, even to our own host), resolved through
 * `URL` so that what is matched is what the click will open:
 *   `/\evil.com`              resolves off-origin        → null
 *   `/rentals/../payments`    resolves to `/payments`    → not under /rentals
 *   `/rentals/%2e%2e/payments` likewise
 */
export function resolveSameOriginPath(url: unknown): ResolvedPath | null {
  const href = safeHref(typeof url === 'string' ? url : null);
  if (!href || !href.startsWith('/')) return null;
  let parsed: URL;
  try {
    parsed = new URL(href, `${ORIGIN}/`);
  } catch {
    return null;
  }
  if (parsed.origin !== ORIGIN) return null;
  const pathname = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '') || '/';
  return { pathname, search: parsed.search };
}

/**
 * Is `pathname` one of the prefixes, or beneath one? `/rentals` covers
 * `/rentals` and `/rentals/new`, never `/rentalsX`. A bare "/" prefix would
 * cover the whole portal and is ignored.
 */
export function isUnderRoutePrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((raw) => {
    if (typeof raw !== 'string' || !raw.startsWith('/')) return false;
    const prefix = raw.replace(/\/+$/, '');
    if (!prefix) return false;
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

/**
 * Does `target` point at the feature living at `route`? Same pathname, and
 * every query parameter the route names is present in the target with that
 * value. So `/turo-bridge?tab=vehicles` is Turo Sync, but `/rentals` is not
 * Calendar View (`/rentals?view=calendar`).
 */
export function isSameRoute(target: ResolvedPath, route: ResolvedPath): boolean {
  if (target.pathname !== route.pathname) return false;
  const want = new URLSearchParams(route.search);
  const have = new URLSearchParams(target.search);
  for (const [key, value] of want) {
    if (!have.getAll(key).includes(value)) return false;
  }
  return true;
}

/**
 * Is `target` the feature at `route`, or a page beneath it? This is the GATE
 * test, wider than `isSameRoute` (which stays the de-duplication test): an
 * announcement for `/turo-bridge/review` must pass Turo Sync's gate just as
 * `/turo-bridge` does. A route that names query parameters is a VIEW of its
 * page, not a tree: `/rentals/new` is not beneath `/rentals?view=calendar`.
 */
export function isUnderFeature(target: ResolvedPath, route: ResolvedPath): boolean {
  if (isSameRoute(target, route)) return true;
  return route.search === '' && isUnderRoutePrefix(target.pathname, [route.pathname]);
}

/** Where a registry card lives, resolved, or null for a handler with no URL. */
export function featureRoute(def: FeatureCardDef): ResolvedPath | null {
  const raw = def.route ?? (def.action.kind === 'href' ? def.action.href : undefined);
  return raw ? resolveSameOriginPath(raw) : null;
}

/**
 * An image we are willing to load into the art slot: https, or a same-origin
 * path. Plain http is refused as well as everything `safeHref` refuses — the
 * portal is served over https and a mixed-content image is at best blocked.
 */
export function safeImageSrc(url: unknown): string | null {
  const href = safeHref(typeof url === 'string' ? url : null);
  if (!href) return null;
  if (/^https:\/\//i.test(href)) {
    try {
      return new URL(href).protocol === 'https:' ? href : null;
    } catch {
      return null;
    }
  }
  return resolveSameOriginPath(href) ? href : null;
}

/* ─── Eligibility ───────────────────────────────────────────────────────── */

export function isFeatureNew(def: Pick<FeatureCardDef, 'isNewUntil'>, now: Date): boolean {
  if (!def.isNewUntil) return false;
  const until = Date.parse(def.isNewUntil);
  return Number.isFinite(until) && now.getTime() < until;
}

/** The destination's own gate plus the lean-hidden check — nothing tab-specific. */
function destinationOpen(def: FeatureCardDef, ctx: FeaturedContext): boolean {
  if (def.hiddenBy && ctx.hiddenAreas.includes(def.hiddenBy)) return false;
  return def.gate(ctx) === true;
}

/** May this registry card appear on this tab, for this viewer? */
export function isFeatureEligible(def: FeatureCardDef, tab: FeaturedTab, ctx: FeaturedContext): boolean {
  if (!def.tabs.includes(tab)) return false;
  if (ctx.adopted[def.id] === true) return false;
  if (def.action.kind === 'handler' && !ctx.handlers.includes(def.action.handler)) return false;
  if (def.action.kind === 'href' && !resolveSameOriginPath(def.action.href)) return false;
  const route = featureRoute(def);
  if (route && !ctx.canAccessRoute(route.pathname)) return false;
  return destinationOpen(def, ctx);
}

export function isRecommendationEligible(rec: FeaturedRecommendation, ctx: FeaturedContext): boolean {
  if (typeof rec.count !== 'number' || !Number.isFinite(rec.count) || rec.count <= 0) return false;
  if (typeof rec.title !== 'string' || rec.title.trim().length === 0) return false;
  if (rec.action.kind === 'handler') return ctx.handlers.includes(rec.action.handler);
  const path = resolveSameOriginPath(rec.action.href);
  return !!path && ctx.canAccessRoute(path.pathname);
}

/**
 * The dev-only preview rows in use-feature-announcements.ts (`preview-…`).
 *
 * Left out of the deck. They are invented product news that exists so the
 * dashboard carousel has something to fan on a dev server; here they would push
 * real cards aside on exactly the screen someone is checking — "Fleet Calendar"
 * (/blocked-dates, promising drag-to-block) would REPLACE the Availability card,
 * whose v2 screen is read-only. Production never has them either way.
 */
export function isPreviewAnnouncement(a: Pick<FeatureAnnouncement, 'id'>): boolean {
  return typeof a.id === 'string' && a.id.startsWith('preview-');
}

/**
 * The resolved CTA path when this announcement belongs in this tab's deck,
 * else null.
 */
export function admitAnnouncement(
  a: FeatureAnnouncement,
  routePrefixes: readonly string[],
  ctx: FeaturedContext,
  registry: readonly FeatureCardDef[] = FEATURE_CARDS,
): ResolvedPath | null {
  if (!a || typeof a.id !== 'string' || isPreviewAnnouncement(a)) return null;
  if (typeof a.title !== 'string' || a.title.trim().length === 0) return null;
  const path = resolveSameOriginPath(a.cta_url);
  if (!path || !isUnderRoutePrefix(path.pathname, routePrefixes)) return null;
  if (!ctx.canAccessRoute(path.pathname)) return null;
  // Gate inheritance: pointing at a gated feature, or anywhere beneath it, is
  // only allowed to someone that feature's own gate lets in — whichever tab the
  // registry card is on.
  for (const def of registry) {
    const route = featureRoute(def);
    if (route && isUnderFeature(path, route) && !destinationOpen(def, ctx)) return null;
  }
  return path;
}

/* ─── Ordering ──────────────────────────────────────────────────────────── */

function publishedAt(a: FeatureAnnouncement): number {
  const t = a.published_at ? Date.parse(a.published_at) : NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

function finite(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * Critical first; then higher `sort_priority`; then more recently published.
 * A row with no (or an unparseable) publish date counts as oldest. Equal rows
 * keep their input order (Array.prototype.sort is stable).
 */
export function compareAnnouncements(a: FeatureAnnouncement, b: FeatureAnnouncement): number {
  const critical = Number(b.severity === 'critical') - Number(a.severity === 'critical');
  if (critical !== 0) return critical;
  const priority = finite(b.sort_priority) - finite(a.sort_priority);
  if (priority !== 0) return priority;
  const ta = publishedAt(a);
  const tb = publishedAt(b);
  if (ta === tb) return 0;
  return tb > ta ? 1 : -1;
}

export interface BuildDeckInput {
  tab: FeaturedTab;
  ctx: FeaturedContext;
  /** Route prefixes an announcement's CTA must fall under, e.g. ["/rentals"]. */
  routePrefixes: readonly string[];
  announcements?: readonly FeatureAnnouncement[];
  recommendations?: readonly FeaturedRecommendation[];
  /** Defaults to FEATURE_CARDS. */
  registry?: readonly FeatureCardDef[];
  now: Date;
}

/** Eligible cards, merged, de-duplicated and ordered. */
export function buildDeck({
  tab,
  ctx,
  routePrefixes,
  announcements = [],
  recommendations = [],
  registry = FEATURE_CARDS,
  now,
}: BuildDeckInput): DeckCard[] {
  // (a) announcements
  const seenAnnouncements = new Set<string>();
  const admitted: { a: FeatureAnnouncement; path: ResolvedPath }[] = [];
  for (const a of announcements) {
    if (!a || seenAnnouncements.has(a.id)) continue;
    const path = admitAnnouncement(a, routePrefixes, ctx, registry);
    if (!path) continue;
    seenAnnouncements.add(a.id);
    admitted.push({ a, path });
  }
  admitted.sort((x, y) => compareAnnouncements(x.a, y.a));
  const announcementCards: DeckCard[] = admitted.map(({ a }) => ({
    source: 'announcement',
    id: `announcement:${a.id}`,
    title: a.title.trim(),
    subtitle: a.summary?.trim() || 'Find out more',
    art: 'announcement',
    badge: a.severity === 'critical' ? 'Important' : 'New',
    announcement: a,
    imageUrl: safeImageSrc(a.image_url),
  }));

  // (b) recommendations
  const seenRecommendations = new Set<string>();
  const recommendationCards: DeckCard[] = recommendations
    .filter((rec) => {
      if (!rec || typeof rec.id !== 'string' || seenRecommendations.has(rec.id)) return false;
      if (!isRecommendationEligible(rec, ctx)) return false;
      seenRecommendations.add(rec.id);
      return true;
    })
    .sort((x, y) => finite(y.priority) - finite(x.priority))
    .map((rec) => ({
      source: 'recommendation',
      id: `recommendation:${rec.id}`,
      title: rec.title.trim(),
      subtitle: rec.subtitle.trim(),
      art: rec.art ?? 'suggestion',
      badge: 'Suggested',
      action: rec.action,
    }));

  // (c) features, minus any an admitted announcement replaces
  const featureCards: DeckCard[] = registry
    .filter((def) => isFeatureEligible(def, tab, ctx))
    .filter((def) => {
      const route = featureRoute(def);
      return !(route && admitted.some(({ path }) => isSameRoute(path, route)));
    })
    .map((def) => ({ def, isNew: isFeatureNew(def, now) }))
    .sort((x, y) => y.def.priority - x.def.priority || Number(y.isNew) - Number(x.isNew))
    .map(({ def, isNew }) => ({
      source: 'feature',
      id: `feature:${def.id}`,
      featureId: def.id,
      title: def.title,
      subtitle: def.subtitle,
      art: def.art,
      badge: isNew ? 'New' : null,
      action: def.action,
    }));

  return [...announcementCards, ...recommendationCards, ...featureCards];
}

/* ─── Rotation by visit ─────────────────────────────────────────────────── */

export const ROTATION_KEY_PREFIX = 'portal:featured-deck:last-shown';

/**
 * Per tab and per signed-in app user, so two staff sharing a browser each get
 * their own rotation (the announcements dismissal list, by contrast, is per
 * browser — see use-feature-announcements.ts).
 */
export function rotationKey(tab: FeaturedTab, appUserId: string | null | undefined): string {
  return `${ROTATION_KEY_PREFIX}:${tab}:${appUserId || 'anonymous'}`;
}

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** `window.localStorage`, or null on the server or where touching it throws. */
export function browserStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLastShown(storage: KeyValueStorage | null | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(key);
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Never throws: a full or blocked storage only costs the rotation. */
export function writeLastShown(storage: KeyValueStorage | null | undefined, key: string, id: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, id);
  } catch {
    /* rotation simply does not persist */
  }
}

/**
 * Where a visit starts: the card after the one shown last, wrapping. With no
 * record, or when that card has left the deck, the first card.
 */
export function startIndex(cards: readonly { id: string }[], lastShownId: string | null): number {
  if (cards.length === 0 || !lastShownId) return 0;
  const i = cards.findIndex((c) => c.id === lastShownId);
  return i === -1 ? 0 : (i + 1) % cards.length;
}
