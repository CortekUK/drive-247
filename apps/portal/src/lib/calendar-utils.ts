import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  differenceInDays,
  format,
  isBefore,
  isAfter,
  parseISO,
  max,
  min,
} from "date-fns";

export type ViewType = "week" | "month";

export interface CalendarRental {
  id: string;
  rental_number: string;
  start_date: string;
  end_date: string | null;
  monthly_amount: number;
  status: string;
  computed_status: string;
  customer: { id: string; name: string; customer_type: string };
  vehicle: { id: string; reg: string; make: string; model: string; photo_url?: string };
}

export interface VehicleTimelineData {
  vehicle: { id: string; reg: string; make: string; model: string; photo_url?: string };
  rentals: CalendarRental[];
}

export interface BarPosition {
  left: string;
  width: string;
  isClipped: boolean;
}

export function getDateRange(
  viewType: ViewType,
  anchorDate: Date
): { start: Date; end: Date } {
  if (viewType === "week") {
    return {
      start: startOfWeek(anchorDate, { weekStartsOn: 1 }),
      end: endOfWeek(anchorDate, { weekStartsOn: 1 }),
    };
  }
  return {
    start: startOfMonth(anchorDate),
    end: endOfMonth(anchorDate),
  };
}

export function getDatesInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  let current = start;
  while (!isAfter(current, end)) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

export function calculateBarPosition(
  rentalStart: string,
  rentalEnd: string | null,
  rangeStart: Date,
  rangeEnd: Date
): BarPosition {
  const start = parseISO(rentalStart);
  const end = rentalEnd ? parseISO(rentalEnd) : addDays(rangeEnd, 30); // open-ended → extend beyond view

  const totalDays = differenceInDays(rangeEnd, rangeStart) + 1;

  const clampedStart = max([start, rangeStart]);
  const clampedEnd = min([end, rangeEnd]);

  const offsetDays = differenceInDays(clampedStart, rangeStart);
  const durationDays = differenceInDays(clampedEnd, clampedStart) + 1;

  const isClipped = isBefore(start, rangeStart) || isAfter(end, rangeEnd);

  return {
    left: `${(offsetDays / totalDays) * 100}%`,
    width: `${(Math.max(1, durationDays) / totalDays) * 100}%`,
    isClipped,
  };
}

export function groupRentalsByVehicle(
  rentals: CalendarRental[]
): VehicleTimelineData[] {
  const vehicleMap = new Map<string, VehicleTimelineData>();

  for (const rental of rentals) {
    const key = rental.vehicle.id;
    if (!vehicleMap.has(key)) {
      vehicleMap.set(key, { vehicle: rental.vehicle, rentals: [] });
    }
    vehicleMap.get(key)!.rentals.push(rental);
  }

  // Sort vehicles by reg
  return Array.from(vehicleMap.values()).sort((a, b) =>
    a.vehicle.reg.localeCompare(b.vehicle.reg)
  );
}

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

export function formatDateRange(start: Date, end: Date): string {
  const sameMonth =
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear();

  if (sameMonth) {
    return `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`;
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) {
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }

  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
}
