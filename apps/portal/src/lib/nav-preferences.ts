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
}

export const EMPTY_NAV_PREFERENCES: NavPreferences = {
  topLevelOrder: [],
  groupOrder: [],
  groupItemOrder: {},
  hidden: [],
  pinned: [],
};

/** Shapes mirror app-sidebar's own `NavItem` / `NavGroup`, structurally. */
export interface OverlayNavItem {
  name: string;
  href: string;
  icon: any;
  badge?: number;
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
    hidden: strings(value.hidden),
    pinned: strings(value.pinned),
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
  preferences,
}: {
  topLevel: OverlayNavItem[];
  groups: OverlayNavGroup[];
  preferences: NavPreferences;
}): { topLevel: OverlayNavItem[]; groups: OverlayNavGroup[] } {
  const hidden = new Set(preferences.hidden);
  const pinned = new Set(preferences.pinned);

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
    (item) => !hidden.has(item.href)
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

  return {
    topLevel: applyOrder(visibleTopLevel, (item) => item.href, preferences.topLevelOrder),
    groups: applyOrder(visibleGroups, (group) => group.label, preferences.groupOrder),
  };
}

/** True when the user has customised anything at all — drives the Reset state. */
export function hasNavCustomisation(preferences: NavPreferences): boolean {
  return (
    preferences.topLevelOrder.length > 0 ||
    preferences.groupOrder.length > 0 ||
    Object.keys(preferences.groupItemOrder).length > 0 ||
    preferences.hidden.length > 0 ||
    preferences.pinned.length > 0
  );
}
