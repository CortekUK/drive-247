// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
/** What the form's action state is: sent (the default here), or null for the form itself. */
const action = vi.hoisted(() => ({
  state: { success: true, sessionId: "b72f37a2-b391-4b2a-943f-f43bdd613420" } as unknown,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
}));

vi.mock("react", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    ...react,
    useActionState: () => [action.state, vi.fn(), false],
  };
});

import { BookDemoFlow } from "./book-demo-flow";
import { GHL_BOOKING_URL } from "@/lib/constants";

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("book a demo: calendar handoff", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEMO_CALENDAR", "on"));
  afterEach(() => vi.unstubAllEnvs());

  it("navigates only once when the trusted frame emits duplicate completion messages", async () => {
    navigation.replace.mockClear();
    await act(async () => root.render(<BookDemoFlow />));

    const iframe = container.querySelector<HTMLIFrameElement>(
      'iframe[title="Book a strategy call"]',
    );
    expect(iframe).not.toBeNull();
    const completion = () =>
      new MessageEvent("message", {
        data: ["msgsndr-booking-complete"],
        origin: new URL(GHL_BOOKING_URL).origin,
        source: iframe?.contentWindow ?? null,
      });

    act(() => {
      window.dispatchEvent(completion());
      window.dispatchEvent(completion());
    });

    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith(
      "/strategy-call/confirmation",
    );
  });
});

describe("book a demo: the business screen", () => {
  const sent = action.state;
  beforeEach(() => {
    action.state = null;
  });
  afterEach(() => {
    action.state = sent;
  });

  /** Types into an input the way a person does, so React's onChange fires. */
  const type = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const next = () =>
    act(() => {
      container.querySelector<HTMLFormElement>("form")!.requestSubmit();
    });
  const hidden = (name: string) =>
    container.querySelector<HTMLInputElement>(`input[type=hidden][name=${name}]`)?.value;

  it("asks for the rental company name and the city and state, both required, and sends them", async () => {
    await act(async () => root.render(<BookDemoFlow />));
    const [name, email] = Array.from(container.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([name=website])"));
    act(() => {
      type(name, "Sam Lee");
      type(email, "sam@harbor.test");
    });
    next();

    expect(container.textContent).toContain("Tell us about your business");
    expect(container.textContent).toContain("Rental company name");
    expect(container.textContent).toContain("City and state");

    // Empty: the screen does not let go.
    next();
    expect(container.textContent).toContain("Add your company name");
    expect(container.textContent).toContain("Add your city and state");
    expect(container.textContent).toContain("Tell us about your business");

    const company = container.querySelector<HTMLInputElement>('input[placeholder="Acme Car Rentals"]')!;
    const city = container.querySelector<HTMLInputElement>('input[placeholder="Houston, TX"]')!;
    act(() => {
      type(company, "  Harbor Car Rentals ");
      type(city, "Houston, TX");
    });
    next();
    expect(container.textContent).toContain("Tell us about your fleet");

    // Both travel with the form, trimmed, to /api/strategy-call/submit.
    expect(hidden("company_name")).toBe("Harbor Car Rentals");
    expect(hidden("city_state")).toBe("Houston, TX");
  });
});

describe("book a demo: with the calendar off (the default)", () => {
  it("thanks the visitor and offers the free trial instead of an empty calendar", async () => {
    await act(async () => root.render(<BookDemoFlow />));

    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("We'll be in touch.");
    const trial = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Start free trial"),
    );
    expect(trial).toBeDefined();
  });
});
