/** QA B4.5/B4.7: the booking flow's return floor follows the shortest rental on the clock, not in whole days. */
import { describe, expect, it } from "vitest";
import type { BookingRules } from "@nw/components/booking/booking-rules";
import { buildTimeSlots } from "@nw/components/booking/time-utils";
import {
  firstLegalReturn,
  firstLegalReturnDay,
  firstLegalReturnSlot,
  isReturnSlotLegal,
  tripHours,
} from "@nw/components/booking/trip-window";

// Northwind during QA B4: open 09:00–17:00 in New York, quarter-hour slots.
const rules = (minRentalHours: number): BookingRules =>
  ({
    minRentalHours,
    maxRentalDays: 14,
    leadTimeHours: 24,
    minimumAge: 21,
    monthlyTierDays: 30,
    operatorTimezone: "America/New_York",
    timeSlots: buildTimeSlots({ enforceWorkingHours: true, open: "09:00", close: "17:00", stepMinutes: 15 }),
    workingHours: { open: "09:00", close: "17:00" },
    bufferMinutes: 240,
    installmentsEnabled: false,
    smsConsentRequired: false,
    collectPaymentUpfront: true,
    fixedPickupAddress: null,
    fixedReturnAddress: null,
  }) as BookingRules;

describe("firstLegalReturnDay", () => {
  it("lets a 10:00 pickup come back the next day under a 1 day 2 hours minimum", () => {
    expect(firstLegalReturnDay("2026-11-12", "10:00", rules(26))).toBe("2026-11-13");
    // The whole-day rule would have said two days.
    expect(firstLegalReturn("2026-11-12", rules(26))).toBe("2026-11-14");
  });

  it("waits a day more when the operator closes before the minimum is up", () => {
    // 16:45 + 26 h = 18:45 the next day, after the 17:00 close.
    expect(firstLegalReturnDay("2026-11-12", "16:45", rules(26))).toBe("2026-11-14");
  });

  it("is the next day for a 1-day minimum and two days for 48 hours", () => {
    expect(firstLegalReturnDay("2026-11-12", "10:00", rules(24))).toBe("2026-11-13");
    expect(firstLegalReturnDay("2026-11-12", "10:00", rules(48))).toBe("2026-11-14");
    expect(firstLegalReturnDay("2026-11-12", "10:00", rules(1))).toBe("2026-11-13");
  });

  it("falls back to whole days without a usable pickup time", () => {
    expect(firstLegalReturnDay("2026-11-12", "", rules(26))).toBe("2026-11-14");
  });
});

describe("isReturnSlotLegal and firstLegalReturnSlot", () => {
  const r = rules(26);

  it("judges each return slot by the hours since the pickup", () => {
    expect(tripHours("2026-11-12", "10:00", "2026-11-13", "12:00", r)).toBe(26);
    expect(isReturnSlotLegal("2026-11-12", "10:00", "2026-11-13", "12:00", r)).toBe(true);
    expect(isReturnSlotLegal("2026-11-12", "10:00", "2026-11-13", "11:45", r)).toBe(false);
    expect(isReturnSlotLegal("2026-11-12", "10:00", "2026-11-13", "10:00", r)).toBe(false);
  });

  it("keeps the preferred slot when it is far enough, else offers the first that is", () => {
    expect(firstLegalReturnSlot("2026-11-12", "10:00", "2026-11-13", r, "14:00")).toBe("14:00");
    expect(firstLegalReturnSlot("2026-11-12", "10:00", "2026-11-13", r, "10:00")).toBe("12:00");
    expect(firstLegalReturnSlot("2026-11-12", "16:45", "2026-11-13", r, "10:00")).toBeNull();
  });
});
