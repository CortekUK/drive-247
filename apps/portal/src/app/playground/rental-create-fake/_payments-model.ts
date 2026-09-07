/**
 * The money model for the rental control centre — DESIGN SANDBOX. Nothing here
 * touches a real row; it is the single shape every payments component builds
 * against so that four agents working in parallel produce one surface.
 *
 * It owns three things and only these: the SHAPE of the ledger, the
 * DERIVATIONS that turn it into figures, and the WORDS those figures are
 * named with. A number computed anywhere else, or a payment described in a
 * dialog differently from how the list describes it, is the bug this file
 * exists to make impossible.
 *
 * Amounts are integer CENTS throughout. Dollars-as-floats is how $298.67 × 3
 * comes to $896.01 and an operator stops trusting the screen.
 *
 * The seed mirrors `_extensions.tsx` exactly — same seven segments, same
 * $110/day, same pay states — so the right-rail timeline and this surface
 * never disagree about the same rental.
 *
 * Grounded in the real product:
 *   charges      `ledger_entries` (one row per billable thing, `remaining_amount`
 *                on each — so a payment is APPLIED to charges, not just received)
 *   payments     `payments` with `stripe_payment_intent_id`; manual ones have none
 *   links        `payment_links` (`status`, `opened_at`, `paid_at`)
 *   deposit      a Stripe pre-auth on `rentals.deposit_hold_*`, captured in part
 *                or released — NEVER revenue until captured
 *   refunds      `process-refund` / `schedule-refund` edge functions
 *   extensions   `rental_extensions`, each with its own charges — which is why a
 *                segment is the unit money is reckoned in
 */

/* ── segments ───────────────────────────────────────────────────────────── */

export type Segment = {
  id: string;
  label: string;
  from: string;
  to: string;
  days: number;
};

/** Same seven periods as the Extensions timeline. */
export const SEGMENTS: Segment[] = [
  { id: "s0", label: "Original", from: "2026-08-05", to: "2026-08-10", days: 5 },
  { id: "s1", label: "Extension 1", from: "2026-08-10", to: "2026-08-17", days: 7 },
  { id: "s2", label: "Extension 2", from: "2026-08-17", to: "2026-08-24", days: 7 },
  { id: "s3", label: "Extension 3", from: "2026-08-25", to: "2026-08-31", days: 6 },
  { id: "s4", label: "Extension 4", from: "2026-08-31", to: "2026-09-05", days: 5 },
  { id: "s5", label: "Extension 5", from: "2026-09-05", to: "2026-09-10", days: 5 },
  { id: "s6", label: "Extension 6", from: "2026-09-09", to: "2026-09-16", days: 7 },
];

/* ── charges: what is owed, and why ─────────────────────────────────────── */

export type ChargeKind = "rental" | "extra" | "delivery" | "insurance" | "fee" | "adhoc";

export type Charge = {
  id: string;
  /** null = not tied to any period (an ad-hoc charge, a fine passed through). */
  segmentId: string | null;
  kind: ChargeKind;
  label: string;
  amountCents: number;
  createdAt: string;
  /** Who raised it and why — the thing an ad-hoc charge must never lose. */
  note?: string;
  by?: string;
};

/* ── payments: money that arrived, with its proof ───────────────────────── */

/** How a manual payment reached us — the only thing standing behind it. */
export type PaymentMethod = "cash" | "bank" | "cheque" | "other";

/**
 * How strongly a payment is evidenced. Provider payments carry a Stripe
 * intent id and a receipt — a bank statement will confirm them. A manual
 * payment carries only who typed it. They must never look alike on screen.
 */
export type Proof =
  | { source: "card"; intentId: string; brand: string; last4: string; receiptUrl: string; by: string }
  | { source: "link"; intentId: string; linkId: string; channel: "email" | "sms"; receiptUrl: string }
  | { source: "manual"; method: PaymentMethod; reference?: string; by: string; note?: string };

export type TrailEvent = { at: string; event: string };

/** Reconciliation: which charges this money was applied to. What is left over
 *  — `amountCents - refundedCents - sum(allocations)`, see `unallocatedOn` —
 *  is money that arrived and was never matched to a charge, and is a real
 *  state, not a rounding error. */
export type Allocation = { chargeId: string; amountCents: number };

export type PaymentStatus = "paid" | "pending" | "failed" | "refunded" | "partly_refunded";

export type Payment = {
  id: string;
  amountCents: number;
  at: string;
  status: PaymentStatus;
  proof: Proof;
  allocations: Allocation[];
  trail: TrailEvent[];
  refundedCents: number;
};

/* ── refunds ────────────────────────────────────────────────────────────── */

export type Refund = {
  id: string;
  paymentId: string;
  amountCents: number;
  at: string;
  reason: string;
  by: string;
  /** Present when it went back through Stripe; absent for a manual refund. */
  intentId?: string;
};

/* ── the deposit: a hold, not revenue ───────────────────────────────────── */

export type DepositStatus = "not_held" | "held" | "expired" | "released" | "captured";

export type Deduction = { amountCents: number; reason: string; at: string; by: string };

export type Deposit = {
  amountCents: number;
  status: DepositStatus;
  heldAt?: string;
  expiresAt?: string;
  intentId?: string;
  /** Captured against the hold, each with a reason — the customer sees these. */
  deductions: Deduction[];
  releasedAt?: string;
};

/* ── payment links ──────────────────────────────────────────────────────── */

export type LinkStatus = "created" | "sent" | "opened" | "declined" | "paid" | "expired";

export type PaymentLink = {
  id: string;
  /** A link can carry one charge or many — "select them all and send it". */
  chargeIds: string[];
  amountCents: number;
  status: LinkStatus;
  channel: "email" | "sms";
  createdAt: string;
  sentAt?: string;
  openedAt?: string;
  paidAt?: string;
  paymentId?: string;
  trail: TrailEvent[];
};

/* ── the ledger ─────────────────────────────────────────────────────────── */

export type Ledger = {
  segments: Segment[];
  charges: Charge[];
  payments: Payment[];
  refunds: Refund[];
  deposit: Deposit;
  links: PaymentLink[];
};

/* ── formatting — one formatter, so the two-decimals rule lives once ────── */

/** Cents in, "$1,657.00" out. Always two decimals; money is never rounded here. */
export const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * The model carries both "2026-08-26" and "2026-08-26T16:00:00". A date-only
 * string is pinned to LOCAL midnight; bare `new Date("2026-08-26")` is UTC
 * midnight, which is still the 25th anywhere west of Greenwich.
 */
export const parseAt = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);

/** "Aug 31" — US ordering like the rest of the app; the year is the rental's. */
export const day = (iso: string) => parseAt(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/* ── words — one vocabulary, said the same everywhere ───────────────────── */

/**
 * The surface, the ladder and the dialogs all name the same things, and they
 * used to name them differently: a payment read "Card on file · Visa 4242" in
 * the list and "Visa 4242" in the refund picker; a link read "Link sent" on a
 * period and "Sent · not opened" in the list. Same fact, two words, and an
 * operator has to work out they are the same. The words live here now, next to
 * the derivations, for the same reason the totals do.
 *
 * TONE is not here. How loudly a thing is said depends on where it is said —
 * a superseded link is a quiet record in the links list and an unpaid period's
 * problem in the ladder — so each surface still chooses its own weight.
 */

export const METHOD_WORDS: Record<PaymentMethod, string> = {
  cash: "cash",
  bank: "bank transfer",
  cheque: "cheque",
  other: "other",
};

export const channelWord = (c: "email" | "sms") => (c === "email" ? "email" : "SMS");

/** Where money came from — the line an operator reads before deciding to trust it. */
export const provenance = (p: Payment) => {
  const pr = p.proof;
  if (pr.source === "card") return `Card on file · ${pr.brand} ${pr.last4}`;
  if (pr.source === "link") return `Payment link · ${channelWord(pr.channel)}`;
  return `Recorded by ${pr.by}`;
};

/** One payment in one line, for a picker or a preview sentence. */
export const paymentWord = (p: Payment) => `${day(p.at)} · ${usd(p.amountCents)} · ${provenance(p)}`;

/**
 * A link's state in a few words. "Sent · not opened" and "Opened · not paid"
 * are kept apart on purpose: a link nobody opened is a reach problem, one
 * opened and abandoned a willingness one. The WHY behind a decline lives in
 * the link's trail and on the failed payment, not in this phrase.
 */
export const linkWords = (status: LinkStatus) =>
  ({
    created: "Not sent",
    sent: "Sent · not opened",
    opened: "Opened · not paid",
    declined: "Declined",
    expired: "Expired",
    paid: "Paid",
  })[status];

/* ── derivations — the only way totals are ever computed ────────────────── */

export const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/**
 * One vocabulary, two sides of the same allocation:
 *   charge side    charged · paid · outstanding
 *   payment side   received · applied · not applied
 * A charge is PAID by the money APPLIED to it. `paidFor` and `applied` are the
 * same cents read from either end; `received` is more than `applied` by
 * whatever arrived and was never matched to a charge.
 */

/** Only money that actually landed counts; a failed or pending payment is a
 *  story, not cents. */
export const counts = (p: Payment) => p.status !== "failed" && p.status !== "pending";

const chargesIn = (l: Ledger, segmentId: string | null) => l.charges.filter((c) => c.segmentId === segmentId);

export function chargedFor(l: Ledger, segmentId: string | null): number {
  return sum(chargesIn(l, segmentId).map((c) => c.amountCents));
}

/** Cents applied to one charge, from every payment that counts. */
const appliedTo = (l: Ledger, chargeId: string) =>
  sum(l.payments.filter(counts).flatMap((p) => p.allocations.filter((a) => a.chargeId === chargeId).map((a) => a.amountCents)));

/** Money APPLIED to a segment's charges. Refunds do not un-apply: a refunded
 *  period stays paid and the refund shows against its payment — see `refunds`. */
export function paidFor(l: Ledger, segmentId: string | null): number {
  return sum(chargesIn(l, segmentId).map((c) => appliedTo(l, c.id)));
}

/** What one charge still needs, never below zero. THE primitive: every
 *  outstanding figure on the screen is a sum of these, so the headline, a
 *  period's cell and the rows under it cannot disagree. */
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
  return Math.max(0, p.amountCents - p.refundedCents - sum(p.allocations.map((a) => a.amountCents)));
}

/** Cents still held on the deposit: the authorisation less what was captured. */
export const heldOn = (d: Deposit) =>
  d.status === "held" ? d.amountCents - sum(d.deductions.map((x) => x.amountCents)) : 0;

export function totals(l: Ledger) {
  const landed = l.payments.filter(counts);
  return {
    charged: sum(l.charges.map((c) => c.amountCents)),
    received: sum(landed.map((p) => p.amountCents)),
    applied: sum(landed.flatMap((p) => p.allocations.map((a) => a.amountCents))),
    outstanding: sum(l.charges.map((c) => remainingOn(l, c.id))),
    unapplied: sum(l.payments.map(unallocatedOn)),
    // From the payments, not `refunds[]`: it is the field `unallocatedOn` nets
    // out, so the two figures can never drift apart.
    refunded: sum(landed.map((p) => p.refundedCents)),
    depositHeld: heldOn(l.deposit),
    depositDeducted: sum(l.deposit.deductions.map((d) => d.amountCents)),
  };
}

/* ── seed ───────────────────────────────────────────────────────────────── */

const RATE = 11_000; // $110/day, as in the Extensions timeline

const rental = (seg: Segment): Charge => ({
  id: `c-${seg.id}-rental`,
  segmentId: seg.id,
  kind: "rental",
  label: `${seg.days} days × $110`,
  amountCents: seg.days * RATE,
  createdAt: seg.from,
});

/**
 * Every failure mode the operator meets, somewhere in here:
 *   s0   paid by LINK (email) — provider-evidenced
 *   s1   paid by CARD on file
 *   s2   paid by card, then PARTLY REFUNDED ($55, early-return credit)
 *   s3   paid MANUALLY (bank transfer) — asserted, not evidenced. Also never insured.
 *   s4   PART PAID: $400 card against $620 (5 × $110 + $70 CDW)
 *   s5   UNPAID: link sent, opened, DECLINED
 *   s6   UNPAID: nothing sent yet
 *   adhoc  a $75 parking fine passed through, tied to no period
 *   deposit  $500 held; $120 captured for cleaning; balance still held
 *   not applied  $30 overpayment on s1, received but never applied
 */
export const SEED: Ledger = {
  segments: SEGMENTS,
  charges: [
    rental(SEGMENTS[0]),
    { id: "c-s0-extra", segmentId: "s0", kind: "extra", label: "Child seat × 5 days", amountCents: 4_000, createdAt: "2026-08-05" },
    { id: "c-s0-delivery", segmentId: "s0", kind: "delivery", label: "Delivery · 14 mi", amountCents: 4_500, createdAt: "2026-08-05" },
    { id: "c-s0-ins", segmentId: "s0", kind: "insurance", label: "CDW · 5 days", amountCents: 7_000, createdAt: "2026-08-05" },
    rental(SEGMENTS[1]),
    { id: "c-s1-ins", segmentId: "s1", kind: "insurance", label: "CDW · 7 days", amountCents: 9_800, createdAt: "2026-08-10" },
    rental(SEGMENTS[2]),
    { id: "c-s2-ins", segmentId: "s2", kind: "insurance", label: "CDW · 7 days", amountCents: 9_800, createdAt: "2026-08-17" },
    rental(SEGMENTS[3]),
    rental(SEGMENTS[4]),
    { id: "c-s4-ins", segmentId: "s4", kind: "insurance", label: "CDW · 5 days", amountCents: 7_000, createdAt: "2026-08-31" },
    rental(SEGMENTS[5]),
    { id: "c-s5-ins", segmentId: "s5", kind: "insurance", label: "CDW · 3 days", amountCents: 4_200, createdAt: "2026-09-05" },
    rental(SEGMENTS[6]),
    {
      id: "c-adhoc-fine",
      segmentId: null,
      kind: "adhoc",
      label: "Parking fine · passed through",
      amountCents: 7_500,
      createdAt: "2026-08-29",
      note: "PCN from 21 Aug, Brickell. Photo of the notice attached to the rental.",
      by: "Priya",
    },
  ],
  payments: [
    {
      id: "p1",
      amountCents: 70_500, // s0 in full: 55000 + 4000 + 4500 + 7000
      at: "2026-07-28T14:12:00",
      status: "paid",
      proof: { source: "link", intentId: "pi_3Q1a…c8f2", linkId: "plink_1Q1a…", channel: "email", receiptUrl: "#" },
      allocations: [
        { chargeId: "c-s0-rental", amountCents: 55_000 },
        { chargeId: "c-s0-extra", amountCents: 4_000 },
        { chargeId: "c-s0-delivery", amountCents: 4_500 },
        { chargeId: "c-s0-ins", amountCents: 7_000 },
      ],
      trail: [
        { at: "2026-07-28T09:40:00", event: "Link created for $705.00" },
        { at: "2026-07-28T09:41:00", event: "Sent by email" },
        { at: "2026-07-28T13:58:00", event: "Opened" },
        { at: "2026-07-28T14:12:00", event: "Paid · Visa 4242" },
      ],
      refundedCents: 0,
    },
    {
      id: "p2",
      amountCents: 89_800, // s1 (77000 + 9800) + $30 over
      at: "2026-08-09T11:05:00",
      status: "paid",
      proof: { source: "card", intentId: "pi_3Q4b…91aa", brand: "Visa", last4: "4242", receiptUrl: "#", by: "Priya" },
      allocations: [
        { chargeId: "c-s1-rental", amountCents: 77_000 },
        { chargeId: "c-s1-ins", amountCents: 9_800 },
      ],
      trail: [{ at: "2026-08-09T11:05:00", event: "Charged card on file · Visa 4242" }],
      refundedCents: 0,
    },
    {
      id: "p3",
      amountCents: 86_800, // s2 in full
      at: "2026-08-16T10:22:00",
      status: "partly_refunded",
      proof: { source: "card", intentId: "pi_3Q7c…e0d1", brand: "Visa", last4: "4242", receiptUrl: "#", by: "Dan" },
      allocations: [
        { chargeId: "c-s2-rental", amountCents: 77_000 },
        { chargeId: "c-s2-ins", amountCents: 9_800 },
      ],
      trail: [
        { at: "2026-08-16T10:22:00", event: "Charged card on file · Visa 4242" },
        { at: "2026-08-24T08:30:00", event: "Refunded $55.00 — returned half a day early" },
      ],
      refundedCents: 5_500,
    },
    {
      id: "p4",
      amountCents: 66_000, // s3
      at: "2026-08-26T16:00:00",
      status: "paid",
      proof: { source: "manual", method: "bank", reference: "FPS 260826-4471", by: "Priya", note: "Customer transferred after the weekend. Confirmed on the bank feed." },
      allocations: [{ chargeId: "c-s3-rental", amountCents: 66_000 }],
      trail: [{ at: "2026-08-26T16:00:00", event: "Recorded by Priya · bank transfer" }],
      refundedCents: 0,
    },
    {
      id: "p5",
      amountCents: 40_000, // part of s4's 62000
      at: "2026-08-30T12:15:00",
      status: "paid",
      proof: { source: "card", intentId: "pi_3Qa1…77b3", brand: "Visa", last4: "4242", receiptUrl: "#", by: "Dan" },
      allocations: [{ chargeId: "c-s4-rental", amountCents: 40_000 }],
      trail: [{ at: "2026-08-30T12:15:00", event: "Charged card on file · $400.00 — customer asked to split" }],
      refundedCents: 0,
    },
    {
      id: "p6",
      amountCents: 59_200, // s5 attempt
      at: "2026-09-04T18:41:00",
      status: "failed",
      proof: { source: "link", intentId: "pi_3Qc9…0f11", linkId: "plink_1Qc9…", channel: "sms", receiptUrl: "#" },
      allocations: [],
      trail: [
        { at: "2026-09-04T09:02:00", event: "Link created for $592.00" },
        { at: "2026-09-04T09:03:00", event: "Sent by SMS" },
        { at: "2026-09-04T18:39:00", event: "Opened" },
        { at: "2026-09-04T18:41:00", event: "Declined · insufficient funds" },
      ],
      refundedCents: 0,
    },
  ],
  refunds: [
    {
      id: "r1",
      paymentId: "p3",
      amountCents: 5_500,
      at: "2026-08-24T08:30:00",
      reason: "Returned half a day early",
      by: "Dan",
      intentId: "re_3Q7c…a2f0",
    },
  ],
  deposit: {
    amountCents: 50_000,
    status: "held",
    heldAt: "2026-08-05T09:15:00",
    expiresAt: "2026-09-11T09:15:00",
    intentId: "pi_3Q1z…hold",
    deductions: [{ amountCents: 12_000, reason: "Interior cleaning — smoke", at: "2026-08-24T09:10:00", by: "Dan" }],
  },
  links: [
    {
      id: "plink_1Q1a…",
      chargeIds: ["c-s0-rental", "c-s0-extra", "c-s0-delivery", "c-s0-ins"],
      amountCents: 70_500,
      status: "paid",
      channel: "email",
      createdAt: "2026-07-28T09:40:00",
      sentAt: "2026-07-28T09:41:00",
      openedAt: "2026-07-28T13:58:00",
      paidAt: "2026-07-28T14:12:00",
      paymentId: "p1",
      trail: [
        { at: "2026-07-28T09:40:00", event: "Created" },
        { at: "2026-07-28T09:41:00", event: "Sent by email" },
        { at: "2026-07-28T13:58:00", event: "Opened" },
        { at: "2026-07-28T14:12:00", event: "Paid" },
      ],
    },
    {
      id: "plink_1Qc9…",
      chargeIds: ["c-s5-rental", "c-s5-ins"],
      amountCents: 59_200,
      status: "declined",
      channel: "sms",
      createdAt: "2026-09-04T09:02:00",
      sentAt: "2026-09-04T09:03:00",
      openedAt: "2026-09-04T18:39:00",
      trail: [
        { at: "2026-09-04T09:02:00", event: "Created" },
        { at: "2026-09-04T09:03:00", event: "Sent by SMS" },
        { at: "2026-09-04T18:39:00", event: "Opened" },
        { at: "2026-09-04T18:41:00", event: "Declined · insufficient funds" },
      ],
    },
    {
      id: "plink_1Qd2…",
      chargeIds: ["c-adhoc-fine"],
      amountCents: 7_500,
      status: "sent",
      channel: "email",
      createdAt: "2026-08-29T15:20:00",
      sentAt: "2026-08-29T15:21:00",
      trail: [
        { at: "2026-08-29T15:20:00", event: "Created" },
        { at: "2026-08-29T15:21:00", event: "Sent by email" },
      ],
    },
  ],
};
