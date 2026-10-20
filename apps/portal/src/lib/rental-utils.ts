import { differenceInMonths, differenceInDays, differenceInWeeks, parseISO, getDaysInMonth } from "date-fns";

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

// Lives in shared/portal-v2/rental-status.ts (the customer portal reads it too).
export { getRentalStatus, type RentalStatusOptions } from "../../../../shared/portal-v2/rental-status";

export const getDurationFilter = (months: number): string => {
  if (months <= 12) return "≤12 mo";
  if (months <= 24) return "13–24 mo";
  return ">24 mo";
};