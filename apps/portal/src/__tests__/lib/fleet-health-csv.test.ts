import { describe, it, expect } from "vitest";
import {
  parseFleetHealthCsv,
  splitCsvLine,
  normaliseReg,
  CSV_TEMPLATE,
} from "@/lib/fleet-health-csv";

const FLEET = [
  { id: "v-1", reg: "AB12 CDE" },
  { id: "v-2", reg: "XY68ZZZ" },
  { id: "v-3", reg: null },
];

const parse = (csv: string) => parseFleetHealthCsv(csv, FLEET);

describe("splitCsvLine", () => {
  it("splits a plain line", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps a comma that sits inside quotes", () => {
    expect(splitCsvLine('AB12CDE,"Kwik Fit, Leeds",100')).toEqual([
      "AB12CDE",
      "Kwik Fit, Leeds",
      "100",
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(splitCsvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
  });

  it("preserves empty trailing fields", () => {
    expect(splitCsvLine("a,,")).toEqual(["a", "", ""]);
  });
});

describe("normaliseReg", () => {
  it("ignores case, spaces and hyphens", () => {
    expect(normaliseReg("AB12 CDE")).toBe(normaliseReg("ab12-cde"));
  });
});

describe("header handling", () => {
  it("accepts the documented template", () => {
    const r = parseFleetHealthCsv(CSV_TEMPLATE, FLEET);
    expect(r.rejected).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });

  it("matches aliases regardless of case, spaces or underscores", () => {
    const r = parse("Registration,Current Mileage\nAB12CDE,1000");
    expect(r.rows[0]).toMatchObject({ vehicleId: "v-1", reading: 1000 });
  });

  it("reports a file with no registration column instead of importing nothing silently", () => {
    const r = parse("odometer\n1000");
    expect(r.rows).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/registration column/i);
  });

  it("lists columns it did not recognise", () => {
    const r = parse("reg,odometer,colour\nAB12CDE,1000,red");
    expect(r.ignoredColumns).toContain("colour");
  });

  it("survives the BOM Excel writes onto the first header", () => {
    const r = parse("﻿reg,odometer\nAB12CDE,1000");
    expect(r.rows).toHaveLength(1);
  });

  it("takes the first of two columns claiming the same field", () => {
    const r = parse("reg,odometer,mileage\nAB12CDE,1000,9999");
    expect(r.rows[0].reading).toBe(1000);
  });
});

describe("vehicle matching", () => {
  it("matches a registration written without the space", () => {
    const r = parse("reg,odometer\nab12cde,500");
    expect(r.rows[0].vehicleId).toBe("v-1");
  });

  it("rejects a registration that belongs to no vehicle, naming the line", () => {
    const r = parse("reg,odometer\nAB12CDE,1\nNOPE1,2");
    expect(r.rows).toHaveLength(1);
    expect(r.rejected).toEqual([
      { line: 3, reg: "NOPE1", reason: "No vehicle with this registration" },
    ]);
  });

  it("never matches a vehicle whose own reg is null", () => {
    const r = parse("reg,odometer\n,500");
    expect(r.rows).toEqual([]);
    expect(r.rejected[0].reason).toBe("Missing registration");
  });

  it("takes the first row for a duplicated vehicle and rejects the rest", () => {
    const r = parse("reg,odometer\nAB12CDE,100\nab12 cde,200");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].reading).toBe(100);
    expect(r.rejected[0].reason).toBe("Duplicate row for this vehicle");
  });
});

describe("odometer values", () => {
  it("keeps a literal 0 — a real reading on a new vehicle", () => {
    const r = parse("reg,odometer\nAB12CDE,0");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].reading).toBe(0);
  });

  it("strips the thousands separators every spreadsheet emits", () => {
    const r = parse('reg,odometer\nAB12CDE,"42,150"');
    expect(r.rows[0].reading).toBe(42150);
  });

  it("rounds a decimal rather than storing it against an integer column", () => {
    const r = parse("reg,odometer\nAB12CDE,1000.6");
    expect(r.rows[0].reading).toBe(1001);
  });

  it("rejects a negative reading", () => {
    const r = parse("reg,odometer\nAB12CDE,-5");
    expect(r.rows).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/negative/);
  });

  it("rejects text in the odometer column", () => {
    const r = parse("reg,odometer\nAB12CDE,unknown");
    expect(r.rejected[0].reason).toMatch(/not a number/);
  });

  it("treats a blank odometer as absent, not as zero", () => {
    const r = parse("reg,odometer,last_service_date\nAB12CDE,,2026-01-05");
    expect(r.rows[0].reading).toBeUndefined();
    expect(r.rows[0].lastServiceDate).toBe("2026-01-05");
  });
});

describe("service dates", () => {
  it("accepts ISO and pads it", () => {
    const r = parse("reg,last_service_date\nAB12CDE,2026-3-4");
    expect(r.rows[0].lastServiceDate).toBe("2026-03-04");
  });

  it("resolves a slash date when only one ordering is possible", () => {
    const r = parse("reg,last_service_date\nAB12CDE,25/03/2026");
    expect(r.rows[0].lastServiceDate).toBe("2026-03-25");
  });

  it("refuses an ambiguous slash date rather than guessing the ordering", () => {
    const r = parse("reg,last_service_date\nAB12CDE,05/03/2026");
    expect(r.rows).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/ambiguous/);
  });

  it("rejects an impossible month", () => {
    const r = parse("reg,last_service_date\nAB12CDE,2026-13-01");
    expect(r.rejected[0].reason).toMatch(/not a valid date/);
  });

  it("will not take a service mileage with no date to attach it to", () => {
    const r = parse("reg,last_service_mileage\nAB12CDE,38000");
    expect(r.rows).toEqual([]);
    expect(r.rejected[0].reason).toMatch(/needs a last service date/);
  });
});

describe("whole-row outcomes", () => {
  it("rejects a row that carries nothing importable", () => {
    const r = parse("reg,odometer,last_service_date\nAB12CDE,,");
    expect(r.rows).toEqual([]);
    expect(r.rejected[0].reason).toBe("Nothing to import on this row");
  });

  it("skips blank lines without counting them as failures", () => {
    const r = parse("reg,odometer\nAB12CDE,100\n\n\nXY68ZZZ,200\n");
    expect(r.rows).toHaveLength(2);
    expect(r.rejected).toEqual([]);
  });

  it("reports line numbers as the operator sees them, header included", () => {
    const r = parse("reg,odometer\nAB12CDE,100\nNOPE,1");
    expect(r.rejected[0].line).toBe(3);
  });

  it("carries every field through when all three are present", () => {
    const r = parse("reg,odometer,last_service_date,last_service_mileage\nAB12CDE,42150,2026-03-14,38000");
    expect(r.rows[0]).toEqual({
      reg: "AB12CDE",
      vehicleId: "v-1",
      reading: 42150,
      lastServiceDate: "2026-03-14",
      lastServiceMileage: 38000,
    });
  });

  it("keeps going after a bad row instead of abandoning the file", () => {
    const r = parse("reg,odometer\nAB12CDE,oops\nXY68ZZZ,200");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].vehicleId).toBe("v-2");
    expect(r.rejected).toHaveLength(1);
  });

  it("handles CRLF, which is what a Windows export produces", () => {
    const r = parse("reg,odometer\r\nAB12CDE,100\r\nXY68ZZZ,200");
    expect(r.rows).toHaveLength(2);
  });

  it("returns empty for an empty file rather than throwing", () => {
    expect(parse("")).toEqual({ rows: [], rejected: [], ignoredColumns: [] });
  });
});
