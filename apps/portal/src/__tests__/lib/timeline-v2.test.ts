import { describe, expect, it } from "vitest";
import { bookingBounds, bookingLanes, bookingRows, dayNumber, extensionValidation, onDay, positionBooking, primaryLabel, rentalSegments, shiftDay, type ExtensionRow } from "@/components/timeline-v2/model";
import { FIXTURE_DATA } from "@/app/playground/timeline/fixtures";

const booking = FIXTURE_DATA.bookings[0];

describe("V2 timeline calendar boundaries", () => {
  it("preserves date-only spans, including the final day", () => {
    expect(positionBooking(booking, "2026-09-08", 14)).toEqual({ offset: 2, span: 3, continuesBefore: false, continuesAfter: false });
    expect(onDay(booking, "2026-09-12")).toBe(true);
    expect(onDay(booking, "2026-09-13")).toBe(false);
  });
  it("honours pickup/return times and midnight returns", () => {
    const timed = { ...booking, pickupTime: "12:00", returnTime: "06:00" };
    expect(positionBooking(timed, booking.start, 7)).toMatchObject({ offset: .5, span: 1.75 });
    expect(onDay({ ...booking, returnTime: "00:00" }, booking.end!)).toBe(false);
  });
  it("finds continuing bookings on a selected day and marks clipped boundaries", () => {
    const ongoing = { ...booking, start: "2026-09-01", end: "2026-09-30" };
    expect(onDay(ongoing, "2026-09-10")).toBe(true);
    expect(positionBooking(ongoing, "2026-09-08", 7)).toEqual({ offset: 0, span: 7, continuesBefore: true, continuesAfter: true });
  });
  it("does not manufacture an open-ended rental's end date", () => {
    const open = { ...booking, end: null };
    expect(bookingBounds(open)[1]).toBe(Infinity);
    expect(positionBooking(open, booking.start, 7)).toMatchObject({ span: 7, continuesAfter: true });
    expect(open.end).toBeNull();
  });
  it("uses calendar days across DST and leap days and rejects invalid dates", () => {
    expect(shiftDay("2026-03-08", 1)).toBe("2026-03-09");
    expect(dayNumber("2026-11-02") - dayNumber("2026-11-01")).toBe(1);
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(dayNumber("2026-02-30")).toBeNaN();
    expect(positionBooking({ ...booking, end: "2026-09-01" }, booking.start, 7)).toBeNull();
  });
});

describe("shared booking identity and lanes", () => {
  it("groups the same intervals by identity and retains genuine gaps", () => {
    const intervals = (perspective: "rental" | "vehicle" | "customer") => bookingRows(FIXTURE_DATA.bookings, perspective, "2026-09-08", 14).flatMap(row => row.lanes.map(({ booking, position }) => ({ id: booking.id, position }))).sort((a, b) => a.id.localeCompare(b.id));
    expect(intervals("vehicle")).toEqual(intervals("rental"));
    expect(intervals("customer")).toEqual(intervals("rental"));
    const vehicle = bookingRows(FIXTURE_DATA.bookings, "vehicle", "2026-09-08", 14).find(row => row.id === booking.vehicle.id)!;
    expect(vehicle.lanes.map(l => l.lane)).toEqual([0, 0]);
    expect(vehicle.lanes[1].position.offset).toBeGreaterThan(vehicle.lanes[0].position.offset + vehicle.lanes[0].position.span);
  });
  it("separates short booking interaction targets without stretching real intervals", () => {
    const short = [0, 1].map(i => ({ ...booking, id: `short-${i}`, start: "2026-09-10", end: "2026-09-10", pickupTime: `${10 + i}:00`, returnTime: `${10 + i}:30` }));
    const row = bookingRows(short, "vehicle", "2026-09-08", 14)[0];
    expect(row.lanes.map(l => l.lane)).toEqual([0, 1]);
    row.lanes.forEach(l => expect(l.position.span).toBeCloseTo(1 / 48));
  });
  it("changes labels without changing any dates, status or identity", () => {
    const before = structuredClone(booking);
    expect(primaryLabel(booking, "rental")).toBe(booking.number);
    expect(primaryLabel(booking, "vehicle")).toBe("PREVIEW 01 · Toyota RAV4 Hybrid");
    expect(primaryLabel(booking, "customer")).toBe(booking.customer.name);
    expect(booking).toEqual(before);
  });
  it("keeps every overlapping booking visible in separate lanes", () => {
    const items = bookingLanes(FIXTURE_DATA.bookings, "2026-09-08", 14);
    expect(items).toHaveLength(8);
    for (const a of items) for (const b of items) {
      if (a.booking.id === b.booking.id || a.lane !== b.lane) continue;
      expect(a.position.offset + a.position.span <= b.position.offset || b.position.offset + b.position.span <= a.position.offset).toBe(true);
    }
  });
  it("preserves separate rentals and the real gap for one vehicle", () => {
    const items = bookingLanes([booking, FIXTURE_DATA.bookings[3]], "2026-09-08", 14);
    expect(items).toHaveLength(2);
    expect(items[0].lane).toBe(items[1].lane);
    expect(items[1].position.offset - (items[0].position.offset + items[0].position.span)).toBe(1);
  });
});

describe("manual rental periods", () => {
  it("retains the original and numbered recorded extension boundaries", () => {
    const rows: ExtensionRow[] = [
      { id: "extension-1", sequence_number: 1, previous_end_date: "2026-09-12", new_end_date: "2026-09-20", status: "paid", total_amount: 300 },
      { id: "extension-2", sequence_number: 2, previous_end_date: "2026-09-20", new_end_date: "2026-09-24", status: "paid", total_amount: 200 },
    ];
    const periods = rentalSegments({ ...booking, end: "2026-09-24" }, rows);
    expect(periods.map(p => p.segment)).toEqual(["Original rental", "Extension #1", "Extension #2"]);
    expect(periods[0].end).toBe("2026-09-12");
    expect(periods[1].start).toBe("2026-09-12");
    expect(bookingLanes(periods, "2026-09-08", 30).map(p => p.lane)).toEqual([0, 0, 0]);
  });
  it("validates only the existing later-end-date rule", () => {
    expect(extensionValidation("2026-09-12", "")).toBeTruthy();
    expect(extensionValidation("2026-09-12", "2026-09-12")).toBeTruthy();
    expect(extensionValidation("2026-09-12", "2026-09-11")).toBeTruthy();
    expect(extensionValidation("2026-09-12", "2026-09-13")).toBeNull();
    expect(extensionValidation("2026-09-12", "2027-01-05")).toBeNull();
  });
});
