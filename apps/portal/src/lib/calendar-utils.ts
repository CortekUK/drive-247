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
  customer: { id: string; name: string };
  vehicle: { id: string; reg: string; make: string; model: string; photo_url?: string };
}

export interface CalendarBlock {
  id: string;
  vehicle_id: string | null; // null = tenant-wide block (applies to every vehicle)
  start_date: string;
  end_date: string;
  reason: string | null;
  /** 'manual' = operator-created block (incl. Turo/Airbnb marked unavailable);
   *  'external' = synced from an external calendar (reserved for future iCal sync). */
  source: "manual" | "external";
}

export interface VehicleTimelineData {
  vehicle: { id: string; reg: string; make: string; model: string; photo_url?: string };
  rentals: CalendarRental[];
  blocks: CalendarBlock[];
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

type VehicleInfo = VehicleTimelineData["vehicle"];

/**
 * Build the per-vehicle timeline from rentals + manual blocks.
 *
 * EVERY vehicle in `vehicleLookup` gets a row — the whole fleet is always
 * visible, even idle cars with no rentals or blocks. Rentals/blocks are layered
 * onto those rows. Blocks with vehicle_id = null are tenant-wide and attach to
 * every vehicle row (so an operator's "all cars off" block shows across the fleet).
 *
 * `vehicleLookup` supplies reg/make/model/photo for all tenant vehicles.
 */
export function groupTimelineByVehicle(
  rentals: CalendarRental[],
  blocks: CalendarBlock[],
  vehicleLookup: Map<string, VehicleInfo>
): VehicleTimelineData[] {
  const vehicleMap = new Map<string, VehicleTimelineData>();

  const ensureRow = (vehicle: VehicleInfo): VehicleTimelineData => {
    if (!vehicleMap.has(vehicle.id)) {
      vehicleMap.set(vehicle.id, { vehicle, rentals: [], blocks: [] });
    }
    return vehicleMap.get(vehicle.id)!;
  };

  // Seed a row for every vehicle so the full fleet always shows.
  for (const vehicle of vehicleLookup.values()) {
    ensureRow(vehicle);
  }

  for (const rental of rentals) {
    ensureRow(rental.vehicle).rentals.push(rental);
  }

  const tenantWideBlocks: CalendarBlock[] = [];
  for (const block of blocks) {
    if (!block.vehicle_id) {
      tenantWideBlocks.push(block);
      continue;
    }
    const vehicle = vehicleLookup.get(block.vehicle_id);
    if (!vehicle) continue; // vehicle no longer exists / not in tenant
    ensureRow(vehicle).blocks.push(block);
  }

  // Attach tenant-wide blocks to every vehicle row that exists
  if (tenantWideBlocks.length) {
    for (const row of vehicleMap.values()) {
      row.blocks.push(...tenantWideBlocks);
    }
  }

  // Sort vehicles by reg
  return Array.from(vehicleMap.values()).sort((a, b) =>
    a.vehicle.reg.localeCompare(b.vehicle.reg)
  );
}

/** @deprecated use groupTimelineByVehicle — kept for backward compatibility */
export function groupRentalsByVehicle(
  rentals: CalendarRental[]
): VehicleTimelineData[] {
  const vehicleMap = new Map<string, VehicleTimelineData>();

  for (const rental of rentals) {
    const key = rental.vehicle.id;
    if (!vehicleMap.has(key)) {
      vehicleMap.set(key, { vehicle: rental.vehicle, rentals: [], blocks: [] });
    }
    vehicleMap.get(key)!.rentals.push(rental);
  }

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

export interface DatePricingInfo {
  type: "regular" | "weekend" | "holiday";
  surchargePercent: number;
  label: string | null; // holiday name when type === 'holiday'
}

export interface DatePricingHoliday {
  name: string;
  start_date: string;
  end_date: string;
  surcharge_percent: number | string;
  recurs_annually: boolean;
}

/**
 * Classify a single calendar date for the per-day pricing strip. Mirrors the
 * holiday/weekend logic in calculate-rental-price.ts so the calendar's surcharge
 * markers match what the booking flow actually charges. Holiday wins over weekend.
 */
export function classifyDatePricing(
  date: Date,
  weekendConfig: { weekend_surcharge_percent: number; weekend_days: number[] } | null,
  holidays: DatePricingHoliday[]
): DatePricingInfo {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dateStr = format(date, "yyyy-MM-dd");

  for (const h of holidays) {
    let match = false;
    if (h.recurs_annually) {
      const start = parseISO(h.start_date);
      const end = parseISO(h.end_date);
      const sM = start.getMonth() + 1;
      const sD = start.getDate();
      const eM = end.getMonth() + 1;
      const eD = end.getDate();
      if (sM === eM) {
        match = month === sM && day >= sD && day <= eD;
      } else {
        match =
          (month === sM && day >= sD) ||
          (month === eM && day <= eD) ||
          (month > sM && month < eM);
      }
    } else {
      match = dateStr >= h.start_date && dateStr <= h.end_date;
    }
    if (match) {
      return {
        type: "holiday",
        surchargePercent: Number(h.surcharge_percent) || 0,
        label: h.name,
      };
    }
  }

  const dow = date.getDay();
  if (
    weekendConfig &&
    weekendConfig.weekend_surcharge_percent > 0 &&
    weekendConfig.weekend_days?.includes(dow)
  ) {
    return {
      type: "weekend",
      surchargePercent: weekendConfig.weekend_surcharge_percent,
      label: null,
    };
  }

  return { type: "regular", surchargePercent: 0, label: null };
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
