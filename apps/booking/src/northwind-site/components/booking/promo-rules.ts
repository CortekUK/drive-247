/**
 * The rules a promo code must pass before the v2 booking site honours it,
 * shared by the typed-code check (`use-promo-code`) and the automatic
 * long-rental discount (`use-duration-discount`). Pure: no React, no client.
 */

export interface PromoRuleRow {
  code: string;
  expires_at: string | null;
  max_users: number | null;
  is_active?: boolean | null;
  min_duration_days?: number | null;
  max_duration_days?: number | null;
}

/**
 * Today as `YYYY-MM-DD` on the operator's clock.
 *
 * `expires_at` is a calendar date and the portal treats a code as live through
 * that whole day. Comparing `new Date("2026-11-11")` (UTC midnight) with now
 * ended it at 7 PM the evening BEFORE for a New York operator, so a code the
 * portal listed as active was refused as expired on its last day.
 */
export function todayIsoIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}

/** Expired only once its expiry DAY has passed on the operator's clock. */
export function isPromoExpiredOn(expiresAt: string | null | undefined, todayIso: string): boolean {
  if (!expiresAt) return false;
  return expiresAt.slice(0, 10) < todayIso;
}

/** Turned off in the portal. Rows written before the flag existed are on. */
export function isPromoOff(row: Pick<PromoRuleRow, "is_active">): boolean {
  return row.is_active === false;
}

/** At or past its use limit. A missing or zero limit means unlimited. */
export function isPromoUsedUp(row: Pick<PromoRuleRow, "max_users">, uses: number | null): boolean {
  if (!row.max_users || row.max_users <= 0 || uses === null) return false;
  return uses >= row.max_users;
}

/** Whether a long-rental tier covers a rental of `days`. */
export function durationTierCovers(row: PromoRuleRow, days: number): boolean {
  const min = row.min_duration_days ?? 0;
  if (min <= 0 || days < min) return false;
  if (row.max_duration_days != null && days > row.max_duration_days) return false;
  return true;
}

/** Whole calendar days between two `YYYY-MM-DD` dates — the pricing engine's day count. */
export function calendarDaysBetween(startIso: string, endIso: string): number {
  const a = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${endIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 86_400_000);
}
