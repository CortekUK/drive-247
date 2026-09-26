/**
 * Everything the plan card SAYS, computed from the rows it shows. Pure.
 *
 * The lead: "Show him the math. Tell him this whole story: this is what
 * happened, this is what was taken, this is what remains." So every figure in
 * the card's math line is a sum over occurrence rows that are on screen, and
 * this file is the only place those sums are written. A figure that cannot be
 * traced to rows is not shown.
 *
 * It also decides which row actions are valid for which status — and, for the
 * ones that are not, WHY. An action is never a silent no-op: a disabled button
 * always carries the sentence that explains it.
 */

import type { AttemptView, EventView, OccurrenceView, PlanView } from "./view-types";
import type { OccurrenceStatus } from "@/lib/payment-plans/types";
import { dayNumber, formatDay, formatInstant, formatMoney, plural, todayInZone } from "./format";
import { describeMethod } from "./plan-form-model";

/* ── statuses ────────────────────────────────────────────────────────────── */

/** Money is still to be collected on these. */
export const OPEN_STATUSES: readonly OccurrenceStatus[] = [
  "scheduled",
  "due",
  "processing",
  "requires_action",
  "partially_paid",
  "failed",
];

/** Asked for: the due date has come (or money arrived early). */
const ASKED_STATUSES: readonly OccurrenceStatus[] = ["due", "processing", "requires_action", "paid", "partially_paid", "failed"];

/** History only. Shown apart, never summed as money owed. */
export const CLOSED_STATUSES: readonly OccurrenceStatus[] = ["skipped", "waived", "superseded", "cancelled"];

export const isOpen = (o: Pick<OccurrenceView, "status">) => OPEN_STATUSES.includes(o.status);

export const remainingOf = (o: Pick<OccurrenceView, "amountCents" | "amountPaidCents">) =>
  Math.max(0, o.amountCents - o.amountPaidCents);

const bySchedule = (a: OccurrenceView, b: OccurrenceView) =>
  a.dueDate === b.dueDate ? a.seq - b.seq : a.dueDate < b.dueDate ? -1 : 1;

/* ── the math line ───────────────────────────────────────────────────────── */

export interface PlanMath {
  /** Σ amount over occurrences that have been asked for (due, paid, failed …). */
  chargedCents: number;
  /** Σ amount paid over every occurrence. */
  paidCents: number;
  /** Σ still-unpaid amount over occurrences whose collection failed or waits on the customer. */
  failedCents: number;
  /** Σ still-unpaid amount over every open occurrence. */
  remainingCents: number;
  /** Paid + remaining — what the plan collects in all. */
  totalCents: number;
  /** Open occurrences, in date order. */
  openCount: number;
  /** The next date anything will happen: the first open occurrence (a retry counts). */
  next: { occurrence: OccurrenceView; date: string; isRetry: boolean } | null;
}

export function planMath(occurrences: OccurrenceView[]): PlanMath {
  let charged = 0;
  let paid = 0;
  let failed = 0;
  let remaining = 0;
  let openCount = 0;
  for (const o of occurrences) {
    paid += o.amountPaidCents;
    if (ASKED_STATUSES.includes(o.status)) charged += o.amountCents;
    if (o.status === "failed" || o.status === "requires_action") failed += remainingOf(o);
    if (isOpen(o)) {
      remaining += remainingOf(o);
      openCount += 1;
    }
  }
  const open = occurrences.filter(isOpen).sort(bySchedule);
  const first = open.find((o) => o.status !== "processing") ?? open[0] ?? null;
  let next: PlanMath["next"] = null;
  if (first) {
    const retry = first.status === "failed" && first.nextAttemptAt;
    next = { occurrence: first, date: retry ? first.nextAttemptAt! : first.dueDate, isRetry: !!retry };
  }
  return {
    chargedCents: charged,
    paidCents: paid,
    failedCents: failed,
    remainingCents: remaining,
    totalCents: paid + remaining,
    openCount,
    next,
  };
}

/** The one-line story under the figures. */
export function explainMath(m: PlanMath, currency: string, timeZone?: string | null): string {
  const $ = (c: number) => formatMoney(c, currency);
  const parts: string[] = [];
  if (m.chargedCents === 0 && m.paidCents === 0) {
    parts.push("Nothing has been asked for yet.");
  } else {
    parts.push(`${$(m.chargedCents)} has been asked for so far and ${$(m.paidCents)} of it is paid`);
    parts[0] += m.failedCents > 0 ? `; ${$(m.failedCents)} didn't go through.` : ".";
  }
  if (m.remainingCents > 0) {
    let tail = `${$(m.remainingCents)} is left to collect across ${plural(m.openCount, "payment")}`;
    if (m.next) {
      const when = m.next.isRetry ? formatInstant(m.next.date, timeZone) : formatDay(m.next.date);
      tail += m.next.isRetry ? `, next a retry on ${when}.` : `, the next on ${when}.`;
    } else tail += ".";
    parts.push(tail);
  } else if (m.paidCents > 0) {
    parts.push("Nothing is left to collect.");
  }
  return parts.join(" ");
}

/* ── one occurrence ──────────────────────────────────────────────────────── */

export type Tone = "muted" | "default" | "primary" | "success" | "destructive";

/** Past its due date and still owed — the operator missed it, or the card did. */
export function isMissed(o: OccurrenceView, today: string): boolean {
  if (o.status === "failed" || o.status === "requires_action") return true;
  if ((o.status === "due" || o.status === "partially_paid") && dayNumber(o.dueDate) < dayNumber(today)) return true;
  return false;
}

export function statusWords(o: OccurrenceView, today: string, currency: string): { text: string; tone: Tone } {
  switch (o.status) {
    case "scheduled":
      return { text: "Scheduled", tone: "muted" };
    case "due":
      return dayNumber(o.dueDate) < dayNumber(today) ? { text: "Missed", tone: "destructive" } : { text: "Due", tone: "default" };
    case "processing":
      return { text: "Processing", tone: "primary" };
    case "requires_action":
      return { text: "Waiting for the customer", tone: "destructive" };
    case "paid":
      return { text: "Paid", tone: "success" };
    case "partially_paid":
      return { text: `${formatMoney(o.amountPaidCents, currency)} paid`, tone: "default" };
    case "failed":
      return o.nextAttemptAt
        ? { text: `Declined · retry ${formatDay(o.nextAttemptAt.slice(0, 10))}`, tone: "destructive" }
        : { text: "Declined", tone: "destructive" };
    case "skipped":
      return { text: "Skipped", tone: "muted" };
    case "waived":
      return { text: "Waived", tone: "muted" };
    case "superseded":
      return { text: "Replaced", tone: "muted" };
    case "cancelled":
      return { text: "Cancelled", tone: "muted" };
  }
}

/**
 * A decline code in words. Lost / stolen / fraud codes are said as a generic
 * decline, as the design requires (§7) — the reason is never repeated to anyone.
 */
export function declineWords(code: string | null | undefined): string {
  switch (code) {
    case null:
    case undefined:
    case "":
      return "the card was declined";
    case "insufficient_funds":
      return "insufficient funds";
    case "expired_card":
      return "the card has expired";
    case "incorrect_number":
    case "invalid_number":
      return "the card number is not valid";
    case "authentication_required":
    case "authentication_not_handled":
    case "payment_intent_authentication_failure":
      return "the bank asked the customer to confirm the payment";
    case "card_velocity_exceeded":
    case "withdrawal_count_limit_exceeded":
      return "the card is over its limit for now";
    case "processing_error":
    case "issuer_not_available":
    case "reenter_transaction":
    case "rate_limit":
      return "the card network had a temporary problem";
    case "card_not_supported":
    case "currency_not_supported":
      return "the card doesn't support this payment";
    default:
      return "the card was declined";
  }
}

export function lastAttempt(o: OccurrenceView, attempts: AttemptView[]): AttemptView | null {
  let best: AttemptView | null = null;
  for (const a of attempts) if (a.occurrenceId === o.id && (!best || a.attemptNo > best.attemptNo)) best = a;
  return best;
}

/* ── actions: which, and why not ─────────────────────────────────────────── */

export type OccurrenceAction = "retry" | "send_link" | "record_payment" | "move_date" | "skip";

export interface Availability {
  enabled: boolean;
  /** Why not, in a sentence. Null when enabled. */
  reason: string | null;
}

export const ACTION_LABELS: Record<OccurrenceAction, string> = {
  retry: "Retry the card",
  send_link: "Send a payment link",
  record_payment: "Record a payment",
  move_date: "Move date",
  skip: "Skip",
};

const on: Availability = { enabled: true, reason: null };
const off = (reason: string): Availability => ({ enabled: false, reason });

function closedReason(o: OccurrenceView): string | null {
  switch (o.status) {
    case "paid":
      return "Already paid in full.";
    case "skipped":
      return "This payment was skipped — its amount moved to the next one.";
    case "waived":
      return "This payment was waived.";
    case "superseded":
      return "Replaced when the plan changed — the new dates are listed above.";
    case "cancelled":
      return "The plan was cancelled.";
    case "processing":
      return "A payment is going through right now. Wait for it to finish so nothing is collected twice.";
    default:
      return null;
  }
}

export interface ActionContext {
  plan: Pick<PlanView, "status">;
  occurrences: OccurrenceView[];
  /** Attempts decide whether a link is out or a charge is running. Optional for callers that only have occurrences. */
  attempts?: AttemptView[];
  today: string;
}

/** Statuses the engine lets an operator collect now (engine.ts OPERATOR_COLLECTABLE). */
const COLLECTABLE: readonly OccurrenceStatus[] = ["due", "failed", "requires_action", "partially_paid"];
/** Statuses that can move, be skipped, take a manual record, or receive a skipped amount (the store's SUPERSEDABLE). */
const ADJUSTABLE: readonly OccurrenceStatus[] = ["scheduled", "due", "requires_action", "partially_paid", "failed"];

const OPEN_ATTEMPT = (a: AttemptView) => a.status === "claimed" || a.status === "in_flight";

/** An attempt still waiting on the card network or the customer, on one occurrence. */
export function openAttemptOn(o: Pick<OccurrenceView, "id">, attempts: AttemptView[] | undefined): AttemptView | null {
  return (attempts ?? []).find((a) => a.occurrenceId === o.id && OPEN_ATTEMPT(a)) ?? null;
}

export function occurrenceActions(o: OccurrenceView, ctx: ActionContext): Record<OccurrenceAction, Availability> {
  const closed = closedReason(o);
  const planWhy =
    ctx.plan.status === "paused"
      ? "The plan is paused. Resume it first."
      : ctx.plan.status === "cancelled"
        ? "The plan was cancelled."
        : "The plan is complete.";
  const planOver = ctx.plan.status === "cancelled" || ctx.plan.status === "completed";
  const notDue = o.status === "scheduled" ? `Not due until ${formatDay(o.dueDate)}.` : null;
  const open = openAttemptOn(o, ctx.attempts);
  const linkOut = open && open.method === "checkout_link";

  // Retry the card — the engine's collect-now, for a card payment, on an active plan.
  let retry: Availability = on;
  if (closed) retry = off(closed);
  else if (ctx.plan.status !== "active") retry = off(planWhy);
  else if (notDue) retry = off(`${notDue} The card is charged on that day — move the date to charge it sooner.`);
  else if (!COLLECTABLE.includes(o.status)) retry = off("There is nothing to collect on this payment.");
  else if (o.collectionMethod !== "auto_charge")
    retry = off(`This payment is collected by ${describeMethod(o.collectionMethod)}, not by charging a card.`);

  // Send a link — on an active plan (the engine refuses a paused one), for anything due and owed.
  let sendLink: Availability = on;
  if (closed) sendLink = off(closed);
  else if (ctx.plan.status !== "active") sendLink = off(planWhy);
  else if (notDue) sendLink = off(`${notDue} A link can be sent from that day — or move the date to send one sooner.`);
  else if (!COLLECTABLE.includes(o.status)) sendLink = off("There is nothing to collect on this payment.");
  else if (open && !linkOut) sendLink = off("A card payment is going through right now. Wait for it to finish.");

  // Record money already received. Allowed on a paused plan; releases any open link.
  let record: Availability = on;
  if (closed) record = off(closed);
  else if (planOver) record = off(planWhy);
  else if (!ADJUSTABLE.includes(o.status)) record = off("There is nothing to collect on this payment.");

  // Move — the store moves any open payment; a failed one is retried on the new date.
  let move: Availability = on;
  if (closed) move = off(closed);
  else if (planOver) move = off(planWhy);
  else if (!ADJUSTABLE.includes(o.status)) move = off("This payment can't be moved.");

  // Skip — its amount rolls into the next payment by number; never the last, never mid-attempt.
  let skip: Availability = on;
  if (closed) skip = off(closed);
  else if (planOver) skip = off(planWhy);
  else if (!ADJUSTABLE.includes(o.status)) skip = off("This payment can't be skipped.");
  // A link that is out is released by the server before it skips (payment-plan-manage);
  // only a card charge in flight blocks.
  else if (open && !linkOut) skip = off("A card payment is going through right now. Wait for it to finish.");
  // A renewal period pays for days of the rental; skipping it would give them
  // for nothing (the store refuses: pp_skip_occurrence).
  else if (o.renews) skip = off("This payment is for a renewal period — its days can't be skipped. Record a payment, or cancel the plan to stop renewing.");
  else if (!nextOpenAfter(o, ctx.occurrences))
    skip = off("This is the last payment, so there is nothing after it to carry the amount. Record a payment or change the plan instead.");

  return { retry, send_link: sendLink, record_payment: record, move_date: move, skip };
}

/** The payment a skipped one's amount rolls into: the next by NUMBER that can still take it (the store's rule). */
export function nextOpenAfter(o: OccurrenceView, occurrences: OccurrenceView[]): OccurrenceView | null {
  return (
    occurrences
      // A skipped amount never rolls into a renewal period (the store's rule).
      .filter((x) => x.id !== o.id && x.planId === o.planId && x.seq > o.seq && !x.renews && ADJUSTABLE.includes(x.status))
      .sort((a, b) => a.seq - b.seq)[0] ?? null
  );
}

export type PlanAction = "edit" | "pause" | "resume" | "cancel";

export function planActions(
  plan: Pick<PlanView, "status"> & Partial<Pick<PlanView, "renewal">>,
  occurrences: OccurrenceView[],
  attempts?: AttemptView[],
): Record<PlanAction, Availability> {
  const done = plan.status === "cancelled" ? "The plan was cancelled." : plan.status === "completed" ? "The plan is complete." : null;
  // The store refuses a change or a cancel only while a CARD charge is in flight
  // (an open payment link is released by the change itself), so say which one.
  const charging = occurrences.find((o) => {
    const open = openAttemptOn(o, attempts);
    return o.status === "processing" || (open !== null && open.method !== "checkout_link");
  });
  const busy = charging ? `A card payment on #${charging.seq} is going through right now. Try again when it has finished.` : null;
  // The store refuses to change a plan that keeps renewing (pp_replace_future,
  // migration 20260926120200): its periods are real extensions. Stop it with
  // Cancel and set up a new one; add days with Extend.
  const renewing = plan.renewal
    ? "A plan that keeps renewing can't be changed — its periods are real extensions. Use Extend to add days, or cancel it and set up a new one."
    : null;
  return {
    edit: done ? off(done) : renewing ? off(renewing) : busy ? off(busy) : on,
    pause: done ? off(done) : plan.status === "paused" ? off("The plan is already paused.") : on,
    resume: done ? off(done) : plan.status === "active" ? off("The plan is running.") : on,
    cancel: done ? off(done) : busy ? off(busy) : on,
  };
}

/* ── the recovery sentence ───────────────────────────────────────────────── */

export interface Recovery {
  occurrence: OccurrenceView;
  /** "Missed on Fri 9 Oct — $200.00 is outstanding." */
  sentence: string;
  /** The actions to offer beside it, enabled ones only, in the lead's order. */
  actions: OccurrenceAction[];
}

export function recoveries(
  ctx: ActionContext & { attempts: AttemptView[]; currency: string; timeZone?: string | null },
): Recovery[] {
  return ctx.occurrences
    .filter((o) => isMissed(o, ctx.today))
    .sort(bySchedule)
    .map((o) => {
      const left = formatMoney(remainingOf(o), ctx.currency);
      const last = lastAttempt(o, ctx.attempts);
      let sentence: string;
      if (o.status === "failed") {
        const why = declineWords(last?.declineCode);
        sentence = o.nextAttemptAt
          ? `Declined on ${formatDay(o.dueDate)} (${why}) — ${left} is outstanding. The card will be tried again on ${formatInstant(o.nextAttemptAt, ctx.timeZone)}.`
          : `Missed on ${formatDay(o.dueDate)} (${why}) — ${left} is outstanding.`;
      } else if (o.status === "requires_action") {
        sentence = `On ${formatDay(o.dueDate)} the bank asked the customer to confirm — ${left} is outstanding until they pay the link.`;
      } else {
        sentence = `Missed on ${formatDay(o.dueDate)} — ${left} is outstanding.`;
      }
      const available = occurrenceActions(o, ctx);
      const order: OccurrenceAction[] = ["send_link", "record_payment", "retry"];
      return { occurrence: o, sentence, actions: order.filter((a) => available[a].enabled) };
    });
}

/* ── the timeline ────────────────────────────────────────────────────────── */

export function eventSentence(e: EventView, occurrences: OccurrenceView[], currency: string): string {
  const occ = e.occurrenceId ? occurrences.find((o) => o.id === e.occurrenceId) : null;
  const n = occ ? `payment #${occ.seq}` : "a payment";
  const N = occ ? `Payment #${occ.seq}` : "A payment";
  const amt = e.amountCents !== null && e.amountCents !== undefined ? formatMoney(e.amountCents, currency) : null;
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
  const num = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);
  switch (e.kind) {
    case "plan_created":
      return "Payment plan set up.";
    case "plan_changed":
      return s("reason") ? `Plan changed — ${s("reason")}.` : "Plan changed.";
    case "plan_paused":
      return s("reason") ? `Plan paused — ${s("reason")}.` : "Plan paused. Nothing is collected until it is resumed.";
    case "plan_resumed":
      return "Plan resumed.";
    case "plan_cancelled":
      return s("reason") ? `Plan cancelled — ${s("reason")}.` : "Plan cancelled.";
    case "plan_completed":
      return "Plan complete — every payment is settled.";
    case "occurrence_due":
      return `${N} is due${amt ? ` (${amt})` : ""} — waiting for you to record it.`;
    case "reminder": {
      const off = num("offset");
      const when = off === null ? "" : off === 0 ? " on the due day" : off < 0 ? ` ${plural(-off, "day")} before` : ` ${plural(off, "day")} after`;
      return `Reminder about ${n} sent${when}${e.channel && e.channel !== "none" ? ` by ${e.channel}` : ""}.`;
    }
    case "link_sent":
      return `Payment link for ${n} sent to the customer${amt ? ` (${amt})` : ""}.`;
    case "charge_attempted":
      return `Card charged for ${n}${amt ? ` (${amt})` : ""}.`;
    case "charge_succeeded":
      return `${amt ?? "Payment"} taken for ${n}.`;
    case "charge_failed":
      return `Card declined for ${n} — ${declineWords(s("declineCode") ?? s("decline_code"))}.`;
    case "requires_action":
      return `The bank asked the customer to confirm ${n}.`;
    case "fallback_to_link":
      return `The card couldn't be charged for ${n}, so a payment link was sent instead.`;
    case "manual_recorded":
      return `${amt ?? "A payment"} recorded by hand for ${n}${s("method") ? ` (${s("method")})` : ""}.`;
    case "occurrence_moved": {
      const from = s("from") ?? s("moved_from");
      const to = s("to") ?? s("moved_to");
      return from && to ? `${N} moved from ${formatDay(from)} to ${formatDay(to)}.` : `${N} moved to a new date.`;
    }
    case "occurrence_skipped":
      return `${N} skipped — its amount moved to the next payment.`;
    case "occurrence_waived":
      return `${N} waived.`;
    case "occurrence_paid":
      return `${N} paid in full.`;
    case "covered_by_balance":
      return `${N} needed nothing — the rental was already paid up.`;
    default:
      return String(e.kind).replace(/_/g, " ");
  }
}

/** Today in the plan's own zone — "missed" is a plan-local question. */
export const planToday = (plan: Pick<PlanView, "timezone">, now?: Date) => todayInZone(plan.timezone, now);
