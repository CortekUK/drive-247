"use client";

import { useEffect, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { CalendarClock, Check, Info, Loader2, Pencil, X } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";
import { computePaygDailyRate } from "@/lib/payg-rate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  /**
   * If provided, an inline edit button appears next to the reminder cadence.
   * The callback receives the new interval (or null to revert to the tenant default)
   * and should persist it. Throw / reject to keep the input open with an error toast.
   */
  onSaveReminderInterval?: (newInterval: number | null) => Promise<void>;
}

const REMINDER_MIN = 1;
const REMINDER_MAX = 365;

/**
 * Read-only (mostly) summary card describing what a PAYG customer will be charged
 * and when. The reminder cadence is optionally editable when `onSaveReminderInterval`
 * is provided — used on the rental detail page so operators can tune the cadence
 * for a specific customer without leaving the page.
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
  onSaveReminderInterval,
}: PaygSchedulePreviewProps) {
  const period = periodType === "Monthly" ? "Monthly" : "Weekly";
  const periodLowerNoun = period === "Monthly" ? "month" : "week";
  const periodAdjective = period.toLowerCase();
  const numericAmount =
    typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : null;

  const tenantDefault = tenantReminderIntervalDays ?? 4;
  const reminderInterval = reminderIntervalOverride ?? tenantDefault;
  const gracePeriod = tenantGracePeriodDays ?? 2;
  const isCustomCadence = reminderIntervalOverride != null;

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

  // Inline edit state for the reminder cadence. The input string is kept
  // separately from the saved number so partial typing (empty, "1", deletes)
  // doesn't crash the parent. Save validates and converts.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(String(reminderInterval));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep the draft in sync with the prop when the parent refetches after a
  // save. Without this, the input shows the stale value the operator typed.
  useEffect(() => {
    if (!editing) setDraft(String(reminderInterval));
  }, [reminderInterval, editing]);

  const beginEdit = () => {
    setDraft(String(reminderInterval));
    setSaveError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setSaveError(null);
    setDraft(String(reminderInterval));
  };
  const saveEdit = async () => {
    if (!onSaveReminderInterval) return;
    const trimmed = draft.trim();
    if (trimmed === "") {
      // Empty = revert to tenant default (NULL on the rental row).
      setSaving(true);
      setSaveError(null);
      try {
        await onSaveReminderInterval(null);
        setEditing(false);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(false);
      }
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      setSaveError("Enter a whole number of days");
      return;
    }
    if (n < REMINDER_MIN || n > REMINDER_MAX) {
      setSaveError(`Must be between ${REMINDER_MIN} and ${REMINDER_MAX} days`);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveReminderInterval(n);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

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
          {editing ? (
            <div className="space-y-1 mt-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">Every</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={REMINDER_MIN}
                  max={REMINDER_MAX}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  className="h-7 w-16 text-sm"
                  placeholder={String(tenantDefault)}
                  disabled={saving}
                  autoFocus
                />
                <span className="text-sm">days</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={saveEdit}
                  disabled={saving}
                  aria-label="Save reminder interval"
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  )}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={cancelEdit}
                  disabled={saving}
                  aria-label="Cancel"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Leave empty to use the tenant default ({tenantDefault} days).
              </div>
              {saveError && (
                <div className="text-xs text-red-600">{saveError}</div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="font-medium">Every {reminderInterval} days</span>
                {isCustomCadence && (
                  <span className="text-[10px] uppercase tracking-wide text-primary bg-primary/10 rounded px-1.5 py-0.5">
                    Custom
                  </span>
                )}
                {onSaveReminderInterval && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={beginEdit}
                    aria-label="Edit reminder interval"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </Button>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Sent only while a balance is outstanding.
                {isCustomCadence && ` (Tenant default: ${tenantDefault} days.)`}
              </div>
            </>
          )}
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
