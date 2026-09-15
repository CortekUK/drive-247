/**
 * v2 Settings (northwind only): the pure state logic behind the Business-rules
 * pages: Driver requirements, Booking rules, Key handover (with its lockbox
 * messages) and the Return reminder panel.
 *
 * No React and no Supabase, so every edge case here is unit-tested by hand in
 * `__tests__/components/settings-business-rules-logic.test.ts`. The pages that
 * use it live in `business-rules-pages.tsx`.
 *
 * Copy rule: every message says what is wrong AND what to do, in the
 * operator's words. Nothing here silently clamps a value the operator typed:
 * it explains, and the page keeps Save disabled until it is fixed.
 */

type Rec = Record<string, any>;

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export const fmtNumber = (n: number) => numberFormat.format(n);
const plural = (n: number, word: string) => `${fmtNumber(n)} ${word}${n === 1 ? "" : "s"}`;

/* -------------------------------------------------------------------------- */
/* Driver requirements                                                        */
/* -------------------------------------------------------------------------- */

export const DRIVER_AGE_MIN = 16;
export const DRIVER_AGE_MAX = 99;

/** Blank means "no minimum age". Anything else must be a whole age in range. */
export function validateDriverAge(value: number | "" | null | undefined): string | null {
  if (value === "" || value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < DRIVER_AGE_MIN || value > DRIVER_AGE_MAX) {
    return `Enter an age between ${DRIVER_AGE_MIN} and ${DRIVER_AGE_MAX}, or leave it blank for no minimum.`;
  }
  return null;
}

export const DOCUMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "driving_license", label: "Driver's License" },
  { value: "passport", label: "Passport" },
  { value: "id_card", label: "ID Card" },
];

/**
 * The three known document types, plus the stored value when it is none of
 * them, so the Select shows what is saved instead of going blank.
 */
export function documentTypeOptions(current: string | null | undefined) {
  if (!current || DOCUMENT_TYPE_OPTIONS.some((o) => o.value === current)) return DOCUMENT_TYPE_OPTIONS;
  const words = current.replace(/[_-]+/g, " ").trim();
  const label = words ? words.charAt(0).toUpperCase() + words.slice(1) : current;
  return [...DOCUMENT_TYPE_OPTIONS, { value: current, label: `${label} (current)` }];
}

/* -------------------------------------------------------------------------- */
/* Booking rules: advance notice, duration limits, buffer                     */
/* -------------------------------------------------------------------------- */

export type LeadUnit = "hours" | "days";

/** 365 days. Past this a booking site cannot show a date anyway. */
export const LEAD_HOURS_MAX = 8760;
/** Ten years. */
export const RENTAL_DAYS_MAX = 3650;
/** Three days. The v1 input clamps silently at this value. */
export const BUFFER_MINUTES_MAX = 4320;

/** Hours are the stored truth; days are only how the number is shown. */
export function leadTimeHours(value: number, unit: LeadUnit): number {
  const v = Number.isFinite(value) ? value : 0;
  return unit === "days" ? Math.round(v * 24) : v;
}

/**
 * A notice stored as 36 hours with unit "days" loads as 1.5 days, which a
 * digits-only box cannot edit. Show it in hours instead; the value is the same.
 */
export function normalizeLoadedLead(value: number, unit: LeadUnit): { value: number; unit: LeadUnit } {
  if (unit === "days" && Number.isFinite(value) && !Number.isInteger(value)) {
    return { value: Math.round(value * 24), unit: "hours" };
  }
  return { value, unit };
}

/**
 * Switch the display unit without changing the notice. Hours to days only
 * happens when the hours are a whole number of days; otherwise it stays in
 * hours and says why (the old switch rounded 36 hours to 2 days, i.e. 48).
 */
export function switchLeadUnit(
  hours: number,
  to: LeadUnit,
): { value: number; unit: LeadUnit; blocked: string | null } {
  if (to === "hours") return { value: hours, unit: "hours", blocked: null };
  if (hours % 24 !== 0) {
    return {
      value: hours,
      unit: "hours",
      blocked: `${plural(hours, "hour")} isn't a whole number of days, so it stays in hours.`,
    };
  }
  return { value: hours / 24, unit: "days", blocked: null };
}

/** "= 1.5 days" beside a notice typed in hours, from 24 hours up. */
export function describeLeadHours(hours: number, unit: LeadUnit): string | null {
  if (unit !== "hours" || !Number.isFinite(hours) || hours < 24) return null;
  return `= ${plural(hours / 24, "day")}`;
}

export interface DurationValues {
  leadHours: number;
  minDays: number;
  minHours: number;
  maxDays: number;
  bufferMinutes: number;
}

export interface DurationErrors {
  lead?: string;
  min?: string;
  max?: string;
  buffer?: string;
}

export function validateDuration(v: DurationValues): DurationErrors {
  const errors: DurationErrors = {};
  const minDays = v.minDays || 0;
  const minHours = v.minHours || 0;
  const minTotal = minDays * 24 + minHours;

  if (!(v.leadHours >= 1)) errors.lead = "Must be at least 1 hour.";
  else if (v.leadHours > LEAD_HOURS_MAX) errors.lead = "Keep this to 365 days (8,760 hours) or less.";

  if (minHours > 23) errors.min = "Hours must be 0–23. Put whole days in the days box.";
  else if (minDays > RENTAL_DAYS_MAX) errors.min = "Keep this to 3,650 days (10 years) or less.";
  else if (minTotal < 1) errors.min = "Must be at least 1 hour.";

  if (!(v.maxDays >= 1)) errors.max = "Enter the longest rental, in days.";
  else if (v.maxDays > RENTAL_DAYS_MAX) errors.max = "Keep this to 3,650 days (10 years) or less.";
  else if (!errors.min && minTotal > v.maxDays * 24) errors.max = "The shortest rental is longer than the longest.";

  if ((v.bufferMinutes || 0) > BUFFER_MINUTES_MAX) errors.buffer = "Keep this to 4,320 minutes (3 days) or less.";

  return errors;
}

export const hasErrors = (errors: object) => Object.values(errors).some(Boolean);

/** 4 -> "4 hours", 24 -> "1 day", 30 -> "1 day 6 hours". */
export function describeHours(total: number): string {
  const days = Math.floor(total / 24);
  const hours = total % 24;
  if (days === 0) return plural(hours, "hour");
  return hours === 0 ? plural(days, "day") : `${plural(days, "day")} ${plural(hours, "hour")}`;
}

export function describeDurationRange(minTotalHours: number, maxDays: number): string {
  return `Customers can book from ${describeHours(minTotalHours)} up to ${plural(maxDays, "day")}.`;
}

/** 90 -> "1h 30m", 45 -> "45m", 0 -> "". */
export function describeBuffer(minutes: number): string {
  const m = Math.max(0, minutes || 0);
  return [Math.floor(m / 60) > 0 ? `${Math.floor(m / 60)}h` : "", m % 60 > 0 ? `${m % 60}m` : ""]
    .filter(Boolean)
    .join(" ");
}

/* -------------------------------------------------------------------------- */
/* Key handover (lockbox)                                                     */
/* -------------------------------------------------------------------------- */

export const CODE_LENGTH_MIN = 1;
export const CODE_LENGTH_MAX = 20;

/** Blank means "any length". 0, negatives and 21+ are refused. */
export function validateCodeLength(value: number | "" | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!Number.isInteger(value) || value < CODE_LENGTH_MIN || value > CODE_LENGTH_MAX) {
    return `Enter ${CODE_LENGTH_MIN}–${CODE_LENGTH_MAX} digits, or leave it blank for any length.`;
  }
  return null;
}

export interface LockboxMethodStatus {
  /** The method the radio shows (the first saved one; email when none). */
  method: string;
  /** Other methods still in a legacy multi-method array. */
  extraSaved: string[];
  /** Set when the chosen method cannot deliver the code as the operator expects. */
  warning: { title: string; body: string; needsTwilio: boolean } | null;
}

/**
 * What actually happens to a code, given the saved method and whether Twilio
 * SMS is connected. `notify-lockbox-code` no longer sends WhatsApp and falls
 * back to email when no requested channel can run; an SMS leg with a phone
 * number but no Twilio simply fails, so that one is a real risk.
 */
export function lockboxMethodStatus(
  methods: string[] | null | undefined,
  { smsReady }: { smsReady: boolean },
): LockboxMethodStatus {
  const list = Array.isArray(methods) ? methods.filter((m) => typeof m === "string" && m) : [];
  const method = list[0] || "email";
  const extraSaved = Array.from(new Set(list.slice(1))).filter((m) => m !== method);

  let warning: LockboxMethodStatus["warning"] = null;
  if (method === "whatsapp") {
    warning = {
      title: "WhatsApp codes aren't sent any more",
      body: "Customers get their code by email instead. Choose Email or Text message and save.",
      needsTwilio: false,
    };
  } else if (method === "sms" && !smsReady) {
    warning = {
      title: "Text messages aren't set up",
      body: "Codes can't be texted until Twilio is connected, so a customer could miss theirs. Connect Twilio, or choose Email and save.",
      needsTwilio: true,
    };
  } else if (method !== "email" && method !== "sms") {
    warning = {
      title: `We can't send codes by "${method}"`,
      body: "Choose Email or Text message and save.",
      needsTwilio: false,
    };
  }
  return { method, extraSaved, warning };
}

export const SEND_OFFSET_PRESETS = [0, 5, 15, 30, 60, 120];

/** 0 -> "Straight away", 60 -> "1 hour after", 90 -> "1 hour 30 minutes after". */
export function describeOffset(minutes: number): string {
  if (!(minutes > 0)) return "Straight away";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${[h ? plural(h, "hour") : "", m ? plural(m, "minute") : ""].filter(Boolean).join(" ")} after`;
}

/** The preset list, plus a stored offset that is not one of them, so the Select never goes blank. */
export function sendOffsetOptions(current: number | null | undefined) {
  const base = [
    { value: "manual", label: "No, I send it myself" },
    ...SEND_OFFSET_PRESETS.map((m) => ({ value: String(m), label: describeOffset(m) })),
  ];
  if (current === null || current === undefined || !Number.isFinite(current) || SEND_OFFSET_PRESETS.includes(current)) {
    return base;
  }
  return [...base, { value: String(current), label: `${describeOffset(current)} (current)` }];
}

/* -------------------------------------------------------------------------- */
/* Return reminder                                                            */
/* -------------------------------------------------------------------------- */

export const REMINDER_HOURS_MIN = 1;
export const REMINDER_HOURS_MAX = 168;

/**
 * Applied on blur, never while typing (the old input snapped a cleared field
 * back to 24 mid-edit). `fallback` is the value kept for a blank field.
 */
export function clampReminderHours(raw: string, fallback: number): { value: number; note: string | null } {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return { value: fallback, note: `Enter 1–168 hours. Kept ${plural(fallback, "hour")}.` };
  const n = parseInt(digits, 10);
  if (n < REMINDER_HOURS_MIN) {
    return { value: REMINDER_HOURS_MIN, note: "Reminders go out at least 1 hour before return, so this is now 1." };
  }
  if (n > REMINDER_HOURS_MAX) {
    return { value: REMINDER_HOURS_MAX, note: "Reminders go out at most 168 hours (7 days) before return, so this is now 168." };
  }
  return { value: n, note: null };
}

/** 24 -> "1 day", 30 -> "1 day 6 hours", 5 -> "5 hours". */
export function describeReminderLead(hours: number): string {
  return describeHours(Math.max(0, Math.round(hours || 0)));
}

/* -------------------------------------------------------------------------- */
/* Dirty tracking and Discard, per page                                       */
/* -------------------------------------------------------------------------- */

export type BusinessPage = "requirements" | "duration" | "lockbox" | "return-reminder";

/**
 * The saved values for one page, in the page form's shape. Mirrors the sync
 * effect in settings/page.tsx, so Discard puts back exactly what a reload shows.
 */
export function savedFieldsFor(page: BusinessPage, saved: Rec | null | undefined): Rec {
  const s = saved ?? {};
  switch (page) {
    case "requirements":
      return {
        minimum_rental_age: s.minimum_rental_age || "",
        verification_document_type: s.verification_document_type ?? "driving_license",
      };
    case "duration": {
      const unit: LeadUnit = s.booking_lead_time_unit ?? "hours";
      return {
        booking_lead_time_unit: unit,
        booking_lead_time_value:
          unit === "days" && s.booking_lead_time_hours ? s.booking_lead_time_hours / 24 : s.booking_lead_time_hours ?? 24,
        min_rental_days: s.min_rental_days ?? 0,
        min_rental_hours: s.min_rental_hours ?? 1,
        max_rental_days: s.max_rental_days ?? 90,
        buffer_time_minutes: s.buffer_time_minutes ?? 0,
      };
    }
    case "lockbox":
      return {
        lockbox_enabled: s.lockbox_enabled ?? false,
        lockbox_code_length: s.lockbox_code_length ?? null,
        lockbox_notification_methods: Array.isArray(s.lockbox_notification_methods) ? s.lockbox_notification_methods : ["email"],
        lockbox_send_offset_minutes: s.lockbox_send_offset_minutes ?? null,
      };
    case "return-reminder":
      return {
        return_reminder_enabled: s.return_reminder_enabled ?? false,
        return_reminder_hours: s.return_reminder_hours ?? 24,
      };
  }
}

/**
 * Whether one page has unsaved edits. Unlike the page-wide `rentalFormDirty`,
 * this includes advance notice, the lockbox delivery method and auto-send
 * timing, which that flag misses.
 */
export function businessPageDirty(page: BusinessPage, form: Rec, saved: Rec | null | undefined): boolean {
  if (!saved || !form) return false;
  switch (page) {
    case "requirements":
      return (
        (form.minimum_rental_age || null) !== (saved.minimum_rental_age || null) ||
        form.verification_document_type !== (saved.verification_document_type ?? "driving_license")
      );
    case "duration": {
      const savedHours = saved.booking_lead_time_hours ?? 24;
      const savedUnit = saved.booking_lead_time_unit ?? "hours";
      const hours = leadTimeHours(form.booking_lead_time_value, form.booking_lead_time_unit);
      // A stored 36 hours in "days" is shown in hours (normalizeLoadedLead):
      // that display change alone is not an edit.
      const unitComparable = !(savedUnit === "days" && savedHours % 24 !== 0);
      return (
        hours !== savedHours ||
        (unitComparable && form.booking_lead_time_unit !== savedUnit) ||
        form.min_rental_days !== (saved.min_rental_days ?? 0) ||
        form.min_rental_hours !== (saved.min_rental_hours ?? 1) ||
        form.max_rental_days !== (saved.max_rental_days ?? 90) ||
        form.buffer_time_minutes !== (saved.buffer_time_minutes ?? 0)
      );
    }
    case "lockbox": {
      const savedMethods = Array.isArray(saved.lockbox_notification_methods) ? saved.lockbox_notification_methods : ["email"];
      const formMethods = Array.isArray(form.lockbox_notification_methods) ? form.lockbox_notification_methods : ["email"];
      return (
        form.lockbox_enabled !== (saved.lockbox_enabled ?? false) ||
        (form.lockbox_code_length ?? null) !== (saved.lockbox_code_length ?? null) ||
        (formMethods[0] || "email") !== (savedMethods[0] || "email") ||
        (form.lockbox_send_offset_minutes ?? null) !== (saved.lockbox_send_offset_minutes ?? null)
      );
    }
    case "return-reminder":
      return (
        form.return_reminder_enabled !== (saved.return_reminder_enabled ?? false) ||
        form.return_reminder_hours !== (saved.return_reminder_hours ?? 24)
      );
  }
}
