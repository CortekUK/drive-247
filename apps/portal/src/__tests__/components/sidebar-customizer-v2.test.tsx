/**
 * The sidebar customiser, after it grew a third bucket and a preview.
 *
 * What was asked for (team lead, Sep 20 2026): Dashboard, Integrations,
 * Billing, Customers and Rentals are PERMANENT and cannot be removed or
 * reordered out; the "More" rows — including the ones currently hidden, such
 * as Insights and Agreements — can be shown, hidden and reordered; and it
 * needs a preview and a Reset to default.
 *
 * These cases hold the two halves that can fail quietly:
 *
 *  - a permanent row offers NO way to hide it, and the saved preferences never
 *    contain one. A "disabled" hide button would look right and still let a
 *    stored preference carry the row away.
 *  - what is saved matches what the preview shows: `moreOrder` for the flat
 *    rows, `shown` for the off-by-default ones, and `hidden` for neither.
 *
 * HARNESS: `react-dom/client` + `act`, matching the other dialog tests here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { SidebarCustomizerDialog } from "@/components/shared/layout/sidebar-customizer-dialog";
import { EMPTY_NAV_PREFERENCES, type NavPreferences } from "@/lib/nav-preferences";

const save = vi.fn().mockResolvedValue(undefined);
const toast = vi.fn();
let stored: NavPreferences = EMPTY_NAV_PREFERENCES;

vi.mock("@/hooks/use-nav-preferences", () => ({
  useNavPreferences: () => ({
    preferences: stored,
    save,
    isSaving: false,
    isUnavailable: false,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// dnd-kit constructs a ResizeObserver; the shared setup's stub is a plain
// function, so give it a class for this file.
const SetupResizeObserver = globalThis.ResizeObserver;
beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  globalThis.ResizeObserver = SetupResizeObserver;
});

const icon = () => null;
const item = (name: string, href: string, extra: Record<string, unknown> = {}) => ({
  name,
  href,
  icon,
  ...extra,
});

const TOP = [
  item("Customers", "/customers"),
  item("Vehicles", "/vehicles"),
  item("Rentals", "/rentals"),
];
const MORE = [
  item("Insights", "/insights", { optional: true }),
  item("Agreements", "/agreements", { optional: true }),
  item("Availability", "/blocked-dates"),
  item("Payments", "/payments"),
];
const GROUPS = [
  { label: "Records", icon, items: [item("Reminders", "/reminders")] },
];
const FIXED = [
  item("Dashboard", "/"),
  item("Integrations", "/integrations"),
  item("Billing", "/subscription"),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  stored = EMPTY_NAV_PREFERENCES;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
const preview = () => document.querySelector('[data-testid="sidebar-preview"]') as HTMLElement;
const byLabel = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === text,
  )!;

async function open() {
  await act(async () => {
    root.render(
      <SidebarCustomizerDialog
        open
        onOpenChange={() => undefined}
        topLevel={TOP}
        groups={GROUPS}
        more={MORE}
        fixed={FIXED}
      />,
    );
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("what the customiser offers", () => {
  beforeEach(() => open());

  it("lists the More rows alongside the rail and the groups", () => {
    expect(byLabel("Reorder Payments")).not.toBeNull();
    expect(byLabel("Reorder Availability")).not.toBeNull();
    expect(byLabel("Reorder Customers")).not.toBeNull();
    expect(byLabel("Reorder Records")).not.toBeNull();
  });

  it("offers the off-by-default rows as something to ADD, not to show back", () => {
    // They are not on the rail…
    expect(byLabel("Reorder Insights")).toBeNull();
    // …and the pool says "Add", which is the word for a row that was never there.
    expect(byLabel("Add Insights")).not.toBeNull();
    expect(byLabel("Add Agreements")).not.toBeNull();
  });

  it("gives a permanent row no way to hide it", () => {
    expect(byLabel("Hide Customers")).toBeNull();
    expect(byLabel("Hide Rentals")).toBeNull();
    // …while an ordinary one keeps its hide button.
    expect(byLabel("Hide Vehicles")).not.toBeNull();
    expect(byLabel("Hide Payments")).not.toBeNull();
  });

  it("shows a preview, with the permanent rows in it and a line saying so", () => {
    const text = preview().textContent ?? "";
    for (const label of ["Dashboard", "Integrations", "Billing", "Customers", "Rentals", "Payments"]) {
      expect(text, label).toContain(label);
    }
    expect(text).toContain("always in your sidebar");
  });

  it("keeps a Reset to default", () => {
    expect(buttonByText("Reset to default")).toBeTruthy();
  });
});

describe("what the customiser saves", () => {
  it("writes the More order and leaves the off-by-default rows out of `hidden`", async () => {
    await open();
    await click(buttonByText("Save"));

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0] as NavPreferences;
    expect(saved.moreOrder).toEqual(["/blocked-dates", "/payments"]);
    expect(saved.shown).toEqual([]);
    // Insights and Agreements are absent, but they were never there: recording
    // them as hidden would be a different fact.
    expect(saved.hidden).toEqual([]);
  });

  it("records an added row in `shown`, and it appears in the preview first", async () => {
    await open();
    await click(byLabel("Add Insights")!);

    expect(preview().textContent).toContain("Insights");

    await click(buttonByText("Save"));
    const saved = save.mock.calls[0][0] as NavPreferences;
    expect(saved.shown).toEqual(["/insights"]);
    expect(saved.moreOrder).toContain("/insights");
    expect(saved.hidden).toEqual([]);
  });

  it("records a hidden row in `hidden`, and drops it from the preview", async () => {
    await open();
    await click(byLabel("Hide Payments")!);

    expect(preview().textContent).not.toContain("Payments");

    await click(buttonByText("Save"));
    const saved = save.mock.calls[0][0] as NavPreferences;
    expect(saved.hidden).toEqual(["/payments"]);
    expect(saved.moreOrder).toEqual(["/blocked-dates"]);
  });

  it("Reset to default writes an empty arrangement, new keys included", async () => {
    await open();
    await click(buttonByText("Reset to default"));

    const saved = save.mock.calls[0][0] as NavPreferences;
    expect(saved).toEqual({
      topLevelOrder: [],
      groupOrder: [],
      groupItemOrder: {},
      hidden: [],
      pinned: [],
      moreOrder: [],
      shown: [],
    });
  });

  it("re-opens on what was stored, so a saved arrangement is what you edit", async () => {
    stored = {
      ...EMPTY_NAV_PREFERENCES,
      shown: ["/agreements"],
      moreOrder: ["/payments", "/agreements", "/blocked-dates"],
      hidden: ["/vehicles"],
    };
    await open();

    expect(byLabel("Reorder Agreements")).not.toBeNull();
    expect(byLabel("Show Vehicles")).not.toBeNull();
    const text = preview().textContent ?? "";
    expect(text.indexOf("Payments")).toBeLessThan(text.indexOf("Agreements"));
    expect(text).not.toContain("Vehicles");
  });
});
