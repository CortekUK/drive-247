import { differenceInMonths, differenceInDays, differenceInWeeks, parseISO, isAfter } from "date-fns";

export const calculateDurationInMonths = (startDate: string, endDate: string | null): number => {
  if (!endDate) {
    const months = differenceInMonths(new Date(), parseISO(startDate));
    return Math.max(1, months); // At least 1 month for active rentals
  }

  const start = parseISO(startDate);
  const end = parseISO(endDate);

  // Calculate months difference - return actual value (can be 0 for same-day)
  return differenceInMonths(end, start);
};

export const calculateDuration = (startDate: string, endDate: string | null, periodType: string = 'Monthly'): number => {
  if (!endDate) {
    // For active rentals, calculate duration from start to now (minimum 1)
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

  // For closed rentals, show actual duration (can be 0 for same-day)
  const start = parseISO(startDate);
  const end = parseISO(endDate);

  switch (periodType) {
    case 'Daily':
      return differenceInDays(end, start);
    case 'Weekly':
      return differenceInWeeks(end, start);
    case 'Monthly':
    default:
      return differenceInMonths(end, start);
  }
};

export const formatDuration = (months: number, periodType: string = 'Monthly'): string => {
  if (months === 0) {
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
      return `${months} ${months === 1 ? 'day' : 'days'}`;
    case 'Weekly':
      return `${months} ${months === 1 ? 'week' : 'weeks'}`;
    case 'Monthly':
    default:
      return `${months} mo`;
  }
};

// Smart duration formatter that shows days when < 1 month
export const formatDurationSmart = (startDate: string, endDate: string | null, periodType: string = 'Monthly'): string => {
  if (!endDate) {
    // Active rental - show at least 1
    const start = parseISO(startDate);
    const now = new Date();
    const months = differenceInMonths(now, start);
    if (months > 0) return `${months} mo`;
    const days = differenceInDays(now, start);
    return days === 0 ? "< 1 day" : `${days} ${days === 1 ? 'day' : 'days'}`;
  }

  const start = parseISO(startDate);
  const end = parseISO(endDate);

  // For daily period type, always show days
  if (periodType === 'Daily') {
    const days = differenceInDays(end, start);
    return days === 0 ? "< 1 day" : `${days} ${days === 1 ? 'day' : 'days'}`;
  }

  // For weekly period type
  if (periodType === 'Weekly') {
    const weeks = differenceInWeeks(end, start);
    if (weeks > 0) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
    const days = differenceInDays(end, start);
    return days === 0 ? "< 1 day" : `${days} ${days === 1 ? 'day' : 'days'}`;
  }

  // For monthly - show days if < 1 month
  const months = differenceInMonths(end, start);
  if (months > 0) return `${months} mo`;

  const days = differenceInDays(end, start);
  return days === 0 ? "< 1 day" : `${days} ${days === 1 ? 'day' : 'days'}`;
};

export const getRentalStatus = (startDate: string, endDate: string | null, status: string): string => {
  // If explicitly set to Pending in database, respect that (key not yet handed)
  if (status === "Pending") {
    return "Pending";
  }

  // If explicitly set to Rejected in database (payment was rejected), respect that
  if (status === "Rejected") {
    return "Rejected";
  }

  const today = new Date();
  const start = parseISO(startDate);

  // If start date is in the future, it's upcoming
  if (isAfter(start, today)) {
    return "Upcoming";
  }

  // If there's an end date and it's in the past, it's closed
  if (endDate) {
    const end = parseISO(endDate);
    if (!isAfter(end, today)) {
      return "Closed";
    }
  }

  // If explicitly set to Closed in database, respect that
  if (status === "Closed") {
    return "Closed";
  }

  return "Active";
};

export const getDurationFilter = (months: number): string => {
  if (months <= 12) return "≤12 mo";
  if (months <= 24) return "13–24 mo";
  return ">24 mo";
};