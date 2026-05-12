"use client";

import { addDays, format, parseISO } from "date-fns";
import { CalendarClock, Info } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";
import { computePaygDailyRate } from "@/lib/payg-rate";

interface PaygSchedulePreviewProps {
  /** "Weekly" or "Monthly" — Daily is not allowed on PAYG. */
  periodType: string | null | undefined;
  /** Per-period billing amount the customer pays (stored in rentals.monthly_amount). */
  amount: number | null | undefined;
  /** Rental start date as ISO string ("YYYY-MM-DD") or Date. */
  startDate: string | Date | null | undefined;
  /** Tenant currency code, e.g., "USD". */
  currencyCode: string;
  /** Tenant default reminder interval in days; falls back to 4 if absent. */
  tenantReminderIntervalDays?: number | null;
  /** Per-rental reminder interval override; takes precedence over tenant default when set. */
  reminderIntervalOverride?: number | null;
  /** Tenant grace period before the first reminder fires; falls back to 2 if absent. */
  tenantGracePeriodDays?: number | null;
}

/**
 * Read-only summary card describing what a PAYG customer will be charged and when.
 *
 * Shown twice:
 *   1. In the new-rental form below the PAYG fields, so the operator can sanity-check
 *      the schedule before clicking Create (the question Kris asked for in her May 8 call).
 *   2. On the rental detail page above the rolling-invoice ledger, as a recap for
 *      anyone reviewing an active PAYG rental.
 *
 * The PAYG accrual model is daily under the hood (one ledger entry per day), but
 * customers and operators reason about it in the period the rental was sold on
 * (weekly or monthly). We lead with the period-level framing and disclose the
 * daily rate parenthetically so the rolling-invoice view further down isn't
 * surprising.
 */
export function PaygSchedulePreview({
  periodType,
  amount,
  startDate,
  currencyCode,
  tenantReminderIntervalDays,
  reminderIntervalOverride,
  tenantGracePeriodDays,
}: PaygSchedulePreviewProps) {
  const period = periodType === "Monthly" ? "Monthly" : "Weekly";
  const periodLowerNoun = period === "Monthly" ? "month" : "week";
  const periodAdjective = period.toLowerCase();
  const numericAmount = typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : null;

  const reminderInterval = reminderIntervalOverride ?? tenantReminderIntervalDays ?? 4;
  const gracePeriod = tenantGracePeriodDays ?? 2;

  const start = (() => {
    if (!startDate) return null;
    if (startDate instanceof Date) return startDate;
    try {
      return parseISO(startDate);
    } catch {
      return null;
    }
  })();

  const dailyRate = computePaygDailyRate(numericAmount, period);
  const firstReminderDate = start ? addDays(start, gracePeriod) : null;

  if (!numericAmount || !start) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          Enter a {periodAdjective} amount and start date to preview the customer's billing schedule.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Customer billing schedule</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground text-xs">Customer is billed</div>
          <div className="font-medium">
            {formatCurrency(numericAmount, currencyCode)}{" "}
            <span className="text-muted-foreground font-normal">
              per {periodLowerNoun}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Accrued as {formatCurrency(dailyRate, currencyCode)}/day in the rolling invoice ledger.
          </div>
        </div>

        <div>
          <div className="text-muted-foreground text-xs">Billing starts</div>
          <div className="font-medium">{format(start, "EEE, d MMM yyyy")}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Pickup time anchors the daily accrual window.
          </div>
        </div>

        <div>
          <div className="text-muted-foreground text-xs">Payment reminders</div>
          <div className="font-medium">Every {reminderInterval} days</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Sent only while a balance is outstanding.
          </div>
        </div>

        <div>
          <div className="text-muted-foreground text-xs">First reminder no earlier than</div>
          <div className="font-medium">
            {firstReminderDate ? format(firstReminderDate, "EEE, d MMM yyyy") : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            After a {gracePeriod}-day grace period from billing start.
          </div>
        </div>
      </div>
    </div>
  );
}
