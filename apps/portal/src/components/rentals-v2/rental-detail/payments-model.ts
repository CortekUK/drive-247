"use client";

/**
 * The money model for the rental control centre — REAL ROWS.
 *
 * The SHAPE is the playground's `rental-create-fake/_payments-model.ts`, kept
 * deliberately: it owns the ledger's types, the derivations that turn it into
 * figures, and the words those figures are named with. A number computed
 * anywhere else, or a payment described in a dialog differently from how the
 * list describes it, is the bug this file exists to make impossible.
 *
 * What is NOT the playground's is everything below `── the adapter ──`. The
 * sandbox seeded a `Ledger`; this builds one from `ledger_entries`,
 * `payment_applications`, `payments` and the rental's own `deposit_hold_*`
 * columns. Nothing on this screen is invented — where a fact
 * has no column behind it, the field is null and the surface says so.
 *
 * ── Cents ────────────────────────────────────────────────────────────────
 *
 * Amounts are integer CENTS throughout, because dollars-as-floats is how
 * $298.67 × 3 comes to $896.01 and an operator stops trusting the screen.
 *
 * The DATABASE stores dollars — `ledger_entries.amount`, `payments.amount`,
 * `rentals.deposit_hold_amount` and every `rental_extension_totals` figure are
 * `numeric` in major units, and PostgREST hands them over as strings. So there
 * is exactly ONE boundary where dollars become cents: `cents()` below, called
 * only inside `buildLedger`. Nothing downstream — no derivation, no component,
 * no dialog — ever sees a dollar float again until `usd()` prints one.
 *
 * The single exception is `deposit_hold_links.amount_cents`, which is already
 * an integer of cents. It gets `rawCents()` instead, and the difference is
 * called out at the call site, because multiplying it by 100 a second time is
 * precisely the kind of mistake this convention exists to prevent.
 *
 * ── What the schema does NOT carry ───────────────────────────────────────
 *
 * Three things the prototype showed have no column behind them, and are
 * therefore absent rather than guessed:
 *
 *   who did it     `payments` has no `created_by`. A manual payment is
 *                  "Recorded in the portal", never "Recorded by Priya".
 *   card brand     `payments` carries the intent id but not brand/last4 —
 *                  those exist only for the DEPOSIT hold. A card payment shows
 *                  its intent id and nothing it cannot prove.
 *   link channel   nothing records whether a link went by email or by SMS.
 *
 * ── The unit money can actually be aimed at ──────────────────────────────
 *
 * The prototype let an operator tick individual charges. The database cannot
 * honour that: `payment_apply_fifo_v2` narrows a payment with
 * `le.category = ANY(v_targets)` — a list of CATEGORIES. So the finest
 * addressable unit is a CATEGORY, not a charge, and `chargeSelectionUnit`
 * below is where that reality is stated once.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { SHOW_MULTI_PERIOD } from "./multi-period";

/* ══════════════════════════════════════════════════════════════════════════
   Money
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE boundary. A `numeric` column arrives from PostgREST as a string
 * ("9271.43"); this is the only place in the payments stage that turns one
 * into a number, and it rounds at the point of conversion so no float ever
 * survives the trip.
 */
export const cents = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** For a column that is ALREADY integer cents — `deposit_hold_links.amount_cents`. */
export const rawCents = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Cents in, "$1,657.00" out. Always two decimals; money is never rounded here. */
export const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * The model carries both "2026-08-26" and "2026-08-26T16:00:00+00". A date-only
 * string is pinned to LOCAL midnight; bare `new Date("2026-08-26")` is UTC
 * midnight, which is still the 25th anywhere west of Greenwich.
 */
export const parseAt = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);

/** "Aug 31" — US ordering like the rest of the app. */
export const day = (iso: string | null | undefined) =>
  iso ? parseAt(String(iso)).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

export const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/* ══════════════════════════════════════════════════════════════════════════
   Categories — what the database will and will not settle
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The category table inside `payment_apply_fifo_v2`, copied exactly and in its
 * own priority order.
 *
 * This is not decoration. The function's loop reads
 *
 *     JOIN cat_order co ON co.cat = le.category
 *
 * — an INNER join — so a charge whose category is absent from this list is
 * invisible to the allocator and NO payment can ever settle it. The ledger's
 * own CHECK constraint allows six categories that are missing here
 * (`UNSETTLEABLE` below), and two of them carry real money on production.
 *
 * The order also matters to an operator: money is applied by CATEGORY rank,
 * not by which charge they meant. An untargeted payment that is short smears
 * the shortfall down this list rather than landing where it was aimed.
 */
export const FIFO_CATEGORIES = [
  "Rental",
  "Tax",
  "Service Fee",
  "Delivery Fee",
  "Collection Fee",
  "Insurance",
  "Extras",
  "Extension Rental",
  "Extension Tax",
  "Extension Service Fee",
  "Extension Insurance",
  "Fine",
  "Fines",
  "Other",
  "Security Deposit",
] as const;

const FIFO_SET = new Set<string>(FIFO_CATEGORIES);

/** Where a category sits in the allocator's order; `Infinity` if it is not in it. */
export const fifoRank = (category: string) => {
  const i = FIFO_CATEGORIES.indexOf(category as (typeof FIFO_CATEGORIES)[number]);
  return i < 0 ? Number.POSITIVE_INFINITY : i;
};

/**
 * Allowed on a ledger row, absent from the allocator. A charge in one of these
 * categories can be RAISED and can be seen, but no payment will ever reduce
 * its `remaining_amount` — only an edge function writing the column directly
 * (which is what `deduct-from-deposit` and the Stripe webhooks do for excess
 * mileage, leaving no `payment_applications` row and so no allocation trail).
 */
export const UNSETTLEABLE = [
  "Excess Mileage",
  "Unlimited Mileage",
  "Adjustment",
  "Supercharger",
  "Extension",
  "InitialFee",
  "Initial Fees",
] as const;

/** Can any payment ever settle a charge in this category? */
export const isSettleable = (category: string) => FIFO_SET.has(category);

/**
 * Categories that describe the BOOKING itself, as opposed to something that
 * happened afterwards. Used to decide whether a charge belongs to the hire or
 * to no period at all — a parking fine raised in week three is not part of
 * what the customer booked.
 */
const BOOKING_CATEGORIES = new Set([
  "Rental",
  "Tax",
  "Service Fee",
  "Delivery Fee",
  "Collection Fee",
  "Insurance",
  "Extras",
  "Unlimited Mileage",
  "InitialFee",
  "Initial Fees",
]);

/** The deposit is a hold, not revenue. It never enters the charge lists. */
export const DEPOSIT_CATEGORY = "Security Deposit";

/* ══════════════════════════════════════════════════════════════════════════
   Shape
   ══════════════════════════════════════════════════════════════════════════ */

export type Segment = {
  /** `"original"`. With `SHOW_MULTI_PERIOD` on, also a `rental_extensions.id`. */
  id: string;
  label: string;
  from: string;
  to: string | null;
  days: number | null;
  /** The period's own state, where it has one. */
  status?: string | null;
};

export type Charge = {
  /** `ledger_entries.id`. */
  id: string;
  /** null = tied to no period — an ad-hoc charge, a fine passed through. */
  segmentId: string | null;
  category: string;
  label: string;
  amountCents: number;
  createdAt: string;
  /** `ledger_entries.reference` — the only note a charge carries. */
  note: string | null;
  dueDate: string | null;
  /**
   * The allocator's own figure for this charge. Kept beside the derived one so
   * the surface can say when the two disagree, which is the signature of money
   * written straight into the column without a `payment_applications` row.
   */
  remainingOnRow: number;
  /** False when no payment can ever settle it. See `UNSETTLEABLE`. */
  settleable: boolean;
};

/** Which charges this money was applied to — `payment_applications`. */
export type Allocation = { chargeId: string; amountCents: number };

/**
 * How strongly a payment is evidenced.
 *
 * `card`   charged against the card on file — there is a Stripe intent behind
 *          it and a bank statement will confirm it.
 * `link`   the customer paid a checkout session we sent them. Same evidence,
 *          different origin, and the origin is what an operator wants to know.
 * `manual` somebody typed it. No provider record of any kind stands behind it.
 *
 * The three are told apart by columns, not by a flag: a checkout session id
 * means a link, an intent with no session means the card on file, neither
 * means manual.
 */
export type Proof =
  | { source: "card"; intentId: string; provider: string | null }
  | {
      source: "link";
      sessionId: string;
      intentId: string | null;
      provider: string | null;
      /** From `useRentalPaymentLinks`, which resolves expiry and supersession. */
      state: string | null;
    }
  | { source: "manual"; method: string | null; reference: string | null };

export type PaymentStatus = "paid" | "pending" | "failed" | "refunded" | "partly_refunded";

/** Why a payment carries no money, when it carries none. */
export type DeadReason = "declined" | "expired" | "superseded" | "voided" | "rejected" | null;

export type TrailEvent = { at: string; event: string };

export type Payment = {
  /** `payments.id`. */
  id: string;
  amountCents: number;
  at: string;
  status: PaymentStatus;
  deadReason: DeadReason;
  proof: Proof;
  allocations: Allocation[];
  trail: TrailEvent[];
  refundedCents: number;
  refundReason: string | null;
  refundIntentId: string | null;
  refundedAt: string | null;
  /**
   * `payments.remaining_amount` — the allocator's own view of what is still
   * unapplied. Kept so the surface can spot money applied to charges that are
   * not on this rental, which would otherwise read here as spare cash.
   */
  remainingOnRow: number;
  /**
   * Cents of this payment that went to the `Security Deposit` charge.
   *
   * Load-bearing, and the reason it is not simply an allocation: the deposit
   * charge is deliberately kept out of `Ledger.charges`, because a deposit is
   * the renter's money held against damage and it must never sit in the same
   * total as revenue. But dropping its ALLOCATIONS too would make a payment
   * that settled the deposit in full — a $400 row with nothing left over —
   * read as "$400.00 not applied", which is money the screen would be
   * inventing a problem about. Netted out of `unallocatedOn`, and stated on
   * its own line in the payment's expansion.
   */
  depositAppliedCents: number;
};

/* ── the deposit: a hold, not revenue ───────────────────────────────────── */

export type DepositStatus = "not_held" | "held" | "expired" | "released" | "captured" | "failed" | "needs_review";

/** One row of `deposit_hold_links` — the hold's own audit trail. */
export type DepositEvent = {
  id: string;
  at: string;
  action: string;
  outcome: string | null;
  amountCents: number;
  intentId: string | null;
  errorMessage: string | null;
  actor: string | null;
};

export type Deposit = {
  /** What is authorised on the card, from `rentals.deposit_hold_amount`. */
  amountCents: number;
  status: DepositStatus;
  heldAt: string | null;
  expiresAt: string | null;
  intentId: string | null;
  card: { brand: string | null; last4: string | null };
  /** Successful captures against the hold — `deposit_hold_links.action='capture'`. */
  deductions: { amountCents: number; reason: string; at: string; by: string | null }[];
  releasedAt: string | null;
  events: DepositEvent[];
  /**
   * The `Security Deposit` LEDGER charge, which is a different thing from the
   * card hold and is regularly confused with it: the charge is money billed,
   * the hold is money frozen. A tenant may run either, both or neither.
   */
  charged: number;
  chargeOutstanding: number;
  refunded: number;
};

/* ── the ledger ─────────────────────────────────────────────────────────── */

export type Ledger = {
  segments: Segment[];
  charges: Charge[];
  payments: Payment[];
  deposit: Deposit;
  /**
   * Refund rows on `ledger_entries` that could not be tied to a payment.
   * `ledger_entries.payment_id` is NULL on every refund row the platform
   * writes, so this is not an edge case — it is the normal case, and the
   * per-payment refund figures come from `payments.refund_amount` instead.
   * These are kept so the two sources can be compared rather than trusted.
   */
  untiedRefunds: { id: string; category: string; amountCents: number; at: string; note: string | null }[];
};

export const EMPTY_DEPOSIT: Deposit = {
  amountCents: 0,
  status: "not_held",
  heldAt: null,
  expiresAt: null,
  intentId: null,
  card: { brand: null, last4: null },
  deductions: [],
  releasedAt: null,
  events: [],
  charged: 0,
  chargeOutstanding: 0,
  refunded: 0,
};

export const EMPTY_LEDGER: Ledger = {
  segments: [],
  charges: [],
  payments: [],
  deposit: EMPTY_DEPOSIT,
  untiedRefunds: [],
};

/* ══════════════════════════════════════════════════════════════════════════
   Words — one vocabulary, said the same everywhere
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `payments.method` is free text and production carries all of
 * "Card", "Cash", "Zelle", "Bank Transfer", "Other: Stripelink", "Other:" and
 * "". It is shown as typed where it says something and dropped where it does
 * not, rather than being forced into a four-value enum it never was.
 */
export const methodWord = (method: string | null | undefined) => {
  const m = (method ?? "").trim();
  if (!m || m.toLowerCase() === "other:") return null;
  return m.replace(/^Other:\s*/i, "").trim() || null;
};

/** Where money came from — the line an operator reads before deciding to trust it. */
export const provenance = (p: Payment) => {
  const pr = p.proof;
  if (pr.source === "card") return "Card on file";
  if (pr.source === "link") return "Payment link";
  const m = methodWord(pr.method);
  return m ? `Recorded by hand · ${m}` : "Recorded by hand";
};

/** One payment in one line, for a picker or a preview sentence. */
export const paymentWord = (p: Payment) => `${day(p.at)} · ${usd(p.amountCents)} · ${provenance(p)}`;

/**
 * A link's state in a few words, from `useRentalPaymentLinks`'s vocabulary.
 * "Sent, not paid" and "Expired" are kept apart on purpose: one is a customer
 * who has not got round to it, the other is a request that no longer works.
 */
export const linkWords = (state: string | null | undefined) =>
  (({
    paid: "Paid",
    awaiting: "Sent · not paid",
    expired: "Expired",
    superseded: "Replaced by a later request",
    voided: "Voided",
    rejected: "Rejected",
    approved: "Approved",
    deposit_hold: "Deposit hold",
  }) as Record<string, string>)[state ?? ""] ?? "Sent";

/* ══════════════════════════════════════════════════════════════════════════
   Derivations — the only way totals are ever computed
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * One vocabulary, two sides of the same allocation:
 *   charge side    charged · paid · outstanding
 *   payment side   received · applied · not applied
 * A charge is PAID by the money APPLIED to it. `paidFor` and `applied` are the
 * same cents read from either end; `received` is more than `applied` by
 * whatever arrived and was never matched to a charge.
 */

/** Only money that actually landed counts; a pending or dead payment is a
 *  story, not cents. */
export const counts = (p: Payment) => p.status !== "failed" && p.status !== "pending";

const chargesIn = (l: Ledger, segmentId: string | null) => l.charges.filter((c) => c.segmentId === segmentId);

export function chargedFor(l: Ledger, segmentId: string | null): number {
  return sum(chargesIn(l, segmentId).map((c) => c.amountCents));
}

/** Cents applied to one charge, from every payment that counts. */
const appliedTo = (l: Ledger, chargeId: string) =>
  sum(
    l.payments
      .filter(counts)
      .flatMap((p) => p.allocations.filter((a) => a.chargeId === chargeId).map((a) => a.amountCents))
  );

/** Money APPLIED to a segment's charges. Refunds do not un-apply: a refunded
 *  period stays paid and the refund shows against its payment. */
export function paidFor(l: Ledger, segmentId: string | null): number {
  return sum(chargesIn(l, segmentId).map((c) => appliedTo(l, c.id)));
}

/**
 * What one charge still needs, never below zero. THE primitive: every
 * outstanding figure on the screen is a sum of these, so the headline, a
 * period's cell and the rows under it cannot disagree.
 *
 * Derived from the allocations rather than read from `remaining_amount`, and
 * that is deliberate: the two disagree exactly where an edge function wrote
 * the column without recording an application, and a screen that reads the
 * column would show such money as settled with nothing behind it. `Charge`
 * keeps `remainingOnRow` so the surface can point the disagreement out.
 */
export function remainingOn(l: Ledger, chargeId: string): number {
  const c = l.charges.find((x) => x.id === chargeId);
  return c ? Math.max(0, c.amountCents - appliedTo(l, c.id)) : 0;
}

export const outstandingFor = (l: Ledger, segmentId: string | null) =>
  sum(chargesIn(l, segmentId).map((c) => remainingOn(l, c.id)));

/**
 * Received but not applied to anything — real, and must be visible. Per
 * payment, never below zero: a refund against a fully-applied payment is money
 * that left, not a negative pool of spare money. Clamped per payment, not on
 * the sum, so one refunded payment cannot mask another's spare.
 */
export function unallocatedOn(p: Payment): number {
  if (!counts(p)) return 0;
  return Math.max(
    0,
    p.amountCents - p.refundedCents - p.depositAppliedCents - sum(p.allocations.map((a) => a.amountCents))
  );
}

/** Cents still frozen on the card: the authorisation less what was captured. */
export const heldOn = (d: Deposit) =>
  d.status === "held" ? Math.max(0, d.amountCents - sum(d.deductions.map((x) => x.amountCents))) : 0;

export function totals(l: Ledger) {
  const landed = l.payments.filter(counts);
  return {
    charged: sum(l.charges.map((c) => c.amountCents)),
    received: sum(landed.map((p) => p.amountCents)),
    applied: sum(landed.flatMap((p) => p.allocations.map((a) => a.amountCents))),
    outstanding: sum(l.charges.map((c) => remainingOn(l, c.id))),
    unapplied: sum(l.payments.map(unallocatedOn)),
    // From the payments, not the refund rows: it is the field `unallocatedOn`
    // nets out, so the two figures can never drift apart.
    refunded: sum(landed.map((p) => p.refundedCents)),
    depositHeld: heldOn(l.deposit),
    depositDeducted: sum(l.deposit.deductions.map((d) => d.amountCents)),
    /** Of what was received, how much went to the deposit rather than revenue. */
    depositApplied: sum(landed.map((p) => p.depositAppliedCents)),
    /** Charges no payment can reach. Zero on a healthy rental. */
    stuck: sum(l.charges.filter((c) => !c.settleable).map((c) => remainingOn(l, c.id))),
  };
}

/**
 * The finest thing money can be aimed at, stated once.
 *
 * `payment_apply_fifo_v2` narrows a payment by `target_categories`; there is no
 * charge-level target. So every picker on this screen groups by CATEGORY —
 * ticking one charge out of two in the same category is not a thing the
 * database can honour, and a UI that offered it would be lying about where the
 * money would land.
 *
 * (The allocator also accepts an `extension_id`, which is how it narrowed to a
 * single period. With one fixed period there is nothing to narrow to — see
 * `SHOW_MULTI_PERIOD`.)
 */
export const chargeSelectionUnit = (c: Charge) => c.category;

/* ══════════════════════════════════════════════════════════════════════════
   ── the adapter ──  real rows in, one Ledger out
   ══════════════════════════════════════════════════════════════════════════ */

type Row = Record<string, any>;

export type LedgerInput = {
  rental: Row;
  chargeRows: Row[];
  paymentRows: Row[];
  applicationRows: Row[];
  refundRows: Row[];
  extensionRows: Row[];
  depositEventRows: Row[];
  /** `useRentalPaymentLinks` output, keyed by payment id. */
  linkStateById: Map<string, string>;
};

/** `payments.status` → the five states arithmetic cares about. */
function paymentStatusOf(row: Row, linkState: string | null): { status: PaymentStatus; deadReason: DeadReason } {
  const s = String(row.status ?? "").toLowerCase();
  const refunded = cents(row.refund_amount);
  const amount = cents(row.amount);

  // A dead link never took money, whatever the payment row says about itself.
  if (linkState === "expired") return { status: "failed", deadReason: "expired" };
  if (linkState === "superseded") return { status: "failed", deadReason: "superseded" };
  if (linkState === "voided") return { status: "failed", deadReason: "voided" };
  if (linkState === "rejected") return { status: "failed", deadReason: "rejected" };

  if (s === "reversed") return { status: "failed", deadReason: "declined" };
  if (s === "pending") return { status: "pending", deadReason: null };
  if (refunded > 0) {
    return { status: refunded >= amount ? "refunded" : "partly_refunded", deadReason: null };
  }
  if (s === "refunded") return { status: "refunded", deadReason: null };
  if (s === "partial refund") return { status: "partly_refunded", deadReason: null };
  return { status: "paid", deadReason: null };
}

/**
 * Which of the three provenances a payment row is.
 *
 * Order matters. A checkout session means the customer was SENT somewhere and
 * paid there; an intent with no session means somebody in the office charged
 * the card on file; neither means a human typed the row and nothing outside
 * this database knows the money exists.
 */
function proofOf(row: Row, linkState: string | null): Proof {
  const session = row.stripe_checkout_session_id ?? row.square_payment_link_id ?? null;
  const intent = row.stripe_payment_intent_id ?? row.square_payment_id ?? null;
  const provider = row.payment_provider ?? null;

  if (session) {
    return { source: "link", sessionId: String(session), intentId: intent ? String(intent) : null, provider, state: linkState };
  }
  if (intent) {
    return { source: "card", intentId: String(intent), provider };
  }
  return { source: "manual", method: row.method ?? null, reference: row.booking_source ?? null };
}

/**
 * The events behind one payment, in order.
 *
 * There is no event table for payments, so the trail is assembled from the
 * timestamps the row itself carries. It is short and it is honest: every line
 * has a column behind it, and a payment with nothing but a created_at gets one
 * line rather than a plausible four.
 */
function trailOf(row: Row, proof: Proof, status: PaymentStatus, deadReason: DeadReason): TrailEvent[] {
  const t: TrailEvent[] = [];
  const created = row.created_at ?? row.payment_date ?? null;

  if (created) {
    t.push({
      at: String(created),
      event:
        proof.source === "link"
          ? "Payment request created"
          : proof.source === "card"
            ? "Charged the card on file"
            : "Recorded in the portal",
    });
  }
  if (row.paid_at) t.push({ at: String(row.paid_at), event: "Paid" });
  if (deadReason === "declined") t.push({ at: String(row.updated_at ?? created ?? ""), event: "Reversed" });
  if (deadReason && deadReason !== "declined") {
    t.push({ at: String(row.updated_at ?? created ?? ""), event: linkWords(proof.source === "link" ? proof.state : null) });
  }
  if (row.refund_processed_at) {
    t.push({
      at: String(row.refund_processed_at),
      event: `Refunded ${usd(cents(row.refund_amount))}${row.refund_reason ? ` — ${row.refund_reason}` : ""}`,
    });
  }
  return t.filter((e) => !!e.at).sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The rental's period. With `SHOW_MULTI_PERIOD` off this is the whole hire,
 * start to end; with it on, the booking as it stood BEFORE anybody extended it.
 */
function originalSegment(rental: Row, extensions: Row[]): Segment {
  const first = extensions
    .filter((e) => !!e.previous_end_date)
    .sort((a, b) => Number(a.sequence_number ?? 0) - Number(b.sequence_number ?? 0))[0];
  const to = (first?.previous_end_date ?? rental.end_date ?? null) as string | null;
  const from = String(rental.start_date ?? "").slice(0, 10);
  let days: number | null = null;
  if (from && to) {
    const a = new Date(`${from}T00:00:00`).getTime();
    const b = new Date(`${String(to).slice(0, 10)}T00:00:00`).getTime();
    if (Number.isFinite(a) && Number.isFinite(b)) days = Math.max(0, Math.round((b - a) / 86_400_000));
  }
  return { id: "original", label: "Original", from, to: to ? String(to).slice(0, 10) : null, days };
}

/**
 * The rental's whole money story, as one object.
 *
 * The `ledger_entries` rows of `type='Payment'` are deliberately ignored: they
 * are a mirror of the `payments` table written for the customer statement, they
 * carry no proof and no allocation, and reading both would double every figure
 * on the screen. `payments` plus `payment_applications` is the pair that
 * actually reconciles.
 */
export function buildLedger(input: LedgerInput): Ledger {
  const { rental, chargeRows, paymentRows, applicationRows, refundRows, extensionRows, depositEventRows, linkStateById } =
    input;

  /* ── segments ───────────────────────────────────────────────────────── */

  // Empty unless `SHOW_MULTI_PERIOD` is on — `stage-payments` does not ask for
  // the rows, and this guard means a stale cache entry could not resurrect them
  // either.
  const extensions = SHOW_MULTI_PERIOD
    ? [...extensionRows].sort((a, b) => Number(a.sequence_number ?? 0) - Number(b.sequence_number ?? 0))
    : [];

  const segments: Segment[] = [
    originalSegment(rental, extensions),
    ...extensions.map((e) => ({
      id: String(e.id),
      label: `Extension ${e.sequence_number ?? "?"}`,
      from: String(e.previous_end_date ?? "").slice(0, 10),
      to: e.new_end_date ? String(e.new_end_date).slice(0, 10) : null,
      days: e.extension_days == null ? null : Number(e.extension_days),
      status: (e.display_status ?? e.status ?? null) as string | null,
    })),
  ];

  const segmentIds = new Set(segments.map((s) => s.id));

  /* ── charges ────────────────────────────────────────────────────────── */

  const depositCharges = chargeRows.filter((r) => r.category === DEPOSIT_CATEGORY);

  const charges: Charge[] = chargeRows
    // The deposit is a hold, not revenue, and it is kept out of every list and
    // every total on the left of the screen. It has its own block.
    .filter((r) => r.category !== DEPOSIT_CATEGORY)
    .map((r) => {
      const category = String(r.category ?? "Other");
      // `extension_id` is the only hard tie a charge has to a period, and it is
      // read as one only while there is more than one period to tie it to — see
      // `SHOW_MULTI_PERIOD`. Otherwise a booking category belongs to the hire
      // and anything else — a fine, an adjustment, excess mileage — belongs to
      // no period at all.
      const ext = SHOW_MULTI_PERIOD && r.extension_id ? String(r.extension_id) : null;
      const segmentId = ext && segmentIds.has(ext) ? ext : BOOKING_CATEGORIES.has(category) ? "original" : null;
      return {
        id: String(r.id),
        segmentId,
        category,
        label: category,
        amountCents: cents(r.amount),
        createdAt: String(r.entry_date ?? r.created_at ?? ""),
        note: (r.reference ?? null) as string | null,
        dueDate: (r.due_date ?? null) as string | null,
        remainingOnRow: cents(r.remaining_amount),
        settleable: isSettleable(category),
      };
    })
    // Oldest first, then by the allocator's own category order — so the list
    // reads in the order money will actually be applied to it.
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || fifoRank(a.category) - fifoRank(b.category));

  const chargeIds = new Set(charges.map((c) => c.id));

  /* ── payments ───────────────────────────────────────────────────────── */

  const depositChargeIds = new Set(depositCharges.map((r) => String(r.id)));

  const allocationsByPayment = new Map<string, Allocation[]>();
  const depositAppliedByPayment = new Map<string, number>();
  for (const a of applicationRows) {
    const chargeId = String(a.charge_entry_id);
    const pid = String(a.payment_id);
    // Money that settled the DEPOSIT charge is counted but not listed — see
    // `Payment.depositAppliedCents`. Anything against a charge on another
    // rental is not this screen's money at all.
    if (depositChargeIds.has(chargeId)) {
      depositAppliedByPayment.set(pid, (depositAppliedByPayment.get(pid) ?? 0) + cents(a.amount_applied));
      continue;
    }
    if (!chargeIds.has(chargeId)) continue;
    const list = allocationsByPayment.get(pid) ?? [];
    list.push({ chargeId, amountCents: cents(a.amount_applied) });
    allocationsByPayment.set(pid, list);
  }

  const payments: Payment[] = paymentRows
    .map((r) => {
      const id = String(r.id);
      const linkState = linkStateById.get(id) ?? null;
      const proof = proofOf(r, linkState);
      const { status, deadReason } = paymentStatusOf(r, linkState);
      return {
        id,
        amountCents: cents(r.amount),
        at: String(r.paid_at ?? r.payment_date ?? r.created_at ?? ""),
        status,
        deadReason,
        proof,
        allocations: allocationsByPayment.get(id) ?? [],
        trail: trailOf(r, proof, status, deadReason),
        refundedCents: cents(r.refund_amount),
        refundReason: (r.refund_reason ?? null) as string | null,
        refundIntentId: (r.stripe_refund_id ?? r.square_refund_id ?? null) as string | null,
        refundedAt: (r.refund_processed_at ?? null) as string | null,
        remainingOnRow: cents(r.remaining_amount),
        depositAppliedCents: depositAppliedByPayment.get(id) ?? 0,
      } satisfies Payment;
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  /* ── the deposit ────────────────────────────────────────────────────── */

  const depositRefundRows = refundRows.filter((r) => r.category === DEPOSIT_CATEGORY);

  const deposit: Deposit = {
    amountCents: cents(rental.deposit_hold_amount ?? rental.deposit_hold_target_amount ?? 0),
    status: depositStatusOf(rental),
    heldAt: (rental.deposit_hold_placed_at ?? null) as string | null,
    expiresAt: (rental.deposit_hold_expires_at ?? null) as string | null,
    intentId: (rental.deposit_hold_payment_intent_id ?? null) as string | null,
    card: { brand: rental.deposit_hold_card_brand ?? null, last4: rental.deposit_hold_card_last4 ?? null },
    deductions: depositEventRows
      .filter((e) => String(e.action ?? "").startsWith("capture") && e.outcome === "succeeded")
      .map((e) => ({
        // ALREADY CENTS on this table — the one column in the payments stage
        // that must not go through `cents()`.
        amountCents: rawCents(e.amount_cents),
        reason: (e.error_message ?? e.disclosure_ref ?? "Captured from the hold") as string,
        at: String(e.completed_at ?? e.created_at ?? ""),
        by: (e.actor ?? null) as string | null,
      })),
    releasedAt: (rental.deposit_hold_release_requested_at ?? null) as string | null,
    events: depositEventRows.map((e) => ({
      id: String(e.id),
      at: String(e.created_at ?? ""),
      action: String(e.action ?? ""),
      outcome: (e.outcome ?? null) as string | null,
      amountCents: rawCents(e.amount_cents),
      intentId: (e.payment_intent_id ?? null) as string | null,
      errorMessage: (e.error_message ?? null) as string | null,
      actor: (e.actor ?? null) as string | null,
    })),
    charged: sum(depositCharges.map((r) => cents(r.amount))),
    chargeOutstanding: sum(depositCharges.map((r) => cents(r.remaining_amount))),
    refunded: sum(depositRefundRows.map((r) => Math.abs(cents(r.amount)))),
  };

  /* ── refunds nobody can tie to a payment ────────────────────────────── */

  const untiedRefunds = refundRows
    .filter((r) => r.category !== DEPOSIT_CATEGORY)
    .map((r) => ({
      id: String(r.id),
      category: String(r.category ?? "Other"),
      amountCents: Math.abs(cents(r.amount)),
      at: String(r.entry_date ?? r.created_at ?? ""),
      note: (r.reference ?? null) as string | null,
    }));

  return { segments, charges, payments, deposit, untiedRefunds };
}

/** `rentals.deposit_hold_status` → the model's word for it. */
function depositStatusOf(rental: Row): DepositStatus {
  const s = String(rental.deposit_hold_status ?? "").toLowerCase();
  if (!s) return "not_held";
  if (s === "released") return "released";
  if (s === "captured") return "captured";
  if (s === "expired") return "expired";
  if (s === "failed") return "failed";
  if (s === "needs_review") return "needs_review";
  // 'active', 'held', 'requires_action' and anything else the placer writes all
  // mean the same thing to an operator: money is frozen on the card.
  return "held";
}

/* ══════════════════════════════════════════════════════════════════════════
   The hook
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every row the payments stage reads, in one query.
 *
 * v1's own hooks cover most of this and are reused where their shape fits —
 * `useRentalPaymentLinks` for link state, `useRentalTotals` for the
 * cross-check (and `useRentalExtensionTotals` for the periods, when
 * `SHOW_MULTI_PERIOD` puts them back). Payments are the
 * exception and this is why: `useRentalPayments` builds its list by grouping
 * `payment_applications`, so a payment that arrived and was never applied —
 * `status = 'Credit'`, the exact state the model calls out as "must be
 * visible" — has no application row and simply does not appear. It also drops
 * `stripe_payment_intent_id`, which is the only thing separating evidenced
 * money from asserted money. So the payments read is done here, in full, and
 * nothing else on this screen is.
 *
 * Payments are gathered from BOTH ends: rows that name this rental, and rows
 * whose applications landed on this rental's charges. A payment made against a
 * customer rather than a rental settles this rental's charges without ever
 * naming it, and it would otherwise show as allocated money from nowhere.
 */
export function useRentalLedgerRows(rentalId: string | null | undefined, extensionRows: Row[], linkStateById: Map<string, string>) {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["rental-payments-ledger-v2", rentalId, tenant?.id],
    queryFn: async () => {
      const [{ data: entries, error: entriesError }, { data: rentalRow, error: rentalError }] = await Promise.all([
        supabase
          .from("ledger_entries")
          .select("id, entry_date, due_date, type, category, amount, remaining_amount, reference, extension_id, payment_id, created_at")
          .eq("rental_id", rentalId!)
          .eq("tenant_id", tenant!.id)
          .order("entry_date", { ascending: true }),
        supabase
          .from("rentals")
          .select(
            "id, start_date, end_date, deposit_hold_status, deposit_hold_amount, deposit_hold_target_amount, deposit_hold_placed_at, deposit_hold_expires_at, deposit_hold_payment_intent_id, deposit_hold_card_brand, deposit_hold_card_last4, deposit_hold_release_requested_at"
          )
          .eq("id", rentalId!)
          .eq("tenant_id", tenant!.id)
          .maybeSingle(),
      ]);

      if (entriesError) throw entriesError;
      if (rentalError) throw rentalError;

      const rows = (entries ?? []) as Row[];
      const chargeRows = rows.filter((r) => r.type === "Charge");
      const refundRows = rows.filter((r) => r.type === "Refund");
      const chargeIds = chargeRows.map((r) => String(r.id));

      const [{ data: apps, error: appsError }, { data: depositEvents }] = await Promise.all([
        chargeIds.length
          ? supabase
              .from("payment_applications")
              .select("id, payment_id, charge_entry_id, amount_applied")
              .in("charge_entry_id", chargeIds)
          : Promise.resolve({ data: [] as Row[], error: null }),
        supabase
          .from("deposit_hold_links")
          .select("id, action, outcome, amount_cents, payment_intent_id, error_message, actor, created_at, completed_at, disclosure_ref")
          .eq("rental_id", rentalId!)
          .order("created_at", { ascending: true }),
      ]);

      if (appsError) throw appsError;

      const applicationRows = (apps ?? []) as Row[];
      const viaApplications = [...new Set(applicationRows.map((a) => String(a.payment_id)))];

      // `.or()` rather than two round trips. An empty `in.()` list is a syntax
      // error in PostgREST, so the second clause is only added when there is
      // something to put in it.
      const filter = viaApplications.length
        ? `rental_id.eq.${rentalId},id.in.(${viaApplications.join(",")})`
        : `rental_id.eq.${rentalId}`;

      const { data: paymentRows, error: paymentsError } = await supabase
        .from("payments")
        .select(
          "id, amount, payment_date, paid_at, created_at, updated_at, method, payment_type, status, remaining_amount, stripe_payment_intent_id, stripe_checkout_session_id, square_payment_id, square_payment_link_id, square_refund_id, payment_provider, booking_source, refund_status, refund_amount, refund_reason, refund_processed_at, stripe_refund_id, extension_id, target_categories, capture_status, is_manual_mode"
        )
        .eq("tenant_id", tenant!.id)
        .or(filter);

      if (paymentsError) throw paymentsError;

      return {
        rental: (rentalRow ?? {}) as Row,
        chargeRows,
        refundRows,
        applicationRows,
        paymentRows: (paymentRows ?? []) as Row[],
        depositEventRows: (depositEvents ?? []) as Row[],
      };
    },
    enabled: !!rentalId && !!tenant?.id,
  });

  const ledger = useMemo(() => {
    if (!query.data) return null;
    return buildLedger({ ...query.data, extensionRows, linkStateById });
  }, [query.data, extensionRows, linkStateById]);

  return { ledger, isLoading: query.isLoading, error: query.error as Error | null, refetch: query.refetch };
}
