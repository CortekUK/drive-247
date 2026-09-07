/**
 * Pinning on the Integrations board, rendered rather than reasoned about.
 *
 * Four promises are made to the operator, and each one is a separate way this
 * can go wrong:
 *
 *   1. Pinning floats the card to the top, under a "Pinned" heading.
 *   2. Unpinning returns it to its DEFAULT position — not to the end, and not
 *      somewhere new.
 *   3. The pin control does not fight the card. Clicking it must pin and must
 *      NOT open the panel behind it; the card body must still open the panel.
 *   4. With nothing pinned, the board is byte-for-byte the board it was before
 *      this feature existed — one grid, no headings, no empty "Pinned" section.
 *
 * Plus the two failure modes storage actually has: a bucket belonging to
 * another tenant or another user must never be read, and storage that throws
 * must leave every card on screen in the default order.
 *
 * HARNESS: `react-dom/client` + `act`, matching
 * `integrations-board-cmd-gate.test.tsx` — the repo lacks `@testing-library/dom`,
 * so `@testing-library/react`'s `render()` throws at import.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { IntegrationsBoard } from "@/app/(dashboard)/integrations/integrations-board";
import { integrationPinsKey } from "@/app/(dashboard)/integrations/integration-pins";

let tenantId = "tenant-a";
let appUserId: string | null = "user-1";

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({
    tenant: { id: tenantId, slug: "northwind" },
    tenantSlug: "northwind",
  }),
}));

// The board reads only the logged-in user's id, through a narrow selector.
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: { appUser: { id: string } | null }) => unknown) =>
    selector({ appUser: appUserId ? { id: appUserId } : null }),
}));

/** Answers any Supabase chain without touching the network. See the cmd-gate file. */
function chainable(): any {
  const result = { data: null, error: null, count: 0 };
  const target: any = () => target;
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then")
        return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      return () => chainable();
    },
    apply: () => chainable(),
  });
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => chainable(),
    storage: { from: () => chainable() },
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  },
  supabaseUntyped: {
    from: () => chainable(),
    storage: { from: () => chainable() },
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Descriptions, in the order the board declares them. Unique, always text. */
const TURO = "Pull your Turo trips in and stop double-booking.";
const STRIPE = "Accept booking payments, deposits & payouts.";
const SQUARE = "Take booking payments through your Square account.";
const ZOHO = "Sync books & CRM with Zoho.";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  tenantId = "tenant-a";
  appUserId = "user-1";
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function render(): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <IntegrationsBoard />
      </QueryClientProvider>,
    );
  });
  return container.textContent ?? "";
}

function click(el: Element | null): string {
  if (!el) throw new Error("nothing to click");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  return container.textContent ?? "";
}

const pinButton = (name: string) =>
  container.querySelector(`[aria-label="Pin ${name}"]`);
const unpinButton = (name: string) =>
  container.querySelector(`[aria-label="Unpin ${name}"]`);

/** Card order, as the operator reads down the page. */
const order = (text: string, ...descriptions: string[]) =>
  descriptions.map((d) => text.indexOf(d));

const isAscending = (positions: number[]) =>
  positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]));

describe("IntegrationsBoard — pinning", () => {
  it("looks exactly like it always did when nothing is pinned", () => {
    const text = render();

    // No heading of any kind, and certainly no empty "Pinned" section.
    expect(text).not.toContain("Pinned");
    expect(text).not.toContain("All integrations");
    // Every card gets an (unpinned) pin control; none is in the pinned state.
    expect(pinButton("Turo Sync")).not.toBeNull();
    expect(container.querySelectorAll('[aria-pressed="true"]').length).toBe(0);
    expect(isAscending(order(text, TURO, STRIPE, SQUARE, ZOHO))).toBe(true);
  });

  it("floats a pinned card to the top, under a Pinned heading", () => {
    render();
    const text = click(pinButton("Zoho"));

    expect(text).toContain("Pinned");
    expect(text).toContain("All integrations");
    // Zoho was last; it now precedes the first card of the main grid.
    expect(isAscending(order(text, ZOHO, TURO, STRIPE))).toBe(true);
    expect(unpinButton("Zoho")).not.toBeNull();
  });

  it("keeps pinned cards ahead of Turo Sync, which is otherwise first", () => {
    // The board puts Turo Sync first on purpose. A shortlist the operator built
    // by hand still outranks a default we chose for them.
    render();
    const text = click(pinButton("Square"));
    expect(isAscending(order(text, SQUARE, TURO))).toBe(true);
  });

  it("returns an unpinned card to its DEFAULT position, not to the end", () => {
    render();
    // Pin the last card, then the second — both leave their slots.
    click(pinButton("Zoho"));
    let text = click(pinButton("Stripe Connect"));
    // Inside the pinned row the board's own order is kept: Stripe before Zoho.
    expect(isAscending(order(text, STRIPE, ZOHO, TURO))).toBe(true);

    text = click(unpinButton("Zoho"));
    // Zoho is back at the bottom of the main grid, behind Square.
    expect(isAscending(order(text, STRIPE, TURO, SQUARE, ZOHO))).toBe(true);

    text = click(unpinButton("Stripe Connect"));
    // Everything is home, and the headings are gone with the last pin.
    expect(text).not.toContain("Pinned");
    expect(isAscending(order(text, TURO, STRIPE, SQUARE, ZOHO))).toBe(true);
  });

  it("survives a reload — the pin is on disk, under the tenant+user key", () => {
    render();
    click(pinButton("Square"));

    expect(
      JSON.parse(window.localStorage.getItem(integrationPinsKey("tenant-a", "user-1"))!),
    ).toEqual(["Square"]);

    // Remount from scratch: the board reads the shortlist back.
    act(() => root.unmount());
    root = createRoot(container);
    expect(isAscending(order(render(), SQUARE, TURO))).toBe(true);
  });

  it("does not open the panel when the pin is clicked", () => {
    // The pin is a real <button> inside a card whose whole body opens a
    // dialog. Without `stopPropagation` every pin would also open a panel.
    render();
    click(pinButton("Turo Sync"));
    expect(document.body.textContent ?? "").not.toContain("Turo publishes no API at all");
  });

  // Generous timeout, and only here: this is the one case that actually mounts
  // the Radix dialog, which in jsdom costs seconds rather than milliseconds —
  // enough to trip the 5s default on a loaded machine. The assertion is worth
  // keeping at that price; the flake is not.
  it("still opens the panel when the card body is clicked", () => {
    // The negative above would pass on a board whose cards had stopped opening
    // at all, so prove the click path is alive.
    const text = render();
    expect(text).toContain(TURO);
    const body = container.querySelector('[data-slot="card-content"]');
    click(body);
    expect(document.body.textContent ?? "").toContain("Turo publishes no API at all");
  }, 30_000);

  it("never serves another tenant's shortlist", () => {
    // A super admin hopping tenants must see each tenant's own board.
    window.localStorage.setItem(
      integrationPinsKey("tenant-b", "user-1"),
      JSON.stringify(["Zoho"]),
    );
    tenantId = "tenant-a";
    const text = render();
    expect(text).not.toContain("Pinned");
    expect(isAscending(order(text, TURO, ZOHO))).toBe(true);
  });

  it("never serves another user's shortlist on the same tenant", () => {
    // Two operators on one tenant have different jobs. One of them re-ordering
    // the other's board every morning is worse than no feature.
    window.localStorage.setItem(
      integrationPinsKey("tenant-a", "user-2"),
      JSON.stringify(["Zoho"]),
    );
    appUserId = "user-1";
    const text = render();
    expect(text).not.toContain("Pinned");
    expect(isAscending(order(text, TURO, ZOHO))).toBe(true);
  });

  it("renders the whole board when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const text = render();
    expect(text).toContain("Integrations");
    expect(isAscending(order(text, TURO, STRIPE, SQUARE, ZOHO))).toBe(true);
    // And a click on the pin still cannot take the board down.
    expect(() => click(pinButton("Square"))).not.toThrow();
  });

  it("ignores a hand-edited value that is not a list of real cards", () => {
    window.localStorage.setItem(
      integrationPinsKey("tenant-a", "user-1"),
      JSON.stringify(["Zoho", "A Card That Does Not Exist", 7]),
    );
    const text = render();
    // The real name is honoured; the junk contributes no phantom card.
    expect(text).toContain("Pinned");
    expect(text).not.toContain("A Card That Does Not Exist");
    expect(isAscending(order(text, ZOHO, TURO))).toBe(true);
  });
});
