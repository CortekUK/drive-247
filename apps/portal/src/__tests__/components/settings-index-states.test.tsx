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
