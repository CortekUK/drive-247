import { differenceInMonths, differenceInDays, differenceInWeeks, parseISO, isAfter, getDaysInMonth } from "date-fns";

export const calculateDurationInMonths = (startDate: string, endDate: string | null): number => {
  if (!endDate) {
    const months = differenceInMonths(new Date(), parseISO(startDate));
    return Math.max(1, months); // At least 1 month for active rentals
  }

  const start = parseISO(startDate);
  const end = parseISO(endDate);

  // Calculate months difference
  const months = differenceInMonths(end, start);

  // If less than 1 month, check if it spans most of a calendar month
  if (months === 0) {
    const days = differenceInDays(end, start);
    // Use actual days in the start month for more accurate calculation
    const daysInStartMonth = getDaysInMonth(start);
    // If rental spans 80% or more of the month, count as 1 month; otherwise use fractional
    if (days >= daysInStartMonth * 0.8) {
      return 1;
    }
    // For very short rentals, still return at least 1
    return 1;
  }

  return months;
};

export const calculateDuration = (startDate: string, endDate: string | null, periodType: string = 'Monthly'): number => {
  if (!endDate) {
    // For active rentals, calculate duration from start to now
    const start = parseISO(startDate);
    const now = new Date();

    switch (periodType) {
      case 'Daily':
        return Math.max(1, differenceInDays(now, start));
      case 'Weekly':
        return Math.max(1, differenceInWeeks(now, start));
      case 'Monthly':
      default:
        return Math.max(1, differenceInMonths(now, start));
    }
  }

  const start = parseISO(startDate);
  const end = parseISO(endDate);

  switch (periodType) {
    case 'Daily':
      return Math.max(1, differenceInDays(end, start));
    case 'Weekly':
      return Math.max(1, differenceInWeeks(end, start));
    case 'Monthly':
    default:
      // Calculate actual months
      const months = differenceInMonths(end, start);
      // If less than 1 month, return the fraction (will be formatted as days)
      if (months === 0) {
        return differenceInDays(end, start);
      }
      return months;
  }
};

/**
 * Calculate rental duration and return a formatted string with automatic unit detection
 */
export const formatRentalDuration = (startDate: string, endDate: string | null): string => {
  const start = parseISO(startDate);
  const end = endDate ? parseISO(endDate) : new Date();

  const days = differenceInDays(end, start);
  const weeks = differenceInWeeks(end, start);
  const months = differenceInMonths(end, start);

  // Auto-select best unit
  if (months >= 1) {
    return `${months} mo`;
  } else if (weeks >= 1) {
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
  } else {
    return `${Math.max(1, days)} ${days === 1 ? 'day' : 'days'}`;
  }
};

export const formatDuration = (value: number, periodType: string = 'Monthly'): string => {
  if (value === 0) {
    switch (periodType) {
      case 'Daily':
        return "0 days";
      case 'Weekly':
        return "0 weeks";
      default:
        return "0 mo";
    }
  }

  switch (periodType) {
    case 'Daily':
      return `${value} ${value === 1 ? 'day' : 'days'}`;
    case 'Weekly':
      return `${value} ${value === 1 ? 'week' : 'weeks'}`;
    case 'Monthly':
    default:
      return `${value} mo`;
  }
};

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

export const getDurationFilter = (months: number): string => {
  if (months <= 12) return "≤12 mo";
  if (months <= 24) return "13–24 mo";
  return ">24 mo";
};