/**
 * One engine per rental — the portal's read of it.
 *
 * A rental still on auto-extend, an open pay-as-you-go or a live installment
 * plan is billed by that mechanism's own cron. A payment plan on top of it
 * would be a second cron charging the same rental, so the database refuses one
 * (migration 20260925120200_payment_plans_one_engine_per_rental.sql, function
 * pp__legacy_mechanism) and "Set up a payment plan" is disabled with the same
 * sentence the server would answer with.
 *
 * The SERVER is the guard; this only saves the operator a round trip. Same
 * rule, same order as the SQL: auto-extend, then PAYG, then installment.
 */

import { LEGACY_MECHANISM_REASON, type LegacyMechanism } from "@/lib/payment-plans/errors";

/** The rentals columns the rule reads (the v2 rental detail selects `*`). */
export interface LegacyRentalFlags {
  auto_extend_enabled?: boolean | null;
  is_pay_as_you_go?: boolean | null;
  payg_closed_at?: string | null;
}

/** installment_plans.status values that still collect money. */
export const LIVE_INSTALLMENT_STATUSES = ["pending", "active", "overdue"] as const;

export function legacyMechanismForRental(
  rental: LegacyRentalFlags | null | undefined,
  hasLiveInstallmentPlan: boolean,
): LegacyMechanism | null {
  if (rental?.auto_extend_enabled === true) return "auto_extend";
  if (rental?.is_pay_as_you_go === true && !rental.payg_closed_at) return "payg";
  if (hasLiveInstallmentPlan) return "installment";
  return null;
}

/** The operator's sentence for a blocked setup, or null when nothing blocks it. */
export function legacyMechanismReason(mechanism: LegacyMechanism | null): string | null {
  return mechanism ? LEGACY_MECHANISM_REASON[mechanism] : null;
}
