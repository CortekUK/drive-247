/**
 * Promo codes and long-rental discounts on a portal rental (QA P8.4, P8.8).
 *
 * New Rental must price a rental the way the booking page does, and the booking
 * page takes a typed promo code off the rental and, with no code, applies the
 * longest qualifying long-rental discount by itself (P4.13/P4.14). These are
 * the same rules as the v2 booking site
 * (apps/booking/src/northwind-site/components/booking/promo-rules.ts,
 * use-promo-code.ts, use-duration-discount.ts): a code is live through its
 * expiry DAY on the operator's clock, an off code or one at its use limit is
 * refused, a long-rental code cannot be typed, and a typed code replaces the
 * long-rental discount (they never stack). The discount comes off the rental
 * only; tax and the service fee are worked out on what is left.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RentalPromo = {
  code: string;
  type: "percentage" | "fixed_amount";
  value: number;
  /** "code" = typed by staff; "duration" = the long-rental discount. */
  source: "code" | "duration";
  minDays?: number | null;
};

type PromoRow = {
  id: string;
  code: string;
  type: string;
  value: number | string;
  expires_at: string | null;
  max_users: number | null;
  is_active: boolean | null;
  min_duration_days: number | null;
  max_duration_days: number | null;
};

const SELECT = "id, code, type, value, expires_at, max_users, is_active, min_duration_days, max_duration_days";

/** Today as YYYY-MM-DD on the operator's clock. */
export function todayIsoIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}

export function calendarDaysBetween(startIso: string, endIso: string): number {
  const a = Date.parse(`${startIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${endIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 86_400_000);
}

const toCents = (n: number) => (Number.isFinite(n) ? Math.round(Number((n * 100).toPrecision(12))) / 100 : 0);

/** The discount on a rental price: a fixed amount never takes it below zero. */
export function promoDiscount(promo: RentalPromo | null, rentalPrice: number): number {
  if (!promo || rentalPrice <= 0) return 0;
  if (promo.type === "fixed_amount") return toCents(Math.min(promo.value, rentalPrice));
  return toCents((rentalPrice * promo.value) / 100);
}

const toPromo = (row: PromoRow, source: RentalPromo["source"]): RentalPromo => ({
  code: row.code,
  type: row.type === "value" || row.type === "fixed_amount" ? "fixed_amount" : "percentage",
  value: Number(row.value) || 0,
  source,
  minDays: row.min_duration_days,
});

async function usedUp(tenantId: string, row: PromoRow): Promise<boolean> {
  if (!row.max_users || row.max_users <= 0) return false;
  const { data, error } = await (supabase as any).rpc("promo_code_use_count", { p_tenant_id: tenantId, p_code: row.code });
  if (error || typeof data !== "number") return false; // a failed count does not block, as on the site
  return data >= row.max_users;
}

/** Check a code typed by staff. Same answers, same words, as the booking page. */
export async function checkTypedCode(
  tenantId: string,
  timeZone: string | null | undefined,
  raw: string
): Promise<{ promo: RentalPromo | null; error: string | null }> {
  const code = raw.trim();
  if (!code) return { promo: null, error: "Enter a promo code first." };
  const { data, error } = await (supabase as any)
    .from("promocodes")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .ilike("code", code.replace(/[\\%_]/g, (m) => `\\${m}`))
    .maybeSingle();
  if (error) return { promo: null, error: "We could not check that code. Please try again." };
  const row = data as PromoRow | null;
  if (!row) return { promo: null, error: "That promo code is not valid." };
  if ((row.min_duration_days ?? 0) > 0)
    return { promo: null, error: "That discount is applied automatically based on how long the rental is — no code needed." };
  if (row.is_active === false) return { promo: null, error: "That promo code is not available any more." };
  if (row.expires_at && row.expires_at.slice(0, 10) < todayIsoIn(timeZone)) return { promo: null, error: "That promo code has expired." };
  if (await usedUp(tenantId, row)) return { promo: null, error: "That promo code has been used the maximum number of times." };
  return { promo: toPromo(row, "code"), error: null };
}

/** The code already on the rental, if it is a typed one (a long-rental code is re-worked out each time). */
export function useStoredTypedCode(tenantId: string | undefined, code: string | null | undefined) {
  return useQuery({
    queryKey: ["rental-promo-stored", tenantId, code ?? null],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async (): Promise<RentalPromo | null> => {
      if (!code) return null;
      const { data } = await (supabase as any).from("promocodes").select(SELECT).eq("tenant_id", tenantId).eq("code", code).maybeSingle();
      const row = data as PromoRow | null;
      if (!row || (row.min_duration_days ?? 0) > 0) return null;
      return toPromo(row, "code");
    },
  });
}

/** The long-rental discount for a rental of `days`: the longest live tier that covers it. */
export function useDurationDiscount(tenantId: string | undefined, timeZone: string | null | undefined, days: number) {
  return useQuery({
    queryKey: ["rental-promo-duration", tenantId, days],
    enabled: !!tenantId && days > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<RentalPromo | null> => {
      const { data, error } = await (supabase as any)
        .from("promocodes")
        .select(SELECT)
        .eq("tenant_id", tenantId)
        .gt("min_duration_days", 0)
        .lte("min_duration_days", days)
        .order("min_duration_days", { ascending: false });
      if (error || !data) return null;
      const today = todayIsoIn(timeZone);
      for (const row of data as PromoRow[]) {
        if (row.max_duration_days != null && days > row.max_duration_days) continue;
        if (row.is_active === false) continue;
        if (row.expires_at && row.expires_at.slice(0, 10) < today) continue;
        if (await usedUp(tenantId!, row)) continue;
        return toPromo(row, "duration");
      }
      return null;
    },
  });
}
