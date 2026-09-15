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
    expect(registerSave).toHaveBeenCalledWith("fees", expect.any(Function));

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
    expect(registerSave).toHaveBeenCalledWith("preauth", expect.any(Function));
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
