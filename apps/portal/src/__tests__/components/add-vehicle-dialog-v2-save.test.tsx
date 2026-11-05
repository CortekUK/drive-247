/**
 * What the v2 dialog saves and says, driven through its real screens.
 *
 *  - a financed car's cost must equal the contract total, with no dummy $1
 *  - the success screen must not call a car "ready to rent" when it can't be
 *  - the mileage screen must use the tenant's distance unit, as the car's page does
 *  - Trax's line must explain itself when it has no price
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// These walk real screens, and the first render in a busy run is slow.
vi.setConfig({ testTimeout: 30000 });

const h = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  rpc: vi.fn(),
  tenant: { id: "t1", currency_code: "USD", distance_unit: "miles" as "miles" | "km" },
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => ({
    insert: (row: Record<string, unknown>) => {
      if (table === "vehicles") h.inserted.push(row);
      return {
        select: () => ({ single: async () => ({ data: { id: "v1" }, error: null }) }),
        then: (ok: (r: unknown) => unknown) => ok({ error: null }),
      };
    },
  });
  const storage = {
    from: () => ({
      upload: async () => ({ error: null }),
      getPublicUrl: () => ({ data: { publicUrl: "https://x/p.jpg" } }),
      remove: async () => ({}),
    }),
  };
  return { supabase: { from, storage }, supabaseUntyped: { rpc: (...a: unknown[]) => h.rpc(...a) } };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: h.tenant }) }));
vi.mock("@/hooks/use-pickup-locations", () => ({ usePickupLocations: () => ({ activeLocations: [] }) }));
vi.mock("@/hooks/use-audit-log", () => ({ useAuditLog: () => ({ logAction: vi.fn() }) }));
vi.mock("@/hooks/use-audit-log-on-open", () => ({ useAuditLogOnOpen: () => {} }));
vi.mock("@/components/dev/dev-autofill-button", () => ({ DevAutofillButton: () => null }));
vi.mock("@/components/illustrations-v2/scenes/add-vehicle", () => {
  const Art = () => null;
  return new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : Art), has: () => true });
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { AddVehicleDialogV2 } from "@/components/vehicles-v2/add-vehicle-dialog-v2";
import { financeColumnsForContractTotal, getContractTotal, notReadyToRentReasons } from "@/lib/vehicle-utils";

const title = (name: string) => screen.findByRole("heading", { level: 3, name });
const submit = () => fireEvent.click(document.querySelector('[role=dialog] button[type=submit]')!);
const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
const typeAll = (placeholder: string, values: string[]) =>
  screen.getAllByPlaceholderText(placeholder).forEach((el, i) => fireEvent.change(el, { target: { value: values[i] } }));

async function toMileage({ financed = false, rates = ["50", "300", "1000"] } = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AddVehicleDialogV2 open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  type("e.g. Toyota", "Toyota");
  type("e.g. Corolla", "Corolla");
  type(String(new Date().getFullYear()), "2024");
  type("e.g. Pearl White", "White");
  submit();
  await title("Its plate and VIN");
  type("e.g. 7KX 204", "QA-1");
  submit();
  await title("How did you get it?");
  if (financed) {
    fireEvent.click(screen.getByRole("button", { name: "Financed" }));
    await screen.findByText("Contract total");
    type("0.00", "20000");
  } else {
    type("0.00", "15000");
  }
  submit();
  await title("What do you charge?");
  typeAll("0.00", [...rates, ""]);
  submit();
  await title("How far can they drive?");
}

async function finish({ allLengthsOff = false } = {}) {
  submit();
  await title("When can they book it?");
  if (allLengthsOff) screen.getAllByRole("switch").forEach((sw) => fireEvent.click(sw));
  submit();
  for (const name of ["Keeping it on the road", "Paperwork and security", "Keys and notes", "On your booking site", "Show it off"]) {
    await title(name);
    if (name !== "Show it off") submit();
  }
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "car.jpg", { type: "image/jpeg" });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  submit();
  await screen.findByText(/is in your fleet/);
}

beforeEach(() => {
  h.inserted.length = 0;
  h.tenant.distance_unit = "miles";
  // The shared setup's mock can't be used with `new`, which the switches need.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: { confidence: "none" }, error: null });
});

describe("a financed car's cost", () => {
  it("adds up to exactly the contract total, the same sum the ledger does", () => {
    const columns = financeColumnsForContractTotal(20000);
    expect(getContractTotal({ acquisition_type: "Finance", ...columns, term_months: undefined })).toBe(20000);
    const { initial_payment, monthly_payment, term_months } = columns;
    expect(Number(initial_payment) + monthly_payment * (term_months ?? 0)).toBe(20000);
  });

  it("keeps monthly_payment non-null, or the acquisition trigger posts nothing to the ledger", () => {
    expect(financeColumnsForContractTotal(20000).monthly_payment).not.toBeNull();
  });

  it("is saved with no dummy payment", async () => {
    await toMileage({ financed: true });
    await finish();
    expect(h.inserted[0]).toMatchObject({ initial_payment: 20000, monthly_payment: 0, term_months: null });
  });
});

describe("the success screen", () => {
  it("says ready to rent for a car that is", async () => {
    await toMileage();
    await finish();
    expect(screen.getByText(/QA-1 is ready to rent/)).toBeInTheDocument();
  });

  it("does not, with a $0 daily rate", async () => {
    await toMileage({ rates: ["0", "300", "1000"] });
    await finish();
    expect(screen.queryByText(/is ready to rent/)).not.toBeInTheDocument();
    expect(screen.getByText(/isn't ready to rent yet: it has no daily rate\./)).toBeInTheDocument();
  });

  it("does not, with every hire length off", async () => {
    await toMileage();
    await finish({ allLengthsOff: true });
    expect(screen.getByText(/isn't ready to rent yet: it has no hire length switched on\./)).toBeInTheDocument();
  });

  it("names both reasons together", () => {
    expect(
      notReadyToRentReasons({ daily_rent: 0, available_daily: false, available_weekly: false, available_monthly: false }),
    ).toEqual(["no daily rate", "no hire length switched on"]);
  });
});

describe("the mileage screen's unit", () => {
  it("says miles for a miles tenant", async () => {
    await toMileage();
    expect(screen.getByText("Miles included / day")).toBeInTheDocument();
    expect(screen.getByText("Extra mile rate")).toBeInTheDocument();
    expect(screen.getByText(/unlimited miles/)).toBeInTheDocument();
  });

  it("says km for a km tenant, and never miles", async () => {
    h.tenant.distance_unit = "km";
    await toMileage();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Km included / day")).toBeInTheDocument();
    expect(dialog.getByText("Extra km rate")).toBeInTheDocument();
    expect(dialog.getByText("Per km over the allowance")).toBeInTheDocument();
    expect(dialog.getByText(/unlimited km/)).toBeInTheDocument();
    expect(dialog.queryByText(/mile\b|miles/i)).not.toBeInTheDocument();
  });
});

describe("Trax's line under a rate", () => {
  const toRates = async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AddVehicleDialogV2 open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    type("e.g. Toyota", "Rare");
    type("e.g. Corolla", "Car");
    type(String(new Date().getFullYear()), "2024");
    type("e.g. Pearl White", "White");
    submit();
    await title("Its plate and VIN");
    type("e.g. 7KX 204", "QA-1");
    submit();
    await title("How did you get it?");
    type("0.00", "15000");
    submit();
    await title("What do you charge?");
  };

  it("says there aren't enough similar cars, rather than going blank", async () => {
    await toRates();
    await waitFor(() => expect(screen.getAllByText("Not enough similar cars for a Trax price yet")).toHaveLength(3));
  });

  it("says when the check itself failed", async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error("down") });
    await toRates();
    await waitFor(() => expect(screen.getAllByText("Trax couldn't check the market just now")).toHaveLength(3));
  });
});
