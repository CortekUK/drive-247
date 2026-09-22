/**
 * Premium integrations on the Integrations board, rendered
 * (docs/integration-billing/build-spec.md, D9, D10).
 *
 * For northwind, with a catalog that makes Inshur premium ($20, first month
 * free), Turo Sync beta, Tesla not available and Zoho hidden:
 *   - Inshur's card carries a crown, Turo Sync's a Beta pill;
 *   - Tesla is dimmed and says "Not available";
 *   - Zoho is not on the board at all;
 *   - one line says what the crown means (and there is no filter);
 *   - Inshur's dialog opens on the price and a Subscribe button, with the
 *     panel read-only under it; Subscribe swaps in the confirm step with
 *     "$20.00 will be added to your next bill" wording and the card on file.
 * For every other tenant the same catalog changes nothing.
 *
 * HARNESS: `react-dom/client` + `act`, as integrations-board-pins.test.tsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { IntegrationsBoard } from "@/app/(dashboard)/integrations/integrations-board";

let slug = "northwind";

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "tenant-a", slug }, tenantSlug: slug }),
}));

vi.mock("@/stores/auth-store", () => {
  const state = { appUser: { id: "user-1", role: "admin" }, user: { id: "auth-1" }, session: { access_token: "t" } };
  return {
    useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
    useAuth: () => state,
  };
});

vi.mock("@/hooks/use-tenant-subscription", () => ({
  useTenantSubscription: () => ({
    subscription: {
      status: "active",
      interval: "month",
      currency: "usd",
      current_period_end: "2026-10-15T12:00:00.000Z",
      trial_end: null,
      cancel_at: null,
      canceled_at: null,
      card_brand: "visa",
      card_last4: "4242",
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canEdit: () => true, canView: () => true }),
}));

let catalogRows: any[] = [];
let subRows: any[] = [];
let livePlanRows: any[] = [{ stripe_subscription_id: "sub_platform" }];

const CATALOG = [
  { integration_key: "square", is_premium: true, monthly_price_cents: 2000, currency: "usd", first_month_free: true },
  // A "coming soon" preview may be priced, but cannot be sold.
  { integration_key: "inshur", is_premium: true, monthly_price_cents: 2000, currency: "usd", first_month_free: false },
  { integration_key: "turo_sync", is_beta: true },
  { integration_key: "tesla", is_unavailable: true },
  { integration_key: "zoho", is_hidden: true },
];

/** Answers any Supabase chain; the two integration-billing tables get their fixtures. */
function chainable(result: { data: unknown; error: unknown } = { data: null, error: null }): any {
  const target: any = () => target;
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      return () => chainable(result);
    },
    apply: () => chainable(result),
  });
}
const fromTable = (table: string) =>
  table === "integration_catalog_v2"
    ? chainable({ data: catalogRows, error: null })
    : table === "tenant_integration_subscriptions_v2"
      ? chainable({ data: subRows, error: null })
      : table === "tenant_subscriptions"
      ? chainable({ data: livePlanRows, error: null })
      : // The real tenant row always exists; panels' chips read columns off it.
        table === "tenants"
        ? chainable({ data: {}, error: null })
        : chainable();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => fromTable(t),
    storage: { from: () => chainable() },
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  },
  supabaseUntyped: {
    from: (t: string) => fromTable(t),
    storage: { from: () => chainable() },
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const INSHUR = "Fleet insurance for your vehicles between rentals.";
const SQUARE = "Take booking payments through your Square account.";
const TURO = "Pull your Turo trips in and stop double-booking.";
const TESLA = "Supercharging & vehicle data via the Fleet API.";
const ZOHO = "Sync books & CRM with Zoho.";
const LEGEND = "Premium integrations are billed monthly on your Drive247 bill once you subscribe.";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  slug = "northwind";
  catalogRows = CATALOG;
  subRows = [];
  livePlanRows = [{ stripe_subscription_id: "sub_platform" }];
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(): Promise<string> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <IntegrationsBoard />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return container.textContent ?? "";
}

/** The card whose description is `description`. */
const cardOf = (description: string): HTMLElement | null => {
  const p = [...container.querySelectorAll("p")].find((el) => el.textContent === description);
  return (p?.closest("[data-slot='card']") as HTMLElement | null) ?? (p?.parentElement?.parentElement as HTMLElement | null) ?? null;
};

async function click(el: Element | null) {
  if (!el) throw new Error("nothing to click");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("IntegrationsBoard — premium integrations (northwind)", () => {
  it("marks premium with a crown, beta with a pill, dims not-available and hides hidden", async () => {
    const text = await render();
    expect(text).toContain(INSHUR);
    expect(cardOf(INSHUR)?.querySelector('[title="Premium integration"]')).not.toBeNull();
    expect(cardOf(TURO)?.textContent).toContain("Beta");
    expect(cardOf(TURO)?.querySelector('[title="Premium integration"]')).toBeNull();
    expect(cardOf(TESLA)?.className).toContain("opacity-60");
    expect(cardOf(TESLA)?.textContent).toContain("Not available");
    expect(text).not.toContain(ZOHO);
    expect(text).toContain(LEGEND);
    // No free/premium filter: nothing to toggle between the two.
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it("shows the Beta flag in the dialog title too", async () => {
    await render();
    await click(cardOf(TURO));
    const title = document.body.querySelector('[role="dialog"] h2') as HTMLElement;
    expect(title.textContent).toContain("Turo Sync");
    expect(title.textContent).toContain("Beta");
  });

  it("Not available: the dialog says so and the panel is locked, with nothing to buy", async () => {
    await render();
    await click(cardOf(TESLA));
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Tesla isn\u2019t available right now. You can still read about it below.");
    expect(dialog.textContent).toContain("Not available");
    expect(dialog.querySelector("fieldset[disabled]")).not.toBeNull();
    expect([...dialog.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Subscribe")).toBe(false);
  });

  it("shows a coming-soon preview's price, but never a live Subscribe", async () => {
    await render();
    expect(cardOf(INSHUR)?.querySelector('[title="Premium integration"]')).not.toBeNull();
    await click(cardOf(INSHUR));
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Premium · $20.00/month");
    expect(dialog.textContent).toContain("Inshur is coming soon.");
    const button = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Coming soon");
    expect(button?.disabled).toBe(true);
    expect([...dialog.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Subscribe")).toBe(false);
  });

  it("opens a premium dialog on the price and Subscribe, with the panel read-only below", async () => {
    await render();
    await click(cardOf(SQUARE));
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("Premium · $20.00/month");
    expect(dialog.textContent).toContain("First month free. Then $20.00 a month, added to your Drive247 bill.");
    const subscribe = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Subscribe");
    expect(subscribe).toBeDefined();
    expect(subscribe!.disabled).toBe(false);
    expect(dialog.querySelector("fieldset[disabled]")).not.toBeNull();

    // Subscribe → the confirm step, inside the same dialog.
    await click(subscribe!);
    const confirm = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(confirm.textContent).toContain("Subscribe to Square");
    expect(confirm.textContent).toContain("Visa •••• 4242");
    expect(confirm.textContent).toContain("Oct 15, 2026");
    expect(confirm.textContent).toContain("Nothing is charged today.");
    expect([...confirm.querySelectorAll("button")].some((b) => b.textContent === "Subscribe for $20.00/month")).toBe(true);
    // The panel is not rendered under the confirm step, so there is nothing to scroll.
    expect(confirm.querySelector("fieldset[disabled]")).toBeNull();
  });
});

describe("IntegrationsBoard — the defaults, before a super admin saves anything", () => {
  it("crowns Inshur, Turo Sync and CheckMyDriver as coming-soon premium, price to be announced", async () => {
    catalogRows = [];
    await render();
    for (const description of [INSHUR, TURO, "Verify driver's licenses & identity."]) {
      expect(cardOf(description)?.querySelector('[title="Premium integration"]')).not.toBeNull();
    }
    expect(cardOf(SQUARE)?.querySelector('[title="Premium integration"]')).toBeNull();
    expect(container.textContent).toContain(LEGEND);
    await click(cardOf(TURO));
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Premium · Price to be announced");
    expect(dialog.textContent).toContain("Turo Sync is coming soon. Nothing is charged unless you subscribe after it launches.");
    expect(dialog.textContent).toContain("If you subscribe, its monthly price is added to your Drive247 bill as its own line.");
    expect([...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Coming soon")?.disabled).toBe(true);
  });
});

describe("IntegrationsBoard — every other tenant", () => {
  it("ignores the catalog entirely", async () => {
    slug = "goniko";
    const text = await render();
    expect(text).toContain(ZOHO);
    expect(text).not.toContain(LEGEND);
    expect(container.querySelector('[title="Premium integration"]')).toBeNull();
    expect(cardOf(TURO)?.textContent).not.toContain("Beta");
  });
});

describe("IntegrationsBoard — someone already paying", () => {
  const inshurRow = (over: Record<string, unknown> = {}) => ({
    id: "row-1",
    integration_key: "square",
    status: "active",
    monthly_price_cents: 2000,
    currency: "usd",
    first_month_free: false,
    first_bill_at: "2026-10-15T00:00:00.000Z",
    subscribed_at: "2026-09-22T10:00:00.000Z",
    canceled_at: null,
    stripe_subscription_id: "sub_platform",
    ...over,
  });

  it("keeps the crown and the Subscribed block even after the admin made it free and hidden", async () => {
    catalogRows = [{ integration_key: "square", is_premium: false, monthly_price_cents: null, is_hidden: true }];
    subRows = [inshurRow()];
    await render();
    expect(container.textContent).toContain(SQUARE);
    expect(cardOf(SQUARE)?.querySelector('[title="Premium integration"]')).not.toBeNull();
    await click(cardOf(SQUARE));
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Subscribed · $20.00/month on your Drive247 bill");
    // The panel is live for someone paying for it.
    expect(dialog.querySelector("fieldset[disabled]")).toBeNull();
  });

  it("does not call a row on an ended platform subscription 'Subscribed'", async () => {
    subRows = [inshurRow({ stripe_subscription_id: "sub_old_uk" })];
    await render();
    await click(cardOf(SQUARE));
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).not.toContain("Subscribed ·");
    expect(dialog.textContent).toContain("Premium · $20.00/month");
  });
});
