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

  it("head admin: Business, Pricing (with Promo codes and Extras), Payment plans, Notifications", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    expect(sectionTitles()).toEqual(["Business", "Pricing", "Payment plans", "Notifications"]);
    expect(entries()).toEqual([
      ["General", "/settings?tab=general"],
      ["Branding", "/settings/appearance"],
      ["Locations", "/settings?tab=locations"],
      ["Team", "/users"],
      ["Custom pricing", "/settings?tab=pricing"],
      ["Promo codes", "/settings?tab=promos"],
      ["Extras", "/settings?tab=extras"],
      ["Installments", "/settings?tab=installments"],
      ["Pay as you go", "/settings?tab=payg"],
      ["Auto-extension", "/settings?tab=auto-extend"],
      ["Team emails", "/settings?tab=reminders"],
      ["Push notifications", "/settings?tab=push"],
      ["Customer messages", "/settings?tab=templates"],
    ]);
  });

  it("Team is for head admins only", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" />);
    expect(entries().map(([title]) => title)).not.toContain("Team");
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(container.querySelector('a[href="/users"]')).toBeNull();
  });

  it("no merged page or the global blacklist has an entry of its own", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    const titles = entries().map(([title]) => title);
    for (const gone of [
      "Driver requirements",
      "Booking rules",
      "Key handover",
      "Booking site",
      "Tax and fees",
      "Security deposit",
      "Global blacklist",
      "Pricing rules",
    ]) {
      expect(titles).not.toContain(gone);
    }
    expect(sectionTitles()).not.toContain("Bookings");
    expect(container.querySelector('a[href="/settings/blacklist"]')).toBeNull();
  });

  it("General is listed for a manager who may see only one of its sections", () => {
    // Only the settings.rental grant behind Tax and fees: General (its fees
    // section) and nothing else.
    render(<SettingsIndexV2 canView={(tab) => tab === "fees"} tenantSlug="northwind" isHeadAdmin={false} />);
    expect(entries()).toEqual([["General", "/settings?tab=general"]]);
    expect(container.querySelector('[data-settings-state="empty"]')).toBeNull();
  });

  it("finds General by the words of the sections it now holds", () => {
    render(<SettingsIndexV2 canView={() => true} tenantSlug="northwind" isHeadAdmin />);
    type("deposit");
    expect(entries().map(([title]) => title)).toEqual(["General"]);
    type("buffer");
    expect(entries().map(([title]) => title)).toEqual(["General"]);
    type("lockbox");
    expect(entries().map(([title]) => title)).toEqual(["General", "Customer messages"]);
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
      // Only General spans several permissions; none is head-admin only.
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

    // Promo codes and the payment plans, without Extras or Custom pricing.
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
