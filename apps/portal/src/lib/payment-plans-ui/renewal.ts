/**
 * Renewing plans — the rental keeps going, one period at a time, until it is
 * stopped. Pure, no React, no Supabase.
 *
 * This is what auto-extension becomes on the plan (docs/PAYMENTS_ROADMAP.md
 * Wave 3): not a separate product, an answer inside the one plan form —
 * "until: keeps renewing until stopped". The words on screen are always
 * "renew", "period", "extension agreement"; never the old mode's name.
 *
 * ── The pinned contract (both Wave 3 builders code to it) ─────────────────
 *
 *   PlanForm.renewal = { extendsRental: true; periodUnit; periodCount;
 *                        insurance?: {cdw?,rcli?,sli?,pai?} | null;
 *                        sendAgreementEachPeriod }
 *   With renewal set, end.kind is 'open' and each period's amount is priced
 *   by the SERVER, exactly as the renewal job prices a period today. The
 *   browser never states a renewal amount.
 *
 *   payment-plan-manage 'extend' { rentalId, periods, giveDaysNow,
 *   sendAgreement, insurance? } → { extensionIds, occurrenceIds }
 *
 * The types are declared here (not imported from lib/payment-plans/, which is
 * a generated mirror of the engine) so the UI compiles before and after the
 * engine grows the same field. `RenewalSpec` is structurally the pinned shape.
 *
 * ── Dates ──────────────────────────────────────────────────────────────────
 *
 * Every renewal period is dated by the ENGINE's own `renewalPeriod` (renewal-
 * pricing.ts — auto-extend's `addPeriod`, verbatim), chained exactly as the
 * engine chains them: each period starts where the one before ends
 * (renewals.ts `renewalChainStart` → `nextRenewalDraft`). So the dates the
 * operator previews are the dates the server stores — including auto-extend's
 * month overflow: a monthly period from 31 Jan ends on 3 Mar, not 28 Feb, and
 * the next one runs 3 Mar → 3 Apr. (The plan schedule's `expandRule` clamps
 * month-ends instead; renewals never use it, so neither does this file.)
 *
 * ── Extend ─────────────────────────────────────────────────────────────────
 *
 * `extendSteps` says, before anything is saved, which periods an Extend of N
 * would collect and where the rental would then run to — the engine's
 * `extendPlan` order: the plan's own untouched renewal periods first (brought
 * forward), then new ones appended from the end of the last live period. The
 * limit is the engine's `MAX_EXTEND_PERIODS`, re-exported here, so the dialog
 * and the server can never disagree about it.
 */

import type { ISODate, OccurrenceRow, ScheduleRule, Weekday } from "@/lib/payment-plans/types";
import { renewalPeriod } from "@/lib/payment-plans/renewal-pricing";
import { MAX_EXTEND_PERIODS, renewalChainStart } from "@/lib/payment-plans/renewals";
import { formatDay, formatDayLong, formatMoney, isIsoDate, isoWeekday, plural } from "./format";

export { MAX_EXTEND_PERIODS };

export type RenewalUnit = "day" | "week" | "month";

/** Bonzah coverage flags — the shape `bonzah_insurance_policies.coverage_types` stores. */
export interface RenewalInsurance {
  cdw?: boolean;
  rcli?: boolean;
  sli?: boolean;
  pai?: boolean;
}

/** The pinned `PlanForm.renewal` — what the browser SENDS. */
export interface RenewalSpec {
  extendsRental: true;
  periodUnit: RenewalUnit;
  periodCount: number;
  insurance?: RenewalInsurance | null;
  sendAgreementEachPeriod: boolean;
}

/**
 * A stored plan's renewal, as the card reads it back. Structurally the
 * engine's `PlanRow.renewal` (types.ts `PlanRenewal`: insurance is always
 * present, null for none), so `PlanView` can extend `PlanRow` before and after
 * the engine grows the field.
 */
export interface RenewalView {
  extendsRental?: true;
  periodUnit: RenewalUnit;
  periodCount: number;
  insurance: RenewalInsurance | null;
  sendAgreementEachPeriod: boolean;
}

/** Either of the two — what the words and the form need. */
export type RenewalShape = Pick<RenewalSpec, "periodUnit" | "periodCount" | "sendAgreementEachPeriod"> & { insurance?: RenewalInsurance | null };

/** Where a renewal period's insurance stands (payment_plan_occurrences.insurance_status). */
export type RenewalInsuranceStatus = "none" | "pending" | "insured" | "not_insurable" | "failed";

/** A renewal period's insurance, in words — A4: a premium only ever rides on a policy. */
export function insuranceStatusWords(s: RenewalInsuranceStatus | null | undefined): string | null {
  switch (s) {
    case "pending":
      return "cover being bought — it is charged once the policy is decided";
    case "insured":
      return "insured — the premium is on this period";
    case "not_insurable":
      return "Bonzah couldn't cover it — no premium was charged";
    case "failed":
      return "the policy could not be bought — no premium was charged";
    default:
      return null;
  }
}

/** What the form needs to know to OFFER renewing. Absent → the answer is not offered. */
export interface RenewalContext {
  /** The tenant sells Bonzah (lib/bonzah isBonzahSellable). Only then is insurance asked. */
  bonzahSellable: boolean;
  /** The rental's own Bonzah coverage; null when it has none. */
  rentalCoverage: RenewalInsurance | null;
  /**
   * The unit "renew every" starts on — the rental's own period type. It is
   * also what one renewal's price is: ONE rental-period rate per renewal,
   * however long the renewal is (auto-extend's pricing, renewal-pricing.ts),
   * so the form warns when the chosen period is not exactly one of these.
   */
  defaultUnit?: RenewalUnit;
}

/**
 * What one renewal period costs, as the SERVER prices it
 * (payment-plan-manage 'preview' → PlanDraft.summary.renewal.breakdown).
 * Insurance is never in it: a premium joins a period only once its policy is
 * bought (A4).
 */
export interface RenewalPriceBreakdown {
  rentalCents: number;
  taxCents: number;
  serviceFeeCents: number;
  totalCents: number;
}

export type RenewalQuote =
  | { state: "loading" }
  | { state: "ready"; breakdown: RenewalPriceBreakdown }
  | { state: "error"; message: string };

/**
 * One renewal's price in words. Null when there is no quote to show (the
 * caller has no rental to ask the server about yet — New Rental — or the
 * form is not a renewal).
 */
export function renewalPriceWords(quote: RenewalQuote | null | undefined, currency: string): string | null {
  if (!quote) return null;
  if (quote.state === "loading") return "Working out the price of one period…";
  if (quote.state === "error") return `The price could not be worked out: ${quote.message}`;
  const b = quote.breakdown;
  const $ = (c: number) => formatMoney(c, currency);
  const parts = [`${$(b.rentalCents)} rate`];
  if (b.taxCents > 0) parts.push(`${$(b.taxCents)} tax`);
  if (b.serviceFeeCents > 0) parts.push(`${$(b.serviceFeeCents)} service fee`);
  return parts.length === 1 ? `${$(b.totalCents)} each period.` : `${$(b.totalCents)} each period (${parts.join(" + ")}).`;
}

const UNIT_ADJ: Record<RenewalUnit, string> = { day: "day", week: "week", month: "month" };

/**
 * The warning when a renewal period is not exactly one of the rental's own
 * periods. The server charges ONE rental-period rate per renewal whatever its
 * length (renewalBreakdownCents takes no unit or count), so a weekly-priced
 * rental renewing every month would be charged one week's rate for a month.
 * Null when they match, or when the rental's period type is not known.
 */
export function renewalUnitWarning(
  unit: RenewalUnit,
  count: number,
  rentalUnit: RenewalUnit | null | undefined,
  perPeriodWords?: string | null,
): string | null {
  if (!rentalUnit) return null;
  const n = Math.max(1, Math.floor(Number(count) || 1));
  if (unit === rentalUnit && n === 1) return null;
  const rate = perPeriodWords ? `one ${UNIT_ADJ[rentalUnit]}'s rate (${perPeriodWords})` : `one ${UNIT_ADJ[rentalUnit]}'s rate`;
  return `This rental is priced by the ${UNIT_ADJ[rentalUnit]}. Each renewal is charged ${rate}, however long it lasts — renewing ${describeEvery(unit, n)} charges that for ${plural(n, unit)}. Renew every 1 ${UNIT_ADJ[rentalUnit]} to charge the rental's own rate for its own period.`;
}

/** How many renewal periods the preview lists (the plan itself has no end). */
export const RENEWAL_PREVIEW_PERIODS = 4;

/** The plan engine's interval ceilings, per unit (schedule.ts MAX_INTERVAL; 12 months). */
export const MAX_RENEW_EVERY: Record<RenewalUnit, number> = { day: 52, week: 52, month: 12 };

export const RENEWAL_UNITS: readonly RenewalUnit[] = ["day", "week", "month"];

export function unitWord(unit: RenewalUnit, n: number): string {
  return plural(n, unit);
}

/** "every week", "every 2 weeks", "every 10 days", "every month". */
export function describeEvery(unit: RenewalUnit, count: number): string {
  return count === 1 ? `every ${unit}` : `every ${plural(count, unit)}`;
}

/** rentals.rental_period_type ('Daily' | 'Weekly' | 'Monthly') → a renewal unit. */
export function unitFromPeriodType(periodType: string | null | undefined): RenewalUnit {
  const t = String(periodType ?? "").toLowerCase();
  if (t.startsWith("day") || t === "daily") return "day";
  if (t.startsWith("month")) return "month";
  return "week";
}

export function hasCoverage(c: RenewalInsurance | null | undefined): c is RenewalInsurance {
  return !!c && (!!c.cdw || !!c.rcli || !!c.sli || !!c.pai);
}

/** A coverage object with only the four known flags, true ones only. */
export function normaliseCoverage(c: unknown): RenewalInsurance | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const out: RenewalInsurance = {};
  for (const k of ["cdw", "rcli", "sli", "pai"] as const) if (o[k] === true) out[k] = true;
  return hasCoverage(out) ? out : null;
}

const COVER_WORDS: Record<keyof RenewalInsurance, string> = {
  cdw: "collision damage",
  rcli: "liability",
  sli: "supplemental liability",
  pai: "personal accident",
};

/** "collision damage and liability". */
export function describeCoverage(c: RenewalInsurance | null | undefined): string {
  if (!hasCoverage(c)) return "no insurance";
  const words = (Object.keys(COVER_WORDS) as (keyof RenewalInsurance)[]).filter((k) => c[k]).map((k) => COVER_WORDS[k]);
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The rule a renewal runs on: one payment at the START of every period,
 * anchored where the rental currently ends. Weekly renewals take the anchor's
 * weekday, monthly ones the anchor's day of the month.
 */
export function renewalRule(anchor: ISODate, unit: RenewalUnit, count: number, end: ScheduleRule["end"]): ScheduleRule {
  const base = { anchor, firstOccurrence: "on_anchor" as const, end };
  if (unit === "day") return { ...base, freq: "daily", interval: count };
  if (unit === "week") return { ...base, freq: "weekly", interval: count, byWeekday: [isoWeekday(anchor) as Weekday] };
  return { ...base, freq: "monthly", interval: count, byMonthDay: Number(anchor.slice(8, 10)) };
}

/** One renewal period, dated by the engine: [periodStart, periodEnd), `days` long. */
export interface RenewalPeriodDates {
  periodStart: ISODate;
  periodEnd: ISODate;
  days: number;
}

/**
 * The first `n` renewal periods from `anchor`, chained as the engine chains
 * them: each is `renewalPeriod(previous end)` — auto-extend's addPeriod, so a
 * monthly period from the 31st overflows (31 Jan → 3 Mar → 3 Apr) exactly as
 * the server dates it.
 */
export function renewalPeriods(anchor: ISODate, unit: RenewalUnit, count: number, n: number): RenewalPeriodDates[] {
  if (!isIsoDate(anchor) || n < 1) return [];
  const out: RenewalPeriodDates[] = [];
  let start = anchor;
  for (let i = 0; i < n; i += 1) {
    const p = renewalPeriod(start, unit, count);
    out.push({ periodStart: p.periodStart, periodEnd: p.periodEnd, days: p.days });
    start = p.periodEnd;
  }
  return out;
}

/**
 * `n + 1` period boundaries from `anchor`: [anchor, end of period 1, …, end of
 * period n] — `renewalPeriods`' dates, so they are the server's.
 */
export function renewalBoundaries(anchor: ISODate, unit: RenewalUnit, count: number, n: number): ISODate[] {
  if (!isIsoDate(anchor) || n < 1) return [anchor];
  return [anchor, ...renewalPeriods(anchor, unit, count, n).map((p) => p.periodEnd)];
}

/** Where the rental would end after `periods` more periods. */
export function endAfterPeriods(currentEnd: ISODate, unit: RenewalUnit, count: number, periods: number): ISODate {
  const b = renewalBoundaries(currentEnd, unit, count, Math.max(1, Math.floor(periods)));
  return b[b.length - 1];
}

/**
 * The fewest whole periods that take the rental from `currentEnd` to ON OR
 * AFTER `target` — "extend until a date" asks for a date, the server extends
 * by whole periods. Null when the target is not after the current end, or
 * more than `max` periods away.
 */
export function periodsUntil(
  currentEnd: ISODate,
  target: ISODate,
  unit: RenewalUnit,
  count: number,
  max = MAX_EXTEND_PERIODS,
): { periods: number; newEnd: ISODate } | null {
  if (!isIsoDate(currentEnd) || !isIsoDate(target) || target <= currentEnd) return null;
  const b = renewalBoundaries(currentEnd, unit, count, max);
  for (let i = 1; i < b.length; i += 1) if (b[i] >= target) return { periods: i, newEnd: b[i] };
  return null;
}

/* ── Extend: which periods, and to where ────────────────────────────────── */

const LIVE_OUT = new Set(["superseded", "cancelled"]);
const UNTOUCHED = new Set(["scheduled", "due"]);

/** A renewal period still on the plan (renewals.ts `isLive`). */
export const isLiveRenewal = (o: Pick<OccurrenceRow, "renews" | "status">): boolean => !!o.renews && !LIVE_OUT.has(o.status);

/**
 * A live renewal period Extend takes as one of its N rather than adding a new
 * one after it: nothing has been tried on it yet (scheduled or due, no
 * attempt), posted or not. Extend brings it forward to today. This is the
 * engine's `extendPlan` selection with the Wave 3 fix D1 ("bring posted-but-
 * untouched periods forward"); a period already being collected (an attempt
 * made, failed, part paid) is left where it is and new periods follow it.
 */
export const extendReuses = (o: Pick<OccurrenceRow, "renews" | "status" | "attemptNo">): boolean =>
  isLiveRenewal(o) && UNTOUCHED.has(o.status) && (o.attemptNo ?? 0) === 0;

/** One period an Extend would collect. `seq` is set for a period already on the plan. */
export interface ExtendStep {
  periodStart: ISODate;
  periodEnd: ISODate;
  /** Already on the plan — brought forward, not added. */
  reused: boolean;
  seq?: number;
}

/**
 * The periods an Extend of `n` collects, in the engine's order: the plan's
 * untouched renewal periods first (by number), then new ones, each starting
 * where the plan's periods end now (renewals.ts `renewalChainStart`: the later
 * of the rental's end and its last live period) — never from the rental's end
 * alone, which would bill days a period already covers.
 */
export function extendSteps(
  rentalEnd: ISODate | null,
  occurrences: readonly OccurrenceRow[],
  unit: RenewalUnit,
  count: number,
  n: number,
): ExtendStep[] {
  const steps: ExtendStep[] = [];
  if (n < 1) return steps;
  const reusable = occurrences
    .filter((o) => extendReuses(o) && !!o.periodStart && !!o.periodEnd)
    .sort((a, b) => a.seq - b.seq);
  for (const o of reusable.slice(0, n)) steps.push({ periodStart: o.periodStart as ISODate, periodEnd: o.periodEnd as ISODate, reused: true, seq: o.seq });
  let start = renewalChainStart(rentalEnd, [...occurrences]);
  while (steps.length < n && start && isIsoDate(start)) {
    const p = renewalPeriod(start, unit, count);
    steps.push({ periodStart: p.periodStart, periodEnd: p.periodEnd, reused: false });
    start = p.periodEnd;
  }
  return steps;
}

/**
 * How far the plan ALREADY takes the rental without an Extend: the later of
 * its end date and the end of every live renewal period Extend would not
 * reuse (paid, being collected). Asking to extend "until" a date on or before
 * this would add a period the rental does not need.
 */
export function plannedEnd(rentalEnd: ISODate | null, occurrences: readonly OccurrenceRow[]): ISODate | null {
  return renewalChainStart(rentalEnd, occurrences.filter((o) => !extendReuses(o)));
}

export type ExtendPlan =
  | { ok: true; periods: number; newEnd: ISODate; steps: ExtendStep[] }
  | { ok: false; message: string };

/** "Extend by N periods" → what the server does with it. */
export function extendByPeriods(
  rentalEnd: ISODate | null,
  occurrences: readonly OccurrenceRow[],
  unit: RenewalUnit,
  count: number,
  periods: number,
  max = MAX_EXTEND_PERIODS,
): ExtendPlan {
  if (!rentalEnd || !isIsoDate(rentalEnd)) return { ok: false, message: "This rental has no return date to extend from." };
  const n = Math.floor(Number(periods));
  if (!Number.isFinite(n) || n < 1) return { ok: false, message: "Extend by 1 period or more." };
  if (n > max) return { ok: false, message: `One Extend adds at most ${max} periods.` };
  const steps = extendSteps(rentalEnd, occurrences, unit, count, n);
  if (steps.length < n) return { ok: false, message: "This rental has no return date to extend from." };
  return { ok: true, periods: n, newEnd: steps[n - 1].periodEnd, steps };
}

/**
 * "Extend until a date" → the fewest whole periods whose last one ends ON OR
 * AFTER `target`, counted the way the server counts them (`extendSteps`). The
 * server extends by a count, so this count is what is sent.
 */
export function extendUntil(
  rentalEnd: ISODate | null,
  occurrences: readonly OccurrenceRow[],
  target: ISODate | null,
  unit: RenewalUnit,
  count: number,
  max = MAX_EXTEND_PERIODS,
): ExtendPlan {
  if (!rentalEnd || !isIsoDate(rentalEnd)) return { ok: false, message: "This rental has no return date to extend from." };
  if (!target || !isIsoDate(target)) return { ok: false, message: "Pick the date the rental should run to." };
  if (target <= rentalEnd) return { ok: false, message: `Pick a date after ${formatDay(rentalEnd)}, when the rental ends now.` };
  const planned = plannedEnd(rentalEnd, occurrences);
  if (planned && target <= planned) {
    return { ok: false, message: `The plan already runs the rental to ${formatDay(planned)} once its open periods are paid. Pick a later date.` };
  }
  const steps = extendSteps(rentalEnd, occurrences, unit, count, max);
  const i = steps.findIndex((s) => s.periodEnd >= target);
  if (i < 0) return { ok: false, message: `That is more than ${max} periods away.` };
  return { ok: true, periods: i + 1, newEnd: steps[i].periodEnd, steps: steps.slice(0, i + 1) };
}

/* ── Bonzah's own rule, said once ──────────────────────────────────────── */

/**
 * The sentence every renewal/extension insurance choice carries. Bonzah cannot
 * start a policy before tomorrow in Pacific time (lib/bonzah-dates
 * clampToBonzahStart); when it cannot cover a period, NO premium is charged
 * for it — a premium is never charged without a policy (roadmap A4).
 */
export const BONZAH_START_RULE =
  "Bonzah cover can't start before tomorrow, Pacific time. If Bonzah can't cover a period, no premium is charged for it and you're told.";

/**
 * What Bonzah can cover of the new days [from, to), given the earliest date it
 * accepts. Pure: the caller passes `earliest` (clampToBonzahStart(from)).
 */
export function insurableWindow(from: ISODate, to: ISODate, earliest: ISODate): { kind: "all" | "part" | "none"; start: ISODate; uncoveredDays: number } {
  if (!(to > earliest)) return { kind: "none", start: earliest, uncoveredDays: 0 };
  if (earliest <= from) return { kind: "all", start: from, uncoveredDays: 0 };
  const days = Math.round((Date.UTC(+earliest.slice(0, 4), +earliest.slice(5, 7) - 1, +earliest.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);
  return { kind: "part", start: earliest, uncoveredDays: days };
}

export function insurableSentence(w: ReturnType<typeof insurableWindow>, to: ISODate): string {
  if (w.kind === "none") return `Bonzah can't cover any of these days — they end ${formatDay(to)}, before cover could start. No premium is charged.`;
  if (w.kind === "part") {
    return `Cover can start ${formatDay(w.start)} at the earliest, so the first ${plural(w.uncoveredDays, "day")} ha${w.uncoveredDays === 1 ? "s" : "ve"} no cover and no premium.`;
  }
  return "Every new day can be covered.";
}

/* ── extension display ─────────────────────────────────────────────────── */

/** One `rental_extension_totals` row, as the plan card shows it. */
export interface ExtensionRef {
  id: string;
  sequenceNumber: number;
  previousEndDate: ISODate | null;
  newEndDate: ISODate | null;
  /** The view's display_status. */
  status: string | null;
  totalCents: number | null;
}

const EXT_STATUS: Record<string, string> = {
  paid: "paid",
  partial: "part paid",
  awaiting_payment: "awaiting payment",
  pending_approval: "days given when paid",
  cancelled: "cancelled",
  refunded: "refunded",
};

export function extensionStatusWords(status: string | null | undefined): string {
  return (status && EXT_STATUS[status]) || (status ? status.replace(/_/g, " ") : "");
}

/** "2 Oct → 9 Oct": a renewal period read as the rental reads it — from the old return date to the new one. */
export function formatPeriodSpan(start: ISODate | null | undefined, endExclusive: ISODate | null | undefined): string {
  if (!start || !endExclusive || !isIsoDate(start) || !isIsoDate(endExclusive)) return "—";
  const noWeekday = (s: string) => s.replace(/^[A-Za-z]{3} /, "");
  if (start.slice(0, 4) === endExclusive.slice(0, 4)) return `${noWeekday(formatDay(start))} → ${noWeekday(formatDay(endExclusive))}`;
  return `${noWeekday(formatDayLong(start))} → ${noWeekday(formatDayLong(endExclusive))}`;
}
