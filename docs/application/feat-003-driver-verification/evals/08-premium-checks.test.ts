import { describe, expect, it } from "vitest";
import { premiumLine } from "../../../../supabase/functions/_shared/verification/rentid-map";

// Spec 08 · a RentID answer → our line. Report shapes from RentID's API Reference § Report Schemas.

describe("08 licence status answers", () => {
  it("08.15 valid is a pass, with no warning", () => {
    expect(premiumLine("licence_status", { driver_license_check: { outcome: "valid", passenger_license: { status: "valid" } } }))
      .toEqual({ result: "pass", line: "Licence active: valid", warning: null });
  });

  it.each(["suspended", "revoked", "expired", "inactive", "invalid"])("08.15 %s is a fail that says the status", (status) => {
    const r = premiumLine("licence_status", { outcome: "not_valid", passenger_license: { status }, completed_at: "2026-12-02T10:00:00Z" });
    expect(r.result).toBe("fail");
    expect(r.line).toBe(`Licence active: ${status}`);
  });

  it("08.17 a bad answer sets the customer's warning with the date", () => {
    const r = premiumLine("licence_status", { outcome: "not_valid", passenger_license: { status: "suspended" }, completed_at: "2026-12-02T10:00:00Z" });
    expect(r.warning).toBe("Licence suspended (state check, 2026-12-02)");
  });

  it("08.15 restricted and not_found are finished answers (a fail line)", () => {
    expect(premiumLine("licence_status", { outcome: "restricted", passenger_license: { status: "provisional" } }).result).toBe("fail");
    expect(premiumLine("licence_status", { outcome: "not_found", passenger_license: { status: "not_found" } }).line).toBe("Licence active: not_found");
  });

  it("08.16 pending or failed is could_not_check", () => {
    expect(premiumLine("licence_status", { outcome: "failed" }).result).toBe("could_not_check");
    expect(premiumLine("licence_status", null).result).toBe("could_not_check");
  });
});

describe("08 driving record and criminal record answers (switched off; mapped for when they go on)", () => {
  it("08.20 a clear driving record passes", () => {
    expect(premiumLine("driving_record", { outcome: "clear", violations: [], accidents: [], suspensions: [] }).result).toBe("pass");
  });
  it("08.20 a DUI is read from the violation's words", () => {
    const r = premiumLine("driving_record", { outcome: "consider", violations: [{ description: "DUI - alcohol", points: 4 }, { description: "Speeding", points: 2 }], accidents: [{}], suspensions: [] });
    expect(r.result).toBe("fail");
    expect(r.line).toBe("Driving record: 2 violations (1 DUI), 6 points, 1 accident, 0 suspensions");
  });
  it("08.20 a criminal record with records found is a fail with the count", () => {
    expect(premiumLine("criminal_record", { outcome: "records_found", record_count: 2 }).line).toBe("Criminal record: 2 records found");
    expect(premiumLine("criminal_record", { outcome: "clear" }).result).toBe("pass");
  });
});
