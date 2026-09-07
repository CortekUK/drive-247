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
import { readPortalSource } from "../helpers/edge-source";

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

/**
 * The LABELLED escape hatch, matched on its visible text rather than a test id.
 *
 * Text is what makes this control different from the "×" that already existed:
 * the whole reason it was added is that a bare "×" reads as "dismiss", not as
 * "skip and carry on". Asserting on the label is asserting on the thing that
 * matters, and it fails if the button is ever silently reduced back to an icon.
 */
function skipButton(): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll("button"));
  return buttons.find((b) => /skip/i.test(b.textContent ?? "")) ?? null;
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

  it("gets a LABELLED skip, not just a bare ×", () => {
    renderDialog();

    const skip = skipButton();
    expect(skip).not.toBeNull();
    expect(skip!.textContent).toMatch(/Skip for now/i);
  });

  it("skipping records the dismissal, so the form renders behind", () => {
    // This is the whole test. On /rentals/new the gate branch returns this
    // dialog INSTEAD of the form, so a skip that merely closed the dialog would
    // leave a blank screen. `onDismiss` is what flips `blocked` false in the
    // hook, which is the boolean both the v1 route and RentalCreateV2 branch
    // on — so this assertion is the one that proves the flow CONTINUES rather
    // than the dialog simply going away.
    const onDismiss = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({ onDismiss, onOpenChange });

    act(() => {
      skipButton()!.click();
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
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

    it(`renders NO skip button for ${slug}`, () => {
      tenantSlug = slug;
      renderDialog();

      // Not "disabled", not hidden by a class jsdom never loads — absent. An
      // operator with no Connect account must not be offered a way into a form
      // that produces rentals they cannot charge for.
      expect(dialogContent()).not.toBeNull();
      expect(skipButton()).toBeNull();
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

  it("gets no skip button either", () => {
    // NOTE THE DIRECTION. The other lean gates in lib/lean-areas.ts fail OPEN
    // on an unresolved slug — an unknown tenant keeps everything it has today,
    // because those gates TAKE areas away. This one is the inverse: it HANDS
    // OUT an escape from a block, so an unknown tenant must get the block. Both
    // fall out of the same `isLeanTenant` returning false; they only read as
    // opposites because the thing being gated is opposite.
    tenantSlug = null;
    renderDialog();

    expect(skipButton()).toBeNull();
  });

  it("gets no skip button for an unrecognised host either", () => {
    tenantSlug = "not-a-real-tenant";
    renderDialog();

    expect(dialogContent()).not.toBeNull();
    expect(skipButton()).toBeNull();
    expect(closeButton()).toBeNull();
  });
});

/**
 * THE TRAP THIS LOCKS
 * -------------------
 * There are two create-rental implementations, and `/rentals/new` hands v2
 * tenants (which is every lean tenant, i.e. every tenant that can see the skip
 * at all) to `RentalCreateV2` BEFORE the v1 file's own gate branch is reached.
 * A fix applied only to the v1 route therefore ships doing nothing for the
 * canary — which has already happened once on this exact code.
 *
 * `stripe-connect-status.test.ts` asserts the v1 route wires `onDismiss`. This
 * asserts the v2 component does too, because that is the one northwind renders.
 * Without `onDismiss` the skip button closes the dialog and the operator is
 * left staring at a blank screen, since that branch returns the dialog INSTEAD
 * of the form.
 */
describe("the v2 create path — the one the canary actually renders", () => {
  it("wires the canary's dismissal through to the gate hook", () => {
    const src = readPortalSource("components/rentals-v2/rental-create-v2.tsx");

    expect(src).toMatch(/dismiss:\s*dismissRentalCreationGate/);
    expect(src).toMatch(
      /<ConnectStripeRequiredDialog open onDismiss=\{dismissRentalCreationGate\}/,
    );
  });

  it("is reached before the v1 route's own gate branch", () => {
    // If this ordering ever flips, the v1 gate would run first and the v2
    // component's would be dead code — the failure mode that shipped before.
    const src = readPortalSource("app/(dashboard)/rentals/new/page.tsx");
    const v2Handoff = src.indexOf("return <RentalCreateV2 />");
    const v1Gate = src.indexOf("if (rentalCreationBlocked)");

    expect(v2Handoff).toBeGreaterThan(-1);
    expect(v1Gate).toBeGreaterThan(-1);
    expect(v2Handoff).toBeLessThan(v1Gate);
  });
});
