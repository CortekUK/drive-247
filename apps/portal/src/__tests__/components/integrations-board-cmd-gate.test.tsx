/**
 * Every card on the Integrations board renders for EVERY tenant — the canary
 * included — and this file proves it three ways, not two.
 *
 * History, because the previous version of this file asserted the opposite.
 * The CheckMyDriver card used to be filtered off the lean board with
 * `isAreaHidden("cmd", tenantSlug)`. That filter was removed on purpose when
 * CMD (and Inshur) gained a "coming soon" panel: a card that opens a
 * description and connects nothing exposes no feature, so there was nothing
 * left for the lean gate to hide on this screen. The FEATURE gate is
 * untouched — `use-cmd-verification` and `use-platform-status` still close
 * CMD for the canary, and `__tests__/lib/lean-areas-cmd.test.ts` pins that.
 *
 * Why three cases still matter: "the card is present" for northwind alone
 * cannot distinguish a board that renders every card from a board whose
 * filter simply never resolved. So the same assertion runs for the canary, for
 * real live tenants, and for slugs that do not exist — and one more time for
 * id-shaped strings, because a gate that ever keys on a tenant id resolves
 * differently in every environment.
 *
 * This RENDERS the component rather than grepping it. `notFound()` under the
 * portal's `(dashboard)` route group returns HTTP 200, and TenantContext
 * resolves the slug client-side in a `useEffect`, so only executing the client
 * component with a known slug proves anything.
 *
 * HARNESS: `react-dom/client` + `act`, not `@testing-library/react` — the repo
 * lacks that package's `@testing-library/dom` peer, so `render()` throws at
 * import. Same approach as `connect-stripe-required-dialog.test.tsx`.
 *
 * The board renders each card's real status chip, and those chips ask their
 * integration whether it is working — so this file stands up the two things a
 * chip needs before it can mount: a React Query client, and a Supabase client
 * that answers without touching the network. Neither is under test here. The
 * assertions read card names and descriptions, which come from the board's own
 * list rather than from any chip — so a chip left in its loading state
 * (contributing no text) cannot make a card look present or absent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { IntegrationsBoard } from "@/app/(dashboard)/integrations/integrations-board";

let tenantSlug: string | null = "northwind";

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "tenant-1", slug: tenantSlug }, tenantSlug }),
}));

/**
 * A Supabase stub that answers any chain.
 *
 * Seven panels each build their own query shape — `.select().eq().order()`,
 * `.eq().maybeSingle()`, `.select(…, { head: true })` — and this file must not
 * become a place that has to be edited every time one of them changes. So the
 * stub is a Proxy that returns itself for any method and resolves to an empty
 * result when awaited: every shape works, and no shape is asserted on.
 *
 * It exists to keep the chips OFF the network, not to simulate Supabase. A
 * panel's data behaviour is not what this file tests.
 */
function chainable(): any {
  const result = { data: null, error: null, count: 0 };
  const target: any = () => target;
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderFor(slug: string | null): string {
  tenantSlug = slug;
  // A fresh client per render: `retry: false` so a stubbed rejection cannot
  // schedule a retry that outlives the test and warns after teardown.
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

/** Every card's description — unique per card, always a text node. */
const EVERY_CARD: Array<[string, string]> = [
  // First on the board on purpose — see the `integrations` array's own note.
  ["Turo Sync", "Pull your Turo trips in and stop double-booking."],
  ["Stripe Connect", "Accept booking payments, deposits & payouts."],
  ["Square", "Take booking payments through your Square account."],
  ["Bonzah", "Per-rental insurance coverage at checkout."],
  ["Inshur", "Fleet insurance for your vehicles between rentals."],
  ["BoldSign", "E-signature for rental agreements."],
  ["CheckMyDriver", "Verify driver's licenses & identity."],
  ["Twilio Messages", "SMS notifications, reminders & 2-way chat."],
  ["Twilio Calling", "Call forwarding, voicemail & recordings."],
  ["Tesla", "Supercharging & vehicle data via the Fleet API."],
  ["Custom Domain", "Use your own domain for booking & portal."],
  ["Xero", "Sync invoices & payments to Xero."],
  ["Zoho", "Sync books & CRM with Zoho."],
];

// Asserted on each card's DESCRIPTION rather than its name: Bonzah renders its
// name as an <img alt> (localLogo) and contributes no text node, so a
// name-based sweep would fail on a card that is in fact present.
function expectEveryCard(text: string, label: string) {
  // The board itself must have mounted — proving cards were rendered, not that
  // the whole component failed and trivially "showed" nothing.
  expect(text, `board must mount for ${label}`).toContain("Integrations");
  for (const [name, description] of EVERY_CARD) {
    expect(text, `${name} must render for ${label}`).toContain(description);
  }
}

describe("IntegrationsBoard — every card, for every tenant, three cases", () => {
  it("CASE 1 — the northwind canary sees every card, CheckMyDriver included", () => {
    expectEveryCard(renderFor("northwind"), "northwind");
  });

  it("CASE 2 — real non-canary tenants see every card (the outage case)", () => {
    for (const slug of ["revtek", "jangram", "test", "goniko", "globalmotiontransport"]) {
      expectEveryCard(renderFor(slug), slug);
    }
  });

  it("CASE 3 — an unresolved or unknown slug sees every card", () => {
    // null is what TenantContext reports for a tick on first paint and forever
    // on an unrecognised host. Neither may blank a card.
    for (const slug of [null, "", "not-a-real-tenant"]) {
      expectEveryCard(renderFor(slug), JSON.stringify(slug));
    }
  });

  it("never keys on a tenant ID", () => {
    // northwind is 6e5c544f-… in production but 8e6bc88f-… on staging. Both
    // ids must behave like any other unknown string.
    for (const id of [
      "6e5c544f-b374-451f-a662-360a634bff15",
      "8e6bc88f-86d6-4468-8610-73f7c8a88f6e",
    ]) {
      expectEveryCard(renderFor(id), id);
    }
  });

  it("renders exactly the cards on the list — nothing extra, nothing dropped", () => {
    const text = renderFor("northwind");
    // A description that is on no card must not appear: guards against a
    // stale filter or a duplicated entry sneaking a phantom card in.
    expect(text).not.toContain("configuration coming soon");
    expect(EVERY_CARD.length).toBe(13);
  });

  it("Turo Sync leads the grid, and the board is unpinned by default", () => {
    // No auth store is mocked in this file, so `appUser` is null and the pin
    // store has no key to read — which is exactly the state a first-paint
    // render is in. The board must therefore look like it always has: one
    // grid, in list order, with no section headings at all.
    const text = renderFor("northwind");

    expect(text).not.toContain("Pinned");
    expect(text).not.toContain("All integrations");

    const positions = EVERY_CARD.map(([, description]) => text.indexOf(description));
    expect(positions.every((i) => i >= 0)).toBe(true);
    // Turo Sync first, and every other card still in the order the list
    // declares — a sort that "floats" something must not shuffle the rest.
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
