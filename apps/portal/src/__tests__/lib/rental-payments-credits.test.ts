/**
 * The rental Payments stage's money model — credits (Wave 1 fix D1) and the
 * settleable categories read from the database (fix D3). Pure: no React.
 *
 * D1 — a negative charge (goodwill, a correction: an `Adjustment` written with
 * remaining_amount = amount) must lower Outstanding by exactly what the SHARED
 * customer balance rule (lib/finances/balance.ts) takes off: Σ remaining_amount
 * over Charge rows, negative rows included. Every expected number below is
 * derived by hand from the rows in the comment above it, and each fixture is
 * also run through the shared reducer itself (`sumLedgerBalance`) — the stage
 * must say what it says.
 *
 * D3 — `isSettleable` follows `ledger_settleable_categories()` when the
 * database has it (a GET rpc, never HEAD) and the live allocator's list when it
 * does not.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildLedger,
  creditOn,
  isMissingFunction,
  isSettleable,
  netOwedFor,
  owedOn,
  probeSettleableCategories,
  remainingOn,
  totals,
  UNSETTLEABLE,
  type LedgerInput,
} from "@/components/rentals-v2/rental-detail/payments-model";
import { sumLedgerBalance } from "@/lib/finances/balance";

const RENTAL = { id: "r1", start_date: "2026-09-01", end_date: "2026-09-08" };

function ledgerOf(over: Partial<LedgerInput>) {
  return buildLedger({
    rental: RENTAL,
    chargeRows: [],
    paymentRows: [],
    applicationRows: [],
    refundRows: [],
    extensionRows: [],
    depositEventRows: [],
    linkStateById: new Map(),
    ...over,
  });
}

/** The shared reducer's answer for these rows, in cents (no exclusions; every row already due). */
function reducerCents(rows: { amount: number; remaining_amount: number; category: string; due_date: string }[]) {
  const clock = { now: new Date("2026-09-26T12:00:00Z"), today: "2026-09-26" };
  const entries = rows.map((r) => ({ ...r, type: "Charge", rental_id: "r1" }));
  return Math.round(sumLedgerBalance(entries, new Set(), new Set(), clock) * 100);
}

/*
 * Fixture A — goodwill on an unpaid charge.
 *   Rental      100.00, remaining 100.00, nothing applied
 *   Adjustment  −30.00, remaining −30.00 (goodwill, rental-scoped)
 * Hand-derived:
 *   remainingOn(Rental) = 10000 − 0 = 10000;  creditOn(Adjustment) = −3000
 *   outstanding = 10000 − 3000 = 7000         (was 10000: the credit clamped to 0)
 *   charged     = 10000 + (−3000) = 7000;     credited = 3000
 *   v1 useRentalTotals (Σ remaining_amount) = 100.00 − 30.00 = 70.00 → drift 0
 *   plan balance = max(0, 7000 − 0 unapplied) = 7000
 *   a payment aimed at Rental asks for min(10000, 7000) = 7000
 */
const A_ROWS = [
  { id: "c1", category: "Rental", amount: 100, remaining_amount: 100, entry_date: "2026-09-01", due_date: "2026-09-01" },
  { id: "c2", category: "Adjustment", amount: -30, remaining_amount: -30, entry_date: "2026-09-03", due_date: "2026-09-03", reference: "Late · ADJ-1a2b3c4d" },
];

/*
 * Fixture B — goodwill larger than what is left.
 *   Rental      100.00, 80.00 applied (payment p1, Applied) → remaining 20.00
 *   Adjustment  −30.00, remaining −30.00
 * Hand-derived:
 *   remainingOn(Rental) = 10000 − 8000 = 2000; creditOn = −3000
 *   outstanding = 2000 − 3000 = −1000 → "In credit $10.00"
 *   shared reducer: 20.00 + (−30.00) = −10.00 → −1000
 *   plan balance = max(0, −1000 − 0) = 0;  a payment asks for max(0, min(2000, −1000)) = 0
 */
const B_ROWS = [
  { id: "c1", category: "Rental", amount: 100, remaining_amount: 20, entry_date: "2026-09-01", due_date: "2026-09-01" },
  { id: "c2", category: "Adjustment", amount: -30, remaining_amount: -30, entry_date: "2026-09-03", due_date: "2026-09-03" },
];
const B_PAYMENTS = [{ id: "p1", amount: 80, status: "Applied", payment_date: "2026-09-02", method: "Cash", created_at: "2026-09-02T10:00:00Z", remaining_amount: 0 }];
const B_APPS = [{ payment_id: "p1", charge_entry_id: "c1", amount_applied: 80 }];

describe("D1 — credits net Outstanding exactly as the shared balance rule does", () => {
  it("fixture A: $30 goodwill on a $100 charge → Outstanding $70, charged $70 ($30 credited)", () => {
    const l = ledgerOf({ chargeRows: A_ROWS });
    const t = totals(l);
    expect(t.outstanding).toBe(7000);
    expect(t.charged).toBe(7000);
    expect(t.credited).toBe(3000);
    expect(remainingOn(l, "c1")).toBe(10000);
    expect(remainingOn(l, "c2")).toBe(0);
    expect(creditOn(l.charges.find((c) => c.id === "c2")!)).toBe(-3000);
    expect(owedOn(l, l.charges.find((c) => c.id === "c2")!)).toBe(-3000);
    // the one definition: the shared reducer over the same rows
    expect(t.outstanding).toBe(reducerCents(A_ROWS));
  });

  it("fixture A: the plan balance and an aimed payment are the netted $70", () => {
    const l = ledgerOf({ chargeRows: A_ROWS });
    const t = totals(l);
    expect(Math.max(0, t.outstanding - t.unapplied)).toBe(7000);
    expect(netOwedFor(l, remainingOn(l, "c1"))).toBe(7000);
  });

  it("fixture A: no drift against v1's Σ remaining_amount — credits are kept out of the comparison", () => {
    const l = ledgerOf({ chargeRows: A_ROWS });
    const v1RemainingCents = Math.round((100 + -30) * 100); // useRentalTotals.outstanding = 70.00
    expect(totals(l).outstanding - (v1RemainingCents - l.deposit.chargeOutstanding)).toBe(0);
  });

  it("fixture B: a credit larger than what is left puts the rental in credit (−1000), the reducer agrees", () => {
    const l = ledgerOf({ chargeRows: B_ROWS, paymentRows: B_PAYMENTS, applicationRows: B_APPS });
    const t = totals(l);
    expect(t.outstanding).toBe(-1000);
    expect(t.outstanding).toBe(reducerCents(B_ROWS));
    expect(Math.max(0, t.outstanding - t.unapplied)).toBe(0);
    expect(netOwedFor(l, remainingOn(l, "c1"))).toBe(0);
  });

  it("with no credit, nothing changes: Rental 100.00 with 35.00 applied → 6500 by every route", () => {
    const rows = [{ id: "c1", category: "Rental", amount: 100, remaining_amount: 65, entry_date: "2026-09-01", due_date: "2026-09-01" }];
    const l = ledgerOf({
      chargeRows: rows,
      paymentRows: [{ id: "p1", amount: 35, status: "Applied", payment_date: "2026-09-02", remaining_amount: 0 }],
      applicationRows: [{ payment_id: "p1", charge_entry_id: "c1", amount_applied: 35 }],
    });
    expect(totals(l).outstanding).toBe(6500);
    expect(totals(l).credited).toBe(0);
    expect(netOwedFor(l, 6500)).toBe(6500);
    expect(reducerCents(rows)).toBe(6500);
  });
});

describe("D3 — what a payment can settle comes from the database when it can say", () => {
  const positiveAdjustment = [
    { id: "c9", category: "Adjustment", amount: 50, remaining_amount: 50, entry_date: "2026-09-04", due_date: "2026-09-04" },
    { id: "c8", category: "Excess Mileage", amount: 12, remaining_amount: 12, entry_date: "2026-09-04", due_date: "2026-09-04" },
  ];

  it("no function (the migration not applied): the live list — Adjustment and Excess Mileage cannot be settled", () => {
    const l = ledgerOf({ chargeRows: positiveAdjustment, settleable: null });
    expect(l.charges.map((c) => [c.category, c.settleable])).toEqual([
      ["Adjustment", false],
      ["Excess Mileage", false],
    ]);
    expect(totals(l).stuck).toBe(6200);
    for (const c of UNSETTLEABLE) expect(isSettleable(c)).toBe(false);
  });

  it("the function answered (the migration applied): exactly its list", () => {
    const fromDb = ["Rental", "Tax", "Excess Mileage", "Adjustment", "Security Deposit"];
    const l = ledgerOf({ chargeRows: positiveAdjustment, settleable: fromDb });
    expect(l.charges.every((c) => c.settleable)).toBe(true);
    expect(totals(l).stuck).toBe(0);
    // …and only its list: a category it does not name is not settleable
    expect(isSettleable("Supercharger", fromDb)).toBe(false);
  });

  it("the probe is a GET rpc (never HEAD) and returns the list", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ["Rental", "Adjustment"], error: null });
    await expect(probeSettleableCategories({ rpc })).resolves.toEqual(["Rental", "Adjustment"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("ledger_settleable_categories", {}, { get: true });
    expect(rpc.mock.calls[0][2]).not.toHaveProperty("head");
  });

  it("a missing function (PGRST202 / 42883) is a settled 'no list'; anything else throws so the query retries", async () => {
    const missing = { code: "PGRST202", message: "Could not find the function public.ledger_settleable_categories without parameters in the schema cache" };
    await expect(probeSettleableCategories({ rpc: async () => ({ data: null, error: missing }) })).resolves.toBeNull();
    await expect(probeSettleableCategories({ rpc: async () => ({ data: null, error: { code: "42883", message: "function does not exist" } }) })).resolves.toBeNull();
    await expect(probeSettleableCategories({ rpc: async () => ({ data: null, error: { code: "57014", message: "timeout" } }) })).rejects.toBeTruthy();
    // a body-less "success" is not a list
    await expect(probeSettleableCategories({ rpc: async () => ({ data: null, error: null }) })).rejects.toBeTruthy();
    expect(isMissingFunction(missing)).toBe(true);
    expect(isMissingFunction({ code: "PGRST205", message: "Could not find the table" })).toBe(false);
  });
});
