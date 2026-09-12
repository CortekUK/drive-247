import { shiftDay, type TimelineBooking, type TimelineData, type TimelineVehicle } from "@/components/timeline-v2/model";

/** Development/test fixtures only. No production component imports this module. */
export const PREVIEW_TODAY = "2026-09-10";
export const VEHICLES: TimelineVehicle[] = [
  { id: "fixture-vehicle-a", reg: "PREVIEW 01", make: "Toyota", model: "RAV4 Hybrid", daily: 89, weekly: 520, monthly: 1890 },
  { id: "fixture-vehicle-b", reg: "PREVIEW 02", make: "Mercedes-Benz", model: "GLE 350 4MATIC Premium", daily: 145, weekly: 875, monthly: null },
  { id: "fixture-vehicle-c", reg: "PREVIEW 03", make: "Tesla", model: "Model 3", daily: null, weekly: 620, monthly: 2190 },
  { id: "fixture-vehicle-d", reg: "PREVIEW 04", make: "Ford", model: "Transit Custom", daily: 112, weekly: null, monthly: null },
];
function booking(id: string, number: string, start: string, end: string | null, status: string, vehicle = 0, customer = "Alex Morgan"): TimelineBooking {
  return { id, rentalId: id, number, start, end, status, vehicle: VEHICLES[vehicle], customer: { id: `fixture-${customer}`, name: customer } };
}
export const FIXTURE_DATA: TimelineData = {
  vehicles: VEHICLES, extensions: [], prices: { "2026-09-12": 99, "2026-09-13": 99 },
  bookings: [
    booking("fixture-rental-a", "RNT-2026-0841", "2026-09-10", "2026-09-12", "Active"),
    { ...booking("fixture-rental-b", "RNT-2026-0842", "2026-09-08", "2026-09-14", "Active", 1, "Alexandra Montgomery-Wellington"), pickupTime: "10:00", returnTime: "15:30" },
    booking("fixture-rental-c", "RNT-2026-0843", "2026-09-09", "2026-09-11", "Pending", 2, "Jordan Lee"),
    booking("fixture-rental-d", "RNT-2026-0844", "2026-09-14", "2026-09-18", "Upcoming", 0),
    booking("fixture-rental-e", "RNT-2026-0845", "2026-09-17", "2026-09-24", "Upcoming", 1, "Sam Rivera"),
    booking("fixture-rental-f", "RNT-2026-0839", "2026-09-02", "2026-09-09", "Completed", 3, "Casey Taylor"),
    booking("fixture-rental-g", "RNT-2026-CLIENT-REFERENCE-0000000846", "2026-09-11", "2026-09-13", "Cancelled", 3, "Alexandra Montgomery-Wellington"),
    booking("fixture-rental-h", "RNT-2026-0847", "2026-09-19", null, "Upcoming", 2, "Devin Brooks"),
    booking("fixture-rental-past", "RNT-2026-0791", "2026-08-24", "2026-08-29", "Completed", 0),
  ],
  blocks: [{ id: "fixture-block-a", vehicleId: VEHICLES[3].id, start: "2026-09-15", end: "2026-09-17", reason: "Scheduled maintenance" }],
};

/** Deliberately difficult intervals, isolated from tenant data. */
export const DENSE_BOOKINGS: TimelineBooking[] = [
  ...FIXTURE_DATA.bookings,
  ...Array.from({ length: 12 }, (_, i) => ({ ...FIXTURE_DATA.bookings[0], id: `fixture-dense-${i}`, rentalId: `fixture-dense-${i}`, number: `RENTAL-WITH-LONG-REFERENCE-${i + 1}`, start: shiftDay("2026-09-09", i % 4), end: shiftDay("2026-09-12", i % 5) })),
  ...[0, 1].map(i => ({ ...FIXTURE_DATA.bookings[0], id: `fixture-short-${i}`, rentalId: `fixture-short-${i}`, number: `SHORT-${i + 1}`, start: "2026-09-10", end: "2026-09-10", pickupTime: `${10 + i}:00`, returnTime: `${10 + i}:30` })),
];
