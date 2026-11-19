// @vitest-environment jsdom

/**
 * The code screen on a phone: "Check your inbox", six boxes.
 *
 * WHAT THESE PIN:
 *   - the field is one input marked as a one-time code, numeric, so iOS and
 *     Android offer the code from the email or the notification;
 *   - a pasted code (with the spaces a mail app brings along) fills all six
 *     boxes at once and submits;
 *   - "Open Gmail" / "Open Outlook" appear on a touch screen only;
 *   - a screen restored after a reload resumes the resend countdown.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { VerifyStep, type VerifyStepProps } from "./verify-step";

let container: HTMLDivElement;
let root: Root;
let coarse = false;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  coarse = false;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("pointer: coarse") ? coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props: Partial<VerifyStepProps> = {}) => {
  const onVerify = vi.fn(async () => true);
  act(() => {
    root.render(
      createElement(VerifyStep, {
        email: "jordan@harborcars.com",
        busy: false,
        onVerify,
        onResend: vi.fn(async () => {}),
        onUseDifferentEmail: vi.fn(),
        error: null,
        onClearError: vi.fn(),
        ...props,
      }),
    );
  });
  return { onVerify };
};

const input = () => container.querySelector<HTMLInputElement>("#signup-otp")!;
const boxes = () =>
  Array.from(container.querySelectorAll<HTMLDivElement>("[aria-hidden] > div")).map((d) => d.textContent ?? "");
const buttonTexts = () => Array.from(container.querySelectorAll("button")).map((b) => b.textContent?.trim());

describe("the phone offers the code", () => {
  it("is one numeric one-time-code field", () => {
    render();
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(input().getAttribute("autocomplete")).toBe("one-time-code");
    expect(input().getAttribute("inputmode")).toBe("numeric");
    expect(input().getAttribute("pattern")).toBe("[0-9]*");
  });
});

describe("pasting a whole code", () => {
  it("fills every box and submits it, whatever came with it", async () => {
    const { onVerify } = render();
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData(): string };
    };
    paste.clipboardData = { getData: () => " 220 465\n" };
    await act(async () => {
      input().dispatchEvent(paste);
    });
    expect(boxes()).toEqual(["2", "2", "0", "4", "6", "5"]);
    expect(onVerify).toHaveBeenCalledWith("220465");
  });
});

describe("Open Gmail / Open Outlook", () => {
  it("are not shown on a laptop", () => {
    render();
    expect(buttonTexts()).not.toContain("Open Gmail");
  });

  it("are shown on a touch screen", () => {
    coarse = true;
    render();
    expect(buttonTexts()).toEqual(expect.arrayContaining(["Open Gmail", "Open Outlook"]));
  });
});

describe("a restored code screen", () => {
  it("resumes the resend countdown from when the code was sent", () => {
    render({ sentAt: Date.now() - 45_000 });
    const resend = buttonTexts().find((t) => t?.startsWith("Resend"));
    expect(resend).toMatch(/Resend in 1[5-6]s/);
  });

  it("offers Resend at once for a code sent over a minute ago", () => {
    render({ sentAt: Date.now() - 5 * 60_000 });
    expect(buttonTexts()).toContain("Resend code");
  });
});
