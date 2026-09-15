/**
 * v2 `/settings/blacklist` (`components/blacklist-v2/global-blacklist-page-v2.tsx`):
 * one test per state. The table itself is stubbed (its own kit is tested in
 * list-table-v2.test.tsx); what matters here is which state renders and that
 * a failed read never shows zeros that look like real data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const search = vi.hoisted(() => ({ reg: undefined as any }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => nav }));
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
vi.mock("@/components/blacklist-v2/global-blacklist-table-v2", () => ({
  GlobalBlacklistTableV2: ({ entries }: { entries: { id: string; email: string | null }[] }) => (
    <ul data-testid="table">
      {entries.map((e) => (
        <li key={e.id}>{e.email ?? "(no email)"}</li>
      ))}
    </ul>
  ),
}));

import { GlobalBlacklistPageV2 } from "@/components/blacklist-v2/global-blacklist-page-v2";

let container: HTMLDivElement;
let root: Root;

const NOW = Date.parse("2026-09-15T00:00:00Z");
const ROWS = [
  {
    id: "a",
    email: "a@example.com",
    blocked_tenant_count: 3,
    first_blocked_at: "2026-08-01T00:00:00Z",
    last_blocked_at: "2026-09-01T00:00:00Z", // 14 days before NOW: counts as recent
    blocking_tenants: [{ tenant_name: "Kedic Rentals", reason: "Unpaid fines", blocked_at: null }],
  },
  {
    id: "b",
    email: null as unknown as string, // a view row with no email must not crash the page
    blocked_tenant_count: 4,
    first_blocked_at: null,
    last_blocked_at: "2026-07-01T00:00:00Z", // 76 days before NOW: not recent
    blocking_tenants: null,
  },
];

function render(props: Partial<React.ComponentProps<typeof GlobalBlacklistPageV2>> = {}) {
  const all = {
    blacklist: ROWS,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    searchTerm: "",
    onSearchChange: vi.fn(),
    expandedIds: new Set<string>(),
    onToggle: vi.fn(),
    now: NOW,
    ...props,
  };
  act(() => root.render(<GlobalBlacklistPageV2 {...(all as any)} />));
  return all;
}

const view = () => container.querySelector("[data-blacklist-view]")?.getAttribute("data-blacklist-view");
const tiles = () => Array.from(container.querySelectorAll("dd")).map((d) => d.textContent);
const button = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(label));

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  search.reg = undefined;
  nav.push.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("GlobalBlacklistPageV2", () => {
  it("first load: a table skeleton, and no search yet", () => {
    render({ blacklist: undefined, isLoading: true });
    expect(view()).toBe("loading");
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="table"]')).toBeNull();
    expect(search.reg).toBeNull();
  });

  it("read failed: the error with Try again, and dashes rather than zeros", () => {
    const props = render({ blacklist: undefined, error: new Error("Failed to fetch") });
    expect(view()).toBe("error");
    expect(container.textContent).toContain("Couldn't load the global blacklist");
    expect(tiles()).toEqual(["—", "—", "—"]);
    act(() => button("Try again")!.click());
    expect(props.refetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="table"]')).toBeNull();
  });

  it("empty: explains how customers get here, with no search box", () => {
    render({ blacklist: [] });
    expect(view()).toBe("empty");
    expect(container.textContent).toContain("No one is on the platform blacklist");
    expect(tiles()).toEqual(["0", "0", "0"]);
    expect(search.reg).toBeNull();
  });

  it("rows: stats worked out by hand, and a row with no email renders", () => {
    render();
    expect(view()).toBe("rows");
    // 2 customers; 3 + 4 = 7 blocks; only row a is inside 30 days.
    expect(tiles()).toEqual(["2", "7", "1"]);
    expect(container.querySelector('[data-testid="table"]')?.textContent).toBe("a@example.com(no email)");
    expect(search.reg?.placeholder).toBe("Search by email, company or reason");
  });

  it("search narrows by company name", () => {
    render({ searchTerm: "kedic" });
    expect(container.querySelector('[data-testid="table"]')?.textContent).toBe("a@example.com");
  });

  it("no match: echoes the search and Clear search empties it", () => {
    const props = render({ searchTerm: "zzz" });
    expect(view()).toBe("no-match");
    expect(container.textContent).toContain("No customers match");
    act(() => button("Clear search")!.click());
    expect(props.onSearchChange).toHaveBeenCalledWith("");
  });

  it("refresh failed with rows cached: keeps the rows under a one-line error", () => {
    render({ error: new Error("Failed to fetch") });
    expect(view()).toBe("error-stale");
    expect(container.textContent).toContain("Couldn't refresh the global blacklist.");
    expect(container.querySelector('[data-testid="table"]')).not.toBeNull();
  });

  it("Back goes to the settings index, not the ?tab=blacklist loop", () => {
    render();
    const back = Array.from(container.querySelectorAll("nav button")).find((b) => b.textContent === "Settings")!;
    act(() => (back as HTMLButtonElement).click());
    expect(nav.push).toHaveBeenCalledWith("/settings");
  });
});
