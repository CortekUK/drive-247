/**
 * v2 Settings shell decisions (`components/settings-v2/settings-shell-state.ts`).
 *
 * Every expected value below is worked out by hand from the inputs in the same
 * test, never computed by the function under test.
 */

import { describe, it, expect } from "vitest";
import {
  canSaveAllDirty,
  findSettingsSearchHandoff,
  formatCompanyCount,
  isPositiveCount,
  matchesBlacklistSearch,
  resolveBlacklistView,
  resolveSettingsPageData,
  resolveSettingsTabNotice,
  settingsTabNoticeCopy,
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

describe("resolveSettingsPageData", () => {
  const boom = new Error("Failed to fetch");
  const realOrg = { settings: { org_id: "org-1", currency_code: "GBP" }, error: null };
  const realRental = { settings: { tax_enabled: true, _paygMigrationReady: false }, error: null };

  it("the index never waits", () => {
    expect(
      resolveSettingsPageData({ page: null, org: { settings: undefined, error: boom }, rental: { settings: {}, error: boom } }),
    ).toEqual({ kind: "ready" });
  });

  it("General waits on the org placeholder rather than showing its USD default", () => {
    expect(
      resolveSettingsPageData({
        page: "general",
        org: { settings: { org_id: "placeholder", currency_code: "USD" }, error: null },
        rental: realRental,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("General shows the failed org read, never the form", () => {
    expect(resolveSettingsPageData({ page: "general", org: { settings: undefined, error: boom }, rental: realRental })).toEqual({
      kind: "error",
      source: "org",
      error: boom,
    });
  });

  it("stale real org data with a refetch error is still the tenant's own: ready", () => {
    expect(resolveSettingsPageData({ page: "general", org: { ...realOrg, error: boom }, rental: realRental })).toEqual({
      kind: "ready",
    });
  });

  it("Booking rules waits on rental DEFAULTS (no _paygMigrationReady) and errors when the read failed", () => {
    const defaults = { tax_enabled: false, max_rental_days: 90 };
    expect(resolveSettingsPageData({ page: "duration", org: realOrg, rental: { settings: defaults, error: null } })).toEqual({
      kind: "loading",
    });
    expect(resolveSettingsPageData({ page: "duration", org: realOrg, rental: { settings: defaults, error: boom } })).toEqual({
      kind: "error",
      source: "rental",
      error: boom,
    });
  });

  it("a real rental row counts even when the marker's value is false", () => {
    expect(resolveSettingsPageData({ page: "duration", org: realOrg, rental: realRental })).toEqual({ kind: "ready" });
  });

  it("Pricing rules, Tax and fees and Security deposit never wait at page level: each section gates on its own read", () => {
    const defaults = { tax_enabled: false, max_rental_days: 90 };
    for (const page of ["pricing", "fees", "preauth"]) {
      expect(resolveSettingsPageData({ page, org: realOrg, rental: { settings: defaults, error: null } })).toEqual({ kind: "ready" });
      expect(resolveSettingsPageData({ page, org: realOrg, rental: { settings: defaults, error: boom } })).toEqual({ kind: "ready" });
    }
  });

  it("pages reading neither query render regardless of their failures", () => {
    const broken = { settings: undefined, error: boom };
    expect(resolveSettingsPageData({ page: "locations", org: broken, rental: broken })).toEqual({ kind: "ready" });
    expect(resolveSettingsPageData({ page: "extras", org: broken, rental: broken })).toEqual({ kind: "ready" });
  });

  it("General does not wait on rental settings, and Booking rules does not wait on org settings", () => {
    expect(
      resolveSettingsPageData({ page: "general", org: realOrg, rental: { settings: {}, error: boom } }),
    ).toEqual({ kind: "ready" });
    expect(
      resolveSettingsPageData({ page: "duration", org: { settings: undefined, error: boom }, rental: realRental }),
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
    expect(findSettingsSearchHandoff("change password")?.href).toBe("/users");
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
