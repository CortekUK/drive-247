// @vitest-environment jsdom

/**
 * One code field on the signup checkout, for a promo OR a referral code.
 *
 * The server decides the kind from the code itself, so one box is enough. It
 * is always open, and named for both kinds so a referral code from a friend's
 * link plainly belongs here.
 *
 * WHAT THESE PIN:
 *   - the box is there without clicking anything;
 *   - what is typed goes to the lookup unchanged, whatever its kind;
 *   - a code carried in by a referral link is put back in the box, so it does
 *     not look lost after the banner said it was applied;
 *   - applying REPLACES, because the subscription takes one discount, and the
 *     replaced code is named;
 *   - a rejection is shown under the box and leaves the code to be corrected.
 */

import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DiscountCodeFields } from "./payment-step";
import type { PromoOffer } from "@/lib/promo-offer";

const offer = (over: Partial<PromoOffer> = {}): PromoOffer =>
  ({
    kind: "campaign",
    displayCode: "SAVE20",
    discountText: "20% off",
    durationText: "for 3 months",
    duration: "repeating",
    ...over,
  }) as PromoOffer;

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  document.cookie = "d247_ref=; max-age=0; path=/";
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const render = (props: Partial<Parameters<typeof DiscountCodeFields>[0]> = {}) => {
  act(() => {
    root.render(
      createElement(DiscountCodeFields, {
        busy: false,
        applied: null,
        onApply: vi.fn(async () => null),
        ...props,
      } as Parameters<typeof DiscountCodeFields>[0]),
    );
  });
};

const text = () => container.textContent ?? "";
const input = () => container.querySelector<HTMLInputElement>("#signup-discount-code");

const type = (value: string) => {
  const el = input()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const apply = async () => {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
};

describe("one field, always open", () => {
  it("shows the box without a click, named for both kinds", () => {
    render();
    expect(input()).not.toBeNull();
    expect(text()).toContain("Promo or referral code");
    expect(container.querySelectorAll("input")).toHaveLength(1);
  });
});

describe("what is typed goes to the lookup", () => {
  it("sends a promo code unchanged", async () => {
    const onApply = vi.fn(async () => null);
    render({ onApply });
    type("SAVE20");
    await apply();
    expect(onApply).toHaveBeenCalledWith("SAVE20");
  });

  it("sends a referral code unchanged", async () => {
    const onApply = vi.fn(async () => null);
    render({ onApply });
    type("FRIEND-42");
    await apply();
    expect(onApply).toHaveBeenCalledWith("FRIEND-42");
  });
});

describe("a code carried in by a referral link", () => {
  it("is put back in the box", () => {
    document.cookie = "d247_ref=FRIEND-42; path=/";
    render();
    expect(input()?.value).toBe("FRIEND-42");
  });
});

describe("only one code survives", () => {
  it("says which code was replaced", async () => {
    render({ applied: offer({ displayCode: "SAVE20" }), onApply: vi.fn(async () => null) });
    type("FRIEND-42");
    await apply();
    expect(text()).toContain("SAVE20 was replaced.");
  });

  it("shows the applied code in the box, with Remove instead of Apply", async () => {
    const onApply = vi.fn(async () => null);
    render({ applied: offer({ displayCode: "SAVE20" }), onApply });
    expect(input()?.value).toBe("SAVE20");
    const remove = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Remove");
    expect(remove).toBeDefined();
    await act(async () => {
      remove!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onApply).toHaveBeenCalledWith(null);
    expect(input()?.value).toBe("");
  });
});

describe("a rejected code", () => {
  it("is reported under the box and leaves the code to be corrected", async () => {
    render({ onApply: vi.fn(async () => "That code has expired.") });
    type("OLD-ONE");
    await apply();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("That code has expired.");
    expect(input()?.getAttribute("aria-invalid")).toBe("true");
    expect(input()?.value).toBe("OLD-ONE");
  });
});
