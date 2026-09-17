/**
 * v2 Settings (northwind): the state rules behind the Installments, Pay As You
 * Go, Auto-extend, Promo Codes and Extras sections. Pure functions, so the
 * sections stay thin and the rules are tested on their own.
 *
 * NOTHING HERE CHANGES A SAVED VALUE. These functions decide what to SHOW (an
 * inline error, a warning, a dirty marker) and whether a write should be
 * attempted at all. When a value is valid, the section saves exactly what it
 * saved before.
 */

import { parseLocalDate } from "@/lib/date-utils";
import { isStripeConnectUsable, type StripeConnectTenant } from "@/lib/stripe-connect-status";

/* -------------------------------------------------------------------------- */
/* Whole numbers in a range (Auto-extend timing and retries)                  */
/* -------------------------------------------------------------------------- */

export const AUTO_EXTEND_NUMBER_FIELDS = {
  auto_extend_default_lead_hours: { label: "Charge lead time", min: 0, max: 168, unit: "hours", fallback: 0 },
  auto_extend_grace_hours: { label: "Grace window", min: 0, max: 720, unit: "hours", fallback: 48 },
  auto_extend_max_retries: { label: "Retries", min: 0, max: 20, unit: "retries", fallback: 3 },
} as const;

export type AutoExtendNumberKey = keyof typeof AUTO_EXTEND_NUMBER_FIELDS;

export type WholeNumberCheck = { ok: true; value: number } | { ok: false; message: string };

/**
 * A typed whole number inside [min, max]. An empty field, a minus sign, a
 * decimal or an exponent is rejected rather than coerced: `Number('')` is 0, so
 * a cleared "grace window" used to save a 0-hour window.
 */
export function checkWholeNumber(raw: string, min: number, max: number, unit: string): WholeNumberCheck {
  const text = raw.trim();
  const message = `Enter ${min}–${max} ${unit}`;
  if (!/^\d+$/.test(text)) return { ok: false, message };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) return { ok: false, message };
  return { ok: true, value };
}

/* -------------------------------------------------------------------------- */
/* Payment provider (Installments, Auto-extend auto-charge)                   */
/* -------------------------------------------------------------------------- */

export type PaymentProviderState = "connected" | "missing" | "unknown";

/**
 * Stripe is judged by the same rule the New Rental gate uses. A Square tenant
 * keeps its connection in a separate table this row does not carry, so it is
 * "unknown" and no warning is shown: a false "not connected" is worse than none.
 */
export function paymentProviderState(
  tenant: (StripeConnectTenant & { payment_provider?: string | null }) | null | undefined,
): PaymentProviderState {
  if (!tenant) return "unknown";
  if (tenant.payment_provider && tenant.payment_provider !== "stripe") return "unknown";
  return isStripeConnectUsable(tenant) ? "connected" : "missing";
}

/* -------------------------------------------------------------------------- */
/* Installments                                                                */
/* -------------------------------------------------------------------------- */

export interface InstallmentPlanDraft {
  weekly_enabled: boolean;
  weekly_payments_per_unit: 1 | 2;
  monthly_enabled: boolean;
  monthly_payments_per_unit: 1 | 2 | 4;
}

type InstallmentConfigLike = Partial<InstallmentPlanDraft> & Record<string, unknown>;

/** The four plan fields the Installments section edits, with its own defaults. */
export function installmentDraftFromConfig(cfg: InstallmentConfigLike | null | undefined): InstallmentPlanDraft {
  return {
    weekly_enabled: (cfg?.weekly_enabled as boolean | undefined) ?? false,
    weekly_payments_per_unit: ((cfg?.weekly_payments_per_unit as number | undefined) ?? 1) as 1 | 2,
    monthly_enabled: (cfg?.monthly_enabled as boolean | undefined) ?? false,
    monthly_payments_per_unit: ((cfg?.monthly_payments_per_unit as number | undefined) ?? 1) as 1 | 2 | 4,
  };
}

export function isInstallmentDraftDirty(
  draft: InstallmentPlanDraft,
  cfg: InstallmentConfigLike | null | undefined,
): boolean {
  const saved = installmentDraftFromConfig(cfg);
  return (
    draft.weekly_enabled !== saved.weekly_enabled ||
    draft.weekly_payments_per_unit !== saved.weekly_payments_per_unit ||
    draft.monthly_enabled !== saved.monthly_enabled ||
    draft.monthly_payments_per_unit !== saved.monthly_payments_per_unit
  );
}

const PLAN_DEFAULT_MINIMUM_DAYS = { weekly: 7, monthly: 30 } as const;

/** A saved `minimum_days_*` (or old `min_days_for_*`) value, else the plan's default. */
function savedPlanMinimum(cfg: InstallmentConfigLike | null | undefined, plan: "weekly" | "monthly"): number {
  const current = cfg?.[`minimum_days_${plan}`];
  const legacy = cfg?.[`min_days_for_${plan}`];
  const value = typeof current === "number" ? current : typeof legacy === "number" ? legacy : NaN;
  return Number.isFinite(value) && value >= 0 ? value : PLAN_DEFAULT_MINIMUM_DAYS[plan];
}

/**
 * The cadence shape (weekly/monthly toggles and payments per unit) that this
 * section writes on every save, as opposed to the older count-cap shape. Same
 * test as New Rental (rental-create-v2) and checkout (InstallmentSelector).
 */
export function isCadenceInstallmentConfig(cfg: InstallmentConfigLike | null | undefined): boolean {
  return (
    cfg?.weekly_enabled !== undefined ||
    cfg?.monthly_enabled !== undefined ||
    cfg?.weekly_payments_per_unit !== undefined ||
    cfg?.monthly_payments_per_unit !== undefined
  );
}

/**
 * The shortest rental a plan is offered on, as New Rental and checkout decide
 * it. For the cadence shape both hard-code 7 and 30 days and ignore the saved
 * `minimum_days_*`; only the older shape reads them.
 */
export function planMinimumDays(cfg: InstallmentConfigLike | null | undefined, plan: "weekly" | "monthly"): number {
  return isCadenceInstallmentConfig(cfg) ? PLAN_DEFAULT_MINIMUM_DAYS[plan] : savedPlanMinimum(cfg, plan);
}

/**
 * The same, for online checkout. The booking site shows its installment options
 * only when the rental reaches the SMALLER of the two saved minimums, so a saved
 * minimum above 7 days can push a plan later online than in New Rental.
 */
export function planOnlineMinimumDays(cfg: InstallmentConfigLike | null | undefined, plan: "weekly" | "monthly"): number {
  const sectionGate = Math.min(savedPlanMinimum(cfg, "weekly"), savedPlanMinimum(cfg, "monthly"));
  return Math.max(planMinimumDays(cfg, plan), sectionGate);
}

/* -------------------------------------------------------------------------- */
/* Promo codes                                                                 */
/* -------------------------------------------------------------------------- */

export interface PromoDraftLike {
  name: string;
  type: string;
  value: string;
  created_at: Date | null | undefined;
  expires_at: Date | null | undefined;
  max_users: string;
}

export type PromoField = "name" | "value" | "max_users" | "expires_at";

export interface PromoIssue {
  message: string;
  /** `missing` issues wait for a submit; `invalid` ones show as soon as typed. */
  kind: "missing" | "invalid";
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function validatePromoDraft(
  draft: PromoDraftLike,
  today: Date = new Date(),
): Partial<Record<PromoField, PromoIssue>> {
  const issues: Partial<Record<PromoField, PromoIssue>> = {};

  if (!draft.name.trim()) issues.name = { kind: "missing", message: "Enter a name" };

  const value = draft.value.trim();
  if (!value) {
    issues.value = { kind: "missing", message: "Enter a discount" };
  } else if (!/^(\d+(\.\d+)?|\.\d+)$/.test(value)) {
    issues.value = { kind: "invalid", message: "Enter a number, like 10 or 12.50" };
  } else if (Number(value) <= 0) {
    issues.value = { kind: "invalid", message: "The discount must be more than 0" };
  } else if (draft.type === "percentage" && Number(value) > 100) {
    issues.value = { kind: "invalid", message: "A percentage discount can't exceed 100%" };
  }

  const maxUsers = draft.max_users.trim();
  if (!maxUsers) {
    issues.max_users = { kind: "missing", message: "Enter how many times this code can be used" };
  } else if (!/^\d+$/.test(maxUsers) || Number(maxUsers) < 1) {
    issues.max_users = { kind: "invalid", message: "Enter at least 1" };
  }

  if (draft.expires_at) {
    if (draft.created_at && startOfDay(draft.expires_at) < startOfDay(draft.created_at)) {
      issues.expires_at = { kind: "invalid", message: "Expiry must be on or after the start date" };
    } else if (startOfDay(draft.expires_at) < startOfDay(today)) {
      issues.expires_at = { kind: "invalid", message: "This code would already be expired" };
    }
  }

  return issues;
}

/**
 * The Edit dialog's checks: the create form's rules over a saved row. The
 * dialog cannot change the start date, and an expiry left as it was saved is
 * not judged again, so renaming a code that has already expired does not first
 * demand a new date. A NEW expiry in the past is still refused.
 */
export function validatePromoEdit(
  draft: { name?: unknown; type?: unknown; value?: unknown; max_users?: unknown; created_at?: unknown; expires_at?: unknown },
  saved: { expires_at?: string | null } | null | undefined,
  today: Date = new Date(),
): Partial<Record<PromoField, PromoIssue>> {
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const expires = draft.expires_at instanceof Date && !Number.isNaN(draft.expires_at.getTime()) ? draft.expires_at : null;
  const created = typeof draft.created_at === "string" ? parseLocalDate(draft.created_at) : null;
  const issues = validatePromoDraft(
    {
      name: text(draft.name),
      type: text(draft.type),
      value: text(draft.value),
      created_at: created && !Number.isNaN(created.getTime()) ? created : null,
      expires_at: expires,
      max_users: text(draft.max_users),
    },
    today,
  );
  if (issues.expires_at && expires && saved?.expires_at) {
    const savedExpiry = parseLocalDate(saved.expires_at);
    if (!Number.isNaN(savedExpiry.getTime()) && startOfDay(savedExpiry) === startOfDay(expires)) delete issues.expires_at;
  }
  return issues;
}

/** Issues to show now: `invalid` always, `missing` only after a submit attempt. */
export function visiblePromoIssues(
  issues: Partial<Record<PromoField, PromoIssue>>,
  submitted: boolean,
): Partial<Record<PromoField, string>> {
  const shown: Partial<Record<PromoField, string>> = {};
  for (const [field, issue] of Object.entries(issues) as [PromoField, PromoIssue][]) {
    if (issue.kind === "invalid" || submitted) shown[field] = issue.message;
  }
  return shown;
}

/**
 * A promo insert or update refused because another code already uses it.
 * Postgres names the key in `details` ("Key (code, tenant_id)=(...) already
 * exists") and the constraint in `message` ("promocodes_code_tenant_key").
 * The generic duplicate copy talks about a name, which is wrong here.
 */
export function isDuplicatePromoCodeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message, details } = error as { code?: unknown; message?: unknown; details?: unknown };
  if (String(code ?? "") !== "23505") return false;
  return /_code(_|")/i.test(String(message ?? "")) || /\(code\b/i.test(String(details ?? ""));
}

export const PROMO_CODE_TAKEN_COPY = "That code is already in use. Generate a new one or type a different code.";

/** The error a promo form shows: the code-specific copy for a taken code. */
export function promoSaveError(error: unknown): unknown {
  return isDuplicatePromoCodeError(error) ? { message: PROMO_CODE_TAKEN_COPY } : error;
}

/** A stored `yyyy-MM-dd` expiry before today's local calendar day. */
export function isPromoExpired(expiresAt: string | null | undefined, today: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const date = parseLocalDate(expiresAt);
  if (Number.isNaN(date.getTime())) return false;
  return startOfDay(date) < startOfDay(today);
}

/* -------------------------------------------------------------------------- */
/* Extras                                                                      */
/* -------------------------------------------------------------------------- */

export interface ExtraFormLike {
  name: string;
  price: string;
  pricing_type: "global" | "per_vehicle";
  vehicle_pricing: { price: string }[];
  image_urls: string[];
  is_quantity_based: boolean;
  max_quantity: string;
}

export type ExtraField = "name" | "price" | "vehicle_pricing" | "images" | "max_quantity";

/**
 * Every problem at once, one per field. The price rules are v1's own
 * (`parseFloat`, not negative), so nothing that saved before is now refused.
 */
export function getExtraFormIssues(form: ExtraFormLike): Partial<Record<ExtraField, string>> {
  const issues: Partial<Record<ExtraField, string>> = {};
  if (!form.name.trim()) issues.name = "Enter a name";
  if (form.pricing_type === "global") {
    const price = parseFloat(form.price);
    if (Number.isNaN(price) || price < 0) issues.price = "Enter a price of 0 or more";
  } else if (form.vehicle_pricing.length === 0) {
    issues.vehicle_pricing = "Add at least one vehicle and its price";
  } else if (form.vehicle_pricing.some((vp) => Number.isNaN(parseFloat(vp.price)) || parseFloat(vp.price) < 0)) {
    issues.vehicle_pricing = "Every vehicle needs a price of 0 or more";
  }
  if (form.image_urls.length === 0) issues.images = "Add at least one image. Customers see it when they book.";
  if (form.is_quantity_based && !(/^\d+$/.test(form.max_quantity.trim()) && Number(form.max_quantity) >= 1)) {
    issues.max_quantity = "Enter a stock of at least 1";
  }
  return issues;
}

/** "Baby seat is below 20% stock." / "Baby seat, GPS and 2 more are below 20% stock." */
export function lowStockSentence(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is below 20% stock.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are below 20% stock.`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} more are below 20% stock.`;
}
