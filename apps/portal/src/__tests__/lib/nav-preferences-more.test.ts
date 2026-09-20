/**
 * The sidebar overlay, after the "More" rows joined it (Sep 20 2026).
 *
 * Three things were added and each one can fail silently, which is why they
 * are pinned here rather than only in the dialog that writes them:
 *
 *  1. a THIRD bucket (`moreOrder`) for the flat rows under "More";
 *  2. `shown`, for rows that are OFF by default and offered in the customiser
 *     (Insights, Insurances, Agreements) — the canary's rail must look exactly
 *     as it did until somebody asks for one;
 *  3. PERMANENT rows, which may never be hidden however a stored preference is
 *     spelled.
 *
 * The case that matters most is the OLD ROW: `user_nav_preferences` already
 * holds saved arrangements with none of these keys, and those users must keep
 * the sidebar they had. Every "a preference written before this existed"
 * assertion below is that case.
 */

import { describe, it, expect } from "vitest";

import {
  EMPTY_NAV_PREFERENCES,
  PERMANENT_NAV_HREFS,
  applyNavPreferences,
  hasNavCustomisation,
  isPermanentNavHref,
  parseNavPreferences,
  type NavPreferences,
  type OverlayNavItem,
} from "@/lib/nav-preferences";

const item = (name: string, href: string, extra: Partial<OverlayNavItem> = {}) =>
  ({ name, href, icon: null, ...extra }) as OverlayNavItem;

/** The canary's rail, as `app-sidebar-v2.tsx` computes it. */
const TOP = [
  item("Customers", "/customers"),
  item("Vehicles", "/vehicles"),
  item("Rentals", "/rentals"),
];
const MORE = [
  item("Insights", "/insights", { optional: true }),
  item("Insurances", "/insurances", { optional: true }),
  item("Agreements", "/agreements", { optional: true }),
  item("Availability", "/blocked-dates"),
  item("Payments", "/payments"),
  item("Invoices", "/invoices"),
  item("Fines", "/fines"),
  item("Support", "/support"),
];
const GROUPS = [
  { label: "Finance", icon: null, items: [item("Expenses", "/expenses")] },
  { label: "Records", icon: null, items: [item("Reminders", "/reminders")] },
];

const apply = (preferences: NavPreferences) =>
  applyNavPreferences({ topLevel: TOP, groups: GROUPS, more: MORE, preferences });

const hrefs = (items: OverlayNavItem[]) => items.map((i) => i.href);

describe("off-by-default rows", () => {
  it("are absent until the user asks for one", () => {
    expect(hrefs(apply(EMPTY_NAV_PREFERENCES).more)).toEqual([
      "/blocked-dates",
      "/payments",
      "/invoices",
      "/fines",
      "/support",
    ]);
  });

  it("appear once their href is in `shown`, in their declared position", () => {
    const more = apply({ ...EMPTY_NAV_PREFERENCES, shown: ["/agreements"] }).more;
    expect(hrefs(more)).toEqual([
      "/agreements",
      "/blocked-dates",
      "/payments",
      "/invoices",
      "/fines",
      "/support",
    ]);
  });

  it("can be ordered like any other row once shown", () => {
    const more = apply({
      ...EMPTY_NAV_PREFERENCES,
      shown: ["/insights"],
      moreOrder: ["/payments", "/insights"],
    }).more;
    expect(hrefs(more).slice(0, 2)).toEqual(["/payments", "/insights"]);
  });

  it("stay absent for a preferences row written before `shown` existed", () => {
    // Exactly what `user_nav_preferences` holds for a user who customised in
    // August: the five keys that existed then, and nothing else.
    const old = parseNavPreferences({
      topLevelOrder: ["/rentals", "/customers", "/vehicles"],
      groupOrder: [],
      groupItemOrder: {},
      hidden: ["/fines"],
      pinned: [],
    });
    const applied = apply(old);
    expect(hrefs(applied.topLevel)).toEqual(["/rentals", "/customers", "/vehicles"]);
    expect(hrefs(applied.more)).toEqual([
      "/blocked-dates",
      "/payments",
      "/invoices",
      "/support",
    ]);
  });
});

describe("the More bucket", () => {
  it("reorders on `moreOrder`, with anything unlisted falling to the end in place", () => {
    const more = apply({
      ...EMPTY_NAV_PREFERENCES,
      moreOrder: ["/support", "/fines"],
    }).more;
    expect(hrefs(more)).toEqual([
      "/support",
      "/fines",
      "/blocked-dates",
      "/payments",
      "/invoices",
    ]);
  });

  it("hides a row on `hidden`, like every other bucket", () => {
    const more = apply({ ...EMPTY_NAV_PREFERENCES, hidden: ["/payments"] }).more;
    expect(hrefs(more)).not.toContain("/payments");
  });

  it("is empty, not undefined, when the caller passes no More rows at all", () => {
    const applied = applyNavPreferences({
      topLevel: TOP,
      groups: GROUPS,
      preferences: EMPTY_NAV_PREFERENCES,
    });
    expect(applied.more).toEqual([]);
  });
});

describe("permanent rows", () => {
  it("names exactly the five that were asked for", () => {
    expect([...PERMANENT_NAV_HREFS].sort()).toEqual(
      ["/", "/customers", "/integrations", "/rentals", "/subscription"].sort()
    );
    // Vehicles sits beside the other two in the rail and was NOT named, so it
    // stays customisable. If that ever changes, this line is the reminder.
    expect(isPermanentNavHref("/vehicles")).toBe(false);
  });

  it("cannot be hidden, however the preference got there", () => {
    const applied = apply({
      ...EMPTY_NAV_PREFERENCES,
      hidden: ["/customers", "/rentals", "/vehicles"],
    });
    expect(hrefs(applied.topLevel)).toEqual(["/customers", "/rentals"]);
  });

  it("is stripped on the way in, so a stored row cannot resurrect the state", () => {
    const parsed = parseNavPreferences({ hidden: ["/customers", "/expenses"] });
    expect(parsed.hidden).toEqual(["/expenses"]);
  });
});

describe("parseNavPreferences tolerates what came before", () => {
  it("defaults both new keys on a row that has neither", () => {
    const parsed = parseNavPreferences({ topLevelOrder: ["/rentals"] });
    expect(parsed.moreOrder).toEqual([]);
    expect(parsed.shown).toEqual([]);
  });

  it("still refuses anything that is not a string", () => {
    const parsed = parseNavPreferences({ moreOrder: ["/fines", 7, null], shown: "nope" });
    expect(parsed.moreOrder).toEqual(["/fines"]);
    expect(parsed.shown).toEqual([]);
  });

  it("counts the new keys as customisation, so Reset stays meaningful", () => {
    expect(hasNavCustomisation(EMPTY_NAV_PREFERENCES)).toBe(false);
    expect(hasNavCustomisation({ ...EMPTY_NAV_PREFERENCES, moreOrder: ["/fines"] })).toBe(true);
    expect(hasNavCustomisation({ ...EMPTY_NAV_PREFERENCES, shown: ["/insights"] })).toBe(true);
  });
});
