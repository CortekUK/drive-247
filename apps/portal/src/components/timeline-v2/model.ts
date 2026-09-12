import { addDays, format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";

export type Perspective = "rental" | "vehicle" | "customer";
export type TimelineScope = { kind: "all" } | { kind: "rental" | "vehicle" | "customer"; id: string };
export type Period = "week" | "fortnight" | "month" | "custom";
export type TimelineVehicle = { id: string; reg: string; make: string; model: string; photoUrl?: string | null; daily: number | null; weekly: number | null; monthly: number | null };
export type TimelineBooking = {
  id: string; rentalId: string; number: string; start: string; end: string | null;
  pickupTime?: string | null; returnTime?: string | null; status: string; originalEnd?: string | null;
  paymentMode?: string | null; isPayAsYouGo?: boolean; autoExtendEnabled?: boolean;
  customer: { id: string; name: string }; vehicle: TimelineVehicle;
  segment?: string; preview?: boolean; note?: string; amount?: number | null;
  /** A stored extension begins at the prior return boundary, not a new booking. */
  endExclusive?: boolean;
};
export type TimelineBlock = { id: string; vehicleId: string | null; start: string; end: string; reason: string | null; preview?: boolean };
export type ExtensionRow = { id: string; sequence_number: number; previous_end_date: string | null; new_end_date: string | null; status: string; total_amount: number | null };
export type TimelineData = { bookings: TimelineBooking[]; vehicles: TimelineVehicle[]; blocks: TimelineBlock[]; prices: Record<string, number>; extensions: ExtensionRow[] };
export const EMPTY_TIMELINE: TimelineData = { bookings: [], vehicles: [], blocks: [], prices: {}, extensions: [] };
export const STATUSES = ["Active", "Upcoming", "Pending", "Completed", "Cancelled", "Rejected"];

/** Calendar arithmetic, independent of the browser's offset and DST. Never serialise local midnight to UTC. */
export function dayNumber(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return NaN;
  return date.getTime() / 86_400_000;
}
export const shiftDay = (date: string, days: number) => format(addDays(parseLocalDate(date), days), "yyyy-MM-dd");
export const prettyDay = (date: string) => Number.isFinite(dayNumber(date)) ? format(parseLocalDate(date), "MMM d, yyyy") : "Date unavailable";
export function tenantToday(timezone?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    return ["year", "month", "day"].map(k => parts.find(p => p.type === k)?.value).join("-");
  } catch { return format(new Date(), "yyyy-MM-dd"); }
}
const fraction = (time?: string | null) => {
  if (!time || !/^\d{1,2}:\d{2}/.test(time)) return null;
  const [h, m] = time.split(":").map(Number);
  return h < 24 && m < 60 ? (h * 60 + m) / 1440 : null;
};
export function bookingBounds(booking: TimelineBooking): [number, number] {
  const start = dayNumber(booking.start) + (fraction(booking.pickupTime) ?? 0);
  const end = booking.end ? dayNumber(booking.end) + (fraction(booking.returnTime) ?? (booking.endExclusive ? 0 : 1)) : Infinity;
  return [start, end];
}
export function onDay(booking: TimelineBooking, date: string): boolean {
  const [start, end] = bookingBounds(booking), day = dayNumber(date);
  return start < day + 1 && end > day;
}
export function positionBooking(booking: TimelineBooking, start: string, days: number) {
  const [from, to] = bookingBounds(booking), leftEdge = dayNumber(start), rightEdge = leftEdge + days;
  if (!Number.isFinite(from) || Number.isNaN(to) || to <= from || from >= rightEdge || to <= leftEdge) return null;
  return { offset: Math.max(from, leftEdge) - leftEdge, span: Math.min(to, rightEdge) - Math.max(from, leftEdge), continuesBefore: from < leftEdge, continuesAfter: to > rightEdge };
}
/** Interval partitioning keeps concurrent bookings visible; equal endpoints may share a lane. */
export function bookingLanes(bookings: TimelineBooking[], start: string, days: number, minimumHitSpan = 0) {
  const ends: number[] = [];
  return bookings.map(booking => ({ booking, position: positionBooking(booking, start, days) }))
    .filter((item): item is { booking: TimelineBooking; position: NonNullable<ReturnType<typeof positionBooking>> } => !!item.position)
    .sort((a, b) => a.position.offset - b.position.offset || b.position.span - a.position.span || a.booking.id.localeCompare(b.booking.id))
    .map(item => {
      const hitPadding = item.booking.segment ? 0 : Math.max(0, minimumHitSpan - item.position.span) / 2;
      let lane = ends.findIndex(end => end <= item.position.offset - hitPadding);
      if (lane < 0) lane = ends.length;
      ends[lane] = item.position.offset + item.position.span + hitPadding;
      return { ...item, lane };
    });
}
export const vehicleName = (v: TimelineVehicle) => [v.make, v.model].filter(Boolean).join(" ") || v.reg || "Vehicle unavailable";
export const vehicleLabel = (v: TimelineVehicle) => v.reg && v.reg !== vehicleName(v) ? `${v.reg} · ${vehicleName(v)}` : vehicleName(v);
export const primaryLabel = (b: TimelineBooking, p: Perspective) => b.segment || (p === "vehicle" ? vehicleLabel(b.vehicle) : p === "customer" ? b.customer.name : b.number);
export const recordId = (b: TimelineBooking, p: Perspective) => p === "vehicle" ? b.vehicle.id : p === "customer" ? b.customer.id : b.rentalId;

/** Identity only changes row grouping. Every interval retains its original bounds. */
export function bookingRows(bookings: TimelineBooking[], perspective: Perspective, start: string, days: number) {
  const groups = new Map<string, TimelineBooking[]>();
  bookings.forEach(booking => {
    if (!positionBooking(booking, start, days)) return;
    // Missing relationships must not silently merge unrelated records.
    const id = recordId(booking, perspective) || booking.rentalId;
    groups.set(id, [...(groups.get(id) ?? []), booking]);
  });
  return [...groups].map(([id, items]) => ({ id, bookings: items, lanes: bookingLanes(items, start, days, .75) }));
}
export function extensionValidation(currentEnd: string, newEnd: string): string | null {
  if (!Number.isFinite(dayNumber(newEnd))) return "Choose a valid new end date.";
  if (dayNumber(newEnd) <= dayNumber(currentEnd)) return "The new end date must be after the current end date.";
  return null;
}
/** Reads existing periods without flattening them into the rental's latest end date. */
export function rentalSegments(booking: TimelineBooking, rows: ExtensionRow[]): TimelineBooking[] {
  const extensions = [...rows].filter(e => e.previous_end_date && e.new_end_date && !["cancelled", "rejected", "failed"].includes(e.status.toLowerCase()))
    .sort((a, b) => a.sequence_number - b.sequence_number);
  return [
    { ...booking, id: `${booking.id}:original`, segment: "Original rental", end: extensions[0]?.previous_end_date ?? booking.originalEnd ?? booking.end, endExclusive: !!extensions.length },
    ...extensions.map((e, i) => ({ ...booking, id: e.id, segment: `Extension #${e.sequence_number}`, start: e.previous_end_date!, end: e.new_end_date!, endExclusive: extensions[i + 1]?.previous_end_date === e.new_end_date, pickupTime: booking.returnTime, amount: e.total_amount, note: `Recorded extension · ${e.status}` })),
  ];
}
