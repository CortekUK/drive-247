// PAYG rentals store the per-period billing amount in `rentals.monthly_amount`,
// with `rentals.rental_period_type` indicating the period unit. This module is
// the single source of truth for converting that stored amount into a daily
// rate. It MUST stay in lockstep with `computeDailyRate()` in
// supabase/functions/accrue-payg-charges/index.ts and the identically-named
// helper in apps/portal/src/lib/payg-rate.ts — all three are read in different
// contexts (cron, portal UI, customer-portal UI) and divergence would mean the
// customer sees a different daily charge than they are actually billed.

export type PaygPeriodType = "Daily" | "Weekly" | "Monthly";

const DIVISOR: Record<PaygPeriodType, number> = {
  Daily: 1,
  Weekly: 7,
  Monthly: 30,
};

export function computePaygDailyRate(
  monthlyAmount: number | null | undefined,
  periodType: string | null | undefined,
): number {
  const amount = Number(monthlyAmount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const divisor = DIVISOR[periodType as PaygPeriodType] ?? 1;
  return amount / divisor;
}
