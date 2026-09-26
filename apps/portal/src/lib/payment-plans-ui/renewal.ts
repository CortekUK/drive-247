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
 * Every renewal boundary comes from the ENGINE's own generator (`expandRule`),
 * so the dates the operator previews are the dates the server stores: a
 * monthly renewal that starts on the 31st clamps to the 28th in February and
 * returns to the 31st in March (design D4), because that is what the engine
 * does — not because this file re-implemented it.
 */

import type { ISODate, ScheduleRule, Weekday } from "@/lib/payment-plans/types";
import { expandRule } from "@/lib/payment-plans/schedule";
import { formatDay, formatDayLong, isIsoDate, isoWeekday, plural } from "./format";

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
  /** The unit "renew every" starts on — the rental's own period type. */
  defaultUnit?: RenewalUnit;
}

/** How many renewal periods the preview lists (the plan itself has no end). */
export const RENEWAL_PREVIEW_PERIODS = 4;

/** The most periods one Extend adds — a guard against a mistyped 500. */
export const MAX_EXTEND_PERIODS = 52;

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

/**
 * `n + 1` period boundaries from `anchor`: [anchor, end of period 1, …, end of
 * period n]. Computed by the engine's generator, so month-ends clamp and
 * return exactly as the stored schedule will.
 */
export function renewalBoundaries(anchor: ISODate, unit: RenewalUnit, count: number, n: number): ISODate[] {
  if (!isIsoDate(anchor) || n < 1) return [anchor];
  const ex = expandRule(renewalRule(anchor, unit, count, { kind: "count", count: n }));
  return [...ex.dates, ex.lastPeriodEnd];
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
