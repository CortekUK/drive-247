/**
 * v2 Settings → Extras and Promo Codes: every state the operator can land in.
 *
 * - ExtrasTableV2 / PromoCodesTableV2: extreme data (huge money, per-day price,
 *   sold out, a failed bookings or vehicle-price read, broken image, expired
 *   code, huge counts) never overlaps, lies or shows a broken glyph.
 * - PromoCodesSectionV2: loading, failed read, empty (editor vs read-only),
 *   stale rows with a refresh error, and a copy that actually failed.
 * - ExtrasSettings (v2 branch): loading keeps the header, a failed read is an
 *   error and not "no extras", empty teaches with one action, low stock is an
 *   inline notice instead of a toast, and Save lists every field problem.
 *
 * HARNESS: `react-dom/client` + `act` (the repo lacks @testing-library/dom).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const perms = vi.hoisted(() => ({ edit: true }));
const ex = vi.hoisted(() => ({ current: {} as any }));
const toastSpy = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => perms.edit, canViewSettings: () => true }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: toastSpy, useToast: () => ({ toast: toastSpy }) }));
vi.mock("@/hooks/use-rental-extras", () => ({ useRentalExtras: () => ex.current }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", currency_code: "USD" } }) }));
vi.mock("@/lib/v2-context", () => ({ useV2: () => true }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {};
  for (const m of ["from", "select", "eq", "neq"]) chain[m] = () => chain;
  chain.order = () => Promise.resolve({ data: [], error: null });
  return { supabase: chain, supabaseUntyped: chain };
});

import { ExtrasTableV2 } from "@/components/settings-v2/extras-table-v2";
import { PromoCodesSectionV2, copyPromoCode } from "@/components/settings-v2/promo-codes-section-v2";
import { ExtrasSettings } from "@/components/settings/extras-settings";

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
}
const text = () => document.body.textContent ?? "";
const buttonByText = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  perms.edit = true;
  toastSpy.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function extra(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    tenant_id: "t1",
    name: "Child seat",
    description: null,
    price: 12.5,
    pricing_type: "global",
    billing_type: "per_trip",
    image_urls: [],
    is_active: true,
    max_quantity: null,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    booked_quantity: 0,
    remaining_stock: null,
    vehicle_pricing: [],
    ...overrides,
  } as any;
}

const noop = () => {};
function table(extras: any[], canEdit = true) {
  return (
    <ExtrasTableV2
      extras={extras}
      resetKey="t1"
      currencyCode="USD"
      canEdit={canEdit}
      isLowStock={() => false}
      onEdit={noop}
      onUpdateStock={noop}
      onToggleActive={noop}
      onDelete={noop}
    />
  );
}

describe("ExtrasTableV2 extreme data", () => {
  it("prints a huge per-day price in full with '/ day', and a sold-out quantity extra as Sold out", () => {
    render(
      table([
        extra({ price: 999999999.99, billing_type: "per_day", max_quantity: 5, booked_quantity: 5, remaining_stock: 0 }),
      ]),
    );
    expect(text()).toContain("999,999,999.99 / day");
    expect(text()).toContain("Sold out");
    expect(text()).toContain("0 left");
    expect(text()).toContain("All 1 extra shown");
  });

  it("swaps a broken thumbnail for the image tile", () => {
    render(table([extra({ image_urls: ["https://example.test/gone.png"] })]));
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThan(0);
    act(() => imgs.forEach((img) => img.dispatchEvent(new Event("error"))));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("[data-image-fallback]").length).toBeGreaterThan(0);
  });

  it("prints a dash, not full stock or zero vehicles, when those reads failed", () => {
    render(
      table([
        extra({ id: "q", max_quantity: 5, remaining_stock: 5, stock_unknown: true }),
        extra({ id: "v", name: "GPS", pricing_type: "per_vehicle", vehicle_pricing_unknown: true }),
      ]),
    );
    expect(container.querySelector('[title="Bookings couldn\'t be loaded, so stock left is unknown"]')).not.toBeNull();
    expect(text()).not.toContain("5 left");
    expect(text()).toContain("Per Vehicle (—)");
    // A failed bookings read must not flip an extra to Sold out either.
    expect(text()).not.toContain("Sold out");
  });

  it("shows no row menu to a read-only user", () => {
    render(table([extra()], false));
    expect(container.querySelector('[aria-label^="Actions for"]')).toBeNull();
  });
});

function promo(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "Winter",
    code: "WINTER10",
    type: "percentage",
    value: 12.5,
    created_at: "2026-01-01",
    expires_at: "2099-01-01",
    max_users: 100000000,
    min_duration_days: null,
    ...overrides,
  };
}

function section(props: Record<string, unknown>) {
  const all = {
    promos: undefined,
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    canEdit: true,
    currencyCode: "USD",
    resetKey: "t1",
    onEdit: noop,
    onDelete: noop,
    onCreateFirst: vi.fn(),
    ...props,
  } as any;
  return { node: <PromoCodesSectionV2 {...all} />, props: all };
}

describe("PromoCodesSectionV2 states", () => {
  it("shows a table-shaped skeleton while the first read runs", () => {
    render(section({ isLoading: true }).node);
    expect(text()).toContain("All promo codes");
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
  });

  it("shows the load error, never the empty copy, when the read failed", () => {
    const { node, props } = section({ error: new Error("Failed to fetch") });
    render(node);
    expect(text()).toContain("Couldn't load promo codes");
    expect(text()).not.toContain("No promo codes yet");
    act(() => buttonByText("Try again")!.click());
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("teaches an editor with one action, and tells a read-only user without one", () => {
    const { node, props } = section({ promos: [] });
    render(node);
    expect(text()).toContain("No promo codes yet");
    act(() => buttonByText("Create your first code")!.click());
    expect(props.onCreateFirst).toHaveBeenCalledTimes(1);

    render(section({ promos: [], canEdit: false }).node);
    expect(text()).toContain("No promo codes have been set up");
    expect(buttonByText("Create your first code")).toBeUndefined();
  });

  it("keeps stale rows with a refresh error, and marks expired codes and huge counts", () => {
    render(
      section({
        promos: [promo(), promo({ id: "p2", code: "OLDCODE", expires_at: "2020-01-01" })],
        error: new Error("timeout"),
      }).node,
    );
    expect(text()).toContain("Couldn't refresh promo codes.");
    expect(text()).toContain("12.5%");
    expect(text()).toContain("100,000,000");
    expect(text()).toContain("Expired");
    expect(text()).toContain("All 2 promo codes shown");
  });

  it("gives a long code its full text in the title while it truncates", () => {
    const code = "SUPERLONGPROMOCODE1234567890ABCDEFGHIJ";
    render(section({ promos: [promo({ code })] }).node);
    expect(container.querySelectorAll(`button[title="${code}"]`).length).toBeGreaterThan(0);
  });

  it("says a copy failed instead of 'Copied!' when the clipboard is unavailable", async () => {
    const original = (navigator as any).clipboard;
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    await expect(copyPromoCode("WINTER10")).resolves.toBe(false);
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't copy", variant: "destructive" }));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    await expect(copyPromoCode("WINTER10")).resolves.toBe(true);
    expect(toastSpy).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Copied!" }));
    Object.defineProperty(navigator, "clipboard", { value: original, configurable: true });
  });
});

function extrasApi(overrides: Record<string, unknown> = {}) {
  return {
    extras: [],
    activeExtras: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
    hasLoaded: true,
    createExtra: vi.fn(),
    isCreating: false,
    updateExtra: vi.fn(),
    isUpdating: false,
    deleteExtra: vi.fn(),
    isDeleting: false,
    ...overrides,
  };
}

describe("ExtrasSettings (v2) states", () => {
  it("keeps the header and shows a skeleton while loading, with no Add button yet", () => {
    ex.current = extrasApi({ hasLoaded: false, isLoading: true });
    render(<ExtrasSettings />);
    expect(text()).toContain("Rental Extras");
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(buttonByText("Add Extra")).toBeUndefined();
  });

  it("shows the load error with a retry after a failed read, never 'no extras'", () => {
    ex.current = extrasApi({ hasLoaded: false, error: new Error("Failed to fetch") });
    render(<ExtrasSettings />);
    expect(text()).toContain("Couldn't load rental extras");
    expect(text()).not.toContain("No extras");
    act(() => buttonByText("Try again")!.click());
    expect(ex.current.refetch).toHaveBeenCalledTimes(1);
  });

  it("teaches an editor with one action that opens the Add dialog", () => {
    ex.current = extrasApi();
    render(<ExtrasSettings />);
    expect(text()).toContain("Offer add-ons with every booking");
    act(() => buttonByText("Add your first extra")!.click());
    expect(text()).toContain("Add a new optional extra for customers");
  });

  it("tells a read-only user nothing is set up, with no action", () => {
    perms.edit = false;
    ex.current = extrasApi();
    render(<ExtrasSettings />);
    expect(text()).toContain("No extras have been set up yet");
    expect(buttonByText("Add your first extra")).toBeUndefined();
  });

  it("states low stock inline instead of raising a toast on every visit", () => {
    ex.current = extrasApi({
      extras: [extra({ max_quantity: 10, booked_quantity: 9, remaining_stock: 1 })],
    });
    render(<ExtrasSettings />);
    expect(text()).toContain("Child seat is below 20% stock.");
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("lists every field problem under its field on Save and does not create anything", async () => {
    ex.current = extrasApi();
    render(<ExtrasSettings />);
    act(() => buttonByText("Add your first extra")!.click());
    const submit = Array.from(document.body.querySelectorAll('[role="dialog"] button')).find(
      (b) => b.textContent?.trim() === "Add Extra",
    ) as HTMLButtonElement;
    await act(async () => submit.click());
    expect(text()).toContain("Enter a name");
    expect(text()).toContain("Enter a price of 0 or more");
    expect(text()).toContain("Add at least one image. Customers see it when they book.");
    expect(ex.current.createExtra).not.toHaveBeenCalled();
  });
});
