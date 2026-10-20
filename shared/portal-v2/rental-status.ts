/**
 * A rental's status word as the operator sees it (Active, Upcoming, Pending,
 * Completed, Cancelled, Rejected), and its colours. Moved from
 * apps/portal/src/lib/rental-utils.ts and calendar-utils.ts, which re-export
 * them, so the customer portal's Rentals table and calendar say what the
 * operator's say about the same rental.
 */

import { isAfter, parseISO } from "date-fns";

export interface RentalStatusOptions {
  /** The rental's return_time (e.g. "14:30:00"); null/undefined = no specific time */
  returnTime?: string | null;
  /** Whether the rental is set to auto-extend (weekly auto-renew) */
  autoExtendEnabled?: boolean | null;
  /** The auto-extend lifecycle status ('active' | 'awaiting_payment' | 'paused' | 'ended' | ...) */
  autoExtendStatus?: string | null;
}

/**
 * Resolve the precise moment a rental actually ends.
 *
 * `end_date` is a date-only Postgres column, so `parseISO` lands it on LOCAL
 * midnight at the START of the final day. A rental ending "2026-06-09" should
 * stay Active for the whole of June 9 (until the return time, or end-of-day if
 * none) — NOT flip to Completed at 00:00 that morning. We therefore push the
 * boundary to the return time on the end date, or to the next midnight when no
 * return time is recorded.
 */
const getRentalEndBoundary = (endDate: string, returnTime?: string | null): Date => {
  const end = parseISO(endDate);
  if (returnTime && /^\d{1,2}:\d{2}/.test(returnTime)) {
    const [h, m, s] = returnTime.split(":").map((n) => Number(n));
    end.setHours(h || 0, m || 0, s || 0, 0);
    return end;
  }
  // No return time → keep Active through the entire final day (until next midnight).
  end.setDate(end.getDate() + 1);
  return end;
};

export const getRentalStatus = (
  startDate: string,
  endDate: string | null,
  status: string,
  options: RentalStatusOptions = {}
): string => {
  // If explicitly set to Cancelled in database, respect that (rental was cancelled)
  if (status === "Cancelled") {
    return "Cancelled";
  }

  // If explicitly set to Pending in database, respect that (key not yet handed)
  if (status === "Pending") {
    return "Pending";
  }

  // If explicitly set to Rejected in database (payment was rejected), respect that
  if (status === "Rejected") {
    return "Rejected";
  }

  // If explicitly set to Closed in database, respect that
  if (status === "Closed") {
    return "Completed";
  }

  const today = new Date();
  const start = parseISO(startDate);

  // If start date is in the future, it's upcoming
  if (isAfter(start, today)) {
    return "Upcoming";
  }

  // Auto-extending rentals keep renewing weekly, so their end_date constantly
  // trails "now" between renewals. They must NOT auto-complete on date alone —
  // only an explicit Closed/Cancelled status (handled above) or a stopped
  // auto-extend lifecycle ends them. Otherwise they stay Active.
  const autoExtendActive =
    options.autoExtendEnabled === true &&
    options.autoExtendStatus !== "ended" &&
    options.autoExtendStatus !== "cancelled";
  if (autoExtendActive) {
    return "Active";
  }

  // If there's an end date and the rental has fully ended (past the return time /
  // end of its final day), it's completed.
  if (endDate) {
    const end = getRentalEndBoundary(endDate, options.returnTime);
    if (!isAfter(end, today)) {
      return "Completed";
    }
  }

  return "Active";
};

export function getStatusColor(status: string): {
  bg: string;
  border: string;
  text: string;
} {
  switch (status) {
    case "Active":
      return {
        bg: "bg-emerald-100 dark:bg-emerald-500/20",
        border: "border-emerald-300 dark:border-emerald-500/40",
        text: "text-emerald-700 dark:text-emerald-400",
      };
    case "Upcoming":
      return {
        bg: "bg-cyan-100 dark:bg-cyan-500/15",
        border: "border-cyan-300 dark:border-cyan-500/30",
        text: "text-cyan-700 dark:text-cyan-400",
      };
    case "Pending":
      return {
        bg: "bg-amber-100 dark:bg-amber-400/15",
        border: "border-amber-300 dark:border-amber-400/30",
        text: "text-amber-700 dark:text-amber-300",
      };
    case "Completed":
      return {
        bg: "bg-violet-100 dark:bg-violet-500/15",
        border: "border-violet-300 dark:border-violet-500/30",
        text: "text-violet-700 dark:text-violet-400",
      };
    case "Cancelled":
    case "Rejected":
      return {
        bg: "bg-rose-100 dark:bg-rose-500/15",
        border: "border-rose-300 dark:border-rose-500/30",
        text: "text-rose-700 dark:text-rose-400",
      };
    default:
      return {
        bg: "bg-slate-100 dark:bg-slate-500/15",
        border: "border-slate-300 dark:border-slate-500/30",
        text: "text-slate-700 dark:text-slate-400",
      };
  }
}
