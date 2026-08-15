// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
}));

vi.mock("react", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    ...react,
    useActionState: () => [
      {
        success: true,
        sessionId: "b72f37a2-b391-4b2a-943f-f43bdd613420",
      },
      vi.fn(),
      false,
    ],
  };
});

import StrategyCallPage from "./page";
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

describe("strategy-call calendar handoff", () => {
  it("navigates only once when the trusted frame emits duplicate completion messages", async () => {
    navigation.replace.mockClear();
    await act(async () => root.render(<StrategyCallPage />));

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
