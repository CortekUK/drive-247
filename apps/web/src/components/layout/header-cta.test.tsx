// @vitest-environment jsdom

/**
 * The header button: "Book a strategy call", or "Dashboard" for an operator who
 * already pays.
 *
 * WHAT THESE PIN, and each is a way to get a conditional CTA wrong:
 *   - the FIRST paint is always the marketing button, because the page is
 *     static and nobody is known yet;
 *   - a logged-out reader is never asked about — no session, no query;
 *   - a logged-in RENTER (no portal) keeps the marketing button;
 *   - a cancelled operator keeps it too — paying once is not access;
 *   - a failed check falls back to the marketing button rather than an error or
 *     a dead "Dashboard" link.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const supa = vi.hoisted(() => ({
  session: null as unknown,
  rpc: vi.fn(),
  rpcCalls: [] as string[],
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: supa.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    rpc: (fn: string) => {
      supa.rpcCalls.push(fn);
      return supa.rpc();
    },
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { HeaderCta } = await import("./header-cta");

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;

const render = async () => {
  await act(async () => {
    root.render(<HeaderCta />);
  });
  // let the resolve() promise chain settle
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const link = () => container.querySelector("a");

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  supa.session = null;
  supa.rpcCalls = [];
  supa.rpc = vi.fn(async () => ({ data: [], error: null }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("nobody is known at first paint", () => {
  it("renders the strategy call for a logged-out reader", async () => {
    await render();
    expect(link()?.textContent).toBe("Book a strategy call");
    expect(link()?.getAttribute("href")).toBe("/strategy-call");
  });

  it("does not ask the server about a reader with no session", async () => {
    await render();
    expect(supa.rpcCalls).toEqual([]);
  });
});

describe("an operator who already pays", () => {
  beforeEach(() => {
    supa.session = { user: { id: "u1" } };
    supa.rpc = vi.fn(async () => ({
      data: [{ portal_url: "https://acme.portal.drive-247.com", company_name: "Acme", is_active: true }],
      error: null,
    }));
  });

  it("gets a Dashboard button pointing at their own portal", async () => {
    await render();
    expect(link()?.textContent).toBe("Dashboard");
    expect(link()?.getAttribute("href")).toBe("https://acme.portal.drive-247.com");
  });

  it("asks the one function that answers for the caller alone", async () => {
    // Not a table read: app_users and tenant_subscriptions carry colleagues'
    // emails and card details, and the browser is never given either.
    await render();
    expect(supa.rpcCalls).toEqual(["my_portal_access"]);
  });
});

describe("everyone else keeps the marketing button", () => {
  it("a signed-in renter, who has no portal at all", async () => {
    supa.session = { user: { id: "u2" } };
    supa.rpc = vi.fn(async () => ({ data: [], error: null }));
    await render();
    expect(link()?.textContent).toBe("Book a strategy call");
  });

  it("an operator whose subscription is no longer live", async () => {
    // Having paid once is not access. This is the case a naive "do they have a
    // tenant?" check gets wrong.
    supa.session = { user: { id: "u3" } };
    supa.rpc = vi.fn(async () => ({
      data: [{ portal_url: "https://acme.portal.drive-247.com", company_name: "Acme", is_active: false }],
      error: null,
    }));
    await render();
    expect(link()?.textContent).toBe("Book a strategy call");
  });

  it("a check that fails, rather than an error or a dead link", async () => {
    supa.session = { user: { id: "u4" } };
    supa.rpc = vi.fn(async () => ({ data: null, error: { message: "function does not exist" } }));
    await render();
    expect(link()?.textContent).toBe("Book a strategy call");
  });

  it("a check that throws", async () => {
    supa.session = { user: { id: "u5" } };
    supa.rpc = vi.fn(async () => {
      throw new Error("offline");
    });
    await render();
    expect(link()?.textContent).toBe("Book a strategy call");
  });
});
