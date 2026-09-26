/**
 * Balance adjustments — the words, the reason lists and the sign rules.
 *
 * PURE on purpose: no React, no Supabase and no `@/…` imports. The root PGlite
 * suite (tests/payment-plans/sql/balance-adjustments.test.ts) imports this file
 * by path and requires every list below to equal what
 * `balance_reason_codes()` in supabase/migrations/20260926120000_balance_adjustments.sql
 * returns — so the panel can never offer a reason the server refuses.
 *
 * The three things the "What happened?" question tells apart (A1,
 * docs/PAYMENTS_ROADMAP.md §1):
 *   charge_correction     a charge was wrong — credit or debit against it
 *   off_platform_payment  money received outside the platform — a real payment
 *   goodwill              an agreed reduction — no money behind it
 */

export type AdjustmentKind = "charge_correction" | "off_platform_payment" | "goodwill";

export const ADJUSTMENT_KINDS: readonly AdjustmentKind[] = ["charge_correction", "off_platform_payment", "goodwill"];

/** Must equal `balance_reason_codes(kind)` — pinned by a test. */
export const REASON_CODES: Record<AdjustmentKind, readonly string[]> = {
  charge_correction: ["overcharged", "undercharged", "wrong_rate", "duplicate_charge", "payment_request", "other"],
  off_platform_payment: ["paid_in_person", "paid_by_transfer", "settled_elsewhere", "other"],
  goodwill: ["goodwill", "late_delivery", "vehicle_problem", "loyalty", "agreed_discount", "other"],
};

/** Must equal `balance_reason_codes(NULL, true)` — pinned by a test. */
export const UNDO_REASON_CODES: readonly string[] = [
  "entered_by_mistake",
  "wrong_amount",
  "wrong_customer",
  "customer_disputed",
  "other",
];

/** Every code, in plain words. */
export const REASON_LABELS: Record<string, string> = {
  overcharged: "Charged too much",
  undercharged: "Charged too little",
  wrong_rate: "Wrong rate used",
  duplicate_charge: "Charged twice",
  payment_request: "Requested a payment",
  paid_in_person: "Paid in person",
  paid_by_transfer: "Sent to our bank or payment app",
  settled_elsewhere: "Settled in another system",
  goodwill: "Goodwill",
  late_delivery: "Car was late",
  vehicle_problem: "Problem with the car",
  loyalty: "Loyal customer",
  agreed_discount: "Agreed discount",
  entered_by_mistake: "Entered by mistake",
  wrong_amount: "Wrong amount",
  wrong_customer: "Wrong customer",
  customer_disputed: "Customer disputed it",
  other: "Something else",
};

/**
 * Which way a correction may go for each reason — the same rule
 * `balance_adjust` enforces. `either` = the operator picks.
 */
export const CORRECTION_DIRECTION: Record<string, "credit" | "debit" | "either"> = {
  overcharged: "credit",
  duplicate_charge: "credit",
  undercharged: "debit",
  payment_request: "debit",
  wrong_rate: "either",
  other: "either",
};

/** The reasons a "charge was wrong" answer offers (a payment request has its own button). */
export const CORRECTION_REASONS = REASON_CODES.charge_correction.filter((r) => r !== "payment_request");

/** The manual methods an off-platform payment can be — the Record Payment list without "Card". */
export const OFF_PLATFORM_METHODS: readonly string[] = ["Cash", "Bank Transfer", "Zelle", "Check", "Other"];

/** The "What happened?" answers, in the order they are asked. */
export const WHAT_HAPPENED: readonly { kind: AdjustmentKind; title: string; detail: string }[] = [
  {
    kind: "charge_correction",
    title: "A charge was wrong",
    detail: "Take money off one charge, or add to it. The charge itself stays as it was; the correction sits beside it.",
  },
  {
    kind: "off_platform_payment",
    title: "I received money outside the platform",
    detail: "Cash, a bank transfer, Zelle or a check. It counts as money received and pays off the charges like any payment.",
  },
  {
    kind: "goodwill",
    title: "Goodwill or an agreed reduction",
    detail: "Lower what they owe with no money changing hands. It is not counted as money received.",
  },
];

/** A kind, as the history list names it. */
export const KIND_LABELS: Record<AdjustmentKind, string> = {
  charge_correction: "Charge corrected",
  off_platform_payment: "Paid outside the platform",
  goodwill: "Goodwill",
};

/* ── money ───────────────────────────────────────────────────────────────── */

/** A numeric dollar column (number or string) → integer cents. */
export function centsOf(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** A typed dollar amount → integer cents, or null when it is not a positive amount with at most two decimals. */
export function parseDollarsToCents(input: string): number | null {
  const s = String(input ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}

export function formatCents(cents: number, currency = "USD"): string {
  let code = (currency || "USD").toUpperCase();
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: code });
  } catch {
    code = "USD";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Signed, for a history row: "−$30.00" / "+$20.00". */
export function formatSignedCents(cents: number, currency = "USD"): string {
  if (cents === 0) return formatCents(0, currency);
  return `${cents < 0 ? "−" : "+"}${formatCents(Math.abs(cents), currency)}`;
}

/* ── the balance, in words ───────────────────────────────────────────────── */

export type BalanceTone = "owes" | "credit" | "settled";

/**
 * The header's one sentence, from the shared reducer's NET figure in cents
 * (outstanding − captured credit, `useCustomerBalanceWithStatus`). Under half a
 * cent either way is settled, exactly as the hook's `Math.abs(net) < 0.01`.
 */
export function balanceWords(netCents: number, currency = "USD"): { tone: BalanceTone; headline: string; amountCents: number } {
  if (Math.abs(netCents) < 1) return { tone: "settled", headline: "Settled", amountCents: 0 };
  if (netCents > 0) return { tone: "owes", headline: `Owes you ${formatCents(netCents, currency)}`, amountCents: netCents };
  return { tone: "credit", headline: `In credit ${formatCents(-netCents, currency)}`, amountCents: -netCents };
}

/**
 * The shared reducer's own answer (`useCustomerBalanceWithStatus`: status +
 * display balance in dollars) → signed net cents. The header draws from this,
 * so it can never say something the hook does not.
 */
export function netCentsFromStatus(
  result: { balance: number; status: "In Credit" | "Settled" | "In Debt" } | null | undefined,
): number | null {
  if (!result) return null;
  if (result.status === "Settled") return 0;
  const cents = centsOf(result.balance);
  return result.status === "In Credit" ? -cents : cents;
}

/** The sentence a history row's amount means. */
export function effectWords(kind: AdjustmentKind, amountCents: number, isUndo: boolean): string {
  if (isUndo) return amountCents > 0 ? "Owes more again" : "Owes less again";
  if (kind === "off_platform_payment") return "Money received";
  return amountCents < 0 ? "Owes less" : "Owes more";
}
