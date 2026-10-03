// @vitest-environment jsdom

/**
 * Two code fields on the signup checkout, and only one code can win.
 *
 * It was one box labelled "Promo code" that silently accepted referral codes as
 * well, because the server decides the kind from the code itself. Somebody
 * holding a referral code from a friend's link had no field with their name on
 * it and no reason to believe it would be taken.
 *
 * WHAT THESE PIN, each being a way two fields go wrong:
 *   - both fields post to the SAME lookup, so a referral code typed in the
 *     promo box is still accepted — the labels are a signpost, not a rule;
 *   - a code carried in by a referral link lands in the Referral field, so it
 *     does not look lost after the banner said it was applied;
 *   - applying REPLACES, because the subscription takes one signup discount —
 *     and the rule is stated before it surprises anyone;
 *   - applying in one field clears the other, so a stale code never sits there
 *     looking applied;
 *   - a rejection is shown against the field it was typed into.
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
const open = () => {
  const link = container.querySelector("button");
  act(() => link?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const input = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const applyButtonFor = (label: string) =>
  input(label)?.closest("form")?.querySelector<HTMLButtonElement>('button[type="submit"]');

const type = (label: string, value: string) => {
  const el = input(label)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const apply = async (label: string) => {
  await act(async () => {
    applyButtonFor(label)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
};

describe("it stays a link until asked for", () => {
  it("offers both kinds by name when nothing is applied", () => {
    render();
    expect(text()).toContain("Have a promo or referral code?");
  });

  it("offers a swap once a code is on the subscription", () => {
    // Hiding the fields here left "use a different code" with nowhere to go.
    render({ applied: offer() });
    expect(text()).toContain("Use a different code");
  });
});

describe("two labelled fields", () => {
  beforeEach(() => {
    render();
    open();
  });

  it("shows one for each kind", () => {
    expect(input("Promo code")).not.toBeNull();
    expect(input("Referral code")).not.toBeNull();
  });

  it("states the one-code rule before anyone trips over it", () => {
    expect(text()).toMatch(/Only one discount code can be applied per subscription/i);
  });
});

describe("a code carried in by a referral link", () => {
  it("lands in the Referral field", () => {
    document.cookie = "d247_ref=FRIEND-42; path=/";
    render();
    open();
    expect(input("Referral code")?.value).toBe("FRIEND-42");
    expect(input("Promo code")?.value).toBe("");
  });

  it("does not overwrite something already typed there", () => {
    document.cookie = "d247_ref=FRIEND-42; path=/";
    render();
    open();
    type("Referral code", "MY-OWN-CODE");
    expect(input("Referral code")?.value).toBe("MY-OWN-CODE");
  });
});

describe("both fields post to the same lookup", () => {
  it("sends what was typed in the promo field", async () => {
    const onApply = vi.fn(async () => null);
    render({ onApply });
    open();
    type("Promo code", "SAVE20");
    await apply("Promo code");
    expect(onApply).toHaveBeenCalledWith("SAVE20");
  });

  it("sends what was typed in the referral field, unchanged", async () => {
    // The server decides the kind. A referral code is not re-labelled here.
    const onApply = vi.fn(async () => null);
    render({ onApply });
    open();
    type("Referral code", "FRIEND-42");
    await apply("Referral code");
    expect(onApply).toHaveBeenCalledWith("FRIEND-42");
  });
});

describe("only one code survives", () => {
  it("says which code was replaced", async () => {
    render({ applied: offer({ displayCode: "SAVE20" }), onApply: vi.fn(async () => null) });
    open();
    type("Referral code", "FRIEND-42");
    await apply("Referral code");
    expect(text()).toContain("SAVE20 was replaced.");
  });

  it("clears the other field, so no stale code sits there looking applied", async () => {
    render();
    open();
    type("Promo code", "SAVE20");
    type("Referral code", "FRIEND-42");
    await apply("Referral code");
    expect(input("Promo code")?.value).toBe("");
    expect(input("Referral code")?.value).toBe("FRIEND-42");
  });

  it("says nothing about replacing when re-applying the same code", async () => {
    render({ applied: offer({ displayCode: "SAVE20" }), onApply: vi.fn(async () => null) });
    open();
    type("Promo code", "SAVE20");
    await apply("Promo code");
    expect(text()).not.toContain("was replaced");
  });
});

describe("a rejected code", () => {
  it("is reported against the field it was typed into", async () => {
    render({ onApply: vi.fn(async () => "That code has expired.") });
    open();
    type("Referral code", "OLD-ONE");
    await apply("Referral code");

    const message = container.querySelector('[role="alert"]');
    expect(message?.textContent).toBe("That code has expired.");
    expect(input("Referral code")?.getAttribute("aria-invalid")).toBe("true");
    expect(input("Promo code")?.getAttribute("aria-invalid")).toBeNull();
  });

  it("leaves the typed code in place to be corrected", async () => {
    render({ onApply: vi.fn(async () => "No such code.") });
    open();
    type("Promo code", "TYPOO");
    await apply("Promo code");
    expect(input("Promo code")?.value).toBe("TYPOO");
  });
});
