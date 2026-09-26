/**
 * Finances — putting money right: "Move payment" and "Fix what's owed".
 * The pure half: the server's contract, the rules the screen checks before it
 * asks, the words, and what a history row changed. No React, no Supabase.
 *
 * The server is `payment-reallocate` (supabase/functions/payment-reallocate/
 * core.ts) over the SQL in 20260926120100_payment_reallocation.sql:
 *
 *   reallocate         { paymentId, targets: [{ chargeEntryId, amountCents }], reason, note? }
 *                      → { ok, auditId, before, after }
 *                      targets is the payment's COMPLETE new allocation — a
 *                      charge left out is taken off; [] leaves it all unplaced.
 *   recompute_charge   { chargeEntryId, reason, note? } → { ok, auditId, before, after }
 *   reconcile_options  { rentalId, extensionId? } → { ok, options }   (read only)
 *   history            { rentalId } | { paymentId } → { ok, changes }  (read only)
 *
 * Money is INTEGER CENTS in and out. Statuses: 400 invalid · 401 · 403 ·
 * 404 · 409 the payment's or charge's state forbids it · 422 a rule the
 * operator fixes by changing the amounts · 500 · 503 the database update is
 * not applied yet.
 *
 * The checks below MIRROR the SQL function's own (payment_reallocate steps 4,
 * 7 and 8) so an operator is told before they press the button. They are a
 * courtesy, never the enforcement: the server checks every one again.
 *
 * Words: "Move payment", "Fix what's owed", "placed", "unplaced", "owed" —
 * never FIFO, reallocate or recompute on screen (roadmap rule 5).
 */

import { formatMoney } from "@/lib/payment-plans-ui/format";
import { toCents } from "@/lib/finances/balance";
import { formatListDay } from "./finance-words";

export const RECONCILE_FUNCTION = "payment-reallocate";
export const ADJUST_FUNCTION = "adjust-customer-balance";

/** The server's limits (core.ts `reasonOf`). */
export const REASON_MAX = 200;
export const NOTE_MAX = 2000;

/* ══════════════════════════════════════════════════════════════════════════
   The contract (bill_reconcile_options, pal__*_snapshot), as the server sends it
   ══════════════════════════════════════════════════════════════════════════ */

export interface ReconcileApplication {
  payment_id: string;
  applied_cents: number;
  pnl_cents: number | null;
  payment_status: string | null;
  payment_date: string | null;
  method: string | null;
  net_cents: number;
  unplaced_cents: number;
  movable: boolean;
}

export interface RecomputeStep {
  action: "recompute_charge";
  charge_entry_id: string;
  remaining_cents_before: number;
  remaining_cents_after: number;
}

export interface ReallocateStep {
  action: "reallocate";
  payment_id: string;
  /** The payment's COMPLETE new allocation — sent exactly as given. */
  targets: { charge_entry_id: string; amount_cents: number }[];
  changes: { charge_entry_id: string; from_cents: number; to_cents: number }[];
  unplaced_cents_added?: number;
  unplaced_cents_used?: number;
}

export interface AdjustmentStep {
  action: "record_adjustment";
  via: string;
  amount_cents: number;
  /** An adjust-customer-balance v2 body; the operator's note is added to it. */
  body: Record<string, unknown>;
}

export type ReconcileStep = RecomputeStep | ReallocateStep | AdjustmentStep;

export interface ReconcileFix {
  kind: string;
  label: string;
  result: string;
  remaining_cents_after?: number;
  unresolved_cents?: number;
  payment_id?: string;
  steps: ReconcileStep[];
}

export interface ReconcileCharge {
  charge_entry_id: string;
  category: string | null;
  due_date: string | null;
  reference: string | null;
  extension_id: string | null;
  amount_cents: number;
  remaining_cents: number;
  settled_cents: number;
  applied_cents: number;
  drift_cents: number;
  over_applied_cents: number;
  in_drift_view: boolean;
  problem: "settled_without_payment" | "payments_exceed_settled" | "payments_exceed_charge" | string;
  explanation: string;
  applications: ReconcileApplication[];
  fixes: ReconcileFix[];
}

export interface UnplacedPayment {
  payment_id: string;
  rental_id: string | null;
  payment_date: string | null;
  method: string | null;
  status: string | null;
  unplaced_cents: number;
}

export interface ReconcileOptions {
  rental_id: string;
  extension_id: string | null;
  tenant_id: string;
  customer_id: string | null;
  ties_out: boolean;
  totals: {
    charges_checked: number;
    charged_cents: number;
    settled_cents: number;
    applied_cents: number;
    gap_cents: number;
    over_applied_cents: number;
  };
  charges: ReconcileCharge[];
  open_charges: { charge_entry_id: string; category: string | null; due_date: string | null; extension_id: string | null; remaining_cents: number }[];
  unplaced_payments: UnplacedPayment[];
}

/** One `payment_allocation_changes` row. `before`/`after` are the SQL snapshots. */
export interface AllocationChange {
  id: string;
  kind: "reallocate" | "recompute_remaining" | string;
  payment_id: string | null;
  charge_entry_id: string | null;
  rental_ids: string[] | null;
  reason: string;
  note: string | null;
  before: any;
  after: any;
  created_by: string | null;
  created_by_label: string | null;
  created_at: string;
}

/** The server's answer, checked for the shape the screen relies on. Throws on anything else. */
export function parseOptions(data: unknown): ReconcileOptions {
  const o = (data ?? null) as Partial<ReconcileOptions> | null;
  if (!o || typeof o !== "object" || typeof o.ties_out !== "boolean" || !Array.isArray(o.charges)) {
    throw new Error("The server's answer about this bill was not in the expected shape.");
  }
  return {
    ...(o as ReconcileOptions),
    charges: o.charges.map((c) => ({ ...c, applications: c.applications ?? [], fixes: (c.fixes ?? []).map((f) => ({ ...f, steps: f.steps ?? [] })) })),
    open_charges: o.open_charges ?? [],
    unplaced_payments: o.unplaced_payments ?? [],
  };
}

/**
 * The charges of THIS bill: the booking's own (no extension) or one
 * extension's. `bill_reconcile_options` without an extension reads every
 * charge of the rental, extensions included — each extension has its own bill,
 * so they are left to it.
 */
export function chargesOfBill(options: ReconcileOptions, extensionId: string | null): ReconcileCharge[] {
  return options.charges.filter((c) => (c.extension_id ?? null) === (extensionId ?? null));
}

/* ══════════════════════════════════════════════════════════════════════════
   Words
   ══════════════════════════════════════════════════════════════════════════ */

/** What is owed on a charge: a negative remaining is money over-paid (a credit). */
export function owedWords(cents: number, currency: string): string {
  return cents < 0 ? `${formatMoney(-cents, currency)} over-paid` : formatMoney(cents, currency);
}

/** "Rental · due 1 Sep" */
export function chargeWords(c: { category: string | null; due_date?: string | null; dueDate?: string | null }): string {
  const due = c.due_date ?? c.dueDate ?? null;
  return `${c.category || "Charge"}${due ? ` · due ${formatListDay(due) ?? due}` : ""}`;
}

/** "the payment of 12 Sep (Card)" */
export function paymentWords(p: { payment_date?: string | null; method?: string | null } | null | undefined, paymentId: string): string {
  if (!p) return `the payment …${paymentId.slice(-6)}`;
  const day = p.payment_date ? formatListDay(p.payment_date) ?? p.payment_date : null;
  return `the payment of ${day ?? "an unknown date"}${p.method ? ` (${p.method})` : ""}`;
}

/** Every payment a bill's options name, by id — for naming a payment in a step. */
export function paymentsNamedIn(options: ReconcileOptions | null): Map<string, { payment_date: string | null; method: string | null }> {
  const out = new Map<string, { payment_date: string | null; method: string | null }>();
  if (!options) return out;
  for (const p of options.unplaced_payments) out.set(p.payment_id, { payment_date: p.payment_date, method: p.method });
  for (const c of options.charges) for (const a of c.applications) out.set(a.payment_id, { payment_date: a.payment_date, method: a.method });
  return out;
}

/** One step of a fix, in plain words. */
export function stepWords(
  step: ReconcileStep,
  currency: string,
  payments: Map<string, { payment_date: string | null; method: string | null }> = new Map(),
): string {
  const $ = (c: number) => formatMoney(c, currency);
  if (step.action === "recompute_charge") {
    return `Change what is owed on this charge from ${owedWords(step.remaining_cents_before, currency)} to ${owedWords(step.remaining_cents_after, currency)}.`;
  }
  if (step.action === "reallocate") {
    const who = paymentWords(payments.get(step.payment_id), step.payment_id);
    const change = step.changes[0];
    const what = change
      ? `Change what ${who} pays on this charge from ${$(change.from_cents)} to ${$(change.to_cents)}`
      : `Place ${who} again`;
    if (step.unplaced_cents_added) return `${what}; ${$(step.unplaced_cents_added)} of it becomes unplaced on that payment.`;
    if (step.unplaced_cents_used) return `${what}, using ${$(step.unplaced_cents_used)} of it that was not placed on any charge.`;
    return `${what}.`;
  }
  return `Record a ${$(step.amount_cents)} goodwill credit for the customer, so what they owe overall does not change.`;
}

/* ══════════════════════════════════════════════════════════════════════════
   Move payment — who may, and the checks before asking
   ══════════════════════════════════════════════════════════════════════════ */

/** The statuses `payment_reallocate` accepts. */
export const MOVABLE_STATUSES: ReadonlySet<string> = new Set(["Applied", "Credit", "Partial", "Partial Refund"]);

export interface MovePaymentFacts {
  paymentId: string;
  customerId: string | null;
  tenantId: string | null;
  rentalId: string | null;
  amountCents: number;
  refundCents: number;
  status: string | null;
  captureStatus: string | null;
  paymentDate: string | null;
  method: string | null;
}

/** What the payment can place at most: received less refunded. */
export const netCentsOf = (p: Pick<MovePaymentFacts, "amountCents" | "refundCents">) => p.amountCents - p.refundCents;

/**
 * Why this payment cannot be moved, or null. The SQL function's step 4
 * ("Is it captured money?"), sentence for sentence.
 */
export function moveRefusal(p: Pick<MovePaymentFacts, "status" | "captureStatus" | "amountCents" | "refundCents" | "customerId" | "tenantId">): string | null {
  const s = p.status ?? null;
  if (!p.tenantId) return "This payment has no company recorded on it, so it cannot be moved here.";
  if (p.captureStatus === "requires_capture" || p.captureStatus === "cancelled" || p.captureStatus === "expired" || s === "Pending") {
    return "This payment was never collected — there is no money to move.";
  }
  if (s === "Completed") return "This payment is still being applied to the bill — try again in a moment.";
  if (s === "Reversed") return "This payment was reversed — there is no money to move.";
  if (s === "Refunded") return "This payment was refunded in full — there is no money left to move.";
  if (!s || !MOVABLE_STATUSES.has(s)) return `A payment marked ${s ?? "with no status"} cannot be moved.`;
  if (p.refundCents > p.amountCents) return "More was refunded than this payment took, so it cannot be moved.";
  if (p.amountCents > 0 && p.refundCents === p.amountCents) return "This payment was refunded in full — there is no money left to move.";
  if (!p.customerId) return "This payment is on no customer, so there is nowhere to move it.";
  return null;
}

/**
 * The Received row's gate for "Move payment" — the same rule read off the row
 * the list already holds (`rawStatus`; `countsAsReceived` is false for a hold
 * that was never captured). A refunded payment is not offered the action.
 */
export function receiptMoveRefusal(r: {
  rawStatus: string | null;
  countsAsReceived: boolean;
  amountCents: number;
  refundedCents: number;
  customerId: string;
}): string | null {
  // A hold that was authorised but never captured carries a movable status and
  // `countsAsReceived` false (lib/payment-status `isMoneyReceived`).
  if (r.rawStatus && MOVABLE_STATUSES.has(r.rawStatus) && !r.countsAsReceived) {
    return "This payment was never collected — there is no money to move.";
  }
  return moveRefusal({
    status: r.rawStatus,
    captureStatus: null,
    amountCents: r.amountCents,
    refundCents: r.refundedCents,
    customerId: r.customerId || null,
    tenantId: "row",
  });
}

/** One charge in the Move payment list. */
export interface MoveCharge {
  chargeId: string;
  category: string | null;
  rentalId: string | null;
  rentalRef: string | null;
  extensionId: string | null;
  dueDate: string | null;
  amountCents: number;
  /** `remaining_amount` now. */
  remainingCents: number;
  /** What THIS payment has on the charge now. */
  currentCents: number;
}

export interface RawMoveCharge {
  id: string;
  category: string | null;
  rental_id: string | null;
  extension_id: string | null;
  customer_id?: string | null;
  due_date: string | null;
  entry_date?: string | null;
  amount: unknown;
  remaining_amount: unknown;
  type?: string | null;
}

/**
 * The list the operator edits: every charge this payment is on now, then every
 * other charge of the customer that still owes something — by due date.
 * `missing` names a charge the payment is on that could not be read: moving
 * then would silently take the payment off it, so the dialog refuses.
 */
export function moveRows(
  charges: RawMoveCharge[],
  applications: { charge_entry_id: string | null; amount_applied: unknown }[],
  rentalRefs: Map<string, string> = new Map(),
): { rows: MoveCharge[]; missing: string[] } {
  const current = allocationOf(applications);
  const byId = new Map<string, RawMoveCharge>();
  for (const c of charges) if (c && c.id) byId.set(c.id, c);
  const missing = [...current.keys()].filter((id) => !byId.has(id));
  const rows: MoveCharge[] = [];
  for (const c of byId.values()) {
    const amountCents = toCents(c.amount);
    const remainingCents = toCents(c.remaining_amount);
    const currentCents = current.get(c.id) ?? 0;
    if (c.type && c.type !== "Charge") continue;
    if (currentCents === 0 && (amountCents <= 0 || remainingCents <= 0)) continue;
    rows.push({
      chargeId: c.id,
      category: c.category,
      rentalId: c.rental_id ?? null,
      rentalRef: c.rental_id ? rentalRefs.get(c.rental_id) ?? null : null,
      extensionId: c.extension_id ?? null,
      dueDate: c.due_date ?? c.entry_date ?? null,
      amountCents,
      remainingCents,
      currentCents,
    });
  }
  rows.sort((a, b) => {
    if ((a.currentCents > 0) !== (b.currentCents > 0)) return a.currentCents > 0 ? -1 : 1;
    const da = a.dueDate ?? "9999-12-31";
    const db = b.dueDate ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    const ca = a.category ?? "";
    const cb = b.category ?? "";
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.chargeId < b.chargeId ? -1 : 1;
  });
  return { rows, missing };
}

/** `payment_applications` rows → cents per charge (rows without a charge ignored; zeros dropped). */
export function allocationOf(applications: { charge_entry_id: string | null; amount_applied: unknown }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of applications) {
    if (!a?.charge_entry_id) continue;
    out.set(a.charge_entry_id, (out.get(a.charge_entry_id) ?? 0) + toCents(a.amount_applied));
  }
  for (const [k, v] of [...out]) if (v === 0) out.delete(k);
  return out;
}

/** What the operator typed → cents. Empty is 0; anything else unusable is null. */
export function parseAmountCents(input: string | null | undefined): number | null {
  const s = String(input ?? "").trim().replace(/[$,\s]/g, "");
  if (s === "") return 0;
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] === undefined || m[2] === ""))) return null;
  const whole = m[1] === "" ? 0 : Number(m[1]);
  if (!Number.isSafeInteger(whole)) return null;
  const frac = m[2] === undefined ? 0 : Number((m[2] + "00").slice(0, 2));
  return whole * 100 + frac;
}

export interface MoveChange {
  chargeId: string;
  fromCents: number;
  toCents: number;
  owedBeforeCents: number;
  owedAfterCents: number;
}

export interface MoveCheck {
  /** The COMPLETE new allocation (every charge above 0), in the function's shape. */
  targets: { chargeEntryId: string; amountCents: number }[];
  totalCents: number;
  netCents: number;
  unplacedBeforeCents: number;
  unplacedAfterCents: number;
  /** A message next to one amount. */
  rowErrors: Record<string, string>;
  /** A message about the amounts together. */
  formError: string | null;
  changes: MoveChange[];
  changed: boolean;
  ok: boolean;
}

/**
 * The amounts the operator entered, checked the way `payment_reallocate` will
 * check them:
 *   Σ ≤ net (received less refunded)                                  step 7
 *   a charge may go UP only into what it still owes:
 *     new ≤ owed now + what this payment already has there            step 8
 *   and may go DOWN only while it does not re-open past its own amount:
 *     owed now + (old − new) ≤ the charge                              step 8
 *   a refund recorded on a payment not marked refunded: place it all  step 7
 */
export function checkMove(
  rows: MoveCharge[],
  entered: Record<string, string>,
  p: Pick<MovePaymentFacts, "amountCents" | "refundCents" | "status">,
  currency: string,
): MoveCheck {
  const $ = (c: number) => formatMoney(c, currency);
  const netCents = netCentsOf(p);
  const rowErrors: Record<string, string> = {};
  const targets: { chargeEntryId: string; amountCents: number }[] = [];
  const changes: MoveChange[] = [];
  let totalCents = 0;
  let placedBefore = 0;

  for (const r of rows) {
    placedBefore += r.currentCents;
    const raw = entered[r.chargeId];
    const next = raw === undefined ? r.currentCents : parseAmountCents(raw);
    if (next === null) {
      rowErrors[r.chargeId] = "Enter an amount like 12.50.";
      continue;
    }
    totalCents += next;
    if (next > 0) targets.push({ chargeEntryId: r.chargeId, amountCents: next });
    const delta = next - r.currentCents;
    if (delta > 0 && next > r.remainingCents + r.currentCents) {
      rowErrors[r.chargeId] =
        r.currentCents > 0
          ? `This charge can take at most ${$(r.remainingCents + r.currentCents)} from this payment (${$(r.remainingCents)} still owed + the ${$(r.currentCents)} it has here now).`
          : `This charge only owes ${$(Math.max(0, r.remainingCents))}.`;
    } else if (delta < 0 && r.remainingCents - delta > r.amountCents) {
      rowErrors[r.chargeId] =
        `Taking ${$(-delta)} off would leave ${$(r.remainingCents - delta)} owed on a ${$(r.amountCents)} charge — its records already disagree. Use "Fix what's owed" on its bill first.`;
    }
    if (delta !== 0) {
      changes.push({
        chargeId: r.chargeId,
        fromCents: r.currentCents,
        toCents: next,
        owedBeforeCents: r.remainingCents,
        owedAfterCents: r.remainingCents - delta,
      });
    }
  }

  const unplacedAfterCents = netCents - totalCents;
  let formError: string | null = null;
  if (Object.keys(rowErrors).length === 0) {
    if (totalCents > netCents) {
      formError = `The amounts add up to ${$(totalCents)}, but this payment can place at most ${$(netCents)}${p.refundCents > 0 ? ` (${$(p.amountCents)} received less ${$(p.refundCents)} refunded)` : ""}.`;
    } else if (p.refundCents > 0 && p.status !== "Partial Refund" && unplacedAfterCents !== 0) {
      formError = `This payment has ${$(p.refundCents)} refunded but is not marked refunded — place all of its remaining ${$(netCents)}.`;
    }
  }
  const changed = changes.length > 0;
  return {
    targets,
    totalCents,
    netCents,
    unplacedBeforeCents: netCents - placedBefore,
    unplacedAfterCents,
    rowErrors,
    formError,
    changes,
    changed,
    ok: changed && !formError && Object.keys(rowErrors).length === 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   History — what one change did, in before → after lines
   ══════════════════════════════════════════════════════════════════════════ */

export interface ChangeLine {
  label: string;
  from: string;
  to: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The difference a history row records. A reallocation: each charge whose
 * share of the payment changed, what is owed on it, the payment's unplaced
 * money and its status. A fix of what is owed: the charge's owed figure.
 */
export function describeChange(change: AllocationChange, currency: string): { title: string; lines: ChangeLine[] } {
  const $ = (c: number) => formatMoney(c, currency);
  const lines: ChangeLine[] = [];
  const before = change.before ?? {};
  const after = change.after ?? {};

  if (change.kind === "recompute_remaining") {
    const label = chargeWords({ category: after.category ?? before.category ?? null, due_date: after.due_date ?? before.due_date ?? null });
    const b = num(before.remaining_cents);
    const a = num(after.remaining_cents);
    if (b !== null && a !== null && a !== b) lines.push({ label: `Owed on ${label}`, from: owedWords(b, currency), to: owedWords(a, currency) });
    return { title: `Fixed what's owed on ${label}`, lines };
  }

  const charges = new Map<string, any>();
  for (const c of [...(before.charges ?? []), ...(after.charges ?? [])]) if (c?.charge_entry_id) charges.set(c.charge_entry_id, c);
  const applied = (snap: any) => {
    const m = new Map<string, number>();
    for (const a of snap.applications ?? []) {
      if (!a?.charge_entry_id) continue;
      m.set(a.charge_entry_id, (m.get(a.charge_entry_id) ?? 0) + (num(a.applied_cents) ?? 0));
    }
    return m;
  };
  const ab = applied(before);
  const aa = applied(after);
  const ids = [...new Set([...ab.keys(), ...aa.keys()])].sort((x, y) => {
    const cx = charges.get(x)?.due_date ?? "";
    const cy = charges.get(y)?.due_date ?? "";
    return cx === cy ? (x < y ? -1 : 1) : cx < cy ? -1 : 1;
  });
  for (const id of ids) {
    const from = ab.get(id) ?? 0;
    const to = aa.get(id) ?? 0;
    if (from === to) continue;
    const c = charges.get(id);
    lines.push({ label: `Paid on ${chargeWords({ category: c?.category ?? null, due_date: c?.due_date ?? null })}`, from: $(from), to: $(to) });
  }
  const remBefore = new Map<string, number>();
  for (const c of before.charges ?? []) if (c?.charge_entry_id && num(c.remaining_cents) !== null) remBefore.set(c.charge_entry_id, num(c.remaining_cents)!);
  for (const c of after.charges ?? []) {
    const b = c?.charge_entry_id ? remBefore.get(c.charge_entry_id) : undefined;
    const a = num(c?.remaining_cents);
    if (b === undefined || a === null || a === b) continue;
    lines.push({ label: `Owed on ${chargeWords({ category: c.category ?? null, due_date: c.due_date ?? null })}`, from: owedWords(b, currency), to: owedWords(a, currency) });
  }
  const unplaced = (snap: any) => {
    const net = num(snap.payment?.net_cents);
    const placed = num(snap.placed_cents);
    return net === null || placed === null ? null : net - placed;
  };
  const ub = unplaced(before);
  const ua = unplaced(after);
  if (ub !== null && ua !== null && ub !== ua) lines.push({ label: "Unplaced on the payment", from: $(ub), to: $(ua) });
  const sb = before.payment?.status ?? null;
  const sa = after.payment?.status ?? null;
  if (sb && sa && sb !== sa) lines.push({ label: "Payment marked", from: sb, to: sa });
  return { title: "Moved a payment between charges", lines };
}
