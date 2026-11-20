/** QA B4.11/B4.12: a car back at 10:00 is free again the same day, after the gap. */
import { describe, expect, it } from "vitest";
import {
  heldDays,
  overlapsLikeTrigger,
  rentalInterval,
  timedClash,
  tripInterval,
  wallClockToMs,
} from "../../northwind-site/lib/vehicles/availability-time";

const NY = "America/New_York";
const today = "2026-11-10";
const HOUR = 3_600_000;

// The QA gap rental: QA-3001, 11 Nov 10:00 → 12 Nov 10:00, New York.
const gapRental = { status: "Pending", start_date: "2026-11-11", pickup_time: "10:00:00", end_date: "2026-11-12", return_time: "10:00:00" };
const trip = (pickupTime: string, dropoffDate = "2026-11-14") => ({ pickupDate: "2026-11-12", pickupTime, dropoffDate, dropoffTime: pickupTime });

describe("wallClockToMs", () => {
  it("reads the operator's wall clock in their zone", () => {
    // 16:00 in New York on 10 Nov 2026 (EST) is 21:00 UTC.
    expect(wallClockToMs("2026-11-10", "16:00", NY, "00:00")).toBe(Date.UTC(2026, 10, 10, 21, 0));
    expect(wallClockToMs("2026-11-10", "16:00:30", NY, "00:00")).toBe(Date.UTC(2026, 10, 10, 21, 0, 30));
  });

  it("falls back to the given clock when the row has none", () => {
    expect(wallClockToMs("2026-11-10", null, NY, "23:59:59")).toBe(Date.UTC(2026, 10, 11, 4, 59, 59));
    expect(wallClockToMs("not-a-date", "10:00", NY, "00:00")).toBeNull();
  });
});

describe("timedClash with a 4-hour buffer", () => {
  const rental = rentalInterval(gapRental, NY, today)!;
  const buffer = 240;

  it("refuses a pickup two hours after the car comes back", () => {
    expect(timedClash(tripInterval(trip("12:00"), NY)!, rental, buffer)).toBe("buffer");
  });

  it("allows a pickup five hours after the car comes back", () => {
    expect(timedClash(tripInterval(trip("15:00"), NY)!, rental, buffer)).toBeNull();
  });

  it("allows a pickup exactly at the end of the buffer", () => {
    expect(timedClash(tripInterval(trip("14:00"), NY)!, rental, buffer)).toBeNull();
  });

  it("calls an overlap 'rented', not 'buffer'", () => {
    expect(timedClash(tripInterval(trip("09:00"), NY)!, rental, buffer)).toBe("rented");
    expect(timedClash(tripInterval({ pickupDate: "2026-11-10", pickupTime: "10:00", dropoffDate: "2026-11-11", dropoffTime: "12:00" }, NY)!, rental, buffer)).toBe("rented");
  });

  it("guards the next rental's pickup as well as the last one's return", () => {
    // Returning at 08:00 on the 11th, two hours before the gap rental goes out.
    const before = tripInterval({ pickupDate: "2026-11-09", pickupTime: "10:00", dropoffDate: "2026-11-11", dropoffTime: "08:00" }, NY)!;
    expect(timedClash(before, rental, buffer)).toBe("buffer");
    const earlier = tripInterval({ pickupDate: "2026-11-09", pickupTime: "10:00", dropoffDate: "2026-11-11", dropoffTime: "06:00" }, NY)!;
    expect(timedClash(earlier, rental, buffer)).toBeNull();
  });

  it("is plain overlap when the tenant has no buffer", () => {
    expect(timedClash(tripInterval(trip("10:00"), NY)!, rental, 0)).toBeNull();
    expect(timedClash(tripInterval(trip("09:45"), NY)!, rental, 0)).toBe("rented");
  });
});

describe("rentalInterval", () => {
  it("keeps whole-day behaviour for rows without times", () => {
    const iv = rentalInterval({ status: "Pending", start_date: "2026-11-11", end_date: "2026-11-12" }, NY, today)!;
    expect(iv.start).toBe(wallClockToMs("2026-11-11", "00:00", NY, "00:00"));
    expect(iv.end).toBe(wallClockToMs("2026-11-12", "23:59:59", NY, "00:00"));
    expect(iv.end - iv.start).toBeGreaterThan(47 * HOUR);
  });

  it("holds the car indefinitely for open-ended and overdue rentals", () => {
    expect(rentalInterval({ status: "Active", start_date: "2026-11-01", end_date: null }, NY, today)!.end).toBe(Number.POSITIVE_INFINITY);
    expect(rentalInterval({ status: "Active", start_date: "2026-11-01", end_date: "2026-11-05", return_time: "10:00" }, NY, today)!.end).toBe(Number.POSITIVE_INFINITY);
    // A Pending rental that is overdue on paper has not gone out; its dates stand.
    expect(rentalInterval({ status: "Pending", start_date: "2026-11-01", end_date: "2026-11-05" }, NY, today)!.end).toBeLessThan(Number.POSITIVE_INFINITY);
  });
});

describe("heldDays", () => {
  const horizon = "2027-11-10";

  it("greys out only the days held from midnight to midnight", () => {
    expect(heldDays({ status: "Pending", start_date: "2026-11-11", pickup_time: "10:00", end_date: "2026-11-14", return_time: "10:00" }, today, horizon)).toEqual({
      whole: ["2026-11-12", "2026-11-13"],
      partial: ["2026-11-11", "2026-11-14"],
    });
  });

  it("holds whole days for rows without times", () => {
    expect(heldDays({ status: "Pending", start_date: "2026-11-11", end_date: "2026-11-12" }, today, horizon)).toEqual({
      whole: ["2026-11-11", "2026-11-12"],
      partial: [],
    });
  });

  it("treats a same-day rental with times as one partial day", () => {
    expect(heldDays({ status: "Pending", start_date: "2026-11-11", pickup_time: "10:00", end_date: "2026-11-11", return_time: "15:00" }, today, horizon)).toEqual({
      whole: [],
      partial: ["2026-11-11"],
    });
  });

  it("paints open-ended rentals forward to the horizon", () => {
    const held = heldDays({ status: "Active", start_date: "2026-11-01", end_date: null }, today, "2026-11-03");
    expect(held.whole).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
  });
});

describe("overlapsLikeTrigger", () => {
  it("lets a pickup go out two hours after the same-day return (the 2026-10-30 trigger rule)", () => {
    const back = { status: "Completed", start_date: "2026-10-27", pickup_time: "10:00:00", end_date: "2026-10-29", return_time: "10:00:00" };
    expect(overlapsLikeTrigger(back, { pickupDate: "2026-10-29", pickupTime: "12:00", dropoffDate: "2026-10-31", dropoffTime: "12:00" })).toBe(false);
    expect(overlapsLikeTrigger(back, { pickupDate: "2026-10-29", pickupTime: "09:00", dropoffDate: "2026-10-31", dropoffTime: "12:00" })).toBe(true);
  });

  it("keeps whole days for rows without times, and ignores released rentals", () => {
    const untimed = { status: "Pending", start_date: "2026-10-27", end_date: "2026-10-29" };
    expect(overlapsLikeTrigger(untimed, { pickupDate: "2026-10-29", pickupTime: "12:00", dropoffDate: "2026-10-31", dropoffTime: "12:00" })).toBe(true);
    expect(overlapsLikeTrigger({ ...untimed, status: "Cancelled" }, { pickupDate: "2026-10-29", pickupTime: "12:00", dropoffDate: "2026-10-31", dropoffTime: "12:00" })).toBe(false);
    expect(overlapsLikeTrigger({ ...untimed, end_date: null }, { pickupDate: "2027-01-01", pickupTime: "12:00", dropoffDate: "2027-01-03", dropoffTime: "12:00" })).toBe(true);
  });
});
