/**
 * InstallmentSettings, v2 (northwind) states, and v1 untouched.
 *
 * "Save changes" writes the whole installment_config, so a form over
 * placeholder defaults or a failed read would overwrite plan minimums, limits
 * and the retry policy. These tests pin: skeleton / error instead of that form,
 * the dirty + save-error state, the no-plan and no-provider notices, the saved
 * minimum days, read-only, and that a v1 tenant sees none of it.
 *
 * HARNESS: `react-dom/client` + `act` (the repo lacks @testing-library/dom).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const rs = vi.hoisted(() => ({ current: {} as any }));
const flags = vi.hoisted(() => ({ v2: true, edit: true }));
const toastSpy = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => rs.current }));
vi.mock("@/lib/v2-context", () => ({ useV2: () => flags.v2 }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => flags.edit, canViewSettings: () => true }),
}));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", currency_code: "USD" } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: toastSpy, useToast: () => ({ toast: toastSpy }) }));
vi.mock("@/components/installments/InstallmentCalendar", () => ({ InstallmentCalendar: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { InstallmentSettings } from "@/components/settings/InstallmentSettings";

let container: HTMLDivElement;
let root: Root;

const savedConfig = {
  weekly_enabled: false,
  weekly_payments_per_unit: 1,
  monthly_enabled: false,
  monthly_payments_per_unit: 1,
  minimum_days_weekly: 14,
  minimum_days_monthly: 45,
  weekly_installments_limit: 4,
  grace_period_days: 3,
};

function api(overrides: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  return {
    settings: { installments_enabled: true, installment_config: savedConfig, ...settings },
    hasLoaded: true,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue({}),
    isUpdating: false,
    ...overrides,
  };
}

function render() {
  act(() => root.render(<InstallmentSettings />));
}
const text = () => container.textContent ?? "";
const saveButton = () =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Save changes") as
    | HTMLButtonElement
    | undefined;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  flags.v2 = true;
  flags.edit = true;
  toastSpy.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("InstallmentSettings v2 states", () => {
  it("shows a skeleton, with no Save and no switch, until the real row arrives", () => {
    rs.current = api({ hasLoaded: false });
    render();
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(saveButton()).toBeUndefined();
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it("shows the load error instead of a default form after a failed read", () => {
    rs.current = api({ hasLoaded: false, error: new Error("Failed to fetch") });
    render();
    expect(text()).toContain("Couldn't load installment settings");
    expect(saveButton()).toBeUndefined();
    const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Try again"))!;
    act(() => retry.click());
    expect(rs.current.refetch).toHaveBeenCalledTimes(1);
  });

  it("warns that no plan is on, that no provider is connected, and shows the saved minimum days", () => {
    rs.current = api();
    render();
    expect(text()).toContain("Installments is on, but no plan is enabled");
    expect(text()).toContain("No payment provider is connected");
    expect(text()).toContain("Available for rentals 14+ days");
    expect(text()).toContain("Available for rentals 45+ days");
    // Nothing changed yet, so nothing to save.
    expect(saveButton()!.disabled).toBe(true);
  });

  it("drops the provider notice once Stripe is usable", () => {
    rs.current = api({}, { own_stripe_account_id: "acct_1" });
    render();
    expect(text()).not.toContain("No payment provider is connected");
  });

  it("marks a plan toggle as unsaved, saves the merged config, and keeps it dirty with the error on failure", async () => {
    rs.current = api({ updateSettings: vi.fn().mockRejectedValue(new Error("Failed to fetch")) });
    render();
    const weekly = container.querySelector<HTMLButtonElement>("#weekly-enabled")!;
    act(() => weekly.click());
    expect(text()).toContain("Unsaved changes");
    expect(saveButton()!.disabled).toBe(false);

    await act(async () => saveButton()!.click());
    // Every saved key the section does not own is carried through unchanged.
    expect(rs.current.updateSettings).toHaveBeenCalledWith({
      installment_config: { ...savedConfig, weekly_enabled: true },
    });
    expect(text()).toContain("Couldn't save.");
    expect(saveButton()!.disabled).toBe(false);
  });

  it("disables the controls and hides Save for a read-only user", () => {
    flags.edit = false;
    rs.current = api();
    render();
    expect(container.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
    expect(container.querySelector("fieldset[data-read-only]")).not.toBeNull();
    expect(saveButton()).toBeUndefined();
  });
});

describe("InstallmentSettings v1 is unchanged", () => {
  it("renders the v1 form over defaults with none of the v2 states", () => {
    flags.v2 = false;
    rs.current = api({ hasLoaded: false }, { installments_enabled: false, installment_config: null });
    render();
    expect(text()).toContain("Enable Installments");
    expect(text()).toContain("Available for rentals 7+ days");
    expect(container.querySelector("[data-settings-state]")).toBeNull();
    expect(container.querySelector("fieldset[data-read-only]")).toBeNull();
    expect(saveButton()!.disabled).toBe(false);
  });
});
