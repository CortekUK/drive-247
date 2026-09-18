/**
 * v2 Settings (northwind): the pure state rules behind the Pricing rules, Tax and
 * fees and Security deposit pages. No React, no queries: every function takes
 * the form and the saved row and answers one question, so each is unit-tested
 * with hand-worked values.
 *
 * PRESENTATION ONLY. Nothing here changes what is saved. The payload builders
 * return exactly the objects the pages sent before this file existed, and the
 * form transforms (clamping while typing, blur defaults) stay in the components
 * unchanged. These rules only decide what the operator is shown: whether a
 * section has unsaved edits, which warning a value earns, and whether Save is
 * held back for a value the form already declares invalid (a negative
 * surcharge, a percentage over 100).
 */

import { format } from "date-fns";
import { formatCurrency } from "@/lib/format-utils";
import { describeSaveError } from "@/components/settings-v2/settings-error-copy";

export type NumberLike = number | string | null | undefined;

/** A number from a form value. Blank, null and non-numeric text are `null`. */
export function toFiniteNumber(value: NumberLike): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "7.50" and 7.5 are the same value; "" and 0 are not (the field was cleared). */
export function sameNumber(a: NumberLike, b: NumberLike): boolean {
  return toFiniteNumber(a) === toFiniteNumber(b);
}

const plain = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

/** "+12.5%", "1,234,567%", "—" for nothing. `sign` adds "+" to positive values. */
export function formatPercent(value: NumberLike, sign = false): string {
  const n = toFiniteNumber(value);
  if (n === null) return "—";
  return `${sign && n > 0 ? "+" : ""}${plain(n)}%`;
}

/* -------------------------------------------------------------------------- */
/* Field issues                                                                */
/* -------------------------------------------------------------------------- */

export type IssueTone = "danger" | "warning" | "info";

export interface FieldIssue {
  tone: IssueTone;
  message: string;
  /** The form already treats this value as invalid, so Save waits for a fix. */
  blocksSave?: boolean;
}

export const ISSUE_TEXT_CLASS: Record<IssueTone, string> = {
  danger: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-muted-foreground",
};

export function hasBlockingIssue(issues: Array<FieldIssue | null | undefined>): boolean {
  return issues.some((issue) => !!issue?.blocksSave);
}

/** Thrown by a registered "Save & Leave" save while a value blocks saving. */
export const BLOCKED_SAVE_MESSAGE = "Fix the highlighted value before saving.";

/* -------------------------------------------------------------------------- */
/* Tax and fees                                                                */
/* -------------------------------------------------------------------------- */

export interface FeesFormFields {
  tax_enabled: boolean;
  tax_percentage: NumberLike;
  service_fee_enabled: boolean;
  service_fee_type: "percentage" | "fixed_amount";
  service_fee_value: NumberLike;
  service_fee_amount?: NumberLike;
}

export interface FeesSavedFields {
  tax_enabled?: boolean | null;
  tax_percentage?: NumberLike;
  service_fee_enabled?: boolean | null;
  service_fee_type?: string | null;
  service_fee_value?: NumberLike;
  service_fee_amount?: NumberLike;
}

/** The same fallbacks the page's rental-form sync effect applies. */
export function savedFeesValues(saved: FeesSavedFields) {
  return {
    tax_enabled: saved.tax_enabled ?? false,
    tax_percentage: saved.tax_percentage ?? 0,
    service_fee_enabled: saved.service_fee_enabled ?? false,
    service_fee_amount: saved.service_fee_amount ?? 0,
    service_fee_type: ((saved.service_fee_type as FeesFormFields["service_fee_type"]) ?? "fixed_amount"),
    service_fee_value: saved.service_fee_value ?? saved.service_fee_amount ?? 0,
  };
}

export function isFeesDirty(form: FeesFormFields, saved: FeesSavedFields | null | undefined): boolean {
  if (!saved) return false;
  const s = savedFeesValues(saved);
  return (
    !!form.tax_enabled !== !!s.tax_enabled ||
    !sameNumber(form.tax_percentage, s.tax_percentage) ||
    !!form.service_fee_enabled !== !!s.service_fee_enabled ||
    form.service_fee_type !== s.service_fee_type ||
    !sameNumber(form.service_fee_value, s.service_fee_value)
  );
}

/** Exactly what the v2 Tax and fees Save sent before. */
export function feesPayload(form: FeesFormFields) {
  return {
    tax_enabled: form.tax_enabled,
    tax_percentage: form.tax_percentage,
    service_fee_enabled: form.service_fee_enabled,
    service_fee_amount: form.service_fee_value,
    service_fee_type: form.service_fee_type,
    service_fee_value: form.service_fee_value,
  };
}

export function taxIssue(form: Pick<FeesFormFields, "tax_enabled" | "tax_percentage">): FieldIssue | null {
  if (!form.tax_enabled) return null;
  const rate = toFiniteNumber(form.tax_percentage);
  // A negative rate can only come from the saved row (typing strips "-"), and
  // folding it into the 0% line contradicted the field beside it.
  if (rate !== null && rate < 0) {
    return { tone: "danger", message: `The rate is ${plain(rate)}%. A tax rate can't be negative. Enter 0 or more.` };
  }
  if (rate === null || rate <= 0) {
    return { tone: "warning", message: "Tax is on but the rate is 0%, so no tax will be added." };
  }
  if (rate >= 100) {
    return { tone: "warning", message: "A 100% tax doubles every booking total. Check this is intended." };
  }
  return null;
}

export function serviceFeeIssue(
  form: Pick<FeesFormFields, "service_fee_enabled" | "service_fee_type" | "service_fee_value">,
  /** Formats a negative fixed fee in the tenant's currency ("-$10.00"). */
  currencyCode?: string,
): FieldIssue | null {
  if (!form.service_fee_enabled) return null;
  const value = toFiniteNumber(form.service_fee_value);
  // Switching Fixed amount -> Percentage keeps the number, so a 250 fee would
  // otherwise save as 250% of the rental. Typing already caps percentages at 100.
  if (form.service_fee_type === "percentage" && value !== null && value > 100) {
    return {
      tone: "danger",
      blocksSave: true,
      message: `${plain(value)}% is more than the whole rental. Enter a percentage up to 100, or switch back to Fixed amount.`,
    };
  }
  if (value !== null && value < 0) {
    const shown =
      form.service_fee_type === "percentage"
        ? `${plain(value)}%`
        : currencyCode
          ? formatCurrency(value, currencyCode)
          : plain(value);
    return { tone: "danger", message: `The fee is ${shown}. A service fee can't be negative. Enter 0 or more.` };
  }
  if (value === null || value <= 0) {
    return { tone: "warning", message: "The service fee is on but set to 0, so nothing will be added." };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Security deposit                                                            */
/* -------------------------------------------------------------------------- */

export interface DepositFormFields {
  security_deposit_enabled: boolean;
  deposit_charge_enabled: boolean;
  deposit_mode: string;
  global_deposit_amount: NumberLike;
}

export interface DepositSavedFields {
  security_deposit_enabled?: boolean | null;
  deposit_charge_enabled?: boolean | null;
  deposit_mode?: string | null;
  global_deposit_amount?: NumberLike;
}

/** The same fallbacks the page's rental-form sync effect applies. */
export function savedDepositValues(saved: DepositSavedFields) {
  return {
    security_deposit_enabled: saved.security_deposit_enabled ?? true,
    deposit_charge_enabled: saved.deposit_charge_enabled ?? false,
    deposit_mode: saved.deposit_mode ?? "global",
    global_deposit_amount: saved.global_deposit_amount ?? 0,
  };
}

export interface DepositDirtyState {
  dirty: boolean;
  /** The page-wide dirty check misses the two switches; this one does not. */
  switchesDirty: boolean;
  /** "Switch to charges" was confirmed but not saved yet. */
  chargeNotSaved: boolean;
}

export const NOT_DIRTY: DepositDirtyState = { dirty: false, switchesDirty: false, chargeNotSaved: false };

export function depositDirtyState(
  form: DepositFormFields,
  saved: DepositSavedFields | null | undefined,
): DepositDirtyState {
  if (!saved) return NOT_DIRTY;
  const s = savedDepositValues(saved);
  const switchesDirty =
    !!form.security_deposit_enabled !== !!s.security_deposit_enabled ||
    !!form.deposit_charge_enabled !== !!s.deposit_charge_enabled;
  return {
    switchesDirty,
    dirty: switchesDirty || form.deposit_mode !== s.deposit_mode || !sameNumber(form.global_deposit_amount, s.global_deposit_amount),
    chargeNotSaved: !!form.deposit_charge_enabled && !s.deposit_charge_enabled,
  };
}

/** Exactly what the v2 Security deposit Save sent before. */
export function depositPayload(form: DepositFormFields) {
  return {
    security_deposit_enabled: form.security_deposit_enabled,
    deposit_charge_enabled: form.deposit_charge_enabled,
    deposit_mode: form.deposit_mode,
    global_deposit_amount: form.global_deposit_amount,
  };
}

export type DepositChargeGuard = "allowed" | "checking" | "unknown" | "blocked";

/**
 * May the operator switch from holds to charges? Switching back to holds is
 * always allowed. The live-holds count used to read 0 while loading and after a
 * failed read, which let the switch through with holds still live; an unknown
 * count now keeps the switch locked instead.
 */
export function depositChargeGuard({
  chargeEnabled,
  holdsKnown,
  holdsFailed,
  liveHoldCount,
}: {
  chargeEnabled: boolean;
  holdsKnown: boolean;
  holdsFailed: boolean;
  liveHoldCount: number;
}): DepositChargeGuard {
  if (chargeEnabled) return "allowed";
  if (!holdsKnown) return holdsFailed ? "unknown" : "checking";
  return liveHoldCount > 0 ? "blocked" : "allowed";
}

export function liveHoldsMessage(count: number): string {
  return `${plain(count)} rental${count === 1 ? " has" : "s have"} a live hold. Release ${
    count === 1 ? "it" : "them"
  } first, or those cars will be left with no deposit.`;
}

export function depositAmountIssue(form: DepositFormFields, currencyCode: string): FieldIssue | null {
  if (!form.security_deposit_enabled) return null;
  const amount = toFiniteNumber(form.global_deposit_amount) ?? 0;
  if (amount > 0) return null;
  if (amount < 0) {
    return {
      tone: "danger",
      message: `The amount is ${formatCurrency(amount, currencyCode)}. A deposit can't be negative. Enter 0 or more.`,
    };
  }
  const zero = formatCurrency(0, currencyCode);
  if (form.deposit_mode === "per_vehicle") {
    return { tone: "warning", message: `The amount is ${zero}, so vehicles without their own deposit will have none.` };
  }
  return form.deposit_charge_enabled
    ? { tone: "danger", message: `The amount is ${zero}, so no deposit will be collected.` }
    : { tone: "warning", message: `The amount is ${zero}, so no hold will be placed.` };
}

/* -------------------------------------------------------------------------- */
/* Weekend pricing                                                             */
/* -------------------------------------------------------------------------- */

export const WEEKEND_DAY_LIMIT = 3;

export interface WeekendFormFields {
  percent: NumberLike;
  days: number[];
  stack: boolean;
}

export interface WeekendSavedFields {
  weekend_surcharge_percent: NumberLike;
  weekend_days: number[] | null | undefined;
  stack_surcharges: boolean | null | undefined;
}

export function isWeekendDirty(form: WeekendFormFields, saved: WeekendSavedFields): boolean {
  const savedDays = saved.weekend_days ?? [6, 0];
  const sameDays = form.days.length === savedDays.length && form.days.every((day) => savedDays.includes(day));
  return (
    (toFiniteNumber(form.percent) ?? 0) !== (toFiniteNumber(saved.weekend_surcharge_percent) ?? 0) ||
    !sameDays ||
    !!form.stack !== !!saved.stack_surcharges
  );
}

export function weekendPercentIssue(value: NumberLike): FieldIssue | null {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  if (n < 0) {
    return { tone: "danger", blocksSave: true, message: "Enter 0 or more. Use 0 to turn weekend pricing off." };
  }
  if (n > 100) {
    return { tone: "warning", message: `${formatPercent(n, true)} more than doubles the daily rate on these days. Check this is intended.` };
  }
  return null;
}

/** 0% is how "off" is stored, so say so instead of showing an unfilled box. */
export function weekendOffNote(value: NumberLike): FieldIssue | null {
  return (toFiniteNumber(value) ?? 0) === 0
    ? { tone: "info", message: "Off. Weekend bookings use the normal daily rate." }
    : null;
}

export function weekendDaysIssue(percent: NumberLike, days: number[]): FieldIssue | null {
  if ((toFiniteNumber(percent) ?? 0) > 0 && days.length === 0) {
    return { tone: "warning", message: "Pick at least one day, or this surcharge never applies." };
  }
  if (days.length >= WEEKEND_DAY_LIMIT) {
    return { tone: "info", message: `Up to ${WEEKEND_DAY_LIMIT} days. Deselect one to choose another.` };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Holidays                                                                    */
/* -------------------------------------------------------------------------- */

export interface HolidayFormFields {
  name: string;
  start_date: string;
  end_date: string;
  surcharge_percent: number | "";
  recurs_annually: boolean;
}

export const EMPTY_HOLIDAY_FORM: HolidayFormFields = {
  name: "",
  start_date: "",
  end_date: "",
  surcharge_percent: "",
  recurs_annually: false,
};

export type HolidayFormErrors = Partial<Record<keyof HolidayFormFields, string>>;

/** The v1 dialog's validity rule, with a reason for each way it fails. */
export function holidayFormErrors(form: HolidayFormFields): HolidayFormErrors {
  const errors: HolidayFormErrors = {};
  if (!form.name.trim()) errors.name = "Give the holiday a name.";
  if (!form.start_date) errors.start_date = "Pick the first day.";
  if (!form.end_date) errors.end_date = "Pick the last day.";
  else if (form.start_date && form.end_date < form.start_date) {
    errors.end_date = "The last day can't be before the first day.";
  }
  const surcharge = toFiniteNumber(form.surcharge_percent);
  if (surcharge !== null && surcharge < 0) errors.surcharge_percent = "Enter 0 or more.";
  return errors;
}

/** Local calendar date as yyyy-MM-dd, the format holidays are stored in. */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A one-time holiday whose last day is before today. Yearly ones come round again. */
export function isHolidayPast(holiday: { end_date: string; recurs_annually: boolean }, today: string): boolean {
  return !holiday.recurs_annually && !!holiday.end_date && holiday.end_date < today;
}

/**
 * Why a holiday could not be deleted. The save copy for a constraint failure
 * ("One of the values isn't allowed. Check the fields") names fields a delete
 * confirm does not have, and "Your changes are still here" has no changes to
 * keep, so a refused delete says what happened instead. Permission and plain
 * messages keep the save copy.
 */
export function describeHolidayDeleteError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "").toLowerCase()
      : "";
  if (code === "23503" || message.includes("foreign key")) {
    return "Other records still point to this holiday, so it can't be deleted yet. Nothing was removed.";
  }
  const copy = describeSaveError(error);
  if (copy.startsWith("One of the values isn't allowed")) {
    return "The database refused to delete this holiday. Nothing was removed. Try again.";
  }
  return copy.replace("Your changes are still here.", "Nothing was removed.");
}

export function excludedVehicleCount(holiday: { excluded_vehicle_ids?: unknown }): number {
  return Array.isArray(holiday.excluded_vehicle_ids) ? holiday.excluded_vehicle_ids.length : 0;
}

export function formatHolidayDate(dateStr: string): string {
  const [y, m, d] = (dateStr ?? "").split("-").map(Number);
  if (!y || !m || !d) return dateStr || "—";
  return format(new Date(y, m - 1, d), "MMM d, yyyy");
}

export function formatHolidayDates(start: string, end: string): string {
  const first = formatHolidayDate(start);
  return !end || start === end ? first : `${first} – ${formatHolidayDate(end)}`;
}
