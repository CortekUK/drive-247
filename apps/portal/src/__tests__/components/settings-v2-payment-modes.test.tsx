/**
 * v2 Pay As You Go and Auto-extension pages (`settings-v2/payment-modes-v2`).
 *
 * Both pages save a control the moment it changes, so the states that matter
 * are the ones that could write a wrong value: no switch over placeholder
 * defaults or after a failed read, a failed write shows the SAVED value again,
 * read-only users cannot operate anything, and a bad number is never saved.
 *
 * HARNESS: `react-dom/client` + `act` (the repo lacks @testing-library/dom).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const rs = vi.hoisted(() => ({ current: {} as any }));
vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => rs.current }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AutoExtendSettingsV2, PayAsYouGoSettingsV2 } from "@/components/settings-v2/payment-modes-v2";

let container: HTMLDivElement;
let root: Root;

function api(overrides: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  return {
    settings: {
      pay_as_you_go_enabled: false,
      payg_upfront_required: false,
      payg_auto_reminders_enabled: true,
      auto_extend_enabled: false,
      auto_extend_default_charge_mode: "pay_link",
      auto_extend_default_lead_hours: 0,
      auto_extend_grace_hours: 48,
      auto_extend_max_retries: 3,
      ...settings,
    },
    hasLoaded: true,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue({}),
    isUpdating: false,
    ...overrides,
  };
}

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

const switches = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
const text = () => container.textContent ?? "";

function deferred() {
  let resolve!: (v?: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function blur(input: HTMLInputElement) {
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PayAsYouGoSettingsV2", () => {
  it("shows a skeleton, not a writable switch, until the real settings arrive", () => {
    rs.current = api({ hasLoaded: false });
    render(<PayAsYouGoSettingsV2 canEdit />);
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(switches()).toHaveLength(0);
  });

  it("shows the load error with a retry after a failed first read, never the default switch", () => {
    rs.current = api({ hasLoaded: false, error: new Error("Failed to fetch") });
    render(<PayAsYouGoSettingsV2 canEdit />);
    expect(text()).toContain("Couldn't load pay as you go settings");
    expect(switches()).toHaveLength(0);
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Try again"))!;
    act(() => retry.click());
    expect(rs.current.refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the controls when a refresh fails over loaded settings, with the inline error above", () => {
    rs.current = api({ error: new Error("timeout") });
    render(<PayAsYouGoSettingsV2 canEdit />);
    expect(text()).toContain("Couldn't refresh pay as you go settings.");
    expect(switches()).toHaveLength(1);
  });

  it("explains the off state and shows the two follow-up switches only when on", () => {
    rs.current = api();
    render(<PayAsYouGoSettingsV2 canEdit />);
    expect(text()).toContain("Off for new rentals");
    expect(switches()).toHaveLength(1);

    rs.current = api({}, { pay_as_you_go_enabled: true });
    render(<PayAsYouGoSettingsV2 canEdit />);
    expect(switches()).toHaveLength(3);
    expect(text()).not.toContain("Off for new rentals");
  });

  it("saves only the flipped key, shows it saving, then shows the SAVED value again when the write fails", async () => {
    const write = deferred();
    rs.current = api({ updateSettings: vi.fn(() => write.promise) });
    render(<PayAsYouGoSettingsV2 canEdit />);

    await act(async () => switches()[0].click());
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ pay_as_you_go_enabled: true });
    expect(switches()[0].getAttribute("aria-checked")).toBe("true");
    expect(switches()[0].disabled).toBe(true);
    expect(text()).toContain("Saving…");

    await act(async () => {
      write.reject(new Error("permission denied"));
      await write.promise.catch(() => undefined);
    });
    // The database still says off, so the switch says off.
    expect(switches()[0].getAttribute("aria-checked")).toBe("false");
    expect(switches()[0].disabled).toBe(false);
    expect(text()).toContain("Couldn't turn pay as you go on. Nothing was changed.");

    rs.current.updateSettings.mockResolvedValueOnce({});
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
    await act(async () => retry.click());
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(2);
    expect(rs.current.updateSettings).toHaveBeenLastCalledWith({ pay_as_you_go_enabled: true });
    expect(text()).not.toContain("Nothing was changed.");
  });

  it("disables every control for a read-only user, keyboard included (native fieldset)", () => {
    rs.current = api({}, { pay_as_you_go_enabled: true });
    render(<PayAsYouGoSettingsV2 canEdit={false} />);
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect(switches().every((s) => s.disabled)).toBe(true);
  });
});

describe("AutoExtendSettingsV2", () => {
  const inputs = () => Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'));

  it("refuses empty, decimal and out-of-range numbers without saving, and skips unchanged ones", async () => {
    rs.current = api({}, { auto_extend_enabled: true });
    render(<AutoExtendSettingsV2 canEdit />);
    const [lead, grace, retries] = inputs();
    expect([lead.value, grace.value, retries.value]).toEqual(["0", "48", "3"]);

    typeInto(grace, "");
    await blur(grace);
    expect(text()).toContain("Grace window: Enter 0–720 hours");
    expect(grace.getAttribute("aria-invalid")).toBe("true");

    typeInto(lead, "1.5");
    await blur(lead);
    expect(text()).toContain("Charge lead time: Enter 0–168 hours");

    typeInto(retries, "25");
    await blur(retries);
    expect(text()).toContain("Retries: Enter 0–20 retries");

    typeInto(grace, "48"); // back to the saved value
    await blur(grace);
    expect(text()).not.toContain("Grace window:");
    expect(rs.current.updateSettings).not.toHaveBeenCalled();
  });

  it("explains a value already saved out of range, never corrects it, and widens the field for every digit", async () => {
    rs.current = api({}, { auto_extend_enabled: true, auto_extend_default_lead_hours: 9999999, auto_extend_max_retries: -3 });
    render(<AutoExtendSettingsV2 canEdit />);
    const [lead, grace, retries] = inputs();
    expect([lead.value, grace.value, retries.value]).toEqual(["9999999", "48", "-3"]);
    expect(text()).toContain("Charge lead time: The saved value 9,999,999 is outside 0–168 hours. Enter a new value.");
    expect(text()).toContain("Retries: The saved value -3 is outside 0–20 retries. Enter a new value.");
    expect(lead.getAttribute("aria-invalid")).toBe("true");
    expect(grace.getAttribute("aria-invalid")).toBeNull();
    expect(lead.style.minWidth).toBe("calc(7ch + 1.75rem)");
    expect(rs.current.updateSettings).not.toHaveBeenCalled();

    typeInto(lead, "24");
    await blur(lead);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ auto_extend_default_lead_hours: 24 });
    expect(text()).toContain("Retries: The saved value -3");
  });

  it("saves a valid changed number as a number, under its own key", async () => {
    rs.current = api({}, { auto_extend_enabled: true });
    render(<AutoExtendSettingsV2 canEdit />);
    const grace = inputs()[1];
    typeInto(grace, "72");
    await blur(grace);
    expect(rs.current.updateSettings).toHaveBeenCalledTimes(1);
    expect(rs.current.updateSettings).toHaveBeenCalledWith({ auto_extend_grace_hours: 72 });
  });

  it("warns when auto-charge is the default but no payment provider is connected", () => {
    rs.current = api({}, { auto_extend_enabled: true, auto_extend_default_charge_mode: "auto_charge" });
    render(<AutoExtendSettingsV2 canEdit />);
    expect(text()).toContain("No payment provider is connected");
    expect(container.querySelector('a[href="/integrations"]')).not.toBeNull();

    rs.current = api({}, { auto_extend_enabled: true, auto_extend_default_charge_mode: "auto_charge", own_stripe_account_id: "acct_1" });
    render(<AutoExtendSettingsV2 canEdit />);
    expect(text()).not.toContain("No payment provider is connected");

    rs.current = api({}, { auto_extend_enabled: true, auto_extend_default_charge_mode: "pay_link" });
    render(<AutoExtendSettingsV2 canEdit />);
    expect(text()).not.toContain("No payment provider is connected");
  });

  it("hides the billing rows and explains the off state", () => {
    rs.current = api();
    render(<AutoExtendSettingsV2 canEdit />);
    expect(inputs()).toHaveLength(0);
    expect(text()).toContain("Off for new rentals");
  });

  it("'How to take payment' is the v2 dropdown", () => {
    rs.current = api({}, { auto_extend_enabled: true });
    render(<AutoExtendSettingsV2 canEdit />);
    const trigger = container.querySelector('[aria-label="How to take payment"]')!;
    expect(trigger.getAttribute("data-slot")).toBe("select-trigger");
    expect(trigger.className).toContain("rounded-3xl");
  });
});
