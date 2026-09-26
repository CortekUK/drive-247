/**
 * Balance adjustments — the pure parts: the header's words, amount parsing,
 * and how the history ties an undo to what it undid and finds the off-platform
 * payments whose note never saved. Expected values written by hand.
 */
import { describe, expect, it } from "vitest";
import {
  balanceWords,
  centsOf,
  effectWords,
  formatSignedCents,
  netCentsFromStatus,
  parseDollarsToCents,
  CORRECTION_DIRECTION,
  CORRECTION_REASONS,
  REASON_CODES,
  REASON_LABELS,
  UNDO_REASON_CODES,
  WHAT_HAPPENED,
} from "@/components/balance/balance-words";
import { buildAdjustmentHistory, isMissingSchema, type AdjustmentRow, type OffPlatformPaymentRow } from "@/hooks/use-balance-adjustments";

describe("the header, in words", () => {
  it.each([
    [20000, "owes", "Owes you $200.00"],
    [-1550, "credit", "In credit $15.50"],
    [0, "settled", "Settled"],
  ] as const)("%i cents → %s", (net, tone, headline) => {
    expect(balanceWords(net, "USD")).toMatchObject({ tone, headline });
  });

  it("reads the shared reducer's own answer (status + display balance) as signed cents", () => {
    expect(netCentsFromStatus({ balance: 200, status: "In Debt" })).toBe(20000);
    expect(netCentsFromStatus({ balance: 15.5, status: "In Credit" })).toBe(-1550);
    expect(netCentsFromStatus({ balance: 0, status: "Settled" })).toBe(0);
    expect(netCentsFromStatus(null)).toBeNull();
  });
});

describe("amounts", () => {
  it.each([
    ["30", 3000],
    ["30.5", 3050],
    ["30.50", 3050],
    ["0.01", 1],
  ])("%s → %i cents", (s, c) => expect(parseDollarsToCents(s)).toBe(c));

  it.each(["", "0", "0.00", "-5", "5.001", "abc", "1,000"])("%s is refused", (s) => expect(parseDollarsToCents(s)).toBeNull());

  it("signs and cents", () => {
    expect(formatSignedCents(-3000, "USD")).toBe("−$30.00");
    expect(formatSignedCents(2000, "USD")).toBe("+$20.00");
    expect(centsOf("12.345")).toBe(1235);
    expect(effectWords("off_platform_payment", -20000, false)).toBe("Money received");
    expect(effectWords("goodwill", 3000, true)).toBe("Owes more again");
  });
});

describe("the lists", () => {
  it("every code has words, and the three answers are asked in A1's order", () => {
    for (const code of [...Object.values(REASON_CODES).flat(), ...UNDO_REASON_CODES]) expect(REASON_LABELS[code], code).toBeTruthy();
    expect(WHAT_HAPPENED.map((w) => w.kind)).toEqual(["charge_correction", "off_platform_payment", "goodwill"]);
  });

  it("a payment request has its own button, not a place in 'A charge was wrong'", () => {
    expect(CORRECTION_REASONS).not.toContain("payment_request");
    expect(CORRECTION_DIRECTION.payment_request).toBe("debit");
  });
});

/* ── the history ─────────────────────────────────────────────────────────── */

const row = (over: Partial<AdjustmentRow>): AdjustmentRow => ({
  id: "a1",
  kind: "goodwill",
  amount: "-30.00",
  reason_code: "goodwill",
  note: "n",
  rental_id: null,
  extension_id: null,
  ledger_entry_id: "le1",
  payment_id: null,
  target_charge_id: null,
  reverses_id: null,
  created_by: "u1",
  created_at: "2026-09-20T10:00:00.000Z",
  ...over,
});

describe("buildAdjustmentHistory", () => {
  const names = new Map([
    ["u1", "Kristen"],
    ["u2", "Sam"],
  ]);

  it("ties each undo to what it undid, newest first", () => {
    const rows = [
      row({ id: "a1" }),
      row({ id: "a2", amount: "30.00", reverses_id: "a1", created_by: "u2", created_at: "2026-09-21T09:00:00.000Z" }),
    ];
    const { entries } = buildAdjustmentHistory(rows, names, []);
    expect(entries.map((e) => e.id)).toEqual(["a2", "a1"]);
    expect(entries[1]).toMatchObject({ amountCents: -3000, createdByName: "Kristen", undoneBy: { id: "a2", at: "2026-09-21T09:00:00.000Z", byName: "Sam" } });
    expect(entries[0]).toMatchObject({ amountCents: 3000, reversesId: "a1", undoneBy: null });
  });

  it("finds off-platform payments with no audit row, and flags one reversed elsewhere without an undo", () => {
    const rows = [row({ id: "p-rec", kind: "off_platform_payment", amount: "-200.00", payment_id: "pay1", ledger_entry_id: null })];
    const payments: OffPlatformPaymentRow[] = [
      { id: "pay1", amount: 200, method: "Zelle", payment_date: "2026-09-19", status: "Reversed", rental_id: "r1" },
      { id: "pay2", amount: "75.5", method: "Cash", payment_date: "2026-09-20", status: "Applied", rental_id: null },
      { id: "pay3", amount: 10, method: "Cash", payment_date: "2026-09-20", status: "Reversed", rental_id: null },
    ];
    const { entries, unrecorded } = buildAdjustmentHistory(rows, names, payments);
    expect(entries[0]).toMatchObject({ paymentStatus: "Reversed", paymentMethod: "Zelle", reversedWithoutUndo: true });
    // pay3 is reversed: it is not money received, so there is nothing to write a note for.
    expect(unrecorded).toEqual([{ paymentId: "pay2", amountCents: 7550, method: "Cash", paymentDate: "2026-09-20", rentalId: null }]);
  });

  it("a staff name that could not be read is null, never an error", () => {
    const { entries } = buildAdjustmentHistory([row({ created_by: "ghost" })], names, []);
    expect(entries[0].createdByName).toBeNull();
  });
});

describe("isMissingSchema — the migration not applied yet", () => {
  it.each([
    [{ code: "42P01", message: 'relation "public.balance_adjustments" does not exist' }, true],
    [{ code: "PGRST205", message: "Could not find the table 'public.balance_adjustments'" }, true],
    [{ code: "42703", message: "column payments.is_off_platform does not exist" }, true],
    [{ code: "42501", message: "permission denied" }, false],
    [null, false],
  ])("%j → %s", (e, want) => expect(isMissingSchema(e)).toBe(want));
});
