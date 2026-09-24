/**
 * v2 Settings index (`components/settings-v2/settings-index.tsx`): what the
 * operator sees when the search finds nothing, when the search names a setting
 * that lives on another screen, when nothing has been shared with a manager,
 * and when a `?tab=` link could not open its page.
 *
 * HARNESS: `react-dom/client` + `act`, as in settings-section-states.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const search = vi.hoisted(() => ({ reg: null as null | { value: string; onChange: (v: string) => void } }));

vi.mock("@/components/shared/layout/page-search-slot", () => ({
  usePageSearch: (reg: any) => {
    search.reg = reg;
  },
}));

vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SettingsIndexV2 } from "@/components/settings-v2/settings-index";

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

function type(value: string) {
  act(() => search.reg!.onChange(value));
}

const text = () => container.textContent ?? "";

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  search.reg = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SettingsIndexV2 states", () => {
  it("lists the sections with no state when nothing is typed", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" />);
    expect(text()).toContain("Business");
    expect(container.querySelector('[data-settings-state="no-match"]')).toBeNull();
    expect(container.querySelector('[data-settings-state="empty"]')).toBeNull();
    expect(container.querySelector('[data-settings-state="dependency"]')).toBeNull();
  });

  it("a search with no match echoes the query and Clear search restores the list", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" />);
    type("zzqx");
    const noMatch = container.querySelector('[data-settings-state="no-match"]');
    expect(noMatch?.textContent).toContain("No settings match");
    expect(noMatch?.textContent).toContain("zzqx");
    expect(text()).not.toContain("Business");

    const clear = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Clear search")!;
    act(() => clear.click());
    expect(container.querySelector('[data-settings-state="no-match"]')).toBeNull();
    expect(text()).toContain("Business");
    expect(search.reg!.value).toBe("");
  });

  it("a search for Stripe points at Integrations instead of dead-ending", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" />);
    type("stripe");
    const hint = container.querySelector('[data-settings-state="dependency"]');
    expect(hint?.textContent).toContain("Looking for Payments?");
    expect(hint?.querySelector("a")?.getAttribute("href")).toBe("/integrations");
    expect(container.querySelector('[data-settings-state="no-match"]')).not.toBeNull();
  });

  it("a manager with nothing shared sees why, not a no-match", () => {
    render(<SettingsIndexV2 canView={() => false} tenantSlug="northwind" />);
    const empty = container.querySelector('[data-settings-state="empty"]');
    expect(empty?.textContent).toContain("No settings have been shared with you");
    expect(container.querySelector('[data-settings-state="no-match"]')).toBeNull();
  });

  it("renders the deep-link notice under the title", () => {
    render(
      <SettingsIndexV2
        canView={() => true}
        tenantSlug="northwind"
        notice={<p data-testid="notice">You don&apos;t have access to Tax and fees</p>}
      />,
    );
    expect(container.querySelector('[data-testid="notice"]')?.textContent).toBe("You don't have access to Tax and fees");
  });
});

describe("SettingsIndexV2 look", () => {
  it("the Settings title is bold and each section title semibold, with no line under them", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" />);
    const h1 = container.querySelector("h1")!;
    expect(h1.textContent).toBe("Settings");
    expect(h1.className.split(" ")).toEqual(expect.arrayContaining(["font-bold", "text-2xl", "font-heading"]));
    const h2 = container.querySelector("section h2")!;
    expect(h2.className.split(" ")).toEqual(expect.arrayContaining(["font-semibold", "font-heading"]));
    expect(h2.className).not.toContain("border-b");
  });

  it("every entry row hovers light purple (never grey) and is rounded-xl", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" />);
    const rows = Array.from(container.querySelectorAll("section a"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cls = row.className.split(/\s+/);
      expect(cls).toContain("rounded-xl");
      expect(cls).toContain("hover:bg-primary/10");
      expect(cls).toContain("dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]");
      expect(cls).not.toContain("hover:bg-muted");
      expect(cls).not.toContain("rounded-lg");
    }
  });
});

describe("SettingsIndexV2 structure", () => {
  const sectionTitles = () => Array.from(container.querySelectorAll("section h2")).map((h) => h.textContent);
  const entries = () =>
    Array.from(container.querySelectorAll("section a")).map((a) => [a.querySelector("span")?.textContent, a.getAttribute("href")]);

  it("head admin: Business, Pricing (Tax and deposit first, Weekend and holiday pricing last), Payment plans, Notifications", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    expect(sectionTitles()).toEqual(["Business", "Pricing", "Payment plans", "Notifications"]);
    expect(entries()).toEqual([
      ["General", "/settings?tab=general"],
      ["Branding", "/settings/appearance"],
      ["Locations", "/settings?tab=locations"],
      // Out of General into pages of their own (Sep 19 2026).
      ["Booking rules", "/settings?tab=duration"],
      ["Lockbox", "/settings?tab=lockbox"],
      ["Booking site", "/settings?tab=booking-site"],
      ["Optional modules", "/settings?tab=modules"],
      ["Team", "/users"],
      // Moved here from the v2 org menu on Sep 20 2026, and gated on the same
      // `audit_logs` manager grant it had there — through `canAccessRoute`,
      // which this render leaves at its permissive default.
      ["Audit Logs", "/audit-logs"],
      // Tax and deposit's ENTRY moved out of Business into Pricing, first
      // (ticket item 1). The page and all three of its aliases are unchanged.
      ["Tax and deposit", "/settings?tab=tax-and-deposit"],
      ["Promo codes", "/settings?tab=promos"],
      ["Extras", "/settings?tab=extras"],
      ["Weekend and holiday pricing", "/settings?tab=pricing"],
      ["Installments", "/settings?tab=installments"],
      ["Pay as you go", "/settings?tab=payg"],
      ["Auto-extension", "/settings?tab=auto-extend"],
      ["Notifications", "/settings?tab=notifications"],
      // Agreement templates moved to the Agreements tab (Agreements v2, D1), and
      // Customer messages off the index entirely (Sep 24 2026) — it is edited
      // from the tab that sends the message.
    ]);
  });

  it("Notifications is one entry (Team emails and Push notifications are part of it), and the last group", async () => {
    const { SETTINGS_INDEX_SECTIONS } = await import("@/components/settings-v2/settings-index");
    const titles = SETTINGS_INDEX_SECTIONS.map((section) => section.title);
    expect(titles.indexOf("Notifications")).toBe(titles.length - 1);
    const notifications = SETTINGS_INDEX_SECTIONS.find((section) => section.title === "Notifications")!;
    expect(notifications.items.map((item) => [item.title, item.href, item.tab])).toEqual([
      ["Notifications", "/settings?tab=notifications", "notifications"],
    ]);
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    const hrefs = entries().map(([, href]) => href);
    expect(hrefs).not.toContain("/settings?tab=reminders");
    expect(hrefs).not.toContain("/settings?tab=push");
  });

  it("finds Notifications by the words of what it now holds", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    for (const words of ["team emails", "push notifications", "reminders", "sender", "from address", "bell", "in-app", "reply to"]) {
      type(words);
      expect(entries().map(([title]) => title), words).toContain("Notifications");
    }
  });

  it("Notifications follows its own permission; the templates have no card to follow", () => {
    render(<SettingsIndexV2 canView={(tab) => tab === "notifications"} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(entries()).toEqual([["Notifications", "/settings?tab=notifications"]]);
    act(() => root.unmount());
    root = createRoot(container);
    /*
     * The Templates card came off the index on Sep 24 2026: the messages are
     * edited from the tab that sends them (Lockbox has its own Templates
     * button), and a second door from the index only asked people to guess
     * which one was current. Holding the templates permission and nothing else
     * therefore shows an empty index here, NOT a Templates group. The page
     * itself is untouched and ?tab=templates still opens it.
     */
    render(<SettingsIndexV2 canView={(tab) => tab === "templates"} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(sectionTitles()).toEqual([]);
    expect(entries()).toEqual([]);
  });

  it("has no Agreement templates entry: the templates live on the Agreements tab (Agreements v2, D1)", async () => {
    const { SETTINGS_INDEX_SECTIONS } = await import("@/components/settings-v2/settings-index");
    const every = SETTINGS_INDEX_SECTIONS.flatMap((section) => section.items);
    expect(every.map((item) => item.title)).not.toContain("Agreement templates");
    expect(every.map((item) => item.href)).not.toContain("/settings/agreement-templates");
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    expect(container.querySelector('a[href^="/settings/agreement-templates"]')).toBeNull();
  });

  it("Team is for head admins only", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" />);
    expect(entries().map(([title]) => title)).not.toContain("Team");
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(container.querySelector('a[href="/users"]')).toBeNull();
  });

  it("no tab of General, no half of Tax and deposit, and not the global blacklist has an entry of its own", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    const titles = entries().map(([title]) => title);
    for (const gone of [
      "Regional",
      "Driver requirements",
      "Key handover",
      "Tax and fees",
      "Security deposit",
      "Global blacklist",
      "Pricing rules",
      "Custom pricing",
      "Monthly rate",
      // The parallel entry this ticket briefly had; there is one Tax entry now.
      "Tax, fees and deposit",
    ]) {
      expect(titles).not.toContain(gone);
    }
    expect(sectionTitles()).not.toContain("Bookings");
    expect(container.querySelector('a[href="/settings/blacklist"]')).toBeNull();
  });

  it("a page made of sections is listed for a manager who may see only one of them", () => {
    // Only the grant behind Tax and fees: Tax and deposit, and nothing else.
    render(<SettingsIndexV2 canView={(tab) => tab === "fees"} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(entries()).toEqual([["Tax and deposit", "/settings?tab=tax-and-deposit"]]);
    expect(container.querySelector('[data-settings-state="empty"]')).toBeNull();

    // Only the grant behind Security deposit: the same page.
    act(() => root.unmount());
    root = createRoot(container);
    render(<SettingsIndexV2 canView={(tab) => tab === "preauth"} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(entries()).toEqual([["Tax and deposit", "/settings?tab=tax-and-deposit"]]);

    // Only the grant behind Driver requirements: General (its second tab).
    act(() => root.unmount());
    root = createRoot(container);
    render(<SettingsIndexV2 canView={(tab) => tab === "requirements"} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(entries()).toEqual([["General", "/settings?tab=general"]]);
  });

  it("each page that came out of General follows its own permission", () => {
    // Booking rules and Lockbox only.
    const granted = new Set(["duration", "lockbox"]);
    render(<SettingsIndexV2 canView={(tab) => granted.has(tab)} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(entries()).toEqual([
      ["Booking rules", "/settings?tab=duration"],
      ["Lockbox", "/settings?tab=lockbox"],
    ]);

    // General's own grant: General, Booking site and Optional modules (both
    // follow it), and none of the others.
    act(() => root.unmount());
    root = createRoot(container);
    render(<SettingsIndexV2 canView={(tab) => tab === "general"} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(entries()).toEqual([
      ["General", "/settings?tab=general"],
      ["Booking site", "/settings?tab=booking-site"],
      ["Optional modules", "/settings?tab=modules"],
    ]);
  });

  it("the pricing permission lists Weekend and holiday pricing, and General for the monthly rate", () => {
    // The monthly rate is a section of General under the `pricing` grant, so
    // that grant alone opens General — and Weekend and holiday pricing, which
    // it has always opened.
    render(<SettingsIndexV2 canView={(tab) => tab === "pricing"} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(entries()).toEqual([
      ["General", "/settings?tab=general"],
      ["Weekend and holiday pricing", "/settings?tab=pricing"],
    ]);
    expect(sectionTitles()).toEqual(["Business", "Pricing"]);
  });


  it("leaves out an entry the page says has nothing behind it (Optional modules with no module)", () => {
    render(
      <SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin hiddenHrefs={["/settings?tab=modules"]} />,
    );
    const titles = entries().map(([title]) => title);
    expect(titles).not.toContain("Optional modules");
    expect(titles).toContain("Booking site");
    type("turo");
    expect(container.querySelector('[data-settings-state="no-match"]')).not.toBeNull();
  });

  it("finds each page by the words of what it holds", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    type("deposit");
    expect(entries().map(([title]) => title)).toEqual(["Tax and deposit"]);
    type("vat");
    expect(entries().map(([title]) => title)).toEqual(["Tax and deposit"]);
    type("preauth");
    expect(entries().map(([title]) => title)).toEqual(["Tax and deposit"]);
    type("buffer");
    expect(entries().map(([title]) => title)).toEqual(["Booking rules"]);
    type("lockbox");
    // Customer messages used to answer this search too; it is off the index
    // since Sep 24 2026, and the Lockbox page carries its own Templates button.
    expect(entries().map(([title]) => title)).toEqual(["Lockbox"]);
    type("licence");
    expect(entries().map(([title]) => title)).toEqual(["General"]);
    type("monthly rate");
    expect(entries().map(([title]) => title)).toEqual(["General"]);
    type("breakdown");
    expect(entries().map(([title]) => title)).toEqual(["Booking site"]);
    type("turo");
    expect(entries().map(([title]) => title)).toEqual(["Optional modules"]);
    type("holiday");
    expect(entries().map(([title]) => title)).toEqual(["Weekend and holiday pricing"]);
    type("surcharge");
    expect(entries().map(([title]) => title)).toEqual(["Weekend and holiday pricing"]);
    // The old name still finds the renamed page.
    type("custom pricing");
    expect(entries().map(([title]) => title)).toEqual(["Weekend and holiday pricing"]);
  });

  it("Tax and deposit and Weekend and holiday pricing: titles, links, permissions and descriptions", async () => {
    const { SETTINGS_INDEX_SECTIONS } = await import("@/components/settings-v2/settings-index");
    const pricing = SETTINGS_INDEX_SECTIONS.find((section) => section.title === "Pricing")!;
    // Tax and deposit is FIRST under Pricing (ticket item 1, "fees, tax and
    // deposit become a rule inside Pricing, next to custom pricing"), and the
    // renamed weekend page is last.
    expect(pricing.items.map((item) => item.title)).toEqual([
      "Tax and deposit",
      "Promo codes",
      "Extras",
      "Weekend and holiday pricing",
    ]);
    const fees = pricing.items[0];
    // The page, its key and every alias are unchanged: only the entry moved.
    expect([fees.href, fees.tab, fees.anyOfTabs]).toEqual(["/settings?tab=tax-and-deposit", "fees", ["fees", "preauth"]]);
    const weekend = pricing.items[3];
    expect([weekend.href, weekend.tab, weekend.anyOfTabs]).toEqual(["/settings?tab=pricing", "pricing", undefined]);
    // Business no longer lists it.
    const business = SETTINGS_INDEX_SECTIONS.find((section) => section.title === "Business")!;
    expect(business.items.map((item) => item.title)).not.toContain("Tax and deposit");
    // General no longer claims tax or deposits, and names the monthly rate.
    const general = business.items.find((item) => item.title === "General")!;
    expect(general.description).toContain("monthly rate");
    expect(`${general.description} ${general.keywords}`).not.toMatch(/\b(tax|vat|deposit|preauth)\b/i);
    // Regional, Driver requirements and Monthly rate.
    expect(general.anyOfTabs).toEqual(["general", "requirements", "pricing"]);
  });

  it("a head admin finds Team by 'password'; anyone else gets no match and no hand-off", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    type("password");
    expect(entries().map(([title]) => title)).toEqual(["Team"]);
    act(() => root.unmount());
    root = createRoot(container);
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" />);
    type("password");
    expect(container.querySelector('[data-settings-state="no-match"]')).not.toBeNull();
    expect(container.querySelector('[data-settings-state="dependency"]')).toBeNull();
  });

  it("the five pages that were hidden are listed again, each with its title, link and own permission", async () => {
    const { SETTINGS_INDEX_SECTIONS } = await import("@/components/settings-v2/settings-index");
    const byTitle = new Map(SETTINGS_INDEX_SECTIONS.flatMap((section) => section.items.map((item) => [item.title, { ...item, section: section.title }])));
    // Written out by hand: title -> [section, href, permission tab].
    const expected: Array<[string, string, string, string]> = [
      ["Promo codes", "Pricing", "/settings?tab=promos", "promos"],
      ["Extras", "Pricing", "/settings?tab=extras", "extras"],
      ["Installments", "Payment plans", "/settings?tab=installments", "installments"],
      ["Pay as you go", "Payment plans", "/settings?tab=payg", "payg"],
      ["Auto-extension", "Payment plans", "/settings?tab=auto-extend", "auto-extend"],
    ];
    for (const [title, section, href, tab] of expected) {
      const item = byTitle.get(title);
      expect(item, title).toBeDefined();
      expect(item!.section, title).toBe(section);
      expect(item!.href, title).toBe(href);
      expect(item!.tab, title).toBe(tab);
      // Only the sectioned pages (General, Tax and deposit) span several
      // permissions; none of these is head-admin only.
      expect(item!.anyOfTabs, title).toBeUndefined();
      expect(item!.headAdminOnly, title).toBeUndefined();
      expect(item!.description.length, title).toBeGreaterThanOrEqual(95);
      expect(item!.description.length, title).toBeLessThanOrEqual(120);
    }
  });

  it("each of them is listed only for someone who may view its tab", () => {
    // A manager with the Extras grant only: Pricing holds just Extras.
    render(<SettingsIndexV2 canView={(tab) => tab === "extras"} tenantSlug="northwind" />);
    expect(sectionTitles()).toEqual(["Pricing"]);
    expect(entries()).toEqual([["Extras", "/settings?tab=extras"]]);

    // Promo codes and the payment plans, without Extras or the pricing pages.
    act(() => root.unmount());
    root = createRoot(container);
    const granted = new Set(["promos", "installments", "payg", "auto-extend"]);
    render(<SettingsIndexV2 canView={(tab) => granted.has(tab)} tenantSlug="northwind" />);
    expect(sectionTitles()).toEqual(["Pricing", "Payment plans"]);
    expect(entries()).toEqual([
      ["Promo codes", "/settings?tab=promos"],
      ["Installments", "/settings?tab=installments"],
      ["Pay as you go", "/settings?tab=payg"],
      ["Auto-extension", "/settings?tab=auto-extend"],
    ]);

    // No grant for any of the five: none of them shows.
    act(() => root.unmount());
    root = createRoot(container);
    render(<SettingsIndexV2 canView={(tab) => tab === "general"} tenantSlug="northwind" />);
    for (const title of ["Promo codes", "Extras", "Installments", "Pay as you go", "Auto-extension"]) {
      expect(entries().map(([t]) => t)).not.toContain(title);
    }
  });

  it("finds them by the words an operator would type", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    type("coupon");
    expect(entries().map(([title]) => title)).toEqual(["Promo codes"]);
    type("child seat");
    expect(entries().map(([title]) => title)).toEqual(["Extras"]);
    type("instalment");
    expect(entries().map(([title]) => title)).toEqual(["Installments"]);
    type("renew");
    expect(entries().map(([title]) => title)).toEqual(["Auto-extension"]);
    type("payg");
    expect(entries().map(([title]) => title)).toEqual(["Pay as you go"]);
  });

  /**
   * Team lead, Sep 2026, with a screenshot of the index: hovering a card
   * underlined its title. The whole card is the target and it already tints on
   * hover, which is the signal he asked for; an underline made the title read as
   * a word inside a sentence. Keyboard users get a ring instead, which the
   * hover-only underline never gave them.
   */
  it("never underlines a card title on hover, and still reads as clickable", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    const cards = Array.from(container.querySelectorAll<HTMLAnchorElement>("section a"));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const title = card.querySelectorAll("span")[0];
      expect(title.className, card.textContent ?? "").not.toContain("underline");
      // The hover tint (both themes) and the keyboard ring stay on the card.
      expect(card.className).toContain("hover:bg-primary/10");
      expect(card.className).toContain("dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]");
      expect(card.className).toContain("focus-visible:ring-3");
      expect(card.className).toContain("focus-visible:ring-ring/30");
    }
    /*
     * There is no prose under the sections any more. The footer sentence
     * ("Payments, insurance, e-signatures and text messages are set up in
     * Integrations") came off on Sep 24 2026 — it was a rule to read rather
     * than a place to go, and a search for any of those words already hands
     * the reader straight to Integrations (see the handoff tests above).
     */
    expect(container.querySelectorAll("p a")).toHaveLength(0);
    expect(container.textContent).not.toContain("are set up in");
  });

  it("every description is 95–120 characters and wraps in a 320px column", async () => {
    const { SETTINGS_INDEX_SECTIONS } = await import("@/components/settings-v2/settings-index");
    for (const section of SETTINGS_INDEX_SECTIONS) {
      for (const item of section.items) {
        expect(item.description.length, item.title).toBeGreaterThanOrEqual(95);
        expect(item.description.length, item.title).toBeLessThanOrEqual(120);
      }
    }
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    for (const a of Array.from(container.querySelectorAll("section a"))) {
      expect(a.querySelectorAll("span")[1].className).toContain("max-w-[320px]");
    }
  });
});
