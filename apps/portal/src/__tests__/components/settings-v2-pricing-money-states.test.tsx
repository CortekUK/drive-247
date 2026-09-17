/**
 * v2 Settings (northwind): every state of Pricing rules, Tax and fees and
 * Security deposit.
 *
 *   components/settings-v2/pricing-money-logic.ts   (pure rules)
 *   components/settings-v2/pricing-money-parts.tsx  (read state, save state)
 *   components/settings-v2/fees-deposit-v2.tsx
 *   components/settings-v2/pricing-rules-v2.tsx
 *
 * Expected values are worked out by hand in the comments, never produced by
 * the code under test. The payload assertions pin that the saved objects are
 * exactly the ones the pages sent before (presentation-only change).
 *
 * HARNESS: `react-dom/client` + `act`, like settings-section-states.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  edit: true,
  reads: {} as Record<string, any>,
  weekend: {} as any,
  holidays: {} as any,
}));

vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => h.edit, canViewSettings: () => true }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "t1", currency_code: "USD" } }),
}));
vi.mock("@/hooks/use-weekend-pricing", () => ({ useWeekendPricing: () => h.weekend }));
vi.mock("@/hooks/use-tenant-holidays", () => ({ useTenantHolidays: () => h.holidays }));
vi.mock("@/hooks/use-audit-log-on-open", () => ({ useAuditLogOnOpen: () => undefined }));
vi.mock("@/components/settings-v2/pricing-money-parts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/settings-v2/pricing-money-parts")>();
  return {
    ...actual,
    useSettingsReadState: (key: any, enabled?: boolean) =>
      h.reads[String(key[0])] ?? actual.useSettingsReadState(key, enabled),
  };
});

import {
  depositAmountIssue,
  depositChargeGuard,
  depositDirtyState,
  depositPayload,
  describeHolidayDeleteError,
  feesPayload,
  formatHolidayDates,
  formatPercent,
  holidayFormErrors,
  isFeesDirty,
  isHolidayPast,
  isWeekendDirty,
  localDateKey,
  serviceFeeIssue,
  taxIssue,
  weekendDaysIssue,
  weekendOffNote,
  weekendPercentIssue,
  EMPTY_HOLIDAY_FORM,
} from "@/components/settings-v2/pricing-money-logic";
import { DepositSettingsV2, FeesSettingsV2 } from "@/components/settings-v2/fees-deposit-v2";
import { PricingRulesV2 } from "@/components/settings-v2/pricing-rules-v2";
import { SettingsPageSaveProvider } from "@/components/settings-v2/settings-kit";

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

const text = () => document.body.textContent ?? "";

function findButton(name: string | RegExp, scope: ParentNode = document.body): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll("button")).find((b) => {
    const label = `${b.getAttribute("aria-label") ?? ""}|${b.textContent?.trim() ?? ""}`;
    return typeof name === "string"
      ? b.textContent?.trim() === name || b.getAttribute("aria-label") === name
      : name.test(label);
  });
}

function button(name: string | RegExp, scope: ParentNode = document.body): HTMLButtonElement {
  const hit = findButton(name, scope);
  if (!hit) {
    throw new Error(
      `No button "${name}" in: ${Array.from(scope.querySelectorAll("button"))
        .map((b) => b.getAttribute("aria-label") || b.textContent)
        .join(" | ")}`,
    );
  }
  return hit;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const readState = (over: Record<string, unknown> = {}) => ({
  hasData: true,
  isLoading: false,
  isError: false,
  error: null,
  isFetching: false,
  refetch: vi.fn(async () => undefined),
  ...over,
});
const loadingState = () => readState({ hasData: false, isLoading: true });
const failedState = () => readState({ hasData: false, isError: true, error: new Error("boom") });

// setup.ts mocks ResizeObserver with an arrow `vi.fn`, which Vitest 4 cannot
// `new`. A Radix Switch inside a <form> (the holiday dialog) measures itself
// with one, so give it a real class here.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  h.edit = true;
  h.reads = {};
  h.weekend = {
    settings: { weekend_surcharge_percent: 10, weekend_days: [6, 0], stack_surcharges: false },
    updateSettings: vi.fn(async () => undefined),
  };
  h.holidays = {
    holidays: [],
    addHoliday: vi.fn(async () => undefined),
    isAdding: false,
    updateHoliday: vi.fn(async () => undefined),
    isUpdating: false,
    deleteHoliday: vi.fn(async () => undefined),
    isDeleting: false,
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

/* -------------------------------------------------------------------------- */
/* Pure rules                                                                  */
/* -------------------------------------------------------------------------- */

describe("pricing-money-logic", () => {
  it("fees: '7.50' equals a saved 7.5, a cleared field does not equal 0, a null fee value falls back to the amount", () => {
    const saved = {
      tax_enabled: true,
      tax_percentage: 7.5,
      service_fee_enabled: false,
      service_fee_type: "fixed_amount",
      service_fee_value: null,
      service_fee_amount: 5,
    };
    const form = {
      tax_enabled: true,
      tax_percentage: "7.50",
      service_fee_enabled: false,
      service_fee_type: "fixed_amount" as const,
      service_fee_value: 5,
    };
    expect(isFeesDirty(form, saved)).toBe(false);
    expect(isFeesDirty({ ...form, tax_percentage: "" }, saved)).toBe(true);
    expect(isFeesDirty({ ...form, service_fee_value: 6 }, saved)).toBe(true);
    expect(isFeesDirty({ ...form, service_fee_type: "percentage" }, saved)).toBe(true);
    expect(isFeesDirty(form, null)).toBe(false);
  });

  it("fees: the payload is the one the page always sent (amount mirrors value)", () => {
    expect(
      feesPayload({
        tax_enabled: true,
        tax_percentage: 8,
        service_fee_enabled: true,
        service_fee_type: "percentage",
        service_fee_value: 3,
        service_fee_amount: 999,
      }),
    ).toEqual({
      tax_enabled: true,
      tax_percentage: 8,
      service_fee_enabled: true,
      service_fee_amount: 3,
      service_fee_type: "percentage",
      service_fee_value: 3,
    });
  });

  it("tax: off says nothing, 0% and 100% warn, 8% is fine", () => {
    expect(taxIssue({ tax_enabled: false, tax_percentage: 0 })).toBeNull();
    expect(taxIssue({ tax_enabled: true, tax_percentage: 0 })?.message).toBe(
      "Tax is on but the rate is 0%, so no tax will be added.",
    );
    expect(taxIssue({ tax_enabled: true, tax_percentage: "" })?.tone).toBe("warning");
    expect(taxIssue({ tax_enabled: true, tax_percentage: 100 })?.message).toContain("100% tax doubles");
    expect(taxIssue({ tax_enabled: true, tax_percentage: 8 })).toBeNull();
  });

  it("service fee: a fixed 250 switched to Percentage blocks Save; fixed 250 is fine; 0 warns", () => {
    const pct = serviceFeeIssue({ service_fee_enabled: true, service_fee_type: "percentage", service_fee_value: 250 });
    expect(pct?.blocksSave).toBe(true);
    expect(pct?.message).toContain("250% is more than the whole rental");
    expect(serviceFeeIssue({ service_fee_enabled: true, service_fee_type: "percentage", service_fee_value: 100 })).toBeNull();
    expect(serviceFeeIssue({ service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: 250 })).toBeNull();
    expect(serviceFeeIssue({ service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: 0 })?.tone).toBe("warning");
    expect(serviceFeeIssue({ service_fee_enabled: false, service_fee_type: "percentage", service_fee_value: 250 })).toBeNull();
  });

  it("deposit: the two switches count as unsaved edits (saved null enabled means on)", () => {
    const saved = { security_deposit_enabled: null, deposit_charge_enabled: false, deposit_mode: null, global_deposit_amount: 200 };
    expect(depositDirtyState({ security_deposit_enabled: true, deposit_charge_enabled: true, deposit_mode: "global", global_deposit_amount: 200 }, saved)).toEqual({
      dirty: true,
      switchesDirty: true,
      chargeNotSaved: true,
    });
    expect(depositDirtyState({ security_deposit_enabled: true, deposit_charge_enabled: false, deposit_mode: "global", global_deposit_amount: "200" }, saved)).toEqual({
      dirty: false,
      switchesDirty: false,
      chargeNotSaved: false,
    });
    expect(depositDirtyState({ security_deposit_enabled: true, deposit_charge_enabled: false, deposit_mode: "global", global_deposit_amount: 250 }, saved)).toEqual({
      dirty: true,
      switchesDirty: false,
      chargeNotSaved: false,
    });
    expect(
      depositPayload({ security_deposit_enabled: false, deposit_charge_enabled: true, deposit_mode: "per_vehicle", global_deposit_amount: 75 }),
    ).toEqual({ security_deposit_enabled: false, deposit_charge_enabled: true, deposit_mode: "per_vehicle", global_deposit_amount: 75 });
  });

  it("deposit: an unknown live-holds count locks the switch to charges instead of reading as 0", () => {
    expect(depositChargeGuard({ chargeEnabled: false, holdsKnown: false, holdsFailed: false, liveHoldCount: 0 })).toBe("checking");
    expect(depositChargeGuard({ chargeEnabled: false, holdsKnown: false, holdsFailed: true, liveHoldCount: 0 })).toBe("unknown");
    expect(depositChargeGuard({ chargeEnabled: false, holdsKnown: true, holdsFailed: false, liveHoldCount: 2 })).toBe("blocked");
    expect(depositChargeGuard({ chargeEnabled: false, holdsKnown: true, holdsFailed: false, liveHoldCount: 0 })).toBe("allowed");
    // Switching back to holds is always allowed.
    expect(depositChargeGuard({ chargeEnabled: true, holdsKnown: false, holdsFailed: true, liveHoldCount: 5 })).toBe("allowed");
  });

  it("deposit: a zero amount says what happens, in the tenant currency", () => {
    const base = { security_deposit_enabled: true, deposit_charge_enabled: false, deposit_mode: "global", global_deposit_amount: 0 };
    expect(depositAmountIssue(base, "GBP")?.message).toBe("The amount is £0.00, so no hold will be placed.");
    expect(depositAmountIssue({ ...base, deposit_charge_enabled: true }, "USD")?.message).toBe(
      "The amount is $0.00, so no deposit will be collected.",
    );
    expect(depositAmountIssue({ ...base, deposit_mode: "per_vehicle" }, "EUR")?.message).toContain("vehicles without their own deposit");
    expect(depositAmountIssue({ ...base, global_deposit_amount: 50 }, "USD")).toBeNull();
    expect(depositAmountIssue({ ...base, security_deposit_enabled: false }, "USD")).toBeNull();
  });

  it("weekend: negative blocks, over 100 warns, 0 reads as off, a surcharge with no days warns", () => {
    expect(weekendPercentIssue(-5)?.blocksSave).toBe(true);
    expect(weekendPercentIssue(150)?.message).toContain("+150% more than doubles");
    expect(weekendPercentIssue(20)).toBeNull();
    expect(weekendPercentIssue("")).toBeNull();
    expect(weekendOffNote("")?.message).toBe("Off. Weekend bookings use the normal daily rate.");
    expect(weekendOffNote(15)).toBeNull();
    expect(weekendDaysIssue(10, [])?.message).toBe("Pick at least one day, or this surcharge never applies.");
    expect(weekendDaysIssue(0, [])).toBeNull();
    expect(weekendDaysIssue(10, [5, 6, 0])?.tone).toBe("info");
  });

  it("weekend: day order is not an edit, a removed day is", () => {
    const saved = { weekend_surcharge_percent: 10, weekend_days: [6, 0], stack_surcharges: false };
    expect(isWeekendDirty({ percent: "10", days: [0, 6], stack: false }, saved)).toBe(false);
    expect(isWeekendDirty({ percent: 10, days: [6], stack: false }, saved)).toBe(true);
    expect(isWeekendDirty({ percent: 10, days: [6, 0], stack: true }, saved)).toBe(true);
    // Blank saves as 0 (Number('') || 0), so blank over a saved 0 is not an edit.
    expect(isWeekendDirty({ percent: "", days: [6, 0], stack: false }, { ...saved, weekend_surcharge_percent: 0 })).toBe(false);
  });

  it("holiday form: says why it can't save, matching the v1 validity rule", () => {
    expect(Object.keys(holidayFormErrors(EMPTY_HOLIDAY_FORM)).sort()).toEqual(["end_date", "name", "start_date"]);
    expect(
      holidayFormErrors({ name: "Xmas", start_date: "2026-12-25", end_date: "2026-12-24", surcharge_percent: "", recurs_annually: false }),
    ).toEqual({ end_date: "The last day can't be before the first day." });
    expect(
      holidayFormErrors({ name: "Xmas", start_date: "2026-12-24", end_date: "2026-12-26", surcharge_percent: -1, recurs_annually: false }),
    ).toEqual({ surcharge_percent: "Enter 0 or more." });
    expect(
      holidayFormErrors({ name: "  ", start_date: "2026-12-24", end_date: "2026-12-24", surcharge_percent: 0, recurs_annually: true }),
    ).toEqual({ name: "Give the holiday a name." });
  });

  it("holiday rows: past only for one-time holidays that have ended; dates and percentages format", () => {
    expect(isHolidayPast({ end_date: "2026-09-14", recurs_annually: false }, "2026-09-15")).toBe(true);
    expect(isHolidayPast({ end_date: "2026-09-15", recurs_annually: false }, "2026-09-15")).toBe(false);
    expect(isHolidayPast({ end_date: "2020-01-01", recurs_annually: true }, "2026-09-15")).toBe(false);
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatHolidayDates("2026-12-24", "2026-12-26")).toBe("Dec 24, 2026 – Dec 26, 2026");
    expect(formatHolidayDates("2026-12-25", "2026-12-25")).toBe("Dec 25, 2026");
    expect(formatPercent(12.5, true)).toBe("+12.5%");
    expect(formatPercent(1234567, true)).toBe("+1,234,567%");
    expect(formatPercent(0, true)).toBe("0%");
    expect(formatPercent(null)).toBe("—");
  });
});

/* -------------------------------------------------------------------------- */
/* Read state                                                                  */
/* -------------------------------------------------------------------------- */

describe("useSettingsReadState", () => {
  it("reports loading, loaded and failed from the cache, and is inert when disabled", async () => {
    const { useSettingsReadState } = await vi.importActual<typeof import("@/components/settings-v2/pricing-money-parts")>(
      "@/components/settings-v2/pricing-money-parts",
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let seen: any;
    function Probe({ k, enabled }: { k: string; enabled?: boolean }) {
      seen = useSettingsReadState([k, "t1"], enabled);
      return null;
    }
    const show = (k: string, enabled?: boolean) =>
      render(
        <QueryClientProvider client={client}>
          <Probe k={k} enabled={enabled} />
        </QueryClientProvider>,
      );

    show("a");
    expect(seen).toMatchObject({ hasData: false, isLoading: true, isError: false });

    act(() => {
      client.setQueryData(["a", "t1"], { weekend_surcharge_percent: 0 });
    });
    show("a");
    expect(seen).toMatchObject({ hasData: true, isLoading: false, isError: false });

    await act(async () => {
      await client.prefetchQuery({ queryKey: ["b", "t1"], queryFn: () => Promise.reject(new Error("nope")) });
    });
    show("b");
    expect(seen).toMatchObject({ hasData: false, isLoading: false, isError: true });
    expect((seen.error as Error).message).toBe("nope");

    show("a", false);
    expect(seen).toMatchObject({ hasData: false, isLoading: false, isError: false });
  });
});

/* -------------------------------------------------------------------------- */
/* Tax and fees                                                                */
/* -------------------------------------------------------------------------- */

describe("FeesSettingsV2", () => {
  const saved = {
    tax_enabled: true,
    tax_percentage: 7.5,
    service_fee_enabled: false,
    service_fee_type: "fixed_amount",
    service_fee_value: null,
    service_fee_amount: 0,
  };
  const form = {
    tax_enabled: true,
    tax_percentage: 7.5,
    service_fee_enabled: false,
    service_fee_type: "fixed_amount" as const,
    service_fee_value: 0,
    service_fee_amount: 0,
  };
  const props = (over: Record<string, unknown> = {}) => ({
    form,
    setForm: vi.fn(),
    saved,
    read: readState(),
    canEdit: true,
    currencyCode: "USD",
    onSave: vi.fn(async () => undefined),
    registerSave: vi.fn(),
    ...over,
  });

  it("first load: a skeleton, never inputs holding defaults", () => {
    render(<FeesSettingsV2 {...(props({ read: loadingState() }) as any)} />);
    expect(container.querySelector('[data-settings-state="loading"]')).not.toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(findButton("Save")).toBeUndefined();
  });

  it("failed read: the error with Try again instead of the form", () => {
    const read = failedState();
    render(<FeesSettingsV2 {...(props({ read }) as any)} />);
    expect(text()).toContain("Couldn't load tax and fee settings");
    expect(container.querySelector("input")).toBeNull();
    expect(findButton("Save")).toBeUndefined();
    act(() => button("Try again").click());
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it("view only: every control disabled and no Save", () => {
    render(<FeesSettingsV2 {...(props({ canEdit: false }) as any)} />);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Tax rate"]')!;
    expect(input.matches(":disabled")).toBe(true);
    expect(button("Enable tax").matches(":disabled")).toBe(true);
    expect(findButton("Save")).toBeUndefined();
  });

  it("unsaved edit, then a failed save: inline reason, the edit stays, Save stays available", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });
    const registerSave = vi.fn();
    render(<FeesSettingsV2 {...(props({ form: { ...form, tax_percentage: 8 }, onSave, registerSave }) as any)} />);
    expect(text()).toContain("Unsaved changes");
    // The save, and the discard the page's Reset runs.
    expect(registerSave).toHaveBeenCalledWith("fees", expect.any(Function), expect.any(Function));

    const save = button("Save");
    expect(save.disabled).toBe(false);
    act(() => save.click());
    await flush();

    // Hand-written: the page's Save payload for tax 8%, fee off, fixed 0.
    expect(onSave).toHaveBeenCalledWith({
      tax_enabled: true,
      tax_percentage: 8,
      service_fee_enabled: false,
      service_fee_amount: 0,
      service_fee_type: "fixed_amount",
      service_fee_value: 0,
    });
    expect(text()).toContain("Couldn't save.");
    expect(text()).toContain("We couldn't reach the server. Your changes are still here.");
    expect(button("Save").disabled).toBe(false);
  });

  it("a percentage over 100 holds Save back and says why", () => {
    render(
      <FeesSettingsV2
        {...(props({ form: { ...form, service_fee_enabled: true, service_fee_type: "percentage", service_fee_value: 250 } }) as any)}
      />,
    );
    expect(text()).toContain("250% is more than the whole rental");
    expect(button("Save").disabled).toBe(true);
  });

  it("a fixed fee uses the tenant currency and echoes a huge amount formatted", () => {
    render(
      <FeesSettingsV2
        {...(props({ currencyCode: "GBP", form: { ...form, service_fee_enabled: true, service_fee_value: 12500 } }) as any)}
      />,
    );
    expect(text()).toContain("£");
    expect(text()).not.toContain("$");
    expect(text()).toContain("£12,500.00 on every booking.");
  });
});

/* -------------------------------------------------------------------------- */
/* Security deposit                                                            */
/* -------------------------------------------------------------------------- */

describe("DepositSettingsV2", () => {
  const saved = {
    security_deposit_enabled: true,
    deposit_charge_enabled: false,
    deposit_mode: "global",
    global_deposit_amount: 250,
    own_stripe_account_id: "acct_1",
  };
  const form = { security_deposit_enabled: true, deposit_charge_enabled: false, deposit_mode: "global", global_deposit_amount: 250 };
  const props = (over: Record<string, unknown> = {}) => ({
    form,
    setForm: vi.fn(),
    saved,
    read: readState(),
    holds: readState(),
    liveHoldCount: 0,
    canEdit: true,
    currencyCode: "USD",
    paymentProvider: null,
    connectHref: "/integrations",
    onRequestCharge: vi.fn(),
    onSave: vi.fn(async () => undefined),
    registerSave: vi.fn(),
    ...over,
  });
  const chargeSwitch = () => button("Collect the deposit as a real charge");

  it("first load and failed read never show the switches", () => {
    render(<DepositSettingsV2 {...(props({ read: loadingState() }) as any)} />);
    expect(container.querySelector('[role="switch"]')).toBeNull();
    render(<DepositSettingsV2 {...(props({ read: failedState() }) as any)} />);
    expect(text()).toContain("Couldn't load deposit settings");
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it("live holds still loading: the switch to charges is locked and says why", () => {
    render(<DepositSettingsV2 {...(props({ holds: loadingState() }) as any)} />);
    expect(chargeSwitch().disabled).toBe(true);
    expect(text()).toContain("Checking for live deposit holds");
  });

  it("live holds failed: locked, with Try again for the count", () => {
    const holds = failedState();
    render(<DepositSettingsV2 {...(props({ holds }) as any)} />);
    expect(chargeSwitch().disabled).toBe(true);
    expect(text()).toContain("Couldn't check for live deposit holds");
    act(() => button("Try again").click());
    expect(holds.refetch).toHaveBeenCalledTimes(1);
  });

  it("2 live holds: blocked with the count; 0: the switch opens the confirm", () => {
    render(<DepositSettingsV2 {...(props({ liveHoldCount: 2 }) as any)} />);
    expect(text()).toContain("2 rentals have a live hold.");
    expect(chargeSwitch().disabled).toBe(true);

    const onRequestCharge = vi.fn();
    render(<DepositSettingsV2 {...(props({ onRequestCharge }) as any)} />);
    expect(chargeSwitch().disabled).toBe(false);
    act(() => chargeSwitch().click());
    expect(onRequestCharge).toHaveBeenCalledTimes(1);
  });

  it("confirmed but not saved: says so, and registers for Save & Leave", () => {
    const registerSave = vi.fn();
    render(<DepositSettingsV2 {...(props({ form: { ...form, deposit_charge_enabled: true }, registerSave }) as any)} />);
    expect(text()).toContain("Not saved yet. Save to start charging the deposit on new bookings.");
    expect(registerSave).toHaveBeenCalledWith("preauth", expect.any(Function), expect.any(Function));
    expect(button("Save").disabled).toBe(false);
  });

  it("a zero amount in GBP: the hold warning in pounds", () => {
    render(<DepositSettingsV2 {...(props({ currencyCode: "GBP", form: { ...form, global_deposit_amount: 0 } }) as any)} />);
    expect(text()).toContain("The amount is £0.00, so no hold will be placed.");
  });

  it("Stripe not connected: a notice linking to Integrations; Square or a connected account: none", () => {
    const { own_stripe_account_id: _own, ...unconnected } = saved;
    render(<DepositSettingsV2 {...(props({ saved: unconnected }) as any)} />);
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent?.includes("Connect Stripe"));
    expect(link?.getAttribute("href")).toBe("/integrations");

    render(<DepositSettingsV2 {...(props({ saved: unconnected, paymentProvider: "square" }) as any)} />);
    expect(text()).not.toContain("Connect Stripe");

    render(<DepositSettingsV2 {...(props() as any)} />);
    expect(text()).not.toContain("Connect Stripe");
  });
});

/* -------------------------------------------------------------------------- */
/* Pricing rules                                                               */
/* -------------------------------------------------------------------------- */

describe("PricingRulesV2", () => {
  const christmas = {
    id: "h1",
    tenant_id: "t1",
    name: "Christmas",
    start_date: "2026-12-24",
    end_date: "2026-12-26",
    surcharge_percent: 20,
    excluded_vehicle_ids: ["v1", "v2"],
    recurs_annually: true,
    created_at: "",
    updated_at: "",
  };

  it("weekend read failed: the error, not a 0% form; holidays still render on their own", () => {
    h.reads["weekend-pricing"] = failedState();
    h.reads["tenant-holidays"] = readState();
    render(<PricingRulesV2 canEdit />);
    expect(text()).toContain("Couldn't load weekend pricing");
    expect(document.getElementById("v2-weekend-percent")).toBeNull();
    expect(text()).toContain("No holiday surcharges yet");
    expect(Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Add holiday")).toHaveLength(1);
  });

  it("holidays read failed: the error, never the 'nothing configured' copy", () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = failedState();
    render(<PricingRulesV2 canEdit />);
    expect(text()).toContain("Couldn't load holiday pricing");
    expect(text()).not.toContain("No holiday surcharges yet");
    expect(findButton("Add holiday")).toBeUndefined();
  });

  it("view only with no holidays: no invitation to add one", () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    render(<PricingRulesV2 canEdit={false} />);
    expect(text()).toContain("Ask an admin");
    expect(findButton("Add holiday")).toBeUndefined();
    expect(document.getElementById("v2-weekend-percent")!.matches(":disabled")).toBe(true);
    expect(findButton("Save")).toBeUndefined();
  });

  it("extreme rows: a long name keeps its full text in title, a finished one-time holiday is marked Past", () => {
    const longName = "Independence Day long weekend ".repeat(10).trim();
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    h.holidays.holidays = [
      { ...christmas, id: "h2", name: longName, start_date: "2020-07-03", end_date: "2020-07-05", recurs_annually: false, surcharge_percent: 1234567 },
      christmas,
    ];
    render(<PricingRulesV2 canEdit />);
    expect(container.querySelector(`[title="${longName}"]`)).not.toBeNull();
    expect(text().match(/Past/g)).toHaveLength(1);
    expect(text()).toContain("+1,234,567%");
    expect(text()).toContain("All 2 holidays shown");
    expect(findButton(`Edit ${longName}`)).toBeDefined();
    expect(findButton("Delete Christmas")).toBeDefined();
  });

  it("weekend: a negative surcharge shows the reason and Save stays off", () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    render(<PricingRulesV2 canEdit />);
    const input = document.getElementById("v2-weekend-percent") as HTMLInputElement;
    expect(input.value).toBe("10");
    expect(button("Save").disabled).toBe(true);
    typeInto(input, "-5");
    expect(text()).toContain("Enter 0 or more. Use 0 to turn weekend pricing off.");
    expect(text()).toContain("Unsaved changes");
    expect(button("Save").disabled).toBe(true);
    typeInto(input, "15");
    expect(button("Save").disabled).toBe(false);
  });

  it("weekend: a failed save keeps the edit and shows why inline; the payload is v1's", async () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    h.weekend.updateSettings = vi.fn(async () => {
      throw new Error("Tenant not found or no permission to update");
    });
    const onDirtyChange = vi.fn();
    render(<PricingRulesV2 canEdit onDirtyChange={onDirtyChange} />);
    typeInto(document.getElementById("v2-weekend-percent") as HTMLInputElement, "25");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    act(() => button("Save").click());
    await flush();
    expect(h.weekend.updateSettings).toHaveBeenCalledWith({ weekend_surcharge_percent: 25, weekend_days: [6, 0], stack_surcharges: false });
    expect(text()).toContain("Couldn't save.");
    expect((document.getElementById("v2-weekend-percent") as HTMLInputElement).value).toBe("25");

    act(() => root.unmount());
    root = createRoot(container);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("editing a holiday that skips vehicles warns that saving clears the list", () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    h.holidays.holidays = [christmas];
    render(<PricingRulesV2 canEdit />);
    act(() => button("Edit Christmas").click());
    expect(text()).toContain("This holiday skips 2 vehicles");
    expect(text()).toContain("Saving here clears that list");
  });

  it("add holiday: Save with empty fields says what is missing and sends nothing", () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    h.holidays.holidays = [christmas];
    render(<PricingRulesV2 canEdit />);
    act(() => button("Add holiday").click());
    const dialog = document.querySelector('[role="dialog"]')!;
    act(() => button("Add holiday", dialog).click());
    expect(text()).toContain("Give the holiday a name.");
    expect(text()).toContain("Pick the first day.");
    expect(h.holidays.addHoliday).not.toHaveBeenCalled();
  });

  it("a failed delete keeps the confirm open with the reason", async () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    h.holidays.holidays = [christmas];
    h.holidays.deleteHoliday = vi.fn(async () => {
      throw new Error("permission denied for table tenant_holidays");
    });
    render(<PricingRulesV2 canEdit />);
    act(() => button("Delete Christmas").click());
    const confirm = document.querySelector('[role="alertdialog"]')!;
    expect(confirm).not.toBeNull();
    act(() => button("Delete", confirm).click());
    await flush();
    expect(h.holidays.deleteHoliday).toHaveBeenCalledWith("h1");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(text()).toContain("Couldn't delete.");
    expect(text()).toContain("You don't have permission to change this. Ask an admin.");
  });

  it("monthly rate: loading shows a skeleton, not a 30-day default", () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    render(
      <PricingRulesV2
        canEdit
        monthlyTier={{ value: 30, savedValue: 30, onChange: vi.fn(), onSave: vi.fn(async () => undefined), read: loadingState() as any }}
      />,
    );
    expect(text()).toContain("Loading monthly pricing");
    expect(container.querySelector('[aria-label="Monthly rate starts at"]')).toBeNull();
  });
});

describe("inside the page's one save bar", () => {
  const lastWithSave = (registerSave: ReturnType<typeof vi.fn>, key: string) => {
    const calls = registerSave.mock.calls.filter((call) => call[0] === key && call[1]);
    return calls[calls.length - 1] as [string, () => Promise<unknown>, () => void];
  };

  it("Pricing rules: no Save anywhere; the monthly rate and weekend pricing register a save and a discard", async () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    const registerSave = vi.fn();
    const monthlyTier = { value: 31, savedValue: 30, onChange: vi.fn(), onSave: vi.fn(async () => undefined), read: readState() as any };
    render(
      <SettingsPageSaveProvider>
        <PricingRulesV2 canEdit registerSave={registerSave} monthlyTier={monthlyTier} />
      </SettingsPageSaveProvider>,
    );
    typeInto(document.getElementById("v2-weekend-percent") as HTMLInputElement, "25");
    expect(findButton("Save")).toBeUndefined();
    // The bar says "Unsaved changes"; the sections do not repeat it.
    expect(text()).not.toContain("Unsaved changes");

    const [, monthlySave, monthlyDiscard] = lastWithSave(registerSave, "pricing-monthly-tier");
    await act(async () => {
      await monthlySave();
    });
    expect(monthlyTier.onSave).toHaveBeenCalledTimes(1);
    act(() => monthlyDiscard());
    expect(monthlyTier.onChange).toHaveBeenCalledWith(30);

    const [, weekendSave, weekendDiscard] = lastWithSave(registerSave, "pricing-weekend");
    await act(async () => {
      await weekendSave();
    });
    // Hand-written: 25% on the saved Sat/Sun, not stacked.
    expect(h.weekend.updateSettings).toHaveBeenCalledWith({ weekend_surcharge_percent: 25, weekend_days: [6, 0], stack_surcharges: false });
    act(() => weekendDiscard());
    expect((document.getElementById("v2-weekend-percent") as HTMLInputElement).value).toBe("10");
  });

  it("Tax and fees: no Save, and Unit groups keep '%' beside its box with the switch after it", () => {
    const fees = {
      form: {
        tax_enabled: true,
        tax_percentage: 8,
        service_fee_enabled: false,
        service_fee_type: "fixed_amount",
        service_fee_value: 0,
        service_fee_amount: 0,
      },
      setForm: vi.fn(),
      saved: { tax_enabled: true, tax_percentage: 7.5, service_fee_enabled: false, service_fee_type: "fixed_amount", service_fee_value: 0, service_fee_amount: 0 },
      read: readState(),
      canEdit: true,
      currencyCode: "USD",
      onSave: vi.fn(async () => undefined),
      registerSave: vi.fn(),
    };
    render(
      <SettingsPageSaveProvider>
        <FeesSettingsV2 {...(fees as any)} />
      </SettingsPageSaveProvider>,
    );
    expect(findButton("Save")).toBeUndefined();
    const rate = container.querySelector('input[aria-label="Tax rate"]') as HTMLInputElement;
    expect(rate.parentElement!.textContent).toBe("%");
    const toggle = container.querySelector('[aria-label="Enable tax"]')!;
    expect(toggle.parentElement).toBe(rate.parentElement!.parentElement);
    expect(toggle.className.split(/\s+/)).not.toContain("ml-2");
  });
});

/* -------------------------------------------------------------------------- */
/* Verifier fixes: negative values, delete copy, view-only reads, discard      */
/* -------------------------------------------------------------------------- */

describe("negative stored values say what the field shows", () => {
  it("tax -5%: its own line (not 'the rate is 0%'), and it does not hold Save back", () => {
    const issue = taxIssue({ tax_enabled: true, tax_percentage: -5 });
    expect(issue?.message).toBe("The rate is -5%. A tax rate can't be negative. Enter 0 or more.");
    expect(issue?.tone).toBe("danger");
    expect(issue?.blocksSave).toBeUndefined();
    // Off still says nothing, whatever is stored.
    expect(taxIssue({ tax_enabled: false, tax_percentage: -5 })).toBeNull();
  });

  it("service fee -10: percent, tenant currency, or a bare number (not 'set to 0')", () => {
    expect(serviceFeeIssue({ service_fee_enabled: true, service_fee_type: "percentage", service_fee_value: -10 })?.message).toBe(
      "The fee is -10%. A service fee can't be negative. Enter 0 or more.",
    );
    expect(
      serviceFeeIssue({ service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: -10 }, "USD")?.message,
    ).toBe("The fee is -$10.00. A service fee can't be negative. Enter 0 or more.");
    expect(serviceFeeIssue({ service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: "-10" })?.message).toBe(
      "The fee is -10. A service fee can't be negative. Enter 0 or more.",
    );
    expect(serviceFeeIssue({ service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: -10 })?.blocksSave).toBeUndefined();
  });

  it("deposit -250: formatted in the tenant currency (not 'The amount is $0.00')", () => {
    const form = { security_deposit_enabled: true, deposit_charge_enabled: false, deposit_mode: "global", global_deposit_amount: -250 };
    expect(depositAmountIssue(form, "USD")?.message).toBe("The amount is -$250.00. A deposit can't be negative. Enter 0 or more.");
    expect(depositAmountIssue({ ...form, deposit_mode: "per_vehicle" }, "GBP")?.message).toBe(
      "The amount is -£250.00. A deposit can't be negative. Enter 0 or more.",
    );
    expect(depositAmountIssue({ ...form, security_deposit_enabled: false }, "USD")).toBeNull();
  });

  it("Tax and fees renders the negative lines, with the payload untouched", () => {
    render(
      <FeesSettingsV2
        {...({
          form: { tax_enabled: true, tax_percentage: -5, service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: -10, service_fee_amount: -10 },
          setForm: vi.fn(),
          saved: { tax_enabled: true, tax_percentage: -5, service_fee_enabled: true, service_fee_type: "fixed_amount", service_fee_value: -10, service_fee_amount: -10 },
          read: readState(),
          canEdit: true,
          currencyCode: "GBP",
          onSave: vi.fn(async () => undefined),
        } as any)}
      />,
    );
    expect(text()).toContain("The rate is -5%. A tax rate can't be negative.");
    expect(text()).toContain("The fee is -£10.00. A service fee can't be negative.");
    expect(text()).not.toContain("the rate is 0%");
    expect(text()).not.toContain("set to 0");
  });
});

describe("describeHolidayDeleteError", () => {
  it("a foreign-key refusal says the holiday is still referenced", () => {
    expect(
      describeHolidayDeleteError({
        code: "23503",
        message: 'update or delete on table "tenant_holidays" violates foreign key constraint "x_holiday_id_fkey"',
      }),
    ).toBe("Other records still point to this holiday, so it can't be deleted yet. Nothing was removed.");
  });

  it("any other constraint or trigger refusal never mentions fields", () => {
    expect(describeHolidayDeleteError({ code: "P0001", message: "delete blocked" })).toBe(
      "The database refused to delete this holiday. Nothing was removed. Try again.",
    );
  });

  it("network and permission failures keep the save copy, minus 'your changes are still here'", () => {
    expect(describeHolidayDeleteError(new Error("Failed to fetch"))).toBe("We couldn't reach the server. Nothing was removed.");
    expect(describeHolidayDeleteError(new Error("permission denied for table tenant_holidays"))).toBe(
      "You don't have permission to change this. Ask an admin.",
    );
  });

  it("the delete confirm shows it", async () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    h.holidays.holidays = [
      { id: "h1", tenant_id: "t1", name: "Christmas", start_date: "2026-12-24", end_date: "2026-12-26", surcharge_percent: 20, excluded_vehicle_ids: [], recurs_annually: true, created_at: "", updated_at: "" },
    ];
    h.holidays.deleteHoliday = vi.fn(async () => {
      throw { code: "23503", message: "violates foreign key constraint" };
    });
    render(<PricingRulesV2 canEdit />);
    act(() => button("Delete Christmas").click());
    act(() => button("Delete", document.querySelector('[role="alertdialog"]')!).click());
    await flush();
    expect(text()).toContain("Couldn't delete.");
    expect(text()).toContain("Other records still point to this holiday");
    expect(text()).not.toContain("Check the fields");
  });
});

describe("extreme holiday surcharge on a phone", () => {
  it("wraps inside its cell instead of running under Edit, and is never cut", () => {
    h.reads["weekend-pricing"] = readState();
    h.reads["tenant-holidays"] = readState();
    h.holidays.holidays = [
      { id: "h1", tenant_id: "t1", name: "Peak", start_date: "2026-12-24", end_date: "2026-12-26", surcharge_percent: 9999999.99, excluded_vehicle_ids: [], recurs_annually: true, created_at: "", updated_at: "" },
    ];
    render(<PricingRulesV2 canEdit />);
    const value = Array.from(container.querySelectorAll("td span")).find((el) => el.textContent === "+9,999,999.99%")!;
    expect(value).toBeDefined();
    expect(value.className).toContain("whitespace-normal");
    expect(value.className).not.toContain("whitespace-nowrap");
    expect(value.className).not.toContain("truncate");
    // It may only break after a thousands separator: "+9," "999," "999.99%".
    expect(value.querySelectorAll("wbr")).toHaveLength(2);
    expect(value.innerHTML).toBe("+9,<wbr>999,<wbr>999.99%");
    const head = Array.from(container.querySelectorAll("th")).find((th) => th.textContent === "Surcharge")!;
    expect(head.className).toContain("w-[8rem]");
  });
});

describe("view-only reads on Security deposit", () => {
  const form = { security_deposit_enabled: true, deposit_charge_enabled: false, deposit_mode: "global", global_deposit_amount: 250 };
  const props = (over: Record<string, unknown>) => ({
    form,
    setForm: vi.fn(),
    saved: { ...form, own_stripe_account_id: "acct_1" },
    read: readState(),
    holds: readState(),
    liveHoldCount: 0,
    canEdit: false,
    currencyCode: "USD",
    paymentProvider: null,
    connectHref: "/integrations",
    onRequestCharge: vi.fn(),
    onSave: vi.fn(async () => undefined),
    ...over,
  });

  it("a failed live-holds check shows no locked-switch line and no dead Try again", () => {
    render(<DepositSettingsV2 {...(props({ holds: failedState() }) as any)} />);
    expect(text()).not.toContain("Couldn't check for live deposit holds");
    expect(findButton("Try again")).toBeUndefined();
    expect(button("Collect the deposit as a real charge").matches(":disabled")).toBe(true);
  });

  it("live holds and a pending check say nothing to a viewer either", () => {
    render(<DepositSettingsV2 {...(props({ liveHoldCount: 3 }) as any)} />);
    expect(text()).not.toContain("have a live hold");
    render(<DepositSettingsV2 {...(props({ holds: loadingState() }) as any)} />);
    expect(text()).not.toContain("Checking for live deposit holds");
  });

  it("the read-only fieldset dims switches, which a disabled fieldset alone does not", () => {
    render(<DepositSettingsV2 {...(props({}) as any)} />);
    const fieldset = container.querySelector("fieldset[data-read-only]")!;
    expect(fieldset).not.toBeNull();
    expect(fieldset.className).toContain("[&_[role=switch]:disabled]:opacity-50");
  });
});

describe("settings page wiring (source)", () => {
  const page = readFileSync(resolve(__dirname, "../../app/(dashboard)/settings/page.tsx"), "utf8");
  const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
  // The v2 branch ends where the v1 <Tabs> page's return starts.
  const v2End = page.indexOf("\n  return (", page.indexOf("<LeaveDialogV2", v2Start));
  const v2 = page.slice(v2Start, v2End);

  it("Custom pricing and General (which holds Tax and fees and Security deposit) sit outside the page's read-only fieldset", () => {
    expect(page).toMatch(/const V2_PAGES_GATING_OWN_CONTROLS = new Set\(\[[^\]]*'general'[^\]]*\]\);/);
    expect(page).toMatch(/const V2_PAGES_GATING_OWN_CONTROLS = new Set\(\[[^\]]*'pricing'[^\]]*\]\);/);
    // Each money section takes its own permission, not the page's.
    expect(v2).toContain("canEdit={canEditSettings('fees')}");
    expect(v2).toContain("canEdit={canEditSettings('preauth')}");
  });

  it("Installments, Pay as you go, Auto-extension, Promo codes and Extras sit outside it too, so a viewer can retry, copy and show more", () => {
    expect(page).toMatch(/const V2_PAGES_GATING_OWN_CONTROLS = new Set\(\[[^\]]*'installments', 'payg', 'auto-extend', 'promos', 'extras'[^\]]*\]\);/);
  });

  it("Installments registers unsaved plans with the leave guard, and keeps its own Save (no page save bar)", () => {
    expect(v2).toContain("<InstallmentSettings registerSave={registerV2SectionSave} />");
    const bar = page.match(/const V2_PAGES_WITH_SAVE_BAR = new Set\(\[([^\]]*)\]\);/);
    expect(bar).not.toBeNull();
    expect(bar![1]).not.toContain("'installments'");
    // Tax and fees and Security deposit save through General's bar now.
    expect(bar![1]).toContain("'general', 'templates', 'pricing'");
    // v1 still mounts it bare.
    expect(page.slice(v2End)).toContain("<InstallmentSettings />");
  });

  it("promo codes: Add waits for the list, the Edit dialog validates, and a taken code gets its own copy", () => {
    expect(v2).toContain("const promoCheckUnavailableV2 = !promoCodes;");
    expect(v2).toContain("error={promoSaveError(createPromoMutation.error)}");
    expect(page).toContain("validatePromoEdit(editingPromo, savedEditingPromoV2)");
    expect(page).toContain("onClick={v2Chrome ? handleUpdatePromoV2 : handleUpdatePromo}");
    expect(page).toContain('error={promoSaveError(updatePromoMutation.error)}');
    // v1's classes survive beside the phone-safe v2 ones.
    expect(page).toContain('className={v2Chrome ? "flex flex-col gap-4 sm:flex-row" : "flex gap-4"}');
    expect(page).toContain(': () => deletingPromo && deletePromoMutation.mutate(deletingPromo.id)}');
  });

  it("v2 'Don't save' and Reset reset the page's forms and every registered section; v1 dialogs are unchanged", () => {
    expect(v2Start).toBeGreaterThan(-1);
    const guard = page.slice(page.indexOf("  const discardV2PageEdits = () => {"), v2Start);
    expect(guard).toContain("if (lastSyncedRentalForm.current) setRentalForm(lastSyncedRentalForm.current);");
    expect(guard).toContain("resetBrandingForm();");
    expect(guard).toContain("Object.values(v2SectionDiscards.current).forEach((discard) => discard());");
    expect(guard).toContain("onDiscard: resetV2PageEdits,");
    expect(v2).toContain("onReset={resetV2PageEdits}");
    expect(v2).toContain("onDiscard={v2LeaveGuard.discard}");
    // v2 renders only the v2 leave dialog.
    expect(v2).not.toContain("<UnsavedChangesDialog");
    const v1 = page.slice(v2End);
    expect(v1).toContain("onDiscard={confirmLeave}");
    expect(v1).toContain("onDiscard={handleTabDiscardAndSwitch}");
    expect(v1).not.toContain("discardV2PageEdits");
    expect(v1).not.toContain("LeaveDialogV2");
  });

  it("the dark v2 --input token carries no alpha, so bg-input/50 stays a valid colour", () => {
    const css = readFileSync(resolve(__dirname, "../../styles/v2-theme.css"), "utf8");
    const dark = css.slice(css.indexOf(".dark .v2-theme {"));
    const input = dark.match(/--input:\s*([^;]+);/)![1];
    expect(input).not.toContain("/");
  });
});
