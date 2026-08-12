import { describe, expect, it } from "vitest";
import {
  blockBlocksQuoteWindow,
  buildFleetQuote,
  escapeQuoteHtml,
  formatQuoteHtml,
  formatQuotePlainText,
  isValidQuoteEmail,
  isValidQuoteReference,
  quoteStartsBeforeNow,
  quoteLinesChanged,
  rentalBlocksQuoteWindow,
  safeQuoteFilename,
  shiftLocalDate,
  validateQuoteRange,
  type FleetQuoteConfig,
  type FleetQuoteLine,
  type FleetQuoteVehicle,
} from "@/lib/fleet-quote";

const search = {
  startDate: "2026-08-20",
  endDate: "2026-08-23",
  pickupTime: "09:00",
  returnTime: "09:00",
};

const config: FleetQuoteConfig = {
  ...search,
  bufferMinutes: 0,
  monthlyTierDays: 30,
  weekendConfig: null,
  holidays: [],
  overrides: [],
  dailyPrices: [],
  today: "2026-08-12",
  timezone: "UTC",
};

function vehicle(overrides: Partial<FleetQuoteVehicle> = {}): FleetQuoteVehicle {
  return {
    id: "vehicle-1",
    reg: "ABC123",
    make: "Toyota",
    model: "Camry",
    status: "Available",
    available_daily: true,
    available_weekly: true,
    available_monthly: true,
    daily_rent: 100,
    weekly_rent: 560,
    monthly_rent: 1_800,
    ...overrides,
  };
}

describe("fleet quote date validation", () => {
  it("accepts an ordinary multi-day range", () => {
    expect(validateQuoteRange("2026-08-20", "2026-08-23", "09:00", "09:00")).toBeNull();
  });

  it("accepts a same-day rental only when return time is later", () => {
    expect(validateQuoteRange("2026-08-20", "2026-08-20", "09:00", "17:00")).toBeNull();
    expect(validateQuoteRange("2026-08-20", "2026-08-20", "17:00", "09:00")).toMatch(/after pickup/i);
  });

  it("rejects rollover dates, malformed times, and reversed ranges", () => {
    expect(validateQuoteRange("2026-02-30", "2026-03-02", "09:00", "09:00")).toMatch(/valid/i);
    expect(validateQuoteRange("2026-08-20", "2026-08-23", "25:00", "09:00")).toMatch(/valid/i);
    expect(validateQuoteRange("2026-08-23", "2026-08-20", "09:00", "09:00")).toMatch(/after pickup/i);
  });

  it("handles leap days and calendar shifts across month/year boundaries", () => {
    expect(validateQuoteRange("2028-02-29", "2028-03-01", "09:00", "09:00")).toBeNull();
    expect(validateQuoteRange("2027-02-29", "2027-03-01", "09:00", "09:00")).toMatch(/valid/i);
    expect(shiftLocalDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftLocalDate("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("compares pickup against the tenant timezone, including same-day past times", () => {
    const beforePickup = Date.parse("2026-08-20T12:59:00.000Z");
    const afterPickup = Date.parse("2026-08-20T13:01:00.000Z");
    expect(quoteStartsBeforeNow("2026-08-20", "09:00", "America/New_York", beforePickup)).toBe(false);
    expect(quoteStartsBeforeNow("2026-08-20", "09:00", "America/New_York", afterPickup)).toBe(true);
  });

  it("rejects a nonexistent wall-clock time during the tenant's DST spring gap", () => {
    expect(validateQuoteRange(
      "2026-03-08",
      "2026-03-08",
      "02:30",
      "04:00",
      "America/New_York",
    )).toMatch(/valid local times/i);
    expect(validateQuoteRange(
      "2026-03-08",
      "2026-03-08",
      "01:30",
      "04:00",
      "America/New_York",
    )).toBeNull();
  });
});

describe("fleet quote occupancy", () => {
  it("blocks every holding rental status but ignores released terminal rentals", () => {
    for (const status of ["Pending", "Active", "Upcoming", "Confirmed", "Started"]) {
      expect(rentalBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-08-19", end_date: "2026-08-21", status }, config)).toBe(true);
    }
    for (const status of ["Cancelled", "Rejected"]) {
      expect(rentalBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-08-19", end_date: "2026-08-21", status }, config)).toBe(false);
    }
    for (const status of ["Closed", "Completed"]) {
      expect(rentalBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-08-10", end_date: "2026-08-18", status }, config)).toBe(false);
    }
  });

  it("normalizes status casing/whitespace and ignores rentals without a vehicle", () => {
    expect(rentalBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-08-19", end_date: "2026-08-21", status: "  CONFIRMED " }, config)).toBe(true);
    expect(rentalBlocksQuoteWindow({ vehicle_id: null, start_date: "2026-08-19", end_date: null, status: "Active" }, config)).toBe(false);
  });

  it("blocks open-ended PAYG and overdue active rentals", () => {
    expect(rentalBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-01-01", end_date: null, status: "Active", is_pay_as_you_go: true }, config)).toBe(true);
    expect(rentalBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-01-01", end_date: "2026-02-01", status: "Active" }, config)).toBe(true);
  });

  it("does not block a PAYG rental explicitly closed even if status propagation is late", () => {
    expect(rentalBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-01-01", end_date: null, status: "Active", is_pay_as_you_go: true, payg_closed_at: "2026-08-01T12:00:00Z" }, config)).toBe(false);
  });

  it("does not release an active PAYG rental when its closure timestamp is corrupt", () => {
    expect(rentalBlocksQuoteWindow({
      vehicle_id: "v",
      start_date: "2026-01-01",
      end_date: null,
      status: "Active",
      is_pay_as_you_go: true,
      payg_closed_at: "not-a-timestamp",
    }, config)).toBe(true);
  });

  it("applies turnaround buffer on both sides of an adjacent booking", () => {
    const buffered = { ...config, bufferMinutes: 120 };
    expect(rentalBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-08-23", end_date: "2026-08-24", pickup_time: "10:00", return_time: "10:00", status: "Confirmed" }, buffered)).toBe(true);
    expect(rentalBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-08-23", end_date: "2026-08-24", pickup_time: "12:01", return_time: "10:00", status: "Confirmed" }, buffered)).toBe(false);
  });

  it("applies post-rental buffer before pickup and frees the exact boundary", () => {
    const priorRental = {
      vehicle_id: "v",
      start_date: "2026-08-18",
      end_date: "2026-08-20",
      pickup_time: "09:00",
      return_time: "08:00",
      status: "Confirmed",
    };
    expect(rentalBlocksQuoteWindow(priorRental, { ...config, bufferMinutes: 120, pickupTime: "09:59" })).toBe(true);
    expect(rentalBlocksQuoteWindow(priorRental, { ...config, bufferMinutes: 120, pickupTime: "10:00" })).toBe(false);
  });

  it("honours post-return buffer for completed or closed rentals and frees the exact boundary", () => {
    const buffered = { ...config, bufferMinutes: 120, pickupTime: "09:00" };
    const completed = {
      vehicle_id: "v",
      start_date: "2026-08-19",
      end_date: "2026-08-20",
      return_time: "08:00",
      status: "Completed",
    };
    expect(rentalBlocksQuoteWindow(completed, buffered)).toBe(true);
    expect(rentalBlocksQuoteWindow({ ...completed, status: "Closed" }, buffered)).toBe(true);
    expect(rentalBlocksQuoteWindow(completed, { ...buffered, pickupTime: "10:00" })).toBe(false);
    expect(rentalBlocksQuoteWindow(completed, { ...buffered, bufferMinutes: 0 })).toBe(false);
  });

  it("allows exactly adjacent bookings when no turnaround buffer is configured", () => {
    const adjacent = {
      vehicle_id: "v",
      start_date: "2026-08-23",
      end_date: "2026-08-24",
      pickup_time: "09:00",
      return_time: "09:00",
      status: "Confirmed",
    };
    expect(rentalBlocksQuoteWindow(adjacent, config)).toBe(false);
  });

  it("uses an explicit PAYG closure timestamp for its post-return buffer", () => {
    const payg = {
      vehicle_id: "v",
      start_date: "2026-08-01",
      end_date: null,
      status: "Active",
      is_pay_as_you_go: true,
      payg_closed_at: "2026-08-20T07:30:00.000Z",
    };
    expect(rentalBlocksQuoteWindow(payg, { ...config, bufferMinutes: 120 })).toBe(true);
    expect(rentalBlocksQuoteWindow(payg, { ...config, pickupTime: "10:00", bufferMinutes: 120 })).toBe(false);
  });

  it("treats both tenant-wide and vehicle-specific overlapping blocks as conflicts", () => {
    expect(blockBlocksQuoteWindow({ vehicle_id: null, start_date: "2026-08-21", end_date: "2026-08-21" }, search.startDate, search.endDate)).toBe(true);
    expect(blockBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-08-24", end_date: "2026-08-25" }, search.startDate, search.endDate)).toBe(false);
  });

  it("treats either inclusive block boundary as a conflict", () => {
    expect(blockBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-08-23", end_date: "2026-08-25" }, search.startDate, search.endDate)).toBe(true);
    expect(blockBlocksQuoteWindow({ vehicle_id: "v", start_date: "2026-08-18", end_date: "2026-08-20" }, search.startDate, search.endDate)).toBe(true);
  });
});

describe("buildFleetQuote", () => {
  it("accounts for every unique vehicle and sorts available totals lowest first", () => {
    const vehicles = [
      vehicle({ id: "expensive", daily_rent: 120 }),
      vehicle({ id: "cheap", reg: "CHEAP", daily_rent: 80 }),
      vehicle({ id: "maintenance", status: "Maintenance" }),
      vehicle({ id: "missing", daily_rent: null, weekly_rent: null, monthly_rent: null }),
      vehicle({ id: "cheap", reg: "DUPLICATE", daily_rent: 1 }),
    ];
    const result = buildFleetQuote(vehicles, [], [], config);
    expect(result.available.map((line) => line.vehicleId)).toEqual(["cheap", "expensive"]);
    expect(result.excluded.map((line) => line.vehicleId).sort()).toEqual(["maintenance", "missing"]);
    expect(result.available.length + result.excluded.length).toBe(4);
  });

  it("allows a Rented vehicle when its booking does not overlap", () => {
    const result = buildFleetQuote(
      [vehicle({ status: "Rented" })],
      [{ vehicle_id: "vehicle-1", start_date: "2026-09-01", end_date: "2026-09-05", status: "Confirmed" }],
      [],
      config,
    );
    expect(result.available).toHaveLength(1);
  });

  it("does not quote a vehicle whose own status says it is actively out", () => {
    const result = buildFleetQuote([vehicle({ status: "Active" })], [], [], config);
    expect(result.available).toHaveLength(0);
    expect(result.excluded[0].reason).toBe("Not rentable");
  });

  it("excludes disposed, maintenance, unknown-status, and statusless vehicles", () => {
    const result = buildFleetQuote([
      vehicle({ id: "disposed", is_disposed: true }),
      vehicle({ id: "maintenance", status: "Maintenance" }),
      vehicle({ id: "unknown", status: "SomethingNew" }),
      vehicle({ id: "statusless", status: null }),
    ], [], [], config);
    expect(result.available).toHaveLength(0);
    expect(result.excluded).toHaveLength(4);
    expect(result.excluded.every((item) => item.reason === "Not rentable")).toBe(true);
  });

  it("keeps legacy null duration flags enabled", () => {
    const result = buildFleetQuote([vehicle({
      available_daily: null,
      available_weekly: null,
      available_monthly: null,
    })], [], [], config);
    expect(result.available).toHaveLength(1);
  });

  it("enforces daily, weekly, and monthly availability flags at their boundaries", () => {
    const daily = buildFleetQuote([vehicle({ available_daily: false })], [], [], config);
    expect(daily.excluded[0].reason).toBe("Duration not enabled");

    const weekly = buildFleetQuote([vehicle({ available_weekly: false })], [], [], {
      ...config,
      endDate: "2026-08-27",
    });
    expect(weekly.excluded[0].reason).toBe("Duration not enabled");

    const monthly = buildFleetQuote([vehicle({ available_monthly: false })], [], [], {
      ...config,
      endDate: "2026-09-19",
    });
    expect(monthly.excluded[0].reason).toBe("Duration not enabled");
  });

  it("uses the shared tier pricing engine", () => {
    const result = buildFleetQuote([vehicle()], [], [], {
      ...config,
      endDate: "2026-08-27", // seven billable days
    });
    expect(result.available[0].pricingTier).toBe("weekly");
    expect(result.available[0].total).toBe(560);
    expect(result.available[0].effectiveDailyRate).toBe(80);
  });

  it("uses one billable day for a valid same-day rental", () => {
    const result = buildFleetQuote([vehicle()], [], [], {
      ...config,
      endDate: config.startDate,
      returnTime: "17:00",
    });
    expect(result.rentalDays).toBe(1);
    expect(result.available[0].total).toBe(100);
  });

  it("uses calendar days across DST fall-back instead of elapsed 25-hour days", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const result = buildFleetQuote([vehicle()], [], [], {
        ...config,
        startDate: "2026-11-01",
        endDate: "2026-11-02",
      });
      expect(result.rentalDays).toBe(1);
      expect(result.available[0].rentalDays).toBe(1);
      expect(result.available[0].total).toBe(100);
    } finally {
      process.env.TZ = originalTimezone;
    }
  });

  it("falls back to another positive tier when the preferred tier rate is missing", () => {
    const weeklyFallback = buildFleetQuote([vehicle({ weekly_rent: null })], [], [], {
      ...config,
      endDate: "2026-08-27",
    });
    expect(weeklyFallback.available[0].pricingTier).toBe("daily");
    expect(weeklyFallback.available[0].total).toBe(700);

    const noDaily = buildFleetQuote([vehicle({ daily_rent: null })], [], [], config);
    expect(noDaily.available[0].pricingTier).toBe("weekly");
    expect(noDaily.available[0].total).toBe(240);
  });

  it("rejects a pickup timestamp that is already past when now is supplied", () => {
    expect(() => buildFleetQuote([vehicle()], [], [], {
      ...config,
      startDate: "2026-08-12",
      endDate: "2026-08-13",
      pickupTime: "09:00",
      nowMs: Date.parse("2026-08-12T09:01:00.000Z"),
    })).toThrow(/future/i);
  });

  it("applies manual daily prices and marks the quote as dynamic", () => {
    const result = buildFleetQuote([vehicle()], [], [], {
      ...config,
      dailyPrices: [{ vehicle_id: "vehicle-1", date: "2026-08-20", price: 250 }],
    });
    expect(result.available[0].total).toBe(450);
    expect(result.available[0].hasDynamicPricing).toBe(true);
  });

  it("applies weekend pricing and an annual holiday spanning New Year", () => {
    const weekend = buildFleetQuote([vehicle()], [], [], {
      ...config,
      startDate: "2026-08-22",
      endDate: "2026-08-23",
      weekendConfig: {
        weekend_surcharge_percent: 25,
        weekend_days: [6, 0],
      },
    });
    expect(weekend.available[0].total).toBe(125);
    expect(weekend.available[0].hasDynamicPricing).toBe(true);

    const annualHoliday = buildFleetQuote([vehicle()], [], [], {
      ...config,
      startDate: "2026-12-25",
      endDate: "2026-12-26",
      holidays: [{
        id: "winter",
        name: "Winter period",
        start_date: "2020-11-15",
        end_date: "2021-02-15",
        surcharge_percent: 50,
        excluded_vehicle_ids: [],
        recurs_annually: true,
      }],
    });
    expect(annualHoliday.available[0].total).toBe(150);
  });

  it("honours holiday vehicle exclusions and stacked weekend/holiday surcharges", () => {
    const holiday = {
      id: "holiday",
      name: "Special day",
      start_date: "2026-08-22",
      end_date: "2026-08-22",
      surcharge_percent: 20,
      excluded_vehicle_ids: ["excluded"],
      recurs_annually: false,
    };
    const result = buildFleetQuote([
      vehicle({ id: "stacked" }),
      vehicle({ id: "excluded" }),
    ], [], [], {
      ...config,
      startDate: "2026-08-22",
      endDate: "2026-08-23",
      weekendConfig: {
        weekend_surcharge_percent: 10,
        weekend_days: [6],
        stack_surcharges: true,
      },
      holidays: [holiday],
    });
    expect(result.available.find((line) => line.vehicleId === "stacked")?.total).toBe(130);
    expect(result.available.find((line) => line.vehicleId === "excluded")?.total).toBe(110);
  });

  it("uses disabled, global, and per-vehicle deposit settings correctly", () => {
    const baseVehicle = vehicle({ security_deposit: 500 });
    const disabled = buildFleetQuote([baseVehicle], [], [], {
      ...config,
      securityDepositEnabled: false,
      depositMode: "per_vehicle",
    });
    expect(disabled.available[0].securityDeposit).toBeNull();

    const global = buildFleetQuote([baseVehicle], [], [], {
      ...config,
      securityDepositEnabled: true,
      depositMode: "global",
      globalSecurityDeposit: 750,
    });
    expect(global.available[0].securityDeposit).toBe(750);

    const perVehicle = buildFleetQuote([baseVehicle], [], [], {
      ...config,
      securityDepositEnabled: true,
      depositMode: "per_vehicle",
      globalSecurityDeposit: 750,
    });
    expect(perVehicle.available[0].securityDeposit).toBe(500);
  });

  it("chooses deterministic vehicle identity and photo fallbacks", () => {
    const result = buildFleetQuote([vehicle({
      make: null,
      model: null,
      year: null,
      photo_url: null,
      vehicle_photos: [
        { photo_url: "second.jpg", display_order: 2 },
        { photo_url: "first.jpg", display_order: 1 },
      ],
    })], [], [], config);
    expect(result.available[0].name).toBe("ABC123");
    expect(result.available[0].photoUrl).toBe("first.jpg");
  });

  it("a global blocked date excludes the entire otherwise-available fleet", () => {
    const result = buildFleetQuote(
      [vehicle({ id: "one" }), vehicle({ id: "two" })],
      [],
      [{ vehicle_id: null, start_date: "2026-08-22", end_date: "2026-08-22", reason: "Closed" }],
      config,
    );
    expect(result.available).toHaveLength(0);
    expect(result.excluded).toHaveLength(2);
    expect(result.excluded.every((line) => line.reason === "Blocked")).toBe(true);
  });
});

describe("quote snapshot safety", () => {
  const line: FleetQuoteLine = {
    vehicleId: "v",
    registration: "ABC",
    name: "Car",
    category: null,
    photoUrl: null,
    total: 300,
    rentalDays: 3,
    pricingTier: "daily",
    effectiveDailyRate: 100,
    securityDeposit: null,
    hasDynamicPricing: false,
    priceFingerprint: "2026-08-20:100.00",
  };

  it("detects removed vehicles, changed totals, and changed daily breakdowns", () => {
    expect(quoteLinesChanged([line], [])).toBe(true);
    expect(quoteLinesChanged([line], [{ ...line, total: 301 }])).toBe(true);
    expect(quoteLinesChanged([line], [{ ...line, priceFingerprint: "changed" }])).toBe(true);
    expect(quoteLinesChanged([line], [{ ...line, securityDeposit: 500 }])).toBe(true);
    expect(quoteLinesChanged([line], [{ ...line, registration: "XYZ" }])).toBe(true);
    expect(quoteLinesChanged([line], [{ ...line, name: "Renamed car" }])).toBe(true);
    expect(quoteLinesChanged([line], [{ ...line, category: "SUV" }])).toBe(true);
    expect(quoteLinesChanged([line], [{ ...line, pricingTier: "weekly" }])).toBe(true);
    expect(quoteLinesChanged([line], [{ ...line, effectiveDailyRate: 99 }])).toBe(true);
    expect(quoteLinesChanged([line], [{ ...line }])).toBe(false);
  });

  it("is order-independent but detects added selected vehicles", () => {
    const another = { ...line, vehicleId: "another", registration: "DEF" };
    expect(quoteLinesChanged([line, another], [another, line])).toBe(false);
    expect(quoteLinesChanged([line], [line, another])).toBe(true);
  });

  it("escapes operator and customer content before building email HTML", () => {
    expect(escapeQuoteHtml(`<script>alert("x")</script>`)).not.toContain("<script>");
    const html = formatQuoteHtml({
      companyName: "Rental <Co>",
      customerName: `<img src=x onerror=alert(1)>`,
      quoteReference: "QT-1",
      ...search,
      currency: "USD",
      lines: [line],
      note: `<script>bad()</script>`,
    });
    expect(html).not.toContain("<script>bad()</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;Co&gt;");
  });

  it("includes a configured security deposit in customer-facing output", () => {
    const payload = {
      companyName: "Rental Co",
      quoteReference: "QT-1",
      ...search,
      currency: "USD",
      lines: [{ ...line, securityDeposit: 500 }],
    };
    expect(formatQuotePlainText(payload)).toMatch(/security deposit.*500/i);
    expect(formatQuoteHtml(payload)).toMatch(/security deposit[\s\S]*500/i);
  });

  it("hides registration from customer output when the tenant setting requires it", () => {
    const payload = {
      companyName: "Rental Co",
      quoteReference: "QT-1",
      ...search,
      currency: "USD",
      lines: [line],
      hideVehicleRegistration: true,
    };
    expect(formatQuotePlainText(payload)).not.toContain("ABC");
    expect(formatQuoteHtml(payload)).not.toContain("ABC");
    expect(formatQuotePlainText({ ...payload, hideVehicleRegistration: false })).toContain("ABC");
  });

  it("escapes every customer-controlled HTML field and preserves note line breaks safely", () => {
    const html = formatQuoteHtml({
      companyName: `<Company & "Co">`,
      customerName: `O'Reilly <Customer>`,
      quoteReference: `<QT&1>`,
      startDate: `<date>`,
      endDate: `</date>`,
      pickupTime: `09:00`,
      returnTime: `10:00`,
      currency: "USD",
      validUntil: `<expiry>`,
      note: `first line\n<img src=x onerror=alert(1)>`,
      lines: [{ ...line, name: `<Car>`, registration: `A&B`, category: `<SUV>` }],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<Car>");
    expect(html).toContain("first line<br>&lt;img");
    expect(html).toContain("A&amp;B");
  });

  it("falls back safely when a tenant currency code is invalid", () => {
    const text = formatQuotePlainText({
      companyName: "Rental Co",
      quoteReference: "QT-1",
      ...search,
      currency: "NOT-A-CURRENCY",
      lines: [line],
    });
    expect(text).toContain("NOT-A-CURRENCY 300.00");
  });
});

describe("quote customer input validation", () => {
  it("accepts ordinary and plus-address emails", () => {
    expect(isValidQuoteEmail("customer@example.com")).toBe(true);
    expect(isValidQuoteEmail("customer+quotes@sub.example.co.uk")).toBe(true);
  });

  it("rejects whitespace, multiple-at, dotted-local, and invalid-domain emails", () => {
    for (const email of [
      "",
      "customer",
      "customer@@example.com",
      ".customer@example.com",
      "customer..name@example.com",
      "customer@example",
      "customer@-example.com",
      "customer@example-.com",
      "customer example@example.com",
      `customer@example.com\r\nBcc:attacker@example.com`,
    ]) {
      expect(isValidQuoteEmail(email), email).toBe(false);
    }
  });

  it("validates quote references and creates safe filenames", () => {
    expect(isValidQuoteReference(" QT-123 ")).toBe(true);
    expect(isValidQuoteReference("   ")).toBe(false);
    expect(isValidQuoteReference("QT-1\nBcc: attacker@example.com")).toBe(false);
    expect(isValidQuoteReference("x".repeat(61))).toBe(false);
    expect(safeQuoteFilename("QT / Customer: 001")).toBe("QT-Customer-001");
    expect(safeQuoteFilename("///")).toBe("fleet-quote");
  });
});
