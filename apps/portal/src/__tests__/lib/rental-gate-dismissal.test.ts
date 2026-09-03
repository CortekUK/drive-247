/**
 * Dismissing the "Connect Stripe to create rentals" gate — canary only.
 *
 * The thing this file really guards is the SECOND half. It is easy to make the
 * dialog closable and call it done; the /rentals/new route returns that dialog
 * INSTEAD of the form, so a dismissal that only closes the dialog leaves a
 * blank screen and achieves nothing. The route branches on `blocked`, so the
 * test that matters is that `blocked` itself goes false.
 *
 * The other half is the blast radius: this must change nothing for the ~35
 * paying tenants, and must fail closed on a tenant we cannot identify.
 *
 * HARNESS: renders through `react-dom/client` + `act` rather than
 * `@testing-library/react` — the repo depends on that package but NOT on its
 * `@testing-library/dom` peer, so `render()` throws at import. See
 * `components/banner-stack.test.tsx`, which does the same.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  __resetRentalGateDismissal,
  dismissRentalGate,
  isRentalGateDismissed,
} from "@/lib/rental-gate-dismissal";

// The tenant under test, swapped per case.
let tenantSlug: string | null = "northwind";
let tenantId: string | null = "tenant-northwind";

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({
    tenant: tenantId ? { id: tenantId } : null,
    tenantSlug,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn() },
}));

/**
 * northwind's real production shape: onboarding incomplete, status 'pending',
 * no own-account ids — i.e. Connect that cannot take money.
 */
const UNUSABLE_CONNECT = {
  stripe_onboarding_complete: false,
  stripe_account_status: "pending",
  own_stripe_account_id: null,
  own_stripe_test_account_id: null,
};

let queryData: unknown = UNUSABLE_CONNECT;

vi.mock("@tanstack/react-query", () => ({
  // The hook only reads `data` and `isLoading`; the query itself is exercised
  // against the real database elsewhere.
  useQuery: () => ({ data: queryData, isLoading: false }),
}));

// Imported after the mocks above are registered.
const { useRentalCreationGate } = await import("@/hooks/use-rental-creation-gate");

// Tells React this is an act()-aware environment, so act() actually flushes
// instead of warning. Same line as banner-stack.test.tsx.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Gate = ReturnType<typeof useRentalCreationGate>;

let container: HTMLDivElement;
let root: Root;

/** Mounts the hook and returns a live handle to its latest return value. */
function mountGate(): { current: Gate } {
  const handle = { current: null as unknown as Gate };

  function Probe() {
    handle.current = useRentalCreationGate();
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

  return handle;
}

beforeEach(() => {
  __resetRentalGateDismissal();
  tenantSlug = "northwind";
  tenantId = "tenant-northwind";
  queryData = UNUSABLE_CONNECT;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  __resetRentalGateDismissal();
});

describe("rental gate dismissal store", () => {
  it("records a dismissal per tenant slug", () => {
    expect(isRentalGateDismissed("northwind")).toBe(false);
    dismissRentalGate("northwind");
    expect(isRentalGateDismissed("northwind")).toBe(true);
  });

  it("does not leak a dismissal across tenants in one browser", () => {
    // One operator signed into two tenants in the same tab must not carry the
    // canary's dismissal over to a paying tenant.
    dismissRentalGate("northwind");
    expect(isRentalGateDismissed("revtekrentals")).toBe(false);
    expect(isRentalGateDismissed("globalmotiontransport")).toBe(false);
  });

  it("ignores a dismissal keyed on an unresolved slug", () => {
    // Writing under a placeholder would let the dismissal apply to whichever
    // tenant happened to resolve next.
    dismissRentalGate(null);
    dismissRentalGate(undefined);
    dismissRentalGate("");
    expect(isRentalGateDismissed(null)).toBe(false);
    expect(isRentalGateDismissed("northwind")).toBe(false);
  });
});

describe("useRentalCreationGate — the canary may dismiss", () => {
  it("blocks northwind until dismissed, then stops blocking", () => {
    const gate = mountGate();

    // The route returns the dialog instead of the form on exactly this boolean.
    expect(gate.current.blocked).toBe(true);
    expect(gate.current.canDismiss).toBe(true);

    act(() => {
      gate.current.dismiss();
    });

    // THE point of the feature: the route gate now falls through to the form.
    expect(gate.current.blocked).toBe(false);
  });

  it("keeps the dismissal across a remount, i.e. navigating away and back", () => {
    const gate = mountGate();
    act(() => {
      gate.current.dismiss();
    });
    expect(gate.current.blocked).toBe(false);

    // Leaving /rentals/new for /rentals and returning unmounts and remounts the
    // page. The operator must not be asked again in the same sitting.
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    const remounted = mountGate();

    expect(remounted.current.blocked).toBe(false);
  });
});

describe("useRentalCreationGate — everybody else is unaffected", () => {
  it("never blocks a paying tenant, and never offers them a dismissal", () => {
    tenantSlug = "revtekrentals";
    tenantId = "tenant-revtek";
    // Same unusable Connect row: 6 of the 18 tenants that actually trade look
    // like this, and blocking them would stop real bookings.
    const gate = mountGate();

    expect(gate.current.blocked).toBe(false);
    expect(gate.current.canDismiss).toBe(false);
  });

  it("refuses to record a dismissal for a non-lean tenant", () => {
    tenantSlug = "revtekrentals";
    tenantId = "tenant-revtek";
    const gate = mountGate();

    act(() => {
      gate.current.dismiss();
    });

    // Nothing was written, so if that tenant ever did become blockable it would
    // not start out already waved through.
    expect(isRentalGateDismissed("revtekrentals")).toBe(false);
  });

  it("offers no dismissal while the tenant is unresolved", () => {
    // The slug is null for a tick on first paint and on an unrecognised host.
    tenantSlug = null;
    tenantId = null;
    const gate = mountGate();

    expect(gate.current.canDismiss).toBe(false);
    // Fails open on blocking (an unknown tenant is not the canary) and closed
    // on dismissal (no close control offered).
    expect(gate.current.blocked).toBe(false);
  });
});

describe("useRentalCreationGate — a connected canary is not blocked at all", () => {
  it("does not block once Connect is usable", () => {
    queryData = {
      stripe_onboarding_complete: true,
      stripe_account_status: "active",
      own_stripe_account_id: null,
      own_stripe_test_account_id: null,
    };
    const gate = mountGate();

    expect(gate.current.blocked).toBe(false);
  });
});
