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
  V2_NOTIFICATIONS_PERM_TABS,
  V2_NOTIFICATIONS_SECTIONS,
  V2_SECTIONED_PAGES,
  V2_TAX_AND_DEPOSIT_PERM_TABS,
  V2_TAX_AND_DEPOSIT_SECTIONS,
  canSaveAllDirty,
  canSaveV2Edits,
  canViewAny,
  findSettingsSearchHandoff,
  formatCompanyCount,
  isPositiveCount,
  isTabbedV2Page,
  matchesBlacklistSearch,
  resolveBlacklistView,
  resolveSettingsPageData,
  resolveSettingsTabNotice,
  resolveV2SettingsRoute,
  settingsSectionId,
  settingsTabNoticeCopy,
  v2HasUnsavedEdits,
  v2NoticePages,
  v2PageSections,
  v2SectionHomePage,
} from "@/components/settings-v2/settings-shell-state";
import { MONTHLY_RATE_SECTION } from "@/components/settings-v2/pricing-rules-v2";

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

describe("v2 General: three stacked sections, the pages that came out of it, and the five hidden pages back", () => {
  // Written out by hand. General: Regional follows General's own grant, Driver
  // requirements its own, and the monthly rate keeps the pricing page's grant
  // (it moved into General, Sep 19 2026). Tax and deposit: its two halves.
  // Notifications is one grant for every part.
  const GENERAL_PERMS = ["general", "requirements", "pricing"];
  const TAX_AND_DEPOSIT_PERMS = ["fees", "preauth"];
  const NOTIFICATIONS_PERMS = ["notifications"];

  it("General is Regional, Driver requirements then Monthly rate; Tax and deposit is Tax and fees then Security deposit", () => {
    expect(V2_GENERAL_SECTIONS.map((s) => [s.anchor, s.title, s.permTab, s.tab])).toEqual([
      ["regional", "Regional", "general", "general"],
      ["driver-requirements", "Driver requirements", "requirements", "requirements"],
      ["monthly-rate", "Monthly rate", "pricing", null],
    ]);
    expect(V2_TAX_AND_DEPOSIT_SECTIONS.map((s) => [s.anchor, s.title, s.permTab, s.tab])).toEqual([
      ["tax-and-fees", "Tax and fees", "fees", "fees"],
      ["security-deposit", "Security deposit", "preauth", "preauth"],
    ]);
    expect(settingsSectionId("security-deposit")).toBe("settings-security-deposit");
    expect(settingsSectionId("monthly-rate")).toBe("settings-monthly-rate");
    expect(V2_GENERAL_PERM_TABS).toEqual(GENERAL_PERMS);
    expect(V2_TAX_AND_DEPOSIT_PERM_TABS).toEqual(TAX_AND_DEPOSIT_PERMS);
  });

  it("NOTHING is tabbed: General stacks, so a link to one of its sections scrolls instead of opening a tab", () => {
    // The team lead settled this at transcript 00:54 ("Regional comes here,
    // Driver requirements comes here, then put the monthly one somewhere under
    // these"). The `tabs` layout and everything reading it stay, so the next
    // page can be tabs with one word — but no page uses it today.
    expect(V2_SECTIONED_PAGES.general.layout).toBe("stack");
    expect(V2_SECTIONED_PAGES["tax-and-deposit"].layout).toBe("stack");
    expect(V2_SECTIONED_PAGES.notifications.layout).toBe("stack");
    expect(Object.values(V2_SECTIONED_PAGES).every((p) => p.layout === "stack")).toBe(true);
    expect(isTabbedV2Page("general")).toBe(false);
    expect(isTabbedV2Page("tax-and-deposit")).toBe(false);
    expect(isTabbedV2Page("notifications")).toBe(false);
    expect(isTabbedV2Page("duration")).toBe(false);
    expect(isTabbedV2Page(null)).toBe(false);
    expect(isTabbedV2Page("constructor")).toBe(false);
    // So `?tab=requirements` carries an anchor to scroll to, not a tab to pick.
    expect(resolveV2SettingsRoute("requirements", { general: { permTab: "general" } })).toEqual({
      page: "general",
      anchor: "driver-requirements",
      permTab: "requirements",
    });
  });

  it("v2PageSections lists a sectioned page's sections, and nothing for any other page", () => {
    expect(v2PageSections("general").map((s) => s.anchor)).toEqual(["regional", "driver-requirements", "monthly-rate"]);
    expect(v2PageSections("tax-and-deposit").map((s) => s.anchor)).toEqual(["tax-and-fees", "security-deposit"]);
    expect(v2PageSections("notifications").map((s) => s.anchor)).toEqual(["notifications-email", "notifications-push"]);
    expect(v2PageSections("lockbox")).toEqual([]);
    expect(v2PageSections("toString")).toEqual([]);
    expect(v2PageSections(undefined)).toEqual([]);
  });

  it("Monthly rate is last on General, under the pricing permission, with the heading the pricing page used", () => {
    const anchors = V2_GENERAL_SECTIONS.map((s) => s.anchor);
    expect(anchors.indexOf("monthly-rate")).toBe(anchors.indexOf("driver-requirements") + 1);
    expect(anchors.indexOf("monthly-rate")).toBe(anchors.length - 1);
    const monthly = V2_GENERAL_SECTIONS.find((s) => s.anchor === "monthly-rate")!;
    expect(monthly.permTab).toBe("pricing");
    // `?tab=pricing` still opens Weekend and holiday pricing, so it answers to no old tab.
    expect(monthly.tab).toBeNull();
    expect({ title: monthly.title, description: monthly.description }).toEqual(MONTHLY_RATE_SECTION);
  });

  it("Notifications is one page with an email and a push section, both under the one notifications permission", () => {
    expect(V2_NOTIFICATIONS_SECTIONS.map((s) => [s.anchor, s.title, s.permTab, s.tab])).toEqual([
      ["notifications-email", "Email notifications", "notifications", "reminders"],
      ["notifications-push", "Push notifications", "notifications", "push"],
    ]);
    expect(V2_NOTIFICATIONS_PERM_TABS).toEqual(NOTIFICATIONS_PERMS);
  });

  it("atPageTop says which section IS the top of its page, rather than inferring it from the index", () => {
    // Regional and Tax and fees are the first thing under their page title, so
    // their old tab opens the page with nothing to scroll to. Notifications'
    // email section is FIRST but not at the top (the page draws its notice and
    // its Channels heading above it), so `?tab=reminders` still scrolls.
    const atTop = Object.entries(V2_SECTIONED_PAGES).flatMap(([page, { sections }]) =>
      sections.filter((s) => s.atPageTop).map((s) => [page, s.anchor]),
    );
    expect(atTop).toEqual([
      ["general", "regional"],
      ["tax-and-deposit", "tax-and-fees"],
    ]);
    expect(V2_NOTIFICATIONS_SECTIONS.every((s) => !s.atPageTop)).toBe(true);
  });

  it("the three sectioned pages share no anchor, so an old #settings-… link has exactly one home", () => {
    expect(Object.keys(V2_SECTIONED_PAGES)).toEqual(["general", "tax-and-deposit", "notifications"]);
    const anchors = Object.values(V2_SECTIONED_PAGES).flatMap(({ sections }) => sections.map((s) => s.anchor));
    expect(new Set(anchors).size).toBe(anchors.length);
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
      duration: { permTab: "duration" },
      lockbox: { permTab: "lockbox" },
      "tax-and-deposit": { permTab: "fees" },
      "booking-site": { permTab: "general" },
      modules: { permTab: "general" },
      notifications: { permTab: "notifications" },
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

    it("?tab=general opens General on Regional, for anyone who may see either tab", () => {
      expect(resolveV2SettingsRoute("general", pages)).toEqual({ page: "general", anchor: null, permTab: GENERAL_PERMS });
    });

    it("?tab=requirements (the setup guide's link) opens General on Driver requirements, under its own permission", () => {
      expect(resolveV2SettingsRoute("requirements", pages)).toEqual({ page: "general", anchor: "driver-requirements", permTab: "requirements" });
    });

    it("the monthly rate has no tab of its own: ?tab=pricing is still Weekend and holiday pricing", () => {
      expect(resolveV2SettingsRoute("pricing", pages)).toEqual({ page: "pricing", anchor: null, permTab: "pricing" });
      expect(resolveV2SettingsRoute("monthly-rate", pages)).toEqual(none);
    });

    it("Tax and deposit: its own tab needs either half; ?tab=fees opens it at the top, ?tab=preauth at the deposit", () => {
      expect(resolveV2SettingsRoute("tax-and-deposit", pages)).toEqual({ page: "tax-and-deposit", anchor: null, permTab: TAX_AND_DEPOSIT_PERMS });
      expect(resolveV2SettingsRoute("fees", pages)).toEqual({ page: "tax-and-deposit", anchor: null, permTab: "fees" });
      expect(resolveV2SettingsRoute("preauth", pages)).toEqual({ page: "tax-and-deposit", anchor: "security-deposit", permTab: "preauth" });
    });

    it("Notifications: its own tab needs its permission; ?tab=reminders and ?tab=push scroll to the email and push setup", () => {
      expect(resolveV2SettingsRoute("notifications", pages)).toEqual({ page: "notifications", anchor: null, permTab: NOTIFICATIONS_PERMS });
      expect(resolveV2SettingsRoute("reminders", pages)).toEqual({ page: "notifications", anchor: "notifications-email", permTab: "notifications" });
      expect(resolveV2SettingsRoute("push", pages)).toEqual({ page: "notifications", anchor: "notifications-push", permTab: "notifications" });
    });

    it("Booking rules, Lockbox, Booking site and Optional modules open as pages of their own, on their old tabs", () => {
      expect(resolveV2SettingsRoute("duration", pages)).toEqual({ page: "duration", anchor: null, permTab: "duration" });
      expect(resolveV2SettingsRoute("lockbox", pages)).toEqual({ page: "lockbox", anchor: null, permTab: "lockbox" });
      expect(resolveV2SettingsRoute("booking-site", pages)).toEqual({ page: "booking-site", anchor: null, permTab: "general" });
      expect(resolveV2SettingsRoute("modules", pages)).toEqual({ page: "modules", anchor: null, permTab: "general" });
    });

    it("a page made of sections, and its sections' old tabs, open nothing without a page entry, or while hidden", () => {
      const { "tax-and-deposit": _taxAndDeposit, ...withoutTax } = pages;
      expect(resolveV2SettingsRoute("tax-and-deposit", withoutTax)).toEqual(none);
      expect(resolveV2SettingsRoute("fees", withoutTax)).toEqual(none);
      expect(resolveV2SettingsRoute("preauth", withoutTax)).toEqual(none);
      // General still opens: only the Tax and deposit page is missing.
      expect(resolveV2SettingsRoute("requirements", withoutTax)).toEqual({ page: "general", anchor: "driver-requirements", permTab: "requirements" });
    });

    it("with Notifications gone, its sections' old tabs fall through to pages of those names", () => {
      // The fall-through is what keeps `?tab=push` working if Notifications is
      // ever hidden again: the sectioned page opens nothing, so the plain
      // `push` page (the v1-era render case) answers instead.
      const { notifications: _notifications, ...withoutNotifications } = pages;
      const fallback = { ...withoutNotifications, reminders: { permTab: "reminders" }, push: { permTab: "push" } };
      expect(resolveV2SettingsRoute("notifications", fallback)).toEqual(none);
      expect(resolveV2SettingsRoute("reminders", fallback)).toEqual({ page: "reminders", anchor: null, permTab: "reminders" });
      expect(resolveV2SettingsRoute("push", fallback)).toEqual({ page: "push", anchor: null, permTab: "push" });
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

    it("the blacklist, a page with no entry, section anchors and unknown values open the index", () => {
      expect(resolveV2SettingsRoute("promos", { general: { permTab: "general" } })).toEqual(none);
      expect(resolveV2SettingsRoute("lockbox", { general: { permTab: "general" } })).toEqual(none);
      expect(resolveV2SettingsRoute("blacklist", pages)).toEqual(none);
      expect(resolveV2SettingsRoute("optional-modules", pages)).toEqual(none);
      expect(resolveV2SettingsRoute("key-handover", pages)).toEqual(none);
      expect(resolveV2SettingsRoute("regional", pages)).toEqual(none);
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

  it("v2NoticePages: each sectioned page with its any-of permission, each section under its old tab, and every page (none is hidden)", () => {
    expect(
      v2NoticePages({
        general: { title: "General", permTab: "general" },
        locations: { title: "Locations", permTab: "locations" },
        lockbox: { title: "Lockbox", permTab: "lockbox" },
        "tax-and-deposit": { title: "Tax and deposit", permTab: "fees" },
        notifications: { title: "Notifications", permTab: "notifications" },
        promos: { title: "Promo codes", permTab: "promos" },
      }),
    ).toEqual({
      general: { title: "General", permTab: GENERAL_PERMS },
      locations: { title: "Locations", permTab: "locations" },
      lockbox: { title: "Lockbox", permTab: "lockbox" },
      "tax-and-deposit": { title: "Tax and deposit", permTab: TAX_AND_DEPOSIT_PERMS },
      notifications: { title: "Notifications", permTab: NOTIFICATIONS_PERMS },
      promos: { title: "Promo codes", permTab: "promos" },
      requirements: { title: "Driver requirements", permTab: "requirements" },
      fees: { title: "Tax and fees", permTab: "fees" },
      preauth: { title: "Security deposit", permTab: "preauth" },
      reminders: { title: "Email notifications", permTab: "notifications" },
      push: { title: "Push notifications", permTab: "notifications" },
    });
  });

  it("v2NoticePages: without the Tax and deposit page, ?tab=preauth is not listed either", () => {
    // The monthly rate has no tab of its own, so General contributes only
    // `requirements` beyond itself.
    const out = v2NoticePages({ general: { title: "General", permTab: "general" } });
    expect(Object.keys(out)).toEqual(["general", "requirements"]);
  });

  it("v2SectionHomePage: an old #settings-… link finds the page that holds the section now", () => {
    expect(v2SectionHomePage("settings-tax-and-fees")).toBe("tax-and-deposit");
    expect(v2SectionHomePage("settings-security-deposit")).toBe("tax-and-deposit");
    expect(v2SectionHomePage("settings-monthly-rate")).toBe("general");
    expect(v2SectionHomePage("settings-regional")).toBe("general");
    expect(v2SectionHomePage("settings-notifications-push")).toBe("notifications");
    // Sections that left General for pages of their own have no anchor now, so
    // an old `#settings-key-handover` is no one's: the page itself answers.
    expect(v2SectionHomePage("settings-key-handover")).toBeNull();
    // Not a section of a sectioned page (Customer messages' lockbox message), or nothing.
    expect(v2SectionHomePage("settings-lockbox-messages")).toBeNull();
    expect(v2SectionHomePage("tax-and-fees")).toBeNull();
    expect(v2SectionHomePage(null)).toBeNull();
    expect(v2SectionHomePage("")).toBeNull();
  });

  describe("notices for the pages that came out of General, the pages that are back, and the blacklist", () => {
    const base = {
      pages: v2NoticePages({
        general: { title: "General", permTab: "general" },
        duration: { title: "Booking rules", permTab: "duration" },
        lockbox: { title: "Lockbox", permTab: "lockbox" },
        "tax-and-deposit": { title: "Tax and deposit", permTab: "fees" },
        "booking-site": { title: "Booking site", permTab: "general" },
        pricing: { title: "Weekend and holiday pricing", permTab: "pricing" },
        promos: { title: "Promo codes", permTab: "promos" },
        payg: { title: "Pay as you go", permTab: "payg" },
      }),
      redirects: { branding: "/settings/appearance" },
      allTabs: ["general", "requirements", "duration", "lockbox", "fees", "preauth", "promos", "payg", "blacklist", "pricing"],
      isHidden: () => false,
      boardCard: () => null,
      permissionsLoading: false,
    };
    // A manager holding only the settings.rental grant behind Tax and fees.
    const onlyFees = (t: string) => t === "fees";
    // A manager holding only the settings.pricing grant (weekend, holiday and monthly pricing).
    const onlyPricing = (t: string) => t === "pricing";

    it("a page made of sections opens for someone who may see only one of them", () => {
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "tax-and-deposit" })).toEqual({ kind: "none" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "fees" })).toEqual({ kind: "none" });
      // The PAGE's link opens for either half; a SECTION's old tab still needs
      // that section's own grant (`?tab=fees` is Tax and fees').
      expect(resolveSettingsTabNotice({ ...base, canView: (t) => t === "preauth", tabParam: "tax-and-deposit" })).toEqual({ kind: "none" });
      expect(resolveSettingsTabNotice({ ...base, canView: (t) => t === "preauth", tabParam: "fees" })).toEqual({ kind: "no-access", label: "Tax and fees" });
      // The monthly rate is on General now, so the pricing grant alone opens General.
      expect(resolveSettingsTabNotice({ ...base, canView: onlyPricing, tabParam: "general" })).toEqual({ kind: "none" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyPricing, tabParam: "pricing" })).toEqual({ kind: "none" });
    });

    it("Tax and fees is no longer part of General", () => {
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "general" })).toEqual({ kind: "no-access", label: "General" });
    });

    it("the deposit's old tab without its permission names Security deposit; the fees page without either names the page", () => {
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "preauth" })).toEqual({ kind: "no-access", label: "Security deposit" });
      // `?tab=fees` is Tax and fees' own old tab, so the notice names the
      // SECTION, not the page that holds it now.
      expect(resolveSettingsTabNotice({ ...base, canView: onlyPricing, tabParam: "fees" })).toEqual({ kind: "no-access", label: "Tax and fees" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyPricing, tabParam: "tax-and-deposit" })).toEqual({ kind: "no-access", label: "Tax and deposit" });
    });

    it("General opens for someone who may see only Driver requirements", () => {
      const onlyRequirements = (t: string) => t === "requirements";
      expect(resolveSettingsTabNotice({ ...base, canView: onlyRequirements, tabParam: "general" })).toEqual({ kind: "none" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyRequirements, tabParam: "requirements" })).toEqual({ kind: "none" });
    });

    it("a link without that page's (or section's) permission names it", () => {
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "lockbox" })).toEqual({ kind: "no-access", label: "Lockbox" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "duration" })).toEqual({ kind: "no-access", label: "Booking rules" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "booking-site" })).toEqual({ kind: "no-access", label: "Booking site" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "preauth" })).toEqual({ kind: "no-access", label: "Security deposit" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "requirements" })).toEqual({ kind: "no-access", label: "Driver requirements" });
      expect(resolveSettingsTabNotice({ ...base, canView: onlyFees, tabParam: "general" })).toEqual({ kind: "no-access", label: "General" });
    });

    it("no section of a sectioned page at all: the page itself says no access", () => {
      expect(resolveSettingsTabNotice({ ...base, canView: () => false, tabParam: "general" })).toEqual({ kind: "no-access", label: "General" });
      expect(resolveSettingsTabNotice({ ...base, canView: () => false, tabParam: "tax-and-deposit" })).toEqual({ kind: "no-access", label: "Tax and deposit" });
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

  it("Weekend and holiday pricing and Tax and deposit never wait at page level: each section gates on its own read", () => {
    const defaults = { tax_enabled: false, max_rental_days: 90 };
    for (const page of ["pricing", "tax-and-deposit", "duration", "lockbox"]) {
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
