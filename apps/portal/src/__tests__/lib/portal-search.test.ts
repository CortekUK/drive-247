import { describe, expect, it } from "vitest";
import {
  ALL_DESTINATIONS,
  INTEGRATION_CARDS,
  PAGE_DESTINATIONS,
  V1_SETTINGS_TABS,
  isDestinationVisible,
  scoreDestination,
  searchPortalDestinations,
  type DestinationContext,
  type PortalDestination,
} from "@/lib/search/portal-destinations";
import { OPT_IN_CATEGORIES, RECORD_CATEGORIES, scoreText, toAmount, toFilterText } from "@/lib/search-service";
import { RECORD_GROUPS } from "@/hooks/use-global-search";
import { readPortalSource, readRepoSource } from "../helpers/edge-source";

/**
 * The global search (⌘K) finds every PLACE in the portal — pages, settings
 * sections, integrations — as well as records. Two things have to hold:
 *
 *  1. it never offers a place the user cannot open, and
 *  2. it never falls behind the navigation, which is what the "pinned to the
 *     source" tests at the bottom check.
 */

/** A head admin on the v2 portal (Northwind): no manager restrictions, lean tenant. */
const northwind: DestinationContext = {
  v2Chrome: true,
  integrationsBoard: true,
  lean: true,
  isHeadAdmin: true,
  flags: { pending_bookings: true },
  canAccessRoute: () => true,
  canViewSettings: () => true,
};

/** A head admin on the original portal, with every optional feature on. */
const classic: DestinationContext = {
  v2Chrome: false,
  integrationsBoard: false,
  lean: false,
  isHeadAdmin: true,
  flags: {
    lead_management_enabled: true,
    automations_enabled: true,
    vehicle_owners_enabled: true,
    fleet_health_enabled: true,
    turo_sync_enabled: true,
    pending_bookings: true,
    custom_site_enabled: true,
  },
  canAccessRoute: () => true,
  canViewSettings: () => true,
};

const titles = (items: PortalDestination[]) => items.map((d) => d.title);
const find = (query: string, ctx: DestinationContext) => {
  const r = searchPortalDestinations(query, ctx);
  return [...r.pages, ...r.settings, ...r.integrations];
};
const hrefFor = (query: string, ctx: DestinationContext, title: string) =>
  find(query, ctx).find((d) => d.title === title)?.href;

describe("typing the name of a place finds it", () => {
  it.each([
    ["support", "Support"],
    ["help", "Help (TRAX)"],
    ["settings", "Settings"],
    ["integrations", "Integrations"],
    ["billing", "Billing"],
    ["customers", "Customers"],
    ["availability", "Availability"],
    ["credits", "Credits"],
  ])("%s → %s", (query, title) => {
    expect(titles(find(query, northwind))).toContain(title);
  });

  it("finds a settings section, not just the Settings page", () => {
    expect(titles(find("deposit", northwind))).toContain("Security deposit");
    expect(titles(find("promo codes", northwind))).toContain("Promo codes");
    expect(titles(find("installments", northwind))).toContain("Installments");
    expect(titles(find("branding", northwind))).toContain("Branding");
    expect(titles(find("key handover", northwind))).toContain("Key handover");
  });

  it("finds things by what they are called, not only by their title", () => {
    // "vat" and "lockbox" are keywords of Tax and fees / Key handover.
    expect(titles(find("vat", northwind))).toContain("Tax and fees");
    expect(titles(find("lockbox", northwind))).toContain("Key handover");
    // "pcn" is a keyword of Fines; "blocked dates" of Availability.
    expect(titles(find("pcn", northwind))).toContain("Fines");
    expect(titles(find("blocked dates", northwind))).toContain("Availability");
  });

  it("finds an integration and opens its own panel", () => {
    expect(titles(find("stripe", northwind))).toContain("Stripe Connect");
    expect(hrefFor("stripe", northwind, "Stripe Connect")).toBe("/integrations?open=Stripe%20Connect");
    expect(titles(find("twilio", northwind))).toContain("Twilio Messages");
    expect(titles(find("sms", northwind))).toContain("Twilio Messages");
    expect(titles(find("e-sign", northwind))).toContain("BoldSign");
  });

  it("puts the closest match first", () => {
    const first = find("support", northwind)[0];
    expect(first.title).toBe("Support");
    expect(scoreDestination(first, "support")).toBe(100);
  });

  it("finds nothing for an empty query", () => {
    expect(find("   ", northwind)).toEqual([]);
  });
});

describe("the original portal has its own settings list", () => {
  it("settings open as tabs there, and the v2 index is not offered", () => {
    expect(hrefFor("deposit", classic, "Deposit")).toBe("/settings?tab=preauth");
    expect(titles(find("deposit", classic))).not.toContain("Security deposit");
    expect(titles(find("stripe", classic))).toContain("Payments");
    expect(hrefFor("stripe", classic, "Payments")).toBe("/settings?tab=payments");
  });

  it("pages only that portal has are offered there, and not on v2", () => {
    expect(titles(find("messages", classic))).toContain("Messages");
    expect(titles(find("audit", classic))).toContain("Audit Logs");
    expect(titles(find("messages", northwind))).not.toContain("Messages");
    expect(titles(find("audit", northwind))).not.toContain("Audit Logs");
  });

  it("has no Integrations board, and Support and Help are v2 only", () => {
    expect(titles(find("stripe", classic))).not.toContain("Stripe Connect");
    expect(titles(find("support", classic))).not.toContain("Support");
    expect(titles(find("help", classic))).not.toContain("Help (TRAX)");
  });
});

describe("it never offers a place the user cannot open", () => {
  it("a lean tenant is not offered its hidden areas", () => {
    for (const [query, title] of [["reports", "Reports"], ["p&l", "P&L Dashboard"], ["reminders", "Reminders"], ["expenses", "Expenses"], ["quotes", "Fleet Quotes"], ["welcome", "Welcome"]] as const) {
      expect(titles(find(query, northwind)), title).not.toContain(title);
      expect(titles(find(query, { ...classic, flags: { ...classic.flags } })), title).toContain(title);
    }
  });

  it("a page whose feature is switched off is not offered", () => {
    const off: DestinationContext = { ...classic, flags: {} };
    expect(titles(find("leads", off))).not.toContain("Leads");
    expect(titles(find("owners", off))).not.toContain("Vehicle Owners");
    expect(titles(find("fleet health", off))).not.toContain("Fleet Health");
    expect(titles(find("turo", off))).not.toContain("Turo Sync");
    expect(titles(find("pending", off))).not.toContain("Pending Bookings");
  });

  it("a manager is not offered a page their permissions refuse", () => {
    const manager: DestinationContext = {
      ...northwind,
      isHeadAdmin: false,
      canAccessRoute: (path) => path === "/customers" || path === "/",
      canViewSettings: () => false,
    };
    const results = searchPortalDestinations("customers", manager);
    expect(titles(results.pages)).toEqual(["Customers"]);
    expect(find("payments", manager)).toEqual([]);
    expect(find("branding", manager)).toEqual([]);
    expect(find("stripe", manager)).toEqual([]);
  });

  it("Team is for head admins only", () => {
    expect(titles(find("team", northwind))).toContain("Team");
    expect(titles(find("team", { ...northwind, isHeadAdmin: false }))).not.toContain("Team");
    expect(titles(find("users", { ...classic, isHeadAdmin: false }))).not.toContain("Manage Users");
  });

  it("every destination is checked against canAccessRoute", () => {
    const nothing: DestinationContext = { ...classic, canAccessRoute: () => false };
    for (const d of ALL_DESTINATIONS) expect(isDestinationVisible(d, nothing), d.id).toBe(false);
  });
});

describe("results stay a usable size", () => {
  it("each group is capped", () => {
    // "s" matches a great many things through descriptions.
    const r = searchPortalDestinations("s", northwind);
    expect(r.pages.length).toBeLessThanOrEqual(6);
    expect(r.settings.length).toBeLessThanOrEqual(6);
    expect(r.integrations.length).toBeLessThanOrEqual(5);
  });

  it("the same place is never listed twice", () => {
    const r = find("payment", northwind);
    const keys = r.map((d) => `${d.group}:${d.href}:${d.title}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("how typed text is matched", () => {
  it("finds the words in any order", () => {
    expect(scoreText("John Smith", "smith john")).toBeGreaterThan(0);
    expect(scoreText("John Smith", "john smith")).toBeGreaterThan(0);
    expect(scoreText("Chevrolet Malibu LT", "malibu chevrolet")).toBeGreaterThan(0);
  });

  it("finds the start of a word, and a word from the middle", () => {
    expect(scoreText("Chevrolet Malibu", "mal")).toBeGreaterThan(0);
    expect(scoreText("RENT-2026-0184 • Jane Doe • AB12 CDE", "jane")).toBeGreaterThan(0);
    expect(scoreText("Security deposit", "deposit")).toBeGreaterThan(0);
  });

  it("survives a typo in a single word", () => {
    expect(scoreText("Chevrolet", "chevrolt")).toBeGreaterThan(0);
  });

  it("requires every word when several are typed", () => {
    expect(scoreText("John Smith", "john doe")).toBe(0);
    expect(scoreText("Ford Fiesta", "ford malibu")).toBe(0);
  });

  it("ranks an exact title above a partial one", () => {
    expect(scoreText("Payments", "payments")).toBeGreaterThan(scoreText("Owner Payouts • payments", "payments"));
  });

  it("matches emails, registrations, references and ids as one word", () => {
    expect(scoreText("jane@example.com", "jane@example.com")).toBe(100);
    expect(scoreText("AB12 CDE", "ab12")).toBeGreaterThan(0);
    expect(scoreText("RENT-2026-0184", "2026-0184")).toBeGreaterThan(0);
    expect(scoreText("pi_3UH4aSJ5gYWBVGvJ19MgcaHS", "pi_3uh4")).toBeGreaterThan(0);
  });

  it("ignores case and surrounding spaces", () => {
    expect(scoreText("Northwind Rentals", "  NORTHWIND  ")).toBeGreaterThan(0);
  });
});

describe("record search", () => {
  it("every record type is shown in the search window", () => {
    const shown = RECORD_GROUPS.map((g) => g.key);
    for (const c of RECORD_CATEGORIES) expect(shown, `${c} has no group`).toContain(c);
    expect(new Set(RECORD_GROUPS.map((g) => g.filter)).size).toBe(RECORD_GROUPS.length);
  });

  it("searches the settings promo-code table, not the website's promotions", () => {
    const src = readPortalSource("lib/search-service.ts");
    // Settings › Promo codes reads `promocodes`; `promotions` is the website page.
    expect(src).toMatch(/from\("promocodes"\)[\s\S]{0,1200}url: "\/settings\?tab=promos"/);
    expect(src).toMatch(/from\("promotions"\)[\s\S]{0,1200}url: "\/cms\/promotions"/);
  });

  it("covers the uploaded documents that used to be dropped", () => {
    const src = readPortalSource("lib/search-service.ts");
    // Only insurance certificates and agreements were offered; licences and IDs were not.
    expect(src).toMatch(/doc\.document_type !== 'Agreement' && doc\.document_type !== 'Insurance Certificate'/);
  });

  it("searches the fields people actually type", () => {
    const src = readPortalSource("lib/search-service.ts");
    // customers by company, licence and town; vehicles by VIN; payments by Stripe id.
    expect(src).toMatch(/anyField\(\s*\[\s*"name", "email", "phone", "company_name", "license_number", "id_number"/);
    expect(src).toMatch(/anyField\(\["reg", "make", "model", "colour", "color", "vin"/);
    expect(src).toMatch(/"stripe_payment_intent_id"/);
    // status words ("pending", "cancelled") reach rentals, fines and payments.
    expect(src).toMatch(/anyField\(\["rental_number", "status"\]/);
  });

  it("a typed comma or bracket cannot break the database query", () => {
    expect(toFilterText("Smith, John")).toBe("Smith John");
    expect(toFilterText("(BMW) 50%")).toBe("BMW 50");
    expect(toFilterText("  spaced   out  ")).toBe("spaced out");
  });

  it("an amount is recognised, and other text is not", () => {
    expect(toAmount("500")).toBe(500);
    expect(toAmount("$500")).toBe(500);
    expect(toAmount(" 49.99 ")).toBe(49.99);
    expect(toAmount("abc")).toBeNull();
    expect(toAmount("500 deposit")).toBeNull();
  });

  it("rentals, fines and payments are searched by customer and vehicle too", () => {
    const src = readPortalSource("lib/search-service.ts");
    expect(src).toMatch(/from\("rentals"\)[\s\S]{0,400}inClause\("customer_id", matchedCustomerIds\)/);
    expect(src).toMatch(/from\("rentals"\)[\s\S]{0,400}inClause\("vehicle_id", matchedVehicleIds\)/);
    expect(src).toMatch(/from\("fines"\)[\s\S]{0,600}inClause\("customer_id", matchedCustomerIds\)/);
    expect(src).toMatch(/from\("payments"\)[\s\S]{0,600}amount\.eq\./);
  });

  it("the categories added later are only searched when asked for", () => {
    for (const c of OPT_IN_CATEGORIES) expect(RECORD_CATEGORIES).toContain(c);
    // Everything except the ten the search started with is opt-in.
    const original = ["customers", "vehicles", "rentals", "fines", "payments", "plates", "insurance", "invoices", "insurances", "agreements"];
    expect([...OPT_IN_CATEGORIES].sort()).toEqual(RECORD_CATEGORIES.filter((c) => !original.includes(c)).sort());
    // The other search surface passes no include map and must keep its own queries.
    expect(readPortalSource("components/shared/layout/sidebar-search-scene.tsx")).toContain(
      'searchService.searchAll(term, "all", tenant?.id, tenant?.currency_code || "USD")',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Pinned to the navigation: these fail when the portal gains a place the       */
/* search does not know about.                                                  */
/* -------------------------------------------------------------------------- */

describe("the search does not fall behind the navigation", () => {
  const sidebarHrefs = (file: string) =>
    [...readPortalSource(file).matchAll(/href(?::\s*|=\{?)["'`](\/[a-z0-9/_-]*)["'`]/g)].map((m) => m[1]);

  /** Links that are not places of their own. */
  const NOT_A_DESTINATION = new Set([
    "/cms/about", "/cms/blog", "/cms/contact", "/cms/fleet", "/cms/home", "/cms/privacy", "/cms/promotions",
    "/cms/reviews", "/cms/terms", // the Website view's page list — "Website content" covers it
  ]);

  it.each(["components/shared/layout/app-sidebar.tsx", "components/shared/layout/app-sidebar-v2.tsx"])(
    "every page %s links to is searchable",
    (file) => {
      const known = new Set(PAGE_DESTINATIONS.map((d) => d.href));
      const missing = [...new Set(sidebarHrefs(file))].filter((h) => !known.has(h) && !NOT_A_DESTINATION.has(h));
      expect(missing, `add these to PAGE_DESTINATIONS: ${missing.join(", ")}`).toEqual([]);
    },
  );

  it("the original portal's settings tabs all appear in the search", () => {
    const menu = [...readPortalSource("components/shared/layout/app-sidebar.tsx").matchAll(/\{ value: '([a-z-]+)', icon: \w+, label: '([^']+)' \}/g)];
    expect(menu.length).toBeGreaterThan(20);
    const known = new Map(V1_SETTINGS_TABS.map((t) => [t.value, t.label]));
    for (const [, value, label] of menu) {
      expect(known.has(value), `settings tab "${value}" is missing from V1_SETTINGS_TABS`).toBe(true);
      expect(known.get(value), `label for "${value}"`).toBe(label);
    }
    expect(V1_SETTINGS_TABS.length).toBe(menu.length);
  });

  it("the integration cards match the board and its panels exactly", () => {
    const board = [...readPortalSource("app/(dashboard)/integrations/integrations-board.tsx").matchAll(/\{ name: "([^"]+)", category: "([^"]+)"/g)];
    expect(INTEGRATION_CARDS.map((c) => c.name)).toEqual(board.map(([, name]) => name));
    expect(INTEGRATION_CARDS.map((c) => c.category)).toEqual(board.map(([, , category]) => category));
    // `/integrations?open=<name>` only opens a card the panel registry knows.
    const registry = readPortalSource("app/(dashboard)/integrations/_panels/registry.ts");
    for (const card of INTEGRATION_CARDS) {
      expect(registry.includes(`"${card.name}"`) || registry.includes(`\n  ${card.name}:`), card.name).toBe(true);
    }
  });

  it("the v2 settings index is used as-is, not copied", () => {
    const src = readRepoSource("apps/portal/src/lib/search/portal-destinations.ts");
    expect(src).toContain('import { SETTINGS_INDEX_SECTIONS } from "@/components/settings-v2/settings-index"');
    expect(src).toContain('import { V2_GENERAL_SECTIONS } from "@/components/settings-v2/settings-shell-state"');
  });
});
