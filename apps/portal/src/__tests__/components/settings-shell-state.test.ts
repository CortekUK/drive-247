/**
 * v2 Settings shell decisions (`components/settings-v2/settings-shell-state.ts`).
 *
 * Every expected value below is worked out by hand from the inputs in the same
 * test, never computed by the function under test.
 */

import { describe, it, expect } from "vitest";
import {
  SETTINGS_TAB_LABELS,
  V2_GENERAL_PERM_TABS,
  V2_GENERAL_SECTIONS,
  V2_HIDDEN_SETTINGS_PAGES,
  canSaveAllDirty,
  canSaveV2Edits,
  canViewAny,
  findSettingsSearchHandoff,
  formatCompanyCount,
  isPositiveCount,
  matchesBlacklistSearch,
  resolveBlacklistView,
  resolveSettingsPageData,
  resolveSettingsTabNotice,
  resolveV2SettingsRoute,
  settingsSectionId,
  settingsTabNoticeCopy,
  v2HasUnsavedEdits,
  v2NoticePages,
} from "@/components/settings-v2/settings-shell-state";

describe("resolveSettingsTabNotice", () => {
  const base = {
    pages: {
      general: { title: "General", permTab: "general" },
      fees: { title: "Tax and fees", permTab: "fees" },
    },
    redirects: { blacklist: "/settings/blacklist" },
    allTabs: ["general", "fees", "accounting", "payments", "blacklist"],
    // A manager with General but not Fees.
    canView: (t: string) => t !== "fees",
    // Lean: accounting and payments are hidden; only payments has a board card.
    isHidden: (t: string) => t === "accounting" || t === "payments",
    boardCard: (t: string) => (t === "payments" ? "" : null),
    permissionsLoading: false,
  };

  it("no tab, or a blank one, is the plain index", () => {
    expect(resolveSettingsTabNotice({ ...base, tabParam: null })).toEqual({ kind: "none" });
    expect(resolveSettingsTabNotice({ ...base, tabParam: "  " })).toEqual({ kind: "none" });
  });

  it("a page the user may view shows no notice", () => {
    expect(resolveSettingsTabNotice({ ...base, tabParam: "general" })).toEqual({ kind: "none" });
  });

  it("a page the user may not view says so, once grants have loaded", () => {
    expect(resolveSettingsTabNotice({ ...base, tabParam: "fees" })).toEqual({ kind: "no-access", label: "Tax and fees" });
  });

  it("waits while a manager's grants are still loading, instead of bouncing", () => {
    expect(resolveSettingsTabNotice({ ...base, tabParam: "fees", permissionsLoading: true })).toEqual({ kind: "wait" });
  });

  it("redirected tabs and board hand-offs show nothing (they navigate away)", () => {
    expect(resolveSettingsTabNotice({ ...base, tabParam: "blacklist" })).toEqual({ kind: "none" });
    expect(resolveSettingsTabNotice({ ...base, tabParam: "payments" })).toEqual({ kind: "none" });
  });

  it("a known tab this workspace hides, with no board card, is unavailable", () => {
    expect(resolveSettingsTabNotice({ ...base, tabParam: "accounting" })).toEqual({
      kind: "unavailable",
      label: "Accounting",
    });
  });

  it("anything else is unknown, including object-prototype keys", () => {
    expect(resolveSettingsTabNotice({ ...base, tabParam: "foo" })).toEqual({ kind: "unknown", value: "foo" });
    expect(resolveSettingsTabNotice({ ...base, tabParam: "constructor" })).toEqual({
      kind: "unknown",
      value: "constructor",
    });
  });

  it("copy names the page and has nothing for none/wait", () => {
    expect(settingsTabNoticeCopy({ kind: "no-access", label: "Tax and fees" })?.title).toBe(
      "You don't have access to Tax and fees",
    );
    expect(settingsTabNoticeCopy({ kind: "unavailable", label: "INSHUR" })?.title).toBe(
      "INSHUR isn't part of your workspace",
    );
    expect(settingsTabNoticeCopy({ kind: "unknown", value: "x" })?.title).toBe("That settings page doesn't exist");
    expect(settingsTabNoticeCopy({ kind: "none" })).toBeNull();
    expect(settingsTabNoticeCopy({ kind: "wait" })).toBeNull();
  });
});

describe("v2 General: six pages merged into one, and the five hidden pages back", () => {
  const ALL_GENERAL_PERMS = ["general", "requirements", "duration", "lockbox", "fees", "preauth"];

  it("General's sections run in the agreed order, each with its own id", () => {
    expect(V2_GENERAL_SECTIONS.map((s) => s.anchor)).toEqual([
      "regional",
      "driver-requirements",
      "booking-rules",
      "key-handover",
      "tax-and-fees",
      "security-deposit",
      "booking-site",
      "optional-modules",
    ]);
    expect(settingsSectionId("tax-and-fees")).toBe("settings-tax-and-fees");
    // Regional, Booking site and Optional modules all follow General's own permission, so it is listed once.
    expect(V2_GENERAL_PERM_TABS).toEqual(ALL_GENERAL_PERMS);
  });

  it("hides nothing now: Promo codes, Extras, Installments, Pay as you go and Auto-extension are back, and keep their notice labels", () => {
    // The set stays (hiding a page again is one line), but it is empty.
    expect(V2_HIDDEN_SETTINGS_PAGES.size).toBe(0);
    for (const tab of ["promos", "extras", "installments", "payg", "auto-extend"]) {
      expect(V2_HIDDEN_SETTINGS_PAGES.has(tab), tab).toBe(false);
    }
    expect(SETTINGS_TAB_LABELS.promos).toBe("Promo codes");
    expect(SETTINGS_TAB_LABELS.extras).toBe("Extras");
    expect(SETTINGS_TAB_LABELS.installments).toBe("Installments");
    expect(SETTINGS_TAB_LABELS.payg).toBe("Pay as you go");
    expect(SETTINGS_TAB_LABELS["auto-extend"]).toBe("Auto-extension");
  });

  describe("resolveV2SettingsRoute", () => {
    const pages = {
      general: { permTab: "general" },
      locations: { permTab: "locations" },
      pricing: { permTab: "pricing" },
      templates: { permTab: "templates" },
      promos: { permTab: "promos" },
      extras: { permTab: "extras" },
      installments: { permTab: "installments" },
      payg: { permTab: "payg" },
      "auto-extend": { permTab: "auto-extend" },
    };
    const none = { page: null, anchor: null, permTab: null };

    it("no tab, or a blank one, is the index", () => {
      expect(resolveV2SettingsRoute(null, pages)).toEqual(none);
      expect(resolveV2SettingsRoute("  ", pages)).toEqual(none);
    });

    it("?tab=general opens General at the top, for anyone who may see any of its sections", () => {
      expect(resolveV2SettingsRoute("general", pages)).toEqual({ page: "general", anchor: null, permTab: ALL_GENERAL_PERMS });
    });

    it("each merged page's old tab opens General at its section, under that section's permission", () => {
      expect(resolveV2SettingsRoute("requirements", pages)).toEqual({ page: "general", anchor: "driver-requirements", permTab: "requirements" });
      expect(resolveV2SettingsRoute("duration", pages)).toEqual({ page: "general", anchor: "booking-rules", permTab: "duration" });
      expect(resolveV2SettingsRoute("lockbox", pages)).toEqual({ page: "general", anchor: "key-handover", permTab: "lockbox" });
      expect(resolveV2SettingsRoute("fees", pages)).toEqual({ page: "general", anchor: "tax-and-fees", permTab: "fees" });
      expect(resolveV2SettingsRoute("preauth", pages)).toEqual({ page: "general", anchor: "security-deposit", permTab: "preauth" });
      expect(resolveV2SettingsRoute("booking-site", pages)).toEqual({ page: "general", anchor: "booking-site", permTab: "general" });
    });

    it("other pages open as themselves", () => {
      expect(resolveV2SettingsRoute("locations", pages)).toEqual({ page: "locations", anchor: null, permTab: "locations" });
      expect(resolveV2SettingsRoute(" pricing ", pages)).toEqual({ page: "pricing", anchor: null, permTab: "pricing" });
    });

    it("the five pages that were hidden open as themselves again, each under its own permission", () => {
      expect(resolveV2SettingsRoute("promos", pages)).toEqual({ page: "promos", anchor: null, permTab: "promos" });
      expect(resolveV2SettingsRoute("extras", pages)).toEqual({ page: "extras", anchor: null, permTab: "extras" });
      expect(resolveV2SettingsRoute("installments", pages)).toEqual({ page: "installments", anchor: null, permTab: "installments" });
      expect(resolveV2SettingsRoute("payg", pages)).toEqual({ page: "payg", anchor: null, permTab: "payg" });
      expect(resolveV2SettingsRoute("auto-extend", pages)).toEqual({ page: "auto-extend", anchor: null, permTab: "auto-extend" });
    });

    it("the blacklist, a page with no entry and unknown values open the index", () => {
      expect(resolveV2SettingsRoute("promos", { general: { permTab: "general" } })).toEqual(none);
      expect(resolveV2SettingsRoute("blacklist", pages)).toEqual(none);
      expect(resolveV2SettingsRoute("optional-modules", pages)).toEqual(none);
      expect(resolveV2SettingsRoute("constructor", pages)).toEqual(none);
    });
  });

  it("canViewAny: one tab, or any of several", () => {
    const onlyFees = (t: string) => t === "fees";
    expect(canViewAny("fees", onlyFees)).toBe(true);
    expect(canViewAny("general", onlyFees)).toBe(false);
    expect(canViewAny(["general", "fees"], onlyFees)).toBe(true);
    expect(canViewAny(["general", "lockbox"], onlyFees)).toBe(false);
    expect(canViewAny([], () => true)).toBe(false);
  });

  it("v2NoticePages: General with its any-of permission, each section under its old tab, and every page (none is hidden)", () => {
    expect(
      v2NoticePages({
        general: { title: "General", permTab: "general" },
        locations: { title: "Locations", permTab: "locations" },
        promos: { title: "Promo codes", permTab: "promos" },
      }),
    ).toEqual({
      general: { title: "General", permTab: ALL_GENERAL_PERMS },
      locations: { title: "Locations", permTab: "locations" },
      promos: { title: "Promo codes", permTab: "promos" },
      requirements: { title: "Driver requirements", permTab: "requirements" },
      duration: { title: "Booking rules", permTab: "duration" },
      lockbox: { title: "Key handover", permTab: "lockbox" },
      fees: { title: "Tax and fees", permTab: "fees" },
      preauth: { title: "Security deposit", permTab: "preauth" },
      "booking-site": { title: "Booking site", permTab: "general" },
    });
  });

  describe("notices for the merged pages, the pages that are back, and the blacklist", () => {
    const base = {
      pages: v2NoticePages({
        general: { title: "General", permTab: "general" },
        pricing: { title: "Custom pricing", permTab: "pricing" },
        promos: { title: "Promo codes", permTab: "promos" },
        payg: { title: "Pay as you go", permTab: "payg" },
      }),
      redirects: { branding: "/settings/appearance" },
      allTabs: ["general", "requirements", "lockbox", "fees", "promos", "payg", "blacklist", "pricing"],
      isHidden: () => false,
      boardCard: () => null,
      permissionsLoading: false,
    };
    // A manager holding only the settings.rental grant behind Tax and fees.
    const onlyFees = (t: string) => t === "fees";

    it("General opens for someone who may see only one of its sections", () => {
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "general" })).toEqual({ kind: "none" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "fees" })).toEqual({ kind: "none" });
    });

    it("a section's old tab without that section's permission names the section", () => {
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "lockbox" })).toEqual({ kind: "no-access", label: "Key handover" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "booking-site" })).toEqual({ kind: "no-access", label: "Booking site" });
    });

    it("no General section at all: General itself says no access", () => {
      expect(resolveSettingsTabNotice({ ...base, canView: () => false, tabParam: "general" })).toEqual({ kind: "no-access", label: "General" });
    });

    it("a link to a page that is back opens it (no notice), or names it to someone without access", () => {
      expect(resolveSettingsTabNotice({ ...base, canView: () => true, tabParam: "promos" })).toEqual({ kind: "none" });
      expect(resolveSettingsTabNotice({ ...base, canView: () => true, tabParam: "payg" })).toEqual({ kind: "none" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "promos" })).toEqual({ kind: "no-access", label: "Promo codes" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "payg" })).toEqual({ kind: "no-access", label: "Pay as you go" });
    });

    it("the global blacklist still isn't part of the workspace", () => {
      expect(resolveSettingsTabNotice({ ...base, canView: () => true, tabParam: "blacklist" })).toEqual({ kind: "unavailable", label: "Global blacklist" });
      expect(settingsTabNoticeCopy({ kind: "unavailable", label: "Global blacklist" })?.title).toBe("Global blacklist isn't part of your workspace");
    });
  });
});

describe("resolveSettingsPageData", () => {
  const boom = new Error("Failed to fetch");
  const realOrg = { settings: { org_id: "org-1", currency_code: "GBP" }, error: null };
  const realRental = { settings: { tax_enabled: true, _paygMigrationReady: false }, error: null };

  it("the index never waits", () => {
    expect(
      resolveSettingsPageData({ page: null, org: { settings: undefined, error: boom }, rental: { settings: {}, error: boom } }),
    ).toEqual({ kind: "ready" });
  });

  it("Team emails waits on the org placeholder rather than showing its defaults", () => {
    expect(
      resolveSettingsPageData({
        page: "reminders",
        org: { settings: { org_id: "placeholder", currency_code: "USD" }, error: null },
        rental: realRental,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("Team emails shows the failed org read, never the form", () => {
    expect(resolveSettingsPageData({ page: "reminders", org: { settings: undefined, error: boom }, rental: realRental })).toEqual({
      kind: "error",
      source: "org",
      error: boom,
    });
  });

  it("stale real org data with a refetch error is still the tenant's own: ready", () => {
    expect(resolveSettingsPageData({ page: "reminders", org: { ...realOrg, error: boom }, rental: realRental })).toEqual({
      kind: "ready",
    });
  });

  it("Customer messages waits on rental DEFAULTS (no _paygMigrationReady) and errors when the read failed", () => {
    const defaults = { tax_enabled: false, max_rental_days: 90 };
    expect(resolveSettingsPageData({ page: "templates", org: realOrg, rental: { settings: defaults, error: null } })).toEqual({
      kind: "loading",
    });
    expect(resolveSettingsPageData({ page: "templates", org: realOrg, rental: { settings: defaults, error: boom } })).toEqual({
      kind: "error",
      source: "rental",
      error: boom,
    });
  });

  it("a real rental row counts even when the marker's value is false", () => {
    expect(resolveSettingsPageData({ page: "templates", org: realOrg, rental: realRental })).toEqual({ kind: "ready" });
  });

  it("General never waits at page level: a failed org read or rental read no longer hides its other sections", () => {
    const placeholderOrg = { settings: { org_id: "placeholder", currency_code: "USD" }, error: null };
    const brokenOrg = { settings: undefined, error: boom };
    const defaults = { tax_enabled: false, max_rental_days: 90 };
    expect(resolveSettingsPageData({ page: "general", org: placeholderOrg, rental: realRental })).toEqual({ kind: "ready" });
    expect(resolveSettingsPageData({ page: "general", org: brokenOrg, rental: realRental })).toEqual({ kind: "ready" });
    expect(resolveSettingsPageData({ page: "general", org: realOrg, rental: { settings: defaults, error: boom } })).toEqual({
      kind: "ready",
    });
  });

  it("Custom pricing never waits at page level: each section gates on its own read", () => {
    const defaults = { tax_enabled: false, max_rental_days: 90 };
    for (const page of ["pricing"]) {
      expect(resolveSettingsPageData({ page, org: realOrg, rental: { settings: defaults, error: null } })).toEqual({ kind: "ready" });
      expect(resolveSettingsPageData({ page, org: realOrg, rental: { settings: defaults, error: boom } })).toEqual({ kind: "ready" });
    }
  });

  it("pages reading neither query render regardless of their failures", () => {
    const broken = { settings: undefined, error: boom };
    expect(resolveSettingsPageData({ page: "locations", org: broken, rental: broken })).toEqual({ kind: "ready" });
    expect(resolveSettingsPageData({ page: "extras", org: broken, rental: broken })).toEqual({ kind: "ready" });
  });

  it("Team emails does not wait on rental settings, and Customer messages does not wait on org settings", () => {
    expect(
      resolveSettingsPageData({ page: "reminders", org: realOrg, rental: { settings: {}, error: boom } }),
    ).toEqual({ kind: "ready" });
    expect(
      resolveSettingsPageData({ page: "templates", org: { settings: undefined, error: boom }, rental: realRental }),
    ).toEqual({ kind: "ready" });
  });
});

describe("canSaveAllDirty", () => {
  it("offers Save & Leave only when nothing unsaveable is dirty", () => {
    expect(canSaveAllDirty({ rental: false, locations: false, pricing: false })).toBe(true);
    expect(canSaveAllDirty({ rental: true, locations: false, pricing: false })).toBe(false);
    expect(canSaveAllDirty({ rental: false, locations: true, pricing: false })).toBe(false);
    expect(canSaveAllDirty({ rental: false, locations: false, pricing: true })).toBe(false);
  });
});

describe("v2HasUnsavedEdits", () => {
  const clean = { sections: [] as string[], locations: false, pricing: false, rentalUncovered: false };

  it("is false with nothing registered and nothing reported", () => {
    expect(v2HasUnsavedEdits(clean)).toBe(false);
  });

  it("is true for any registered section, Locations, weekend pricing, or an uncovered rental field", () => {
    expect(v2HasUnsavedEdits({ ...clean, sections: ["fees"] })).toBe(true);
    expect(v2HasUnsavedEdits({ ...clean, locations: true })).toBe(true);
    expect(v2HasUnsavedEdits({ ...clean, pricing: true })).toBe(true);
    expect(v2HasUnsavedEdits({ ...clean, rentalUncovered: true })).toBe(true);
  });
});

describe("canSaveV2Edits", () => {
  const nothing = { registered: [] as string[], locations: false, pricing: false, rentalUncovered: false };

  it("offers Save for a fees-only edit once Tax and fees registered (the old check hid it)", () => {
    expect(canSaveV2Edits({ ...nothing, registered: ["fees"] })).toBe(true);
    // Before: any rental-form edit outside the Business-rules fields counted as unsaveable.
    expect(canSaveAllDirty({ rental: true, locations: false, pricing: false })).toBe(false);
  });

  it("counts weekend pricing as saveable only when it registered under pricing-weekend", () => {
    expect(canSaveV2Edits({ ...nothing, pricing: true, registered: ["pricing-weekend"] })).toBe(true);
    expect(canSaveV2Edits({ ...nothing, pricing: true, registered: ["fees"] })).toBe(false);
  });

  it("counts Locations only once it registers under locations", () => {
    expect(canSaveV2Edits({ ...nothing, locations: true })).toBe(false);
    expect(canSaveV2Edits({ ...nothing, locations: true, registered: ["locations"] })).toBe(true);
  });

  it("never offers Save over a rental-form edit no registered section saves", () => {
    expect(canSaveV2Edits({ ...nothing, rentalUncovered: true, registered: ["fees", "preauth", "pricing-weekend"] })).toBe(false);
  });
});

describe("findSettingsSearchHandoff", () => {
  it("points provider names at where they live", () => {
    expect(findSettingsSearchHandoff("stripe")).toEqual({ label: "Payments", where: "Integrations", href: "/integrations" });
    expect(findSettingsSearchHandoff("  Twilio ")?.label).toBe("Text messages and calling");
    expect(findSettingsSearchHandoff("sms")?.label).toBe("Text messages and calling");
    expect(findSettingsSearchHandoff("billing")).toEqual({
      label: "Your Drive247 subscription",
      where: "Billing",
      href: "/subscription",
    });
    // Team members and passwords are the index's own Team entry now: no hand-off.
    expect(findSettingsSearchHandoff("change password")).toBeNull();
    expect(findSettingsSearchHandoff("users")).toBeNull();
  });

  it("matches a prefix only from 4 characters", () => {
    expect(findSettingsSearchHandoff("stri")?.label).toBe("Payments");
    expect(findSettingsSearchHandoff("st")).toBeNull();
    // "car" is not the start of a payments word and too short for a prefix.
    expect(findSettingsSearchHandoff("car")).toBeNull();
  });

  it("returns null for settings that are on the index", () => {
    expect(findSettingsSearchHandoff("logo")).toBeNull();
    expect(findSettingsSearchHandoff("")).toBeNull();
  });
});

describe("resolveBlacklistView", () => {
  const e = new Error("x");
  it.each([
    [{ isLoading: true, error: null, total: null, filtered: 0 }, "loading"],
    [{ isLoading: false, error: null, total: null, filtered: 0 }, "loading"],
    [{ isLoading: false, error: e, total: null, filtered: 0 }, "error"],
    [{ isLoading: false, error: null, total: 0, filtered: 0 }, "empty"],
    [{ isLoading: false, error: e, total: 0, filtered: 0 }, "error"],
    [{ isLoading: false, error: null, total: 5, filtered: 0 }, "no-match"],
    [{ isLoading: false, error: null, total: 5, filtered: 2 }, "rows"],
    [{ isLoading: false, error: e, total: 5, filtered: 2 }, "error-stale"],
  ] as const)("%o -> %s", (input, expected) => {
    expect(resolveBlacklistView(input)).toBe(expected);
  });
});

describe("formatCompanyCount", () => {
  it("pluralises and groups; a broken count is a dash", () => {
    expect(formatCompanyCount(1)).toBe("1 company");
    expect(formatCompanyCount(0)).toBe("0 companies");
    expect(formatCompanyCount(3)).toBe("3 companies");
    expect(formatCompanyCount(1234)).toBe("1,234 companies");
    expect(formatCompanyCount(null)).toBe("—");
    expect(formatCompanyCount(Number.NaN)).toBe("—");
  });

  it("never prints a count the database cannot hold: negative or fractional is a dash", () => {
    expect(formatCompanyCount(-3)).toBe("—");
    expect(formatCompanyCount(-1)).toBe("—");
    expect(formatCompanyCount(2.5)).toBe("—");
    expect(formatCompanyCount(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatCompanyCount(9999999)).toBe("9,999,999 companies");
  });
});

describe("isPositiveCount", () => {
  it("is true only for whole numbers above zero", () => {
    expect(isPositiveCount(1)).toBe(true);
    expect(isPositiveCount(9999999)).toBe(true);
    expect(isPositiveCount(0)).toBe(false);
    expect(isPositiveCount(-3)).toBe(false);
    expect(isPositiveCount(2.5)).toBe(false);
    expect(isPositiveCount(Number.NaN)).toBe(false);
    expect(isPositiveCount(null)).toBe(false);
    expect(isPositiveCount("3")).toBe(false);
  });
});

describe("matchesBlacklistSearch", () => {
  it("never throws on missing fields", () => {
    expect(matchesBlacklistSearch({ email: null, blocking_tenants: null }, "")).toBe(true);
    expect(matchesBlacklistSearch({ email: null, blocking_tenants: null }, "x")).toBe(false);
    expect(matchesBlacklistSearch({ email: "a@b.com", blocking_tenants: [{ tenant_name: null, reason: null }] }, "zz")).toBe(
      false,
    );
  });

  it("matches email, company and reason case-insensitively, trimming the query", () => {
    expect(matchesBlacklistSearch({ email: "A@B.com" }, " a@b ")).toBe(true);
    expect(matchesBlacklistSearch({ email: "x@y.com", blocking_tenants: [{ tenant_name: "Kedic Rentals" }] }, "kedic")).toBe(true);
    expect(matchesBlacklistSearch({ email: "x@y.com", blocking_tenants: [{ reason: "Unpaid fines" }] }, "FINES")).toBe(true);
  });
});
