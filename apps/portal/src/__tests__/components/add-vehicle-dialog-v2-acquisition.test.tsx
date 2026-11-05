/**
 * Leaving "How did you get it?" with no price must be refused ON THAT SCREEN.
 *
 * The rule lives in the schema's superRefine, which zod skips while any required
 * field is missing. The rates are required and sit on the NEXT screen, so the
 * schema alone let the operator walk past with no price and only complained at
 * the very end. These drive the real dialog through the real screens.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", currency_code: "USD" } }) }));
vi.mock("@/hooks/use-pickup-locations", () => ({ usePickupLocations: () => ({ activeLocations: [] }) }));
vi.mock("@/hooks/use-audit-log", () => ({ useAuditLog: () => ({ logAction: vi.fn() }) }));
vi.mock("@/hooks/use-audit-log-on-open", () => ({ useAuditLogOnOpen: () => {} }));
vi.mock("@/hooks/use-trax-price", () => ({ useTraxPrice: () => ({ data: null, isLoading: false }) }));
vi.mock("@/components/dev/dev-autofill-button", () => ({ DevAutofillButton: () => null }));
vi.mock("@/components/illustrations-v2/scenes/add-vehicle", () => {
  const Art = () => null;
  return new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : Art), has: () => true });
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<object>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { AddVehicleDialogV2 } from "@/components/vehicles-v2/add-vehicle-dialog-v2";

/** The visible screen title; the same words also sit in a hidden dialog description. */
const findTitle = (name: string) => screen.findByRole("heading", { level: 3, name });
const clickNext = () => fireEvent.click(screen.getByRole("button", { name: /next/i }));
const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

/** Walks screens 1 and 2 with good values, ending on "How did you get it?". */
async function goToAcquisitionScreen() {
  render(<AddVehicleDialogV2 open onOpenChange={() => {}} />);
  type("e.g. Toyota", "Toyota");
  type("e.g. Corolla", "Corolla");
  type(String(new Date().getFullYear()), "2024");
  type("e.g. Pearl White", "White");
  clickNext();
  await findTitle("Its plate and VIN");
  type("e.g. 7KX 204", "ab12 cde");
  clickNext();
  await findTitle("How did you get it?");
}

describe('the "How did you get it?" screen', () => {
  it("refuses Bought with no purchase price (sheet 1.9)", async () => {
    await goToAcquisitionScreen();
    clickNext();
    await screen.findByText("Purchase price is required for purchased vehicles");
    expect(screen.getByRole("heading", { level: 3, name: "How did you get it?" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "What do you charge?" })).not.toBeInTheDocument();
  });

  it("refuses Financed with no contract total (sheet 1.10)", async () => {
    await goToAcquisitionScreen();
    fireEvent.click(screen.getByRole("button", { name: "Financed" }));
    await screen.findByText("Contract total");
    clickNext();
    await screen.findByText("Contract total is required for financed vehicles");
    expect(screen.queryByRole("heading", { level: 3, name: "What do you charge?" })).not.toBeInTheDocument();
  });

  it("moves on once the price is in, and clears the error as it is typed", async () => {
    await goToAcquisitionScreen();
    clickNext();
    await screen.findByText("Purchase price is required for purchased vehicles");
    type("0.00", "15000");
    await waitFor(() =>
      expect(screen.queryByText("Purchase price is required for purchased vehicles")).not.toBeInTheDocument(),
    );
    clickNext();
    await findTitle("What do you charge?");
  });

  it("moves on for Financed once the total is in", async () => {
    await goToAcquisitionScreen();
    fireEvent.click(screen.getByRole("button", { name: "Financed" }));
    await screen.findByText("Contract total");
    type("0.00", "20000");
    clickNext();
    await findTitle("What do you charge?");
  });

  it("accepts a price of zero: empty is what is refused, not 0", async () => {
    await goToAcquisitionScreen();
    type("0.00", "0");
    clickNext();
    await findTitle("What do you charge?");
  });
});
