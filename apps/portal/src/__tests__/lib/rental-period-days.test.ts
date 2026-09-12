import { describe, expect, it } from "vitest";
import { rentalPeriodDays } from "@/components/timeline-v2/rental-period-days";
import { rentalSegments } from "@/components/timeline-v2/model";
import { FIXTURE_DATA } from "@/app/playground/timeline/fixtures";

const original = { ...FIXTURE_DATA.bookings[0], end: "2026-09-13", segment: "Original rental" };
const extension = { ...original, id: "test-extension", segment: "Extension #1", start: "2026-09-14", end: "2026-09-16", preview: true };

describe("individual rental date boxes", () => {
  it("shows the complete month and colors only actual original and extension dates", () => {
    const periods = [original, extension];
    const before = structuredClone(periods);
    const days = rentalPeriodDays(periods, "2026-09-01", "2026-09-17");
    expect(days).toHaveLength(30);
    expect(days[0].date).toBe("2026-09-01");
    expect(days.at(-1)?.date).toBe("2026-09-30");
    expect(days.slice(9, 17).map(d => d.periods.map(p => p.index))).toEqual([[0], [0], [0], [0], [1], [1], [1], []]);
    expect(days.filter(d => d.date < original.start || d.date > extension.end).every(d => d.periods.length === 0)).toBe(true);
    expect(days.find(d => d.date === "2026-09-17")?.next).toBe(true);
    expect(periods).toEqual(before);
  });
  it("keeps a recorded shared return day assigned to both actual periods", () => {
    const periods = rentalSegments({ ...original, end: "2026-09-16", returnTime: "12:00" }, [{ id: "recorded", sequence_number: 1, previous_end_date: "2026-09-13", new_end_date: "2026-09-16", status: "paid", total_amount: null }]);
    const boundary = rentalPeriodDays(periods, "2026-09-01").find(d => d.date === "2026-09-13")!;
    expect(boundary.periods.map(p => [p.period.segment, p.from, p.to])).toEqual([["Original rental", 0, .5], ["Extension #1", .5, 1]]);
  });
  it("respects exclusive midnight returns without inventing a rented day", () => {
    const days = rentalPeriodDays([{ ...original, returnTime: "00:00" }], "2026-09-01");
    expect(days.find(d => d.date === "2026-09-12")?.periods).toHaveLength(1);
    expect(days.find(d => d.date === "2026-09-13")?.periods).toHaveLength(0);
  });
  it("keeps real gaps neutral and does not produce a next slot for read-only views", () => {
    const days = rentalPeriodDays([original, { ...extension, start: "2026-09-15" }], "2026-09-01");
    expect(days.find(d => d.date === "2026-09-14")?.periods).toHaveLength(0);
    expect(days.some(d => d.next)).toBe(false);
  });
  it("shows real month lengths across years and bounds long rentals to one month", () => {
    const long = { ...original, start: "2027-12-30", end: "2029-03-03" };
    const december = rentalPeriodDays([long], "2027-12-01");
    expect(december).toHaveLength(31);
    expect(december.filter(d => d.periods.length).map(d => d.date)).toEqual(["2027-12-30", "2027-12-31"]);
    expect(rentalPeriodDays([long], "2028-02-01")).toHaveLength(29);
    expect(rentalPeriodDays([long], "2029-02-01")).toHaveLength(28);
    expect(rentalPeriodDays([{ ...long, end: null }], "2028-02-01")).toEqual([]);
  });
});
