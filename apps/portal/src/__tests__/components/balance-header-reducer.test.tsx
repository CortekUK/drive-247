/**
 * The balance header says what the SHARED reducer says — lib/finances/balance.ts,
 * through useCustomerBalanceWithStatus, the same rule the v1 customer page and
 * Finances use — so the canary's "Owes you $X" can never disagree with them.
 *
 * The fixture exercises every exclusion the rule has (hand-derived):
 *
 *   Rental 500.00, 200.00 unpaid, due 1 Sep ............ counts   200.00
 *   Tax 50.00 unpaid .................................... counts    50.00
 *   Goodwill Adjustment −30.00 ........................... counts   −30.00
 *   Rental due 2099 (not yet due) ....................... skipped
 *   Rental on a CANCELLED rental, 999.00 unpaid .......... skipped
 *   Rental on a PAY-AS-YOU-GO rental, 70.00 unpaid ....... skipped (its accruals count instead)
 *   open PAYG accrual 40.00 + 4.00 tax + 1.00 fee ....... counts    45.00
 *                                              outstanding  =   265.00
 *   Credit payment, 20.00 unapplied ...................... credit    20.00
 *   A Stripe hold awaiting capture, 500.00 ............... not money
 *                                              net = 265.00 − 20.00 = 245.00
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedQuery, RecordingSupabase } from "../helpers/recording-supabase";
import { sumAvailableCredit, sumPaygAccruals, summarizeCustomerLedger } from "@/lib/finances/balance";

const h = vi.hoisted(() => ({ rec: null as unknown as RecordingSupabase }));

vi.mock("@/integrations/supabase/client", async () => {
  const { recordingSupabase } = await import("../helpers/recording-supabase");
  h.rec = recordingSupabase();
  return { supabase: h.rec.client, supabaseUntyped: h.rec.client };
});
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "t1", slug: "northwind", currency_code: "USD", timezone: "America/New_York" } }),
}));

import { CustomerBalanceHeader } from "@/components/balance/balance-sections";

const EXCLUDED = [{ id: "r-cancelled" }];
const PAYG = [{ id: "r-payg" }];
const LEDGER = [
  { type: "Charge", amount: 500, remaining_amount: 200, due_date: "2026-09-01", category: "Rental", rental_id: "r1" },
  { type: "Charge", amount: 50, remaining_amount: 50, due_date: "2026-09-01", category: "Tax", rental_id: "r1" },
  { type: "Charge", amount: -30, remaining_amount: -30, due_date: "2026-09-03", category: "Adjustment", rental_id: null },
  { type: "Charge", amount: 100, remaining_amount: 100, due_date: "2099-01-01", category: "Rental", rental_id: "r1" },
  { type: "Charge", amount: 999, remaining_amount: 999, due_date: "2026-08-01", category: "Rental", rental_id: "r-cancelled" },
  { type: "Charge", amount: 70, remaining_amount: 70, due_date: "2026-09-01", category: "Rental", rental_id: "r-payg" },
  { type: "Payment", amount: -320, remaining_amount: 0, due_date: null, category: "Rental", rental_id: "r1" },
];
const ACCRUALS = [{ rental_id: "r-payg", daily_rate: 40, tax_amount: 4, service_fee_amount: 1 }];

let payments: any[] = [];

function answer(q: RecordedQuery) {
  if (q.table === "rentals" && q.filters.some((f) => f[0] === "or")) return { data: EXCLUDED };
  if (q.table === "rentals" && q.filters.some((f) => f[1] === "is_pay_as_you_go")) return { data: PAYG };
  if (q.table === "ledger_entries") return { data: LEDGER };
  if (q.table === "payments") return { data: payments };
  if (q.table === "payg_accruals") return { data: ACCRUALS };
  return { data: [] };
}

/** The reducer's own net, in cents, over the same rows. */
function reducerNetCents(): number {
  const excluded = new Set(EXCLUDED.map((r) => r.id));
  const payg = new Set(PAYG.map((r) => r.id));
  const { outstandingDebt } = summarizeCustomerLedger(LEDGER as any, excluded, payg);
  const net = outstandingDebt + sumPaygAccruals(ACCRUALS, excluded) - sumAvailableCredit(payments);
  return Math.round(net * 100);
}

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CustomerBalanceHeader customerId="c1" currency="USD" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.rec.reset();
  h.rec.onQuery = answer;
});

describe("the balance header equals the shared reducer", () => {
  it("owes: 265.00 on charges − 20.00 credit = Owes you $245.00", async () => {
    payments = [
      { remaining_amount: 20, status: "Credit", capture_status: null },
      { remaining_amount: 500, status: "Pending", capture_status: "requires_capture" },
      { remaining_amount: 0, status: "Applied", capture_status: "captured" },
    ];
    show();
    await screen.findByText("Owes you $245.00");
    const header = screen.getByTestId("balance-header");
    expect(header).toHaveAttribute("data-net-cents", "24500");
    expect(reducerNetCents()).toBe(24500);
    expect(header).toHaveTextContent("$265.00 on charges · $20.00 paid in and not yet applied");
  });

  it("in credit: the same charges against 300.00 of captured credit", async () => {
    payments = [{ remaining_amount: 300, status: "Partial", capture_status: "captured" }];
    show();
    await screen.findByText("In credit $35.00");
    expect(screen.getByTestId("balance-header")).toHaveAttribute("data-net-cents", String(reducerNetCents()));
    expect(reducerNetCents()).toBe(-3500);
  });

  it("settled when the two cancel out", async () => {
    payments = [{ remaining_amount: 265, status: "Credit", capture_status: null }];
    show();
    await screen.findByText("Settled");
    await waitFor(() => expect(screen.getByTestId("balance-header")).toHaveAttribute("data-net-cents", "0"));
    expect(reducerNetCents()).toBe(0);
  });
});
