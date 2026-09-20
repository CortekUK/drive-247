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
 * - The Sep 20 2026 review: no picture and no Description/Type column in the
 *   Extras table, the picture on hovering the row, the row's own controls, and
 *   the promo create form behind an "Add promo code" button as a dialog.
 *
 * HARNESS: `react-dom/client` + `act` (the repo lacks @testing-library/dom).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const perms = vi.hoisted(() => ({ edit: true }));
const flags = vi.hoisted(() => ({ v2: true }));
const sb = vi.hoisted(() => ({ vehicles: [] as Array<{ id: string; reg: string; make: string | null; model: string | null }> }));
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
vi.mock("@/lib/v2-context", () => ({
  useV2: () => flags.v2,
  // The provider now carries the tenant-level half of the same answer
  // (`onV2` = tenants.portal_experience, `lean` = that OR the slug list).
  // All-false here leaves the `LEAN_TENANTS` slug list to decide, which is
  // what these cases meant before the column existed.
  usePortalExperience: () => ({ onV2: false, lean: false }),
  usePortalOnV2: () => false,
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {};
  for (const m of ["from", "select", "eq", "neq"]) chain[m] = () => chain;
  // The only list ExtrasSettings reads itself: the vehicles for per-vehicle prices.
  chain.order = () => Promise.resolve({ data: sb.vehicles, error: null });
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
  // jsdom has no scrollIntoView; the Add dialog scrolls its first field error into view.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  perms.edit = true;
  flags.v2 = true;
  sb.vehicles = [];
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

  it("tints a negative price in the phone rows, and puts each dot with the fact after it", () => {
    render(table([extra({ price: -25, max_quantity: 5, remaining_stock: 5 })]));
    const phoneRow = container.querySelector('ul[aria-label="Rental extras"] li')!;
    const price = Array.from(phoneRow.querySelectorAll("span")).find((el) => el.textContent === "-$25.00")!;
    expect(price.className).toContain("text-red-500");
    // No loose "·" item that could dangle at the end of a wrapped line.
    expect(Array.from(phoneRow.querySelectorAll("span")).some((el) => el.textContent === "·")).toBe(false);
    expect(phoneRow.querySelectorAll("[class*=\"before:content-\"]").length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Team lead, Sep 20 2026: no picture in the table, the picture on hovering the
 * row instead (as the vehicles list does it), no Description and no Type
 * column, and Edit / Update stock / Activate / Delete in the row rather than
 * behind a "..." menu.
 */
describe("ExtrasTableV2 (Sep 20 review): the row carries the picture and the controls", () => {
  /** Radix Popper measures with a constructible ResizeObserver; the shared setup mock is not. */
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const tableRow = () => container.querySelector("table tbody tr")!;
  const hover = (row: Element, over: boolean) => {
    act(() => {
      row.dispatchEvent(new MouseEvent(over ? "mouseover" : "mouseout", { bubbles: true, relatedTarget: null }));
      vi.advanceTimersByTime(300);
    });
  };

  beforeEach(() => {
    (globalThis as any).ResizeObserver = RO;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("puts no image in the table row, and no Description or Type column", () => {
    render(table([extra({ description: "A rear-facing seat for under-fours", image_urls: ["https://x.test/a.png"] })]));
    const heads = Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(heads).toEqual(["Name", "Price", "Pricing", "Stock", "Status", "Actions"]);
    // The picture is only in the phone list, which is hidden from `sm` up.
    expect(container.querySelectorAll("table img")).toHaveLength(0);
    expect(container.querySelector("table")!.textContent).not.toContain("A rear-facing seat");
    expect(container.querySelector("table")!.textContent).not.toContain("Add-on");
  });

  it("shows the picture beside the name while the pointer rests on the row, and takes it away on leaving", () => {
    render(table([extra({ image_urls: ["https://x.test/a.png", "https://x.test/b.png"] })]));
    expect(document.body.querySelector('[data-slot="hover-card-content"]')).toBeNull();

    hover(tableRow(), true);
    const card = document.body.querySelector('[data-slot="hover-card-content"]')!;
    expect(card).not.toBeNull();
    expect(card.querySelector("img")!.getAttribute("src")).toBe("https://x.test/a.png");
    // It never covers the row it belongs to: nothing in it takes the pointer.
    expect(card.className).toContain("pointer-events-none");
    // Says there are more, so the one shown does not read as the only one.
    expect(card.textContent).toContain("1 of 2 images");

    hover(tableRow(), false);
    expect(document.body.querySelector('[data-slot="hover-card-content"]')).toBeNull();
  });

  it("opens no empty card for an extra with no picture", () => {
    render(table([extra({ image_urls: [] })]));
    hover(tableRow(), true);
    expect(document.body.querySelector('[data-slot="hover-card-content"]')).toBeNull();
  });

  it("carries Edit, Update stock, Activate/Deactivate and Delete in the row, each calling v1's handler", () => {
    const calls = { edit: 0, stock: 0, toggle: 0, del: 0 };
    render(
      <ExtrasTableV2
        extras={[extra({ max_quantity: 5, remaining_stock: 5 })]}
        resetKey="t1"
        currencyCode="USD"
        canEdit
        isLowStock={() => false}
        onEdit={() => {
          calls.edit += 1;
        }}
        onUpdateStock={() => {
          calls.stock += 1;
        }}
        onToggleActive={() => {
          calls.toggle += 1;
        }}
        onDelete={() => {
          calls.del += 1;
        }}
      />,
    );
    const inRow = (label: string) =>
      container.querySelector<HTMLButtonElement>(`table button[aria-label="${label}"]`)!;
    for (const [label, key] of [
      ["Edit Child seat", "edit"],
      ["Update stock for Child seat", "stock"],
      ["Deactivate Child seat", "toggle"],
      ["Delete Child seat", "del"],
    ] as const) {
      expect(inRow(label), label).not.toBeNull();
      act(() => inRow(label).click());
      expect(calls[key], label).toBe(1);
    }
    // Nothing is hidden behind a menu in the table any more.
    expect(container.querySelector('table [aria-label^="Actions for"]')).toBeNull();
  });

  it("offers no Update stock where there is no stock to update", () => {
    render(table([extra({ max_quantity: null })]));
    expect(container.querySelector('table button[aria-label="Update stock for Child seat"]')).toBeNull();
    expect(container.querySelector('table button[aria-label="Edit Child seat"]')).not.toBeNull();
  });

  it("disables only Activate/Deactivate while its own write is in flight", () => {
    render(
      <ExtrasTableV2
        extras={[extra()]}
        resetKey="t1"
        currencyCode="USD"
        canEdit
        isLowStock={() => false}
        busyId="e1"
        onEdit={noop}
        onUpdateStock={noop}
        onToggleActive={noop}
        onDelete={noop}
      />,
    );
    expect(container.querySelector<HTMLButtonElement>('table button[aria-label="Deactivate Child seat"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('table button[aria-label="Edit Child seat"]')!.disabled).toBe(false);
  });

  it("shows a read-only user no controls at all", () => {
    render(table([extra({ max_quantity: 5 })], false));
    expect(container.querySelector('table button[aria-label^="Edit"]')).toBeNull();
    expect(container.querySelector('table button[aria-label^="Delete"]')).toBeNull();
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
  it("shows a table-shaped skeleton while the first read runs, and stacked rows below sm", () => {
    render(section({ isLoading: true }).node);
    expect(text()).toContain("All promo codes");
    const skeletons = Array.from(container.querySelectorAll('[data-settings-state="loading"]'));
    // Phones get the rows the loaded list shows there; sm+ the table.
    expect(skeletons.map((el) => el.className.includes("sm:hidden"))).toEqual([true, false]);
    expect(skeletons[1].className).toContain("hidden sm:block");
  });

  it("tints a negative value in the phone rows too, and lets 'Expired' wrap in the desktop cell", () => {
    render(section({ promos: [promo({ type: "value", value: -25, expires_at: "2020-01-01" })] }).node);
    const phoneRow = container.querySelector('ul[aria-label="Promo codes"] li')!;
    const value = Array.from(phoneRow.querySelectorAll("span")).find((el) => el.textContent === "-$25.00")!;
    expect(value.className).toContain("text-red-500");
    const expiresCell = Array.from(container.querySelectorAll("td")).find((td) => td.textContent?.includes("Expired"))!;
    expect(expiresCell.className).toContain("whitespace-normal");
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

/** Radix menus and popovers measure with a constructible ResizeObserver, which the shared setup mock is not. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
function openRowMenuItem(trigger: string, item: string) {
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  const button = document.body.querySelector(`button[aria-label="${trigger}"]`) as HTMLButtonElement;
  act(() => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
  });
  const entry = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((m) => m.textContent?.includes(item)) as HTMLElement;
  act(() => entry.click());
}
const dialogButton = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) => b.textContent?.trim() === label);
function typeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

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
    // The page header names Extras; the list has a plain section title under it.
    expect(text()).toContain("All extras");
    expect(text()).not.toContain("Rental Extras");
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    // Stacked rows (with a thumbnail) below sm, the table from sm up.
    expect(container.querySelectorAll('[data-settings-state="loading"]')).toHaveLength(2);
    expect(buttonByText("Add Extra")).toBeUndefined();
  });

  it("keeps the Edit dialog open with the failure written in it when the save fails", async () => {
    const failure = new Error("The extra was saved, but its vehicle prices couldn't be updated. Try saving again.");
    ex.current = extrasApi({
      extras: [extra({ image_urls: ["https://x.test/a.png"] })],
      updateExtra: vi.fn().mockRejectedValue(failure),
    });
    render(<ExtrasSettings />);
    openRowMenuItem("Actions for Child seat", "Edit");
    await act(async () => dialogButton("Save Changes")!.click());
    expect(ex.current.updateExtra).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    const inline = document.body.querySelector('[role="dialog"] [data-settings-state="save-error"]');
    expect(inline?.textContent).toContain("its vehicle prices couldn't be updated");
    // Retry runs the same save again.
    await act(async () => dialogButton("Retry")!.click());
    expect(ex.current.updateExtra).toHaveBeenCalledTimes(2);
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

  it("asks before Cancel drops typed changes, and closes at once when nothing changed", () => {
    ex.current = extrasApi({ extras: [extra({ image_urls: ["https://x.test/a.png"] })] });
    render(<ExtrasSettings />);
    openRowMenuItem("Actions for Child seat", "Edit");
    act(() => dialogButton("Cancel")!.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(text()).not.toContain("Discard your changes?");

    openRowMenuItem("Actions for Child seat", "Edit");
    const name = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    typeValue(name, "Child seat XL");
    act(() => dialogButton("Cancel")!.click());
    expect(text()).toContain("Discard your changes?");
    const keep = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find((b) => b.textContent === "Keep editing")!;
    act(() => keep.click());
    expect(document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!.value).toBe("Child seat XL");

    act(() => dialogButton("Cancel")!.click());
    const discard = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find((b) => b.textContent === "Discard")!;
    act(() => discard.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(ex.current.updateExtra).not.toHaveBeenCalled();
  });

  it("does not offer a 'New total' next to the whole-number error for a decimal stock", () => {
    ex.current = extrasApi({ extras: [extra({ max_quantity: 10, booked_quantity: 2, remaining_stock: 8 })] });
    render(<ExtrasSettings />);
    openRowMenuItem("Actions for Child seat", "Update Stock");
    const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    typeValue(input, "1.5");
    expect(text()).toContain("Enter a whole number above 0.");
    expect(text()).not.toContain("New total will be");
    typeValue(input, "2500");
    expect(text()).toContain("New total will be: 2,510");
    expect(text()).not.toContain("Enter a whole number above 0.");
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

describe("ExtrasSettings (v2) look, and v1 unchanged", () => {
  const dialogContent = () => document.body.querySelector('[role="dialog"]');
  const optionCard = (label: string) =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((b) =>
      b.textContent?.startsWith(label),
    )!;

  it("the list title is the v2 section title, with no description repeating the page header", () => {
    ex.current = extrasApi({ extras: [extra()] });
    render(<ExtrasSettings />);
    const h2 = Array.from(container.querySelectorAll("h2")).find((h) => h.textContent === "All extras")!;
    expect(h2.className).toBe("font-heading text-base font-semibold tracking-tight text-foreground");
    expect(text()).not.toContain("Manage optional add-ons");
  });

  it("v2: the Add dialog is the v2 dialog, its fields are v2, and its option cards are rounded-xl with the purple hover", () => {
    ex.current = extrasApi({ extras: [extra()] });
    render(<ExtrasSettings />);
    act(() => buttonByText("Add Extra")!.click());
    expect(dialogContent()?.getAttribute("data-slot")).toBe("dialog-content");
    expect(document.body.querySelector('[role="dialog"] input')?.getAttribute("data-slot")).toBe("input");
    expect(document.body.querySelector('[role="dialog"] textarea')?.getAttribute("data-slot")).toBe("textarea");
    expect(document.body.querySelector('[role="dialog"] [role="switch"]')?.getAttribute("data-slot")).toBe("switch");
    for (const label of ["Per trip", "Per day", "Same price for all vehicles", "Different price per vehicle"]) {
      const card = optionCard(label);
      const cls = card.className.split(/\s+/);
      expect(cls, label).toContain("rounded-xl");
      expect(cls, label).not.toContain("rounded-2xl");
      expect(cls, label).not.toContain("rounded-lg");
      if (cls.includes("ring-primary")) continue; // the selected card has no hover of its own
      expect(cls, label).toContain("hover:bg-primary/10");
      expect(cls, label).toContain("dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]");
      expect(cls, label).not.toContain("hover:bg-muted/50");
    }
  });

  it("v2: the per-vehicle picker is the v2 dropdown", async () => {
    sb.vehicles = [{ id: "v1", reg: "AB12 CDE", make: "Ford", model: "Focus" }];
    ex.current = extrasApi({ extras: [extra()] });
    render(<ExtrasSettings />);
    // Let the vehicles read land before the dialog opens.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => buttonByText("Add Extra")!.click());
    await act(async () => optionCard("Different price per vehicle").click());
    const trigger = document.body.querySelector('[role="dialog"] [role="combobox"]');
    expect(trigger?.getAttribute("data-slot")).toBe("select-trigger");
    expect(trigger?.textContent).toContain("Add a vehicle...");
  });

  it("v1: the same dialog keeps v1's parts, square-ish cards and grey hover", () => {
    flags.v2 = false;
    ex.current = extrasApi({ extras: [extra()] });
    render(<ExtrasSettings />);
    act(() => buttonByText("Add Extra")!.click());
    expect(dialogContent()?.getAttribute("data-slot")).toBeNull();
    expect(document.body.querySelector('[role="dialog"] input')?.getAttribute("data-slot")).toBeNull();
    const card = optionCard("Per day");
    expect(card.className).toBe(
      "rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50",
    );
  });
});

describe("ExtrasTableV2 order", () => {
  it("lists the newest extra first, and an extra with no readable date last", () => {
    render(
      table([
        extra({ id: "a", name: "Oldest", created_at: "2026-01-05T10:00:00Z", sort_order: 0 }),
        extra({ id: "b", name: "Newest", created_at: "2026-09-01T10:00:00Z", sort_order: 1 }),
        extra({ id: "c", name: "Undated", created_at: "", sort_order: 2 }),
        extra({ id: "d", name: "Middle", created_at: "2026-05-20T10:00:00Z", sort_order: 3 }),
      ]),
    );
    // Each phone row's name carries its full text in `title` (TruncatedText).
    const phoneNames = Array.from(container.querySelectorAll('ul[aria-label="Rental extras"] li')).map((li) =>
      li.querySelector("[title]")?.getAttribute("title"),
    );
    expect(phoneNames).toEqual(["Newest", "Middle", "Oldest", "Undated"]);
  });
});

describe("PromoCodesSectionV2 look", () => {
  it("'All promo codes' is the v2 section title", () => {
    render(section({ promos: [promo()] }).node);
    const h2 = container.querySelector("#v2-promo-list-heading")!;
    expect(h2.textContent).toBe("All promo codes");
    expect(h2.className).toBe("font-heading text-base font-semibold tracking-tight text-foreground");
  });
});

/**
 * Team lead, Sep 20 2026: "a plain table … with an Add promo code button that
 * opens a dialog where everything is configured." The Settings page is far too
 * large to mount, so its wiring is read as source, the way
 * settings-v2-structure.test.tsx reads the rest of that page.
 */
describe("Promo codes (Sep 20 review): Add opens a dialog, the list is just a list", () => {
  const page = readFileSync(resolve(__dirname, "../..", "app/(dashboard)/settings/page.tsx"), "utf8");
  const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
  const promos = page.slice(page.indexOf("        case 'promos': {", v2Start), page.indexOf("        case 'extras':", v2Start));

  it("puts the create form in a dialog behind the button, not in a panel standing open", () => {
    expect(v2Start).toBeGreaterThan(-1);
    expect(promos).not.toContain('title="New promo code"');
    expect(promos).not.toContain("<SettingsPanel");
    expect(promos).toContain("<DialogV2");
    expect(promos).toContain("open={newPromoOpenV2}");
    expect(promos).toContain("<DialogTitleV2>New promo code</DialogTitleV2>");
    // Every field is still in it: nothing was dropped on the way into the dialog.
    for (const id of [
      "v2_promo_name",
      "v2_promo_value",
      "v2_promo_code",
      "v2_promo_max_users",
      "v2_promo_min_duration",
    ]) {
      expect(promos, id).toContain(id);
    }
    expect(promos).toContain("'Starts')");
    expect(promos).toContain("'Expires')");
  });

  it("hands the list the Add button and the empty state the same opener", () => {
    expect(promos).toContain("onCreateFirst={openNewPromoV2}");
    expect(promos).toContain("Add promo code");
    // It is the editor's button: a view-only manager gets the heading alone.
    expect(promos).toContain("canEditPage ? (");
  });

  it("closes only once the code is really in, and holds while the insert is in flight", () => {
    expect(promos).toContain("createPromoMutation.mutate(promoForm, { onSuccess: () => setNewPromoOpenV2(false) });");
    expect(promos).toContain("if (!createPromoMutation.isPending) setNewPromoOpenV2(open);");
    expect(promos).toContain("disabled={createPromoMutation.isPending}");
  });

  it("still saves per code: nothing here registers with the page save bar", () => {
    expect(promos).not.toContain("registerSave");
  });
});

describe("PromoCodesSectionV2: the Add button beside the heading", () => {
  const add = <button type="button">Add promo code</button>;

  it("sits beside the heading once there are codes", () => {
    render(section({ promos: [promo()], action: add }).node);
    expect(buttonByText("Add promo code")).toBeDefined();
  });

  it("stays out of the empty state, which has a button of its own", () => {
    render(section({ promos: [], action: add }).node);
    expect(text()).toContain("No promo codes yet");
    expect(buttonByText("Add promo code")).toBeUndefined();
    expect(buttonByText("Create your first code")).toBeDefined();
  });

  it("stays out of a failed read, where Try again is the only thing to press", () => {
    render(section({ error: new Error("Failed to fetch"), action: add }).node);
    expect(buttonByText("Add promo code")).toBeUndefined();
    expect(buttonByText("Try again")).toBeDefined();
  });
});
