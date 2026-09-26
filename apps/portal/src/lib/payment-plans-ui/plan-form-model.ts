/**
 * The payment-plan form as data — pure, unit-tested, no React.
 *
 * The form is ONE sentence the operator completes (design §9):
 *
 *   Collect [spread evenly · by days covered · a fixed amount]
 *   every   [Weekly · Every 2 weeks · Twice a week · Monthly · Every N days · Pick dates]
 *   on      [weekday(s) / day of month]
 *   starting [rental start · a date]
 *   until   [the rental ends · after N payments · a date]
 *   by      [card auto-charge · emailed link · I'll record it]
 *   reminders −2 / 0 / +2 days
 *
 * One more answer to "until" (payment-plans Wave 3): **keeps renewing until
 * stopped**. It reveals three more lines in the same style —
 *
 *   renew every [N] [days · weeks · months]
 *   cover each renewal with [the rental's coverage · no insurance]   (only when the tenant sells Bonzah)
 *   send an extension agreement each period [yes · no]               (default no)
 *
 * — and turns the plan into one that moves the rental's end date one period
 * at a time, each period priced by the SERVER when it starts (lib/payment-
 * plans-ui/renewal.ts has the contract). The rhythm lines give way to "renew
 * every", because a renewal is collected when its period starts.
 *
 * There is no plan TYPE anywhere in here. What the business once called "pay as
 * you go" and "installments" are just two corners of the same sentence, and the
 * lead's rule is that the operator is never told which corner they are in
 * ("The user must never be told which one they are using"). So nothing in this
 * file — no id, no label — names either.
 *
 * `formToPlan` turns the sentence into the engine's contract (`ScheduleRule` +
 * `AmountSpec` + method + reminders), and `planToForm` turns a stored plan back
 * into the sentence for Edit. The two round-trip for every rule this form can
 * produce, which the tests pin.
 */

import type {
  AmountSpec,
  CollectionMethod,
  ISODate,
  PlanRuleErrorCode,
  ScheduleEnd,
  ScheduleOverride,
  ScheduleRule,
  Weekday,
} from "@/lib/payment-plans/types";
import type { PlanForm as EnginePlanForm } from "@/lib/payment-plans/engine";
import {
  MAX_RENEW_EVERY,
  RENEWAL_PREVIEW_PERIODS,
  describeCoverage,
  describeEvery,
  hasCoverage,
  renewalBoundaries,
  renewalRule,
  type RenewalContext,
  type RenewalShape,
  type RenewalSpec,
  type RenewalUnit,
} from "./renewal";
import {
  WEEKDAY_LONG,
  centsToInput,
  dayNumber,
  formatDay,
  formatMoney,
  isIsoDate,
  isoWeekday,
  ordinal,
  parseDollarsToCents,
  plural,
  reminderLabel,
} from "./format";

/* ── the choices, as data ────────────────────────────────────────────────── */

export type AmountChoice = "split_total" | "split_by_days" | "fixed";
export type RhythmChoice = "weekly" | "every_2_weeks" | "twice_a_week" | "monthly" | "every_n" | "pick_dates";
export type IntervalUnit = "days" | "weeks" | "months";
export type StartChoice = "rental_start" | "date";
/** "renewing" = keeps renewing until stopped: the plan extends the rental one period at a time. */
export type EndChoice = "rental_end" | "count" | "until" | "renewing";

/** The amount words, in the order the sentence offers them. */
export const AMOUNT_CHOICES: readonly { id: AmountChoice; label: string; hint: string }[] = [
  { id: "split_total", label: "spread evenly", hint: "The balance divided equally across the payments." },
  { id: "split_by_days", label: "by days covered", hint: "Each payment is sized by how many rental days it covers." },
  { id: "fixed", label: "a fixed amount", hint: "The same amount every time, until the dates run out." },
];

export const RHYTHM_CHOICES: readonly { id: RhythmChoice; label: string }[] = [
  { id: "weekly", label: "Weekly" },
  { id: "every_2_weeks", label: "Every 2 weeks" },
  { id: "twice_a_week", label: "Twice a week" },
  { id: "monthly", label: "Monthly" },
  { id: "every_n", label: "Every N days" },
  { id: "pick_dates", label: "Pick dates" },
];

export const METHOD_CHOICES: readonly { id: CollectionMethod; label: string; hint: string }[] = [
  {
    id: "auto_charge",
    label: "card auto-charge",
    hint: "The customer's saved card is charged on each date. If the bank needs the customer to confirm, or there is no working card, they're emailed a payment link instead.",
  },
  { id: "checkout_link", label: "emailed link", hint: "The customer is emailed a payment link on each date." },
  { id: "manual", label: "I'll record it", hint: "Nothing is charged. You are reminded on each date and record what you receive." },
];

/** Days relative to the due date. Offered as three chips. */
export const REMINDER_CHOICES: readonly number[] = [-2, 0, 2];

/** The engine caps `interval_count` at 52 (schedule.ts MAX_INTERVAL). */
export const MAX_EVERY: Record<IntervalUnit, number> = { days: 52, weeks: 52, months: 12 };
export const MAX_COUNT = 520;

export interface PlanFormState {
  amount: AmountChoice;
  /** Dollars as typed, for "a fixed amount". */
  fixedAmount: string;
  rhythm: RhythmChoice;
  /** ISO weekdays. One for Weekly / Every 2 weeks, two for Twice a week, any for Every N weeks. */
  weekdays: Weekday[];
  /** 1..31, or -1 for the month's last day. */
  monthDay: number;
  /** N, for "Every N days". */
  every: number;
  everyUnit: IntervalUnit;
  /** For "Pick dates". */
  dates: ISODate[];
  startFrom: StartChoice;
  startDate: ISODate | null;
  /**
   * When the start is not itself a payment day (a Wednesday start, Friday
   * payments), take a short first payment on the start date covering the days
   * up to the first Friday. Off → the first Friday covers them instead.
   */
  firstPaymentOnStart: boolean;
  endBy: EndChoice;
  count: number;
  until: ISODate | null;
  method: CollectionMethod;
  reminders: number[];
  /** Dates moved in the preview. Cleared whenever the rhythm changes. */
  overrides: ScheduleOverride[];
  /* ── keeps renewing until stopped (endBy === "renewing") ── */
  /** N, for "renew every N units". */
  renewEvery: number;
  renewUnit: RenewalUnit;
  /** Cover each renewal with the rental's own Bonzah coverage, or none. */
  renewInsurance: "rental" | "none";
  /** Send an extension agreement for each new period. Off by default for renewals (roadmap A5). */
  renewAgreement: boolean;
}

/** What the rental says, which the form's words refer to. */
export interface PlanContext {
  rentalStart: ISODate;
  /** The return date. Null for a rental with no end, where "until the rental ends" is not offered. */
  rentalEnd: ISODate | null;
  /** What the rental owes — the total the "spread" modes divide. */
  balanceCents: number;
  /** What to say when the balance is zero (New Rental: the price hasn't been entered yet). */
  zeroBalanceMessage?: string;
  /**
   * Present → "keeps renewing until stopped" is offered. Carries what the
   * insurance question needs (does the tenant sell Bonzah; what cover the
   * rental has). Absent (the Developer-tab simulator) → never offered.
   */
  renewal?: RenewalContext;
}

export type FormField =
  | "amount"
  | "fixedAmount"
  | "rhythm"
  | "weekdays"
  | "monthDay"
  | "every"
  | "dates"
  | "startDate"
  | "endBy"
  | "count"
  | "until"
  | "method"
  | "renewEvery";

export interface PlanDraft {
  rule: ScheduleRule;
  /**
   * For a renewing plan this is `{ mode: "per_period", dailyRateCents: 0 }` —
   * a marker, never sent as a price: the server prices every period itself.
   */
  amount: AmountSpec;
  collectionMethod: CollectionMethod;
  reminderOffsets: number[];
  overrides: ScheduleOverride[];
  /** Set only for "keeps renewing until stopped". */
  renewal?: RenewalSpec;
}

export type FormResult = { ok: true; plan: PlanDraft } | { ok: false; field: FormField; message: string };

/* ── defaults ────────────────────────────────────────────────────────────── */

const clampDay = (d: number) => Math.min(31, Math.max(1, d));

export function defaultPlanForm(ctx: PlanContext): PlanFormState {
  const start = isIsoDate(ctx.rentalStart) ? ctx.rentalStart : null;
  const wd: Weekday = start ? isoWeekday(start) : 5;
  return {
    amount: "split_total",
    fixedAmount: "",
    rhythm: "weekly",
    weekdays: [wd],
    monthDay: start ? clampDay(Number(start.slice(8, 10))) : 1,
    every: 3,
    everyUnit: "days",
    dates: [],
    startFrom: "rental_start",
    startDate: start,
    firstPaymentOnStart: true,
    endBy: ctx.rentalEnd ? "rental_end" : "count",
    count: 4,
    until: ctx.rentalEnd,
    // A new rental has no saved card yet, so the default is the one method that
    // works without one. Auto-charge is one tap away and says what it needs.
    method: "checkout_link",
    reminders: [-2, 0, 2],
    overrides: [],
    renewEvery: 1,
    renewUnit: ctx.renewal?.defaultUnit ?? "week",
    renewInsurance: ctx.renewal?.bonzahSellable && hasCoverage(ctx.renewal.rentalCoverage) ? "rental" : "none",
    renewAgreement: false,
  };
}

/** The keys whose change alters the generated dates — and so drops any moved dates. */
const RULE_KEYS: readonly (keyof PlanFormState)[] = [
  "rhythm",
  "weekdays",
  "monthDay",
  "every",
  "everyUnit",
  "dates",
  "startFrom",
  "startDate",
  "firstPaymentOnStart",
  "endBy",
  "count",
  "until",
  "renewEvery",
  "renewUnit",
];

/**
 * Apply an edit. A change to anything that decides the DATES clears the dates
 * moved in the preview — a moved "payment #3" means nothing once payment #3 is
 * a different day.
 */
export function updateForm(state: PlanFormState, patch: Partial<PlanFormState>): PlanFormState {
  const next = { ...state, ...patch };
  if (patch.overrides === undefined && RULE_KEYS.some((k) => k in patch && !sameValue(state[k], next[k]))) {
    next.overrides = [];
  }
  return next;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

/**
 * Switch rhythm, carrying over what still makes sense: the weekday picked for
 * Weekly becomes the first of the two for Twice a week, and so on.
 */
export function selectRhythm(state: PlanFormState, rhythm: RhythmChoice, ctx: PlanContext): PlanFormState {
  const anchor = anchorOf(state, ctx);
  const first: Weekday = state.weekdays[0] ?? (anchor ? isoWeekday(anchor) : 5);
  let weekdays: Weekday[] = state.weekdays;
  if (rhythm === "weekly" || rhythm === "every_2_weeks") weekdays = [first];
  if (rhythm === "twice_a_week") {
    const second = state.weekdays[1] ?? ((((first - 1 + 3) % 7) + 1) as Weekday);
    weekdays = sortWeekdays([first, second === first ? ((((first - 1 + 3) % 7) + 1) as Weekday) : second]);
  }
  if (rhythm === "every_n" && state.everyUnit === "weeks" && weekdays.length === 0) weekdays = [first];
  return updateForm(state, { rhythm, weekdays });
}

export function sortWeekdays(days: Weekday[]): Weekday[] {
  return [...new Set(days)].sort((a, b) => a - b) as Weekday[];
}

/**
 * Toggle a weekday chip, honouring how many the rhythm takes: one for Weekly
 * and Every 2 weeks (a tap replaces), exactly two for Twice a week (a third tap
 * replaces the older of the two), any number for Every N weeks.
 */
export function toggleWeekday(state: PlanFormState, day: Weekday): PlanFormState {
  const has = state.weekdays.includes(day);
  if (state.rhythm === "weekly" || state.rhythm === "every_2_weeks") return updateForm(state, { weekdays: [day] });
  if (state.rhythm === "twice_a_week") {
    if (has) return updateForm(state, { weekdays: state.weekdays.filter((d) => d !== day) });
    const kept = state.weekdays.length >= 2 ? state.weekdays.slice(-1) : state.weekdays;
    return updateForm(state, { weekdays: sortWeekdays([...kept, day]) });
  }
  return updateForm(state, {
    weekdays: has ? state.weekdays.filter((d) => d !== day) : sortWeekdays([...state.weekdays, day]),
  });
}

export function toggleReminder(state: PlanFormState, offset: number): PlanFormState {
  const has = state.reminders.includes(offset);
  const reminders = (has ? state.reminders.filter((o) => o !== offset) : [...state.reminders, offset]).sort((a, b) => a - b);
  return { ...state, reminders };
}

/**
 * Where the schedule starts. A renewing plan ALWAYS starts where the rental
 * currently ends — the first renewal period begins on the return date, and the
 * rental's own dates are priced and collected as they are. The server anchors
 * it there whatever the form says (engine renewalFormToRowAndSchedule), so the
 * form never offers another start for it.
 */
export function anchorOf(state: PlanFormState, ctx: PlanContext): ISODate | null {
  if (state.endBy === "renewing") return ctx.rentalEnd && isIsoDate(ctx.rentalEnd) ? ctx.rentalEnd : null;
  const a = state.startFrom === "rental_start" ? ctx.rentalStart : state.startDate;
  return a && isIsoDate(a) ? a : null;
}

/** Is "keeps renewing until stopped" on offer here? */
export const renewalOffered = (ctx: PlanContext) => !!ctx.renewal;

/* ── the sentence → the contract ─────────────────────────────────────────── */

const fail = (field: FormField, message: string): FormResult => ({ ok: false, field, message });

export function formToPlan(s: PlanFormState, ctx: PlanContext): FormResult {
  if (s.endBy === "renewing") return renewingToPlan(s, ctx);
  // HOW MUCH
  let amount: AmountSpec;
  if (s.amount === "fixed") {
    const cents = parseDollarsToCents(s.fixedAmount);
    if (cents === null || cents < 1) return fail("fixedAmount", "Enter the amount to collect each time.");
    amount = { mode: "fixed", amountCents: cents };
  } else {
    if (!(ctx.balanceCents > 0)) {
      return fail(
        "amount",
        ctx.zeroBalanceMessage ?? "This rental owes nothing right now, so there is no balance to spread. Use a fixed amount instead.",
      );
    }
    amount = { mode: s.amount, totalCents: Math.round(ctx.balanceCents) };
  }

  // STARTING
  const anchor = anchorOf(s, ctx);
  if (!anchor) return fail("startDate", "Pick the date the plan starts.");

  // EVERY … ON …
  let rhythm: Pick<ScheduleRule, "freq" | "interval"> & Partial<Pick<ScheduleRule, "byWeekday" | "byMonthDay" | "dates">>;
  const days = sortWeekdays(s.weekdays);
  switch (s.rhythm) {
    case "weekly":
    case "every_2_weeks":
      if (days.length !== 1) return fail("weekdays", "Pick the day of the week the payment is taken.");
      rhythm = { freq: "weekly", interval: s.rhythm === "weekly" ? 1 : 2, byWeekday: days };
      break;
    case "twice_a_week":
      if (days.length !== 2) return fail("weekdays", "Pick the two days of the week the payments are taken.");
      rhythm = { freq: "weekly", interval: 1, byWeekday: days };
      break;
    case "monthly":
      if (!validMonthDay(s.monthDay)) return fail("monthDay", "Pick a day of the month — the 1st to the 31st, or the last day.");
      rhythm = { freq: "monthly", interval: 1, byMonthDay: s.monthDay };
      break;
    case "every_n": {
      const n = Math.floor(Number(s.every));
      if (!Number.isFinite(n) || n < 1) return fail("every", `Enter how many ${s.everyUnit} apart the payments are — 1 or more.`);
      if (n > MAX_EVERY[s.everyUnit]) return fail("every", `That is more than ${MAX_EVERY[s.everyUnit]} ${s.everyUnit} apart.`);
      if (s.everyUnit === "days") rhythm = { freq: "daily", interval: n };
      else if (s.everyUnit === "weeks") {
        if (days.length === 0) return fail("weekdays", "Pick the day of the week the payment is taken.");
        rhythm = { freq: "weekly", interval: n, byWeekday: days };
      } else {
        if (!validMonthDay(s.monthDay)) return fail("monthDay", "Pick a day of the month — the 1st to the 31st, or the last day.");
        rhythm = { freq: "monthly", interval: n, byMonthDay: s.monthDay };
      }
      break;
    }
    case "pick_dates": {
      const dates = [...new Set(s.dates.filter(isIsoDate))].sort();
      if (dates.length === 0) return fail("dates", "Pick at least one date on the calendar.");
      if (dayNumber(dates[0]) < dayNumber(anchor)) return fail("dates", `${formatDay(dates[0])} is before the plan starts on ${formatDay(anchor)}.`);
      if (ctx.rentalEnd && dayNumber(dates[dates.length - 1]) >= dayNumber(ctx.rentalEnd)) {
        return fail("dates", `${formatDay(dates[dates.length - 1])} is on or after the return date (${formatDay(ctx.rentalEnd)}). Payments fall before the car comes back.`);
      }
      rhythm = { freq: "dates", interval: 1, dates };
      break;
    }
    default:
      return fail("rhythm", "Choose how often the payments are taken.");
  }

  // UNTIL
  let end: ScheduleEnd;
  if (s.rhythm === "pick_dates") {
    // The dates themselves are the schedule. The rental's end closes the last
    // payment's period when there is one; otherwise the list is the count.
    end = ctx.rentalEnd ? { kind: "rental_end", rentalEnd: ctx.rentalEnd } : { kind: "count", count: rhythm.dates!.length };
  } else if (s.endBy === "rental_end") {
    if (!ctx.rentalEnd) return fail("endBy", "This rental has no return date. Choose a number of payments or an end date.");
    end = { kind: "rental_end", rentalEnd: ctx.rentalEnd };
  } else if (s.endBy === "count") {
    const n = Math.floor(Number(s.count));
    if (!Number.isFinite(n) || n < 1) return fail("count", "Enter how many payments to take — 1 or more.");
    if (n > MAX_COUNT) return fail("count", `That is more than ${MAX_COUNT} payments.`);
    end = { kind: "count", count: n };
  } else {
    if (!s.until || !isIsoDate(s.until)) return fail("until", "Pick the date of the last payment.");
    if (dayNumber(s.until) < dayNumber(anchor)) return fail("until", `The end date is before the plan starts on ${formatDay(anchor)}.`);
    end = { kind: "until", until: s.until };
  }

  const rule: ScheduleRule = {
    freq: rhythm.freq,
    interval: rhythm.interval,
    ...(rhythm.byWeekday ? { byWeekday: rhythm.byWeekday } : {}),
    ...(rhythm.byMonthDay !== undefined ? { byMonthDay: rhythm.byMonthDay } : {}),
    ...(rhythm.dates ? { dates: rhythm.dates } : {}),
    anchor,
    firstOccurrence: s.firstPaymentOnStart ? "on_anchor" : "on_rhythm",
    end,
  };

  return {
    ok: true,
    plan: {
      rule,
      amount,
      collectionMethod: s.method,
      reminderOffsets: [...new Set(s.reminders)].sort((a, b) => a - b),
      overrides: s.overrides.filter((o) => isIsoDate(o.moveTo)),
    },
  };
}

/**
 * "Keeps renewing until stopped" → the contract. The schedule is one payment
 * at the start of every period from where the rental ends; `end.through` is
 * only how far the preview materialises (the plan itself is open) and the
 * amount is the per-period marker — the server prices each period.
 */
function renewingToPlan(s: PlanFormState, ctx: PlanContext): FormResult {
  if (!ctx.renewal) return fail("endBy", "Renewing isn't available here. Choose when the payments end.");
  const anchor = anchorOf(s, ctx);
  if (!anchor) return fail("endBy", "This rental has no return date to renew from. Set one first — the first renewal starts on it.");
  const n = Math.floor(Number(s.renewEvery));
  const unit: RenewalUnit = s.renewUnit;
  if (!Number.isFinite(n) || n < 1) return fail("renewEvery", `Enter how many ${unit}s each renewal lasts — 1 or more.`);
  if (n > MAX_RENEW_EVERY[unit]) return fail("renewEvery", `A renewal can't be longer than ${MAX_RENEW_EVERY[unit]} ${unit}s.`);

  const through = renewalBoundaries(anchor, unit, n, RENEWAL_PREVIEW_PERIODS)[RENEWAL_PREVIEW_PERIODS - 1];
  const rule = renewalRule(anchor, unit, n, { kind: "open", through });
  const coverage = ctx.renewal.bonzahSellable && s.renewInsurance === "rental" && hasCoverage(ctx.renewal.rentalCoverage)
    ? { ...ctx.renewal.rentalCoverage }
    : null;
  return {
    ok: true,
    plan: {
      rule,
      amount: { mode: "per_period", dailyRateCents: 0 },
      collectionMethod: s.method,
      reminderOffsets: [...new Set(s.reminders)].sort((a, b) => a - b),
      // A renewal is collected when its period starts; moving one would take
      // the money on a day that is not the period's first.
      overrides: [],
      renewal: {
        extendsRental: true,
        periodUnit: unit,
        periodCount: n,
        insurance: coverage,
        sendAgreementEachPeriod: s.renewAgreement,
      },
    },
  };
}

function validMonthDay(d: number): boolean {
  return Number.isInteger(d) && (d === -1 || (d >= 1 && d <= 31));
}

/* ── the contract → the sentence (for Edit) ──────────────────────────────── */

export interface StoredPlanShape {
  rule: ScheduleRule;
  amount: AmountSpec;
  collectionMethod: CollectionMethod;
  reminderOffsets: number[];
  renewal?: RenewalShape | null;
}

export function planToForm(p: StoredPlanShape, ctx: PlanContext): PlanFormState {
  const base = defaultPlanForm(ctx);
  const r = p.rule;
  if (p.renewal) {
    return {
      ...base,
      endBy: "renewing",
      startFrom: "rental_start",
      method: p.collectionMethod,
      reminders: [...p.reminderOffsets].sort((a, b) => a - b),
      renewEvery: p.renewal.periodCount,
      renewUnit: p.renewal.periodUnit,
      renewInsurance: hasCoverage(p.renewal.insurance) ? "rental" : "none",
      renewAgreement: !!p.renewal.sendAgreementEachPeriod,
      overrides: [],
    };
  }
  const days = sortWeekdays((r.byWeekday ?? []) as Weekday[]);

  let rhythm: RhythmChoice = "weekly";
  let every = base.every;
  let everyUnit: IntervalUnit = base.everyUnit;
  if (r.freq === "weekly") {
    if (r.interval === 1 && days.length === 1) rhythm = "weekly";
    else if (r.interval === 2 && days.length === 1) rhythm = "every_2_weeks";
    else if (r.interval === 1 && days.length === 2) rhythm = "twice_a_week";
    else {
      rhythm = "every_n";
      every = r.interval;
      everyUnit = "weeks";
    }
  } else if (r.freq === "monthly") {
    if (r.interval === 1) rhythm = "monthly";
    else {
      rhythm = "every_n";
      every = r.interval;
      everyUnit = "months";
    }
  } else if (r.freq === "daily") {
    rhythm = "every_n";
    every = r.interval;
    everyUnit = "days";
  } else {
    rhythm = "pick_dates";
  }

  let endBy: EndChoice = "count";
  let count = base.count;
  let until = base.until;
  switch (r.end.kind) {
    case "rental_end":
      endBy = "rental_end";
      break;
    case "count":
      endBy = "count";
      count = r.end.count;
      break;
    case "until":
      endBy = "until";
      until = r.end.until;
      break;
    case "open":
      endBy = "until";
      until = r.end.through;
      break;
  }

  const amount: AmountChoice =
    p.amount.mode === "fixed" ? "fixed" : p.amount.mode === "split_total" ? "split_total" : "split_by_days";

  return {
    amount,
    fixedAmount: p.amount.mode === "fixed" ? centsToInput(p.amount.amountCents) : "",
    rhythm,
    weekdays: days.length ? days : base.weekdays,
    monthDay: r.byMonthDay ?? base.monthDay,
    every,
    everyUnit,
    dates: r.dates ? [...r.dates] : [],
    startFrom: r.anchor === ctx.rentalStart ? "rental_start" : "date",
    startDate: r.anchor,
    firstPaymentOnStart: r.firstOccurrence !== "on_rhythm",
    endBy,
    count,
    until,
    method: p.collectionMethod,
    reminders: [...p.reminderOffsets].sort((a, b) => a - b),
    overrides: [],
    renewEvery: base.renewEvery,
    renewUnit: base.renewUnit,
    renewInsurance: base.renewInsurance,
    renewAgreement: base.renewAgreement,
  };
}

/* ── words ───────────────────────────────────────────────────────────────── */

/** Plain English for every error code the schedule generator can throw. */
export const RULE_ERROR_TEXT: Record<PlanRuleErrorCode, string> = {
  interval_invalid: "The gap between payments has to be at least 1.",
  weekday_required: "Pick the day of the week the payment is taken.",
  month_day_invalid: "Pick a day of the month — the 1st to the 31st, or the last day.",
  dates_required: "Pick at least one date on the calendar.",
  date_before_anchor: "One of the picked dates is before the plan starts.",
  count_invalid: "The number of payments has to be at least 1.",
  no_occurrences: "These choices produce no payment dates. Check that the end comes after the start.",
  too_many_occurrences: `These choices produce more than ${MAX_COUNT} payments. Take them less often, or end sooner.`,
  amount_too_small: "At least one payment would come to less than one cent. Take fewer payments.",
  charge_time_invalid: "Payments can't be taken between midnight and 4 a.m.",
};

export function ruleErrorText(code: string | null | undefined, fallback = "These choices can't be turned into a schedule."): string {
  return (code && (RULE_ERROR_TEXT as Record<string, string>)[code]) || fallback;
}

const joinWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

const dayOfMonth = (d: number | undefined) => (d === -1 ? "the last day" : `the ${ordinal(d ?? 1)}`);

/** "every Friday", "every 2 weeks on Friday", "every Monday and Thursday", "every 3 days". */
export function describeRhythm(rule: ScheduleRule): string {
  const days = (rule.byWeekday ?? []).map((d) => WEEKDAY_LONG[d - 1]);
  switch (rule.freq) {
    case "weekly":
      if (rule.interval === 1) return `every ${joinWords(days)}`;
      return `every ${rule.interval} weeks on ${joinWords(days)}`;
    case "monthly":
      return rule.interval === 1
        ? `monthly on ${dayOfMonth(rule.byMonthDay)}`
        : `every ${rule.interval} months on ${dayOfMonth(rule.byMonthDay)}`;
    case "daily":
      return rule.interval === 1 ? "every day" : `every ${rule.interval} days`;
    case "dates":
      return `on ${plural(rule.dates?.length ?? 0, "picked date")}`;
  }
}

export function describeEnd(end: ScheduleEnd): string {
  switch (end.kind) {
    case "rental_end":
      return "until the rental ends";
    case "count":
      return `for ${plural(end.count, "payment")}`;
    case "until":
      return `until ${formatDay(end.until)}`;
    case "open":
      return "with no end date";
  }
}

export function describeAmount(amount: AmountSpec, currency: string): string {
  switch (amount.mode) {
    case "split_total":
      return `${formatMoney(amount.totalCents, currency)} spread evenly`;
    case "split_by_days":
      return `${formatMoney(amount.totalCents, currency)} by days covered`;
    case "fixed":
      return `${formatMoney(amount.amountCents, currency)} each time`;
    case "per_period":
      return `${formatMoney(amount.dailyRateCents, currency)} a day`;
  }
}

export function describeMethod(method: CollectionMethod): string {
  return METHOD_CHOICES.find((m) => m.id === method)?.label ?? method;
}

export function describeReminders(offsets: number[]): string {
  if (!offsets.length) return "no reminders";
  return joinWords([...offsets].sort((a, b) => a - b).map((o) => reminderLabel(o).toLowerCase()));
}

/**
 * "Keeps renewing every week from Fri 9 Oct, each period priced when it
 * starts" — or, when the server's price for one period is known (the set-up
 * form asks it), "…, $362.21 each period".
 */
export function describeRenewal(p: Pick<StoredPlanShape, "rule" | "renewal">, perPeriod?: { cents: number; currency: string } | null): string {
  const r = p.renewal!;
  const price = perPeriod && perPeriod.cents > 0 ? `${formatMoney(perPeriod.cents, perPeriod.currency)} each period` : "each period priced when it starts";
  return `Keeps renewing ${describeEvery(r.periodUnit, r.periodCount)} from ${formatDay(p.rule.anchor)}, ${price}`;
}

/** The whole plan as one sentence, for summaries and confirmations. */
export function describePlan(p: StoredPlanShape, currency: string, opts?: { perPeriodCents?: number | null }): string {
  if (p.renewal) {
    const cover = hasCoverage(p.renewal.insurance) ? ` Each period is covered by ${describeCoverage(p.renewal.insurance)} insurance.` : "";
    const agreement = p.renewal.sendAgreementEachPeriod ? " An extension agreement is sent each period." : "";
    const perPeriod = opts?.perPeriodCents ? { cents: opts.perPeriodCents, currency } : null;
    return `${describeRenewal(p, perPeriod)}, by ${describeMethod(p.collectionMethod)}.${cover}${agreement}`;
  }
  const rule = p.rule;
  const rhythm = rule.freq === "dates" ? describeRhythm(rule) : `${describeRhythm(rule)}, ${describeEnd(rule.end)}`;
  return `Collect ${describeAmount(p.amount, currency)} ${rhythm}, by ${describeMethod(p.collectionMethod)}.`;
}

/**
 * What an edit changes, one line per thing that moved — shown before saving so
 * nothing about a plan change is a surprise. Lines for unchanged facts are left
 * out; an empty list means the edit changes nothing.
 */
export function describeChanges(before: StoredPlanShape, after: StoredPlanShape, currency: string): string[] {
  const out: string[] = [];
  if (before.renewal || after.renewal) {
    const eb = before.renewal ? `keeps renewing ${describeEvery(before.renewal.periodUnit, before.renewal.periodCount)}` : describeEnd(before.rule.end);
    const ea = after.renewal ? `keeps renewing ${describeEvery(after.renewal.periodUnit, after.renewal.periodCount)}` : describeEnd(after.rule.end);
    if (eb !== ea) out.push(`Ends: ${eb} → ${ea}`);
    if (before.rule.anchor !== after.rule.anchor) out.push(`Starts: ${formatDay(before.rule.anchor)} → ${formatDay(after.rule.anchor)}`);
    const ib = describeCoverage(before.renewal?.insurance);
    const ia = describeCoverage(after.renewal?.insurance);
    if (ib !== ia) out.push(`Insurance on renewals: ${ib} → ${ia}`);
    const gb = before.renewal?.sendAgreementEachPeriod ? "yes" : "no";
    const ga = after.renewal?.sendAgreementEachPeriod ? "yes" : "no";
    if (gb !== ga) out.push(`Extension agreement each period: ${gb} → ${ga}`);
    if (before.collectionMethod !== after.collectionMethod) {
      out.push(`Collected by: ${describeMethod(before.collectionMethod)} → ${describeMethod(after.collectionMethod)}`);
    }
    const mb = describeReminders(before.reminderOffsets);
    const ma = describeReminders(after.reminderOffsets);
    if (mb !== ma) out.push(`Reminders: ${mb} → ${ma}`);
    return out;
  }
  const rb = describeRhythm(before.rule);
  const ra = describeRhythm(after.rule);
  if (rb !== ra) out.push(`How often: ${rb} → ${ra}`);
  if (before.rule.anchor !== after.rule.anchor) out.push(`Starts: ${formatDay(before.rule.anchor)} → ${formatDay(after.rule.anchor)}`);
  const eb = describeEnd(before.rule.end);
  const ea = describeEnd(after.rule.end);
  if (eb !== ea && after.rule.freq !== "dates") out.push(`Ends: ${eb} → ${ea}`);
  const ab = describeAmount(before.amount, currency);
  const aa = describeAmount(after.amount, currency);
  if (before.amount.mode !== after.amount.mode || (before.amount.mode === "fixed" && ab !== aa)) out.push(`Amount: ${ab} → ${aa}`);
  if (before.collectionMethod !== after.collectionMethod) {
    out.push(`Collected by: ${describeMethod(before.collectionMethod)} → ${describeMethod(after.collectionMethod)}`);
  }
  const mb = describeReminders(before.reminderOffsets);
  const ma = describeReminders(after.reminderOffsets);
  if (mb !== ma) out.push(`Reminders: ${mb} → ${ma}`);
  return out;
}

/* ── the request body ────────────────────────────────────────────────────── */

/**
 * The validated sentence as the ENGINE's `PlanForm` — the shape
 * `payment-plan-manage` (preview / create / update) and the simulator both
 * feed to `planFormToRowAndSchedule`. The one thing it deliberately drops is
 * the split TOTAL: for "spread evenly" and "by days covered" the server takes
 * the amount from the ledger (pp_rental_owed_cents), never from the browser
 * (design §8). A fixed amount is the operator's price, so it is sent.
 */
export function draftToPlanForm(d: PlanDraft): EnginePlanForm & { renewal?: RenewalSpec } {
  const r = d.rule;
  if (d.renewal) {
    // No amount at all: with renewal set the SERVER prices every period,
    // exactly as a renewal is priced today (pinned API). No overrides either.
    return {
      freq: r.freq,
      interval: r.interval,
      ...(r.freq === "weekly" ? { byWeekday: r.byWeekday } : {}),
      ...(r.freq === "monthly" ? { byMonthDay: r.byMonthDay } : {}),
      anchor: r.anchor,
      firstOccurrence: r.firstOccurrence,
      end: r.end.kind === "open" ? r.end : { kind: "open", through: r.anchor },
      amountMode: "per_period",
      fixedAmountCents: null,
      dailyRateCents: null,
      collectionMethod: d.collectionMethod,
      reminderOffsets: d.reminderOffsets,
      renewal: { ...d.renewal, insurance: d.renewal.insurance ?? null },
    };
  }
  const end: EnginePlanForm["end"] = r.end.kind === "rental_end" ? { kind: "rental_end" } : r.end;
  return {
    freq: r.freq,
    interval: r.interval,
    ...(r.freq === "weekly" ? { byWeekday: r.byWeekday } : {}),
    ...(r.freq === "monthly" ? { byMonthDay: r.byMonthDay } : {}),
    ...(r.freq === "dates" ? { dates: r.dates } : {}),
    anchor: r.anchor,
    firstOccurrence: r.firstOccurrence,
    end,
    amountMode: d.amount.mode,
    fixedAmountCents: d.amount.mode === "fixed" ? d.amount.amountCents : null,
    dailyRateCents: d.amount.mode === "per_period" ? d.amount.dailyRateCents : null,
    collectionMethod: d.collectionMethod,
    reminderOffsets: d.reminderOffsets,
    ...(d.overrides.length ? { overrides: d.overrides } : {}),
  };
}
