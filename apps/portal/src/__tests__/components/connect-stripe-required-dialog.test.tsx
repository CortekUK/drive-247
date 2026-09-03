/**
 * ConnectStripeRequiredDialog — who gets a way out.
 *
 * One tenant (`northwind`, the canary) may close this dialog. Every other
 * tenant must find no close control AT ALL: no "×", no Escape, no
 * click-outside. It is the only thing standing between an operator with no
 * Stripe Connect account and a rental form that cannot take their money.
 *
 * NOTE ON "no × at all": these assertions look for the button in the DOM, not
 * for a `hidden` class. Older call sites in this app suppress the corner button
 * with a `[&>button]:hidden` utility, which leaves a real, present element that
 * only a loaded stylesheet hides — and jsdom loads no stylesheet, so such a
 * test would pass while asserting nothing. `showCloseButton={false}` does not
 * render the button, which is both the stronger guarantee and the testable one.
 *
 * HARNESS: `react-dom/client` + `act`, not `@testing-library/react` — the repo
 * lacks that package's `@testing-library/dom` peer, so `render()` throws at
 * import. Same approach as `banner-stack.test.tsx`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ConnectStripeRequiredDialog } from "@/components/rentals/connect-stripe-required-dialog";

let tenantSlug: string | null = "northwind";

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "tenant-1" }, tenantSlug }),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

// Tells React this is an act()-aware environment, so act() actually flushes
// instead of warning. Same line as banner-stack.test.tsx.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function renderDialog(props: Partial<{ onDismiss: () => void; onOpenChange: (o: boolean) => void }> = {}) {
  act(() => {
    root.render(<ConnectStripeRequiredDialog open {...props} />);
  });
}

/**
 * Radix registers its outside-pointer listener inside a `setTimeout(…, 0)`, so
 * a pointerdown dispatched synchronously after render lands before anything is
 * listening and NOTHING happens — for the canary and the blocked tenant alike.
 * A click-outside test written that way passes whatever the code does. Settling
 * the timers first is what makes the assertion mean something; the positive
 * control below fails if this ever stops being true.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function clickOutside() {
  await act(async () => {
    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

/** Radix portals the dialog to document.body, so query the whole document. */
function closeButton(): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll("button"));
  return buttons.find((b) => b.textContent?.trim() === "Close") ?? null;
}

function dialogContent(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

beforeEach(() => {
  tenantSlug = "northwind";
  push.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("the canary tenant", () => {
  it("gets a close control", () => {
    renderDialog();
    expect(dialogContent()).not.toBeNull();
    expect(closeButton()).not.toBeNull();
  });

  it("records a dismissal when the close control is used", () => {
    const onDismiss = vi.fn();
    renderDialog({ onDismiss });

    act(() => {
      closeButton()!.click();
    });

    // The route uses this to flip `blocked` false so the form renders behind.
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Escape", () => {
    const onDismiss = vi.fn();
    renderDialog({ onDismiss });

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onDismiss).toHaveBeenCalled();
  });

  it("dismisses on a click outside — POSITIVE CONTROL", async () => {
    // Guards the negative test below. If this stops firing, the harness has
    // gone deaf and "the blocked tenant ignores a click outside" would be
    // passing for the wrong reason.
    const onDismiss = vi.fn();
    renderDialog({ onDismiss });
    await settle();
    await clickOutside();

    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("every other tenant", () => {
  const payingTenants = ["revtekrentals", "globalmotiontransport", "jangram"];

  for (const slug of payingTenants) {
    it(`renders NO close control for ${slug}`, () => {
      tenantSlug = slug;
      renderDialog();

      // The dialog is up...
      expect(dialogContent()).not.toBeNull();
      // ...and there is no "×" element in the document to find.
      expect(closeButton()).toBeNull();
    });
  }

  it("ignores Escape", () => {
    tenantSlug = "revtekrentals";
    const onDismiss = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({ onDismiss, onOpenChange });

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialogContent()).not.toBeNull();
  });

  it("ignores a click outside", async () => {
    tenantSlug = "revtekrentals";
    const onDismiss = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({ onDismiss, onOpenChange });
    await settle();
    await clickOutside();

    expect(onDismiss).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialogContent()).not.toBeNull();
  });
});

describe("an unresolved tenant", () => {
  it("gets no close control — the safe default is the blocking one", () => {
    // The slug is null for a tick on first paint, and stays null on an
    // unrecognised host. Neither may be mistaken for the canary.
    tenantSlug = null;
    renderDialog();

    expect(dialogContent()).not.toBeNull();
    expect(closeButton()).toBeNull();
  });
});
