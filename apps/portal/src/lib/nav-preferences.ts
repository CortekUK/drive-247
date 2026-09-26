/**
 * Per-user sidebar customisation.
 *
 * The portal's sidebar is COMPUTED, not static: tenant feature flags
 * (`lead_management_enabled`, `vehicle_owners_enabled`, …) add and remove
 * entries, and `filterItem` strips anything a manager's permissions disallow.
 * So a user's arrangement can never be stored as "their list of links" — it is
 * an OVERLAY applied on top of whatever the sidebar computed this render.
 *
 * Two properties fall out of that, and both are deliberate:
 *
 *  - **Unknown items stay visible.** A link that appears later (a feature
 *    switched on months after the user last customised) is not in their saved
 *    order, so it sorts to the end — visible. The alternative, treating
 *    "absent from the order" as "hidden", would silently bury new features.
 *
 *  - **Preferences never widen access.** The overlay runs AFTER the permission
 *    filter, so a stored href for a page the user may not see simply matches
 *    nothing. Customisation can hide, never reveal.
 */

import { repointLegacyFinanceOrder } from "@/lib/finances-nav";

export interface NavPreferences {
  /** Ordered hrefs for the top-level rail. */
  topLevelOrder: string[];
  /** Ordered group labels. */
  groupOrder: string[];
  /** Ordered hrefs within each group, keyed by group label. */
  groupItemOrder: Record<string, string[]>;
  /** Item hrefs and group labels the user has hidden. */
  hidden: string[];
  /** Group-item hrefs promoted into the top-level rail. */
  pinned: string[];
  /**
   * Ordered hrefs for the flat "More" rows.
   *
   * ADDED Sep 20 2026, when those rows became customisable. Rows written
   * before that date have no `moreOrder` key at all, which is exactly the
   * "unlisted sorts to the end, visible" case `applyOrder` already handles —
   * so an old row keeps producing today's sidebar. `parseNavPreferences`
   * tolerates its absence, and every read below defaults it.
   */
  moreOrder: string[];
  /**
   * Rows that are OFF by default and the user has switched on.
   *
   * The nav carries a few entries that were deliberately taken off the rail
   * (Insights, Insurances, Agreements) but whose pages are all still live. The
   * request was that they be offered rather than restored, so they are marked
   * `optional` where they are declared and listed only once their href appears
   * here.
   *
   * This does NOT widen access. `optional` items are filtered by permission
   * before this overlay is applied, exactly like every other item, so a stored
   * href for a page the user may not see still matches nothing.
   */
  shown: string[];
}

export const EMPTY_NAV_PREFERENCES: NavPreferences = {
  topLevelOrder: [],
  groupOrder: [],
  groupItemOrder: {},
  hidden: [],
  pinned: [],
  moreOrder: [],
  shown: [],
};

/**
 * Rows that may never be hidden or taken off the rail.
 *
 * "Dashboard, Integrations, Billing, Customers and Rentals are permanent"
 * (team lead, Sep 20 2026). Two reasons they are enforced HERE rather than
 * only greyed out in the customiser: a stored preference outlives the UI that
 * wrote it, and the dialog is not the only thing that could ever write one.
 *
 * Note what is NOT in this set. Vehicles sits beside Customers and Rentals in
 * the rail and was not named, so it stays customisable; if that was an
 * oversight rather than a decision, adding `/vehicles` here is the whole fix.
 * Dashboard, Integrations and Billing are rendered as fixed rows by the
 * sidebar and never reach this overlay at all — they are listed for the day
 * one of them does, and so that the customiser has one list to read.
 */
export const PERMANENT_NAV_HREFS: readonly string[] = [
  "/",
  "/integrations",
  "/subscription",
  "/customers",
  "/rentals",
];

/** May this row be hidden at all? */
export function isPermanentNavHref(href: string): boolean {
  return PERMANENT_NAV_HREFS.includes(href);
}

/** Shapes mirror app-sidebar's own `NavItem` / `NavGroup`, structurally. */
export interface OverlayNavItem {
  name: string;
  href: string;
  icon: any;
  badge?: number;
  /**
   * Offered, but off until the user asks for it — see `NavPreferences.shown`.
   * Absent or false is the normal case: on unless hidden.
   */
  optional?: boolean;
  [key: string]: any;
}

export interface OverlayNavGroup {
  label: string;
  icon: any;
  items: OverlayNavItem[];
  [key: string]: any;
}

/**
 * Sort by position in `order`, with anything unlisted falling to the end in
 * its original relative order. Stable on purpose — two unlisted items must not
 * shuffle between renders.
 */
function applyOrder<T>(items: T[], keyOf: (item: T) => string, order: string[]): T[] {
  const rankByKey = new Map(order.map((key, index) => [key, index]));
  return items
    .map((item, index) => ({
      item,
      index,
      rank: rankByKey.get(keyOf(item)) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}

export function parseNavPreferences(raw: unknown): NavPreferences {
  if (!raw || typeof raw !== "object") return EMPTY_NAV_PREFERENCES;
  const value = raw as Partial<NavPreferences>;
  const strings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((x): x is string => typeof x === "string") : [];

  const groupItemOrder: Record<string, string[]> = {};
  if (value.groupItemOrder && typeof value.groupItemOrder === "object") {
    for (const [label, hrefs] of Object.entries(value.groupItemOrder)) {
      groupItemOrder[label] = strings(hrefs);
    }
  }

  return {
    topLevelOrder: strings(value.topLevelOrder),
    groupOrder: strings(value.groupOrder),
    groupItemOrder,
    // A permanent row can never be hidden, whatever an older row says. The
    // customiser does not offer it, but a preference written before an entry
    // became permanent — or by hand — would otherwise take Customers or
    // Rentals off the rail with no way back except Reset.
    hidden: strings(value.hidden).filter((href) => !isPermanentNavHref(href)),
    pinned: strings(value.pinned),
    moreOrder: strings(value.moreOrder),
    shown: strings(value.shown),
  };
}

/**
 * Apply a user's arrangement to the sidebar the app just computed.
 *
 * Order of operations matters: promote pinned items out of their groups FIRST,
 * then hide, then sort. Sorting before promotion would rank a pinned item
 * against the group it is leaving rather than the rail it is joining.
 */
export function applyNavPreferences({
  topLevel,
  groups,
  more = [],
  preferences,
}: {
  topLevel: OverlayNavItem[];
  groups: OverlayNavGroup[];
  /** The flat "More" rows. Optional so a caller that has none is unchanged. */
  more?: OverlayNavItem[];
  preferences: NavPreferences;
}): {
  topLevel: OverlayNavItem[];
  groups: OverlayNavGroup[];
  more: OverlayNavItem[];
} {
  // `?? []` on both of the Sep 2026 additions: a preferences object built
  // before they existed — a stored row, or a test double — must behave as it
  // always did rather than throw on a missing array.
  const hidden = new Set(
    (preferences.hidden ?? []).filter((href) => !isPermanentNavHref(href))
  );
  const pinned = new Set(preferences.pinned ?? []);
  const shown = new Set(preferences.shown ?? []);
  /** An off-by-default row is out unless the user has asked for it. */
  const offByDefault = (item: OverlayNavItem) =>
    item.optional === true && !shown.has(item.href);

  const promoted: OverlayNavItem[] = [];
  const remainingGroups = groups.map((group) => {
    const kept: OverlayNavItem[] = [];
    for (const item of group.items) {
      if (pinned.has(item.href)) promoted.push(item);
      else kept.push(item);
    }
    return { ...group, items: kept };
  });

  const visibleTopLevel = [...topLevel, ...promoted].filter(
    (item) => !hidden.has(item.href) && !offByDefault(item)
  );

  const visibleGroups = remainingGroups
    .filter((group) => !hidden.has(group.label))
    .map((group) => ({
      ...group,
      items: applyOrder(
        group.items.filter((item) => !hidden.has(item.href)),
        (item) => item.href,
        preferences.groupItemOrder[group.label] ?? []
      ),
    }))
    // A group whose every item is hidden or pinned away has nothing left to
    // open — it would render as a heading with an empty flyout.
    .filter((group) => group.items.length > 0);

  const visibleMore = more.filter(
    (item) => !hidden.has(item.href) && !offByDefault(item)
  );

  // An order saved before Payments, Invoices and Fines became one Finances row
  // (the `finances` canary) names rows that no longer exist; Finances takes the
  // first one's place. A no-op wherever no Finances row is on screen, which is
  // every tenant but the canary. See `repointLegacyFinanceOrder`.
  const onScreen = new Set([...visibleTopLevel, ...visibleMore].map((item) => item.href));

  return {
    topLevel: applyOrder(
      visibleTopLevel,
      (item) => item.href,
      repointLegacyFinanceOrder(preferences.topLevelOrder ?? [], onScreen)
    ),
    groups: applyOrder(visibleGroups, (group) => group.label, preferences.groupOrder ?? []),
    more: applyOrder(
      visibleMore,
      (item) => item.href,
      repointLegacyFinanceOrder(preferences.moreOrder ?? [], onScreen)
    ),
  };
}

/** True when the user has customised anything at all — drives the Reset state. */
export function hasNavCustomisation(preferences: NavPreferences): boolean {
  return (
    (preferences.topLevelOrder?.length ?? 0) > 0 ||
    (preferences.groupOrder?.length ?? 0) > 0 ||
    Object.keys(preferences.groupItemOrder ?? {}).length > 0 ||
    (preferences.hidden?.length ?? 0) > 0 ||
    (preferences.pinned?.length ?? 0) > 0 ||
    (preferences.moreOrder?.length ?? 0) > 0 ||
    (preferences.shown?.length ?? 0) > 0
  );
}
