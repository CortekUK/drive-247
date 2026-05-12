// PAYG rentals store the per-period billing amount in `rentals.monthly_amount`,
// with `rentals.rental_period_type` indicating the period unit. This module is
// the single source of truth for converting that stored amount into a daily
// rate. It MUST stay in lockstep with `computeDailyRate()` in
// supabase/functions/accrue-payg-charges/index.ts — both are read by the
// portal UI and the accrual cron, and divergence would mean the displayed
// daily charge does not match what the customer is actually billed.
//
// Monthly division uses 30 (calendar-agnostic), matching the cron. If the
// month convention ever changes (e.g., 30.44, actual-month-length), update
// both files together.

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
