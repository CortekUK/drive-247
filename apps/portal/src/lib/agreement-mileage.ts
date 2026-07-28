/**
 * Canonical mileage resolution for rental agreements.
 *
 * WHY THIS EXISTS
 * An operator reported that his signed agreements did not state the mileage
 * limit shown on his website. The cause was not a wrong lookup — no agreement
 * template contained a mileage line at all, so the value computed at send time
 * was silently discarded. Adding the line exposed a second problem: the three
 * agreement engines each resolved mileage differently, and none of them read
 * the rental-level overrides.
 *
 * This module is the single source of truth. It is duplicated byte-for-byte to:
 *   apps/portal/src/lib/agreement-mileage.ts
 *   apps/booking/src/lib/agreement-mileage.ts
 *   supabase/functions/_shared/agreement-mileage.ts
 * (three separate build roots with different aliases; a real shared package is
 * the right long-term answer, but the copies must stay identical — there is a
 * `diff` gate for this in CI notes.)
 *
 * THE SAFETY RULE THAT MATTERS MOST
 * When no allowance is configured we render "Not specified", NEVER "Unlimited".
 * The previous code returned the literal string "Unlimited" for an unconfigured
 * vehicle. Printing that into a document the customer signs would contractually
 * grant unlimited mileage to every renter of every tenant who had not filled in
 * the field — turning a missing-data problem into a money problem. "Unlimited"
 * is only ever produced by an explicit is_unlimited_mileage flag.
 */

export type MileageTier = "daily" | "weekly" | "monthly";

export interface AgreementMileageRental {
  start_date?: string | null;
  end_date?: string | null;
  is_unlimited_mileage?: boolean | null;
  daily_mileage_override?: number | null;
  weekly_mileage_override?: number | null;
  monthly_mileage_override?: number | null;
  excess_mileage_rate_override?: number | null;
}

export interface AgreementMileageVehicle {
  daily_mileage?: number | null;
  weekly_mileage?: number | null;
  monthly_mileage?: number | null;
  excess_mileage_rate?: number | null;
}

export interface AgreementMileage {
  /** Human string for the agreement, e.g. "1,800 miles (60 per day x 30 days)". */
  allowance: string;
  /** Human string, e.g. "$0.50 per additional mile" (currency/unit per tenant). */
  excessRate: string;
  /** True only when the operator explicitly marked the rental unlimited. */
  isUnlimited: boolean;
  /** True when nothing is configured — the agreement should say so plainly. */
  isUnspecified: boolean;
  /** Resolved per-period allowance, or null. Exposed for tests/UI. */
  perUnit: number | null;
  tier: MileageTier;
}

const NOT_SPECIFIED = "Not specified";

/** Parse a yyyy-mm-dd date without timezone drift. */
function parseLocalDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Which pricing tier this rental bills on. Mirrors the tier logic used for
 * pricing so the agreement cannot state a weekly allowance for a rental the
 * customer was charged a monthly rate for.
 */
export function resolveMileageTier(
  rental: AgreementMileageRental | null | undefined,
  monthlyTierDays: number,
): { tier: MileageTier; days: number | null } {
  const mtd = monthlyTierDays > 0 ? monthlyTierDays : 30;
  if (!rental?.start_date || !rental?.end_date) {
    // Open-ended (PAYG / rolling). There is no total to compute; such rentals
    // are billed and accrue allowance per period. Monthly is the usual unit.
    return { tier: "monthly", days: null };
  }
  const ms =
    parseLocalDate(rental.end_date).getTime() -
    parseLocalDate(rental.start_date).getTime();
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  const tier: MileageTier = days >= mtd ? "monthly" : days >= 7 ? "weekly" : "daily";
  return { tier, days };
}

/**
 * Resolve the allowance and excess rate to print on the agreement.
 *
 * Precedence, per tier:
 *   1. rental.is_unlimited_mileage === true  -> "Unlimited"
 *   2. rental.<tier>_mileage_override        (operator set it for THIS rental)
 *   3. vehicle.<tier>_mileage                (the vehicle default)
 *   4. nothing                               -> "Not specified"
 */
export interface AgreementMileageOptions {
  monthlyTierDays?: number;
  /** ISO code from tenants.currency_code. The excess rate is a MONEY TERM in a
   *  signed contract — hardcoding "$" would state dollars to a GBP tenant. */
  currencyCode?: string;
  /** tenants.distance_unit ('miles' | 'km'). Same reasoning. */
  distanceUnit?: string;
}

export function resolveAgreementMileage(
  rental: AgreementMileageRental | null | undefined,
  vehicle: AgreementMileageVehicle | null | undefined,
  options: AgreementMileageOptions | number = {},
): AgreementMileage {
  // Back-compat: earlier callers passed monthlyTierDays positionally.
  const opts: AgreementMileageOptions =
    typeof options === "number" ? { monthlyTierDays: options } : options || {};
  const monthlyTierDays = opts.monthlyTierDays ?? 30;
  const currencyCode = (opts.currencyCode || "USD").toUpperCase();
  const unitPlural = opts.distanceUnit === "km" ? "km" : "miles";
  const unitSingular = opts.distanceUnit === "km" ? "km" : "mile";
  const money = (n: number) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(n);
    } catch {
      // Unknown/invalid ISO code — state the code rather than an arbitrary symbol.
      return `${n.toFixed(2)} ${currencyCode}`;
    }
  };
  const { tier, days } = resolveMileageTier(rental, monthlyTierDays);
  const unitWord = tier === "daily" ? "day" : tier === "weekly" ? "week" : "month";

  const excessRaw =
    rental?.excess_mileage_rate_override ?? vehicle?.excess_mileage_rate ?? null;
  const excessRate =
    excessRaw != null && Number.isFinite(Number(excessRaw))
      ? `${money(Number(excessRaw))} per additional ${unitSingular}`
      : NOT_SPECIFIED;

  // 1. Explicit unlimited always wins, and is the ONLY route to "Unlimited".
  if (rental?.is_unlimited_mileage === true) {
    return {
      allowance: "Unlimited",
      // An unlimited rental cannot incur excess mileage, so quoting a rate
      // would be contradictory.
      excessRate: "Not applicable (unlimited mileage)",
      isUnlimited: true,
      isUnspecified: false,
      perUnit: null,
      tier,
    };
  }

  // 2/3. Override for this rental, else the vehicle default.
  const overrideByTier =
    tier === "daily"
      ? rental?.daily_mileage_override
      : tier === "weekly"
        ? rental?.weekly_mileage_override
        : rental?.monthly_mileage_override;
  const vehicleByTier =
    tier === "daily"
      ? vehicle?.daily_mileage
      : tier === "weekly"
        ? vehicle?.weekly_mileage
        : vehicle?.monthly_mileage;

  const perUnitRaw = overrideByTier ?? vehicleByTier ?? null;
  const perUnit =
    perUnitRaw != null && Number.isFinite(Number(perUnitRaw)) && Number(perUnitRaw) > 0
      ? Number(perUnitRaw)
      : null;

  // 4. Nothing configured. Say so — do NOT imply unlimited.
  if (perUnit == null) {
    return {
      allowance: NOT_SPECIFIED,
      excessRate,
      isUnlimited: false,
      isUnspecified: true,
      perUnit: null,
      tier,
    };
  }

  // Open-ended rental: no total exists, state the recurring allowance.
  if (days == null) {
    return {
      allowance: `${formatInt(perUnit)} ${unitPlural} per ${unitWord} (open-ended rental — allowance accrues each ${unitWord})`,
      excessRate,
      isUnlimited: false,
      isUnspecified: false,
      perUnit,
      tier,
    };
  }

  // Fixed term: pro-rata the per-period allowance across the rental, and show
  // the working so the customer can check it.
  const mtd = monthlyTierDays > 0 ? monthlyTierDays : 30;
  const total =
    tier === "daily"
      ? perUnit * days
      : tier === "weekly"
        ? (perUnit / 7) * days
        : (perUnit / mtd) * days;

  const dayWord = days === 1 ? "day" : "days";
  return {
    allowance: `${formatInt(total)} ${unitPlural} total (${formatInt(perUnit)} per ${unitWord} over ${days} ${dayWord})`,
    excessRate,
    isUnlimited: false,
    isUnspecified: false,
    perUnit,
    tier,
  };
}
