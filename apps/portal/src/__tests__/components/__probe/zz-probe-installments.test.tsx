/** PROBE — temporary. Renders InstallmentSettings (the v2 `installments` page body) and reports row alignment. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const rs = vi.hoisted(() => ({ current: {} as any }));
const flags = vi.hoisted(() => ({ v2: true, edit: true }));
const toastSpy = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-rental-settings", () => ({ useRentalSettings: () => rs.current }));
vi.mock("@/lib/v2-context", () => ({
  useV2: () => flags.v2,
  usePortalExperience: () => ({ onV2: false, lean: false }),
  usePortalOnV2: () => false,
}));
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
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

import { InstallmentSettings } from "@/components/settings/InstallmentSettings";

let container: HTMLDivElement;
let root: Root;

const savedConfig = {
  weekly_enabled: true,
  weekly_payments_per_unit: 1,
  monthly_enabled: true,
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

const START = "md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]";
const END = "md:grid-cols-[minmax(0,1fr)_auto]";

describe("PROBE installments alignment", () => {
  it("reports each row's grid", () => {
    rs.current = api();
    act(() => root.render(<InstallmentSettings registerSave={() => () => {}} />));
    const grids = Array.from(container.querySelectorAll<HTMLElement>("div.px-5.py-4 > div"));
    const report = grids
      .filter((g) => g.className.includes("md:grid-cols-"))
      .map((g) => {
        const label = g.firstElementChild?.textContent?.slice(0, 50) ?? "";
        const mode = g.className.includes(END) ? "END" : g.className.includes(START) ? "START" : "?";
        return `${mode} :: ${label}`;
      });
    // eslint-disable-next-line no-console
    console.log("INSTALLMENT ROWS:\n" + report.join("\n"));
    expect(report.length).toBeGreaterThan(0);
  });
});
