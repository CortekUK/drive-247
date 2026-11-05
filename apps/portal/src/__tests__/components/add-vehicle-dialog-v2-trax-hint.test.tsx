/**
 * The "What do you charge?" screen promises a Trax price under each rate. This
 * drives the real dialog and the real hook, faking only the database's answer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// These walk real screens, and the first render in a busy run is slow.
vi.setConfig({ testTimeout: 30000 });

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({ supabase: {}, supabaseUntyped: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", currency_code: "USD" } }) }));
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

const title = (name: string) => screen.findByRole("heading", { level: 3, name });
const next = () => fireEvent.click(screen.getByRole("button", { name: /next/i }));
const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

async function goToRates() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AddVehicleDialogV2 open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  type("e.g. Toyota", "Toyota");
  type("e.g. Corolla", "Corolla");
  type(String(new Date().getFullYear()), "2024");
  type("e.g. Pearl White", "White");
  next();
  await title("Its plate and VIN");
  type("e.g. 7KX 204", "QA-1");
  next();
  await title("How did you get it?");
  type("0.00", "15000");
  next();
  await title("What do you charge?");
}

describe("Trax's price under each rate", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async (_fn: string, args: { p_tier: string }) => ({
      data: { suggested_price: { daily: 45, weekly: 280, monthly: 950 }[args.p_tier], confidence: "high" },
      error: null,
    }));
  });

  it("asks once per rate, with the car typed on the first screen", async () => {
    await goToRates();
    await screen.findByText("$45/day");
    expect(rpc).toHaveBeenCalledWith(
      "trax_price_suggest",
      expect.objectContaining({ p_make: "Toyota", p_model: "Corolla", p_year: 2024, p_tier: "daily" }),
    );
  });

  it("shows all three suggestions", async () => {
    await goToRates();
    await screen.findByText("$45/day");
    await screen.findByText("$280/week");
    await screen.findByText("$950/month");
  });
});
