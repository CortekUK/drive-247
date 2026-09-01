/**
 * CSV intake for Fleet Health setup (spec F1 step 6).
 *
 * WHY THIS EXISTS
 *
 * The setup screen walks vehicles one at a time, which is right for a fleet of
 * four and hopeless for a fleet of twenty-two sitting at zero coverage — and the
 * largest real fleets are at exactly zero. Those operators already keep the
 * numbers somewhere, almost always a spreadsheet, so the fastest path to a
 * useful Fleet Health is to let them paste the spreadsheet in.
 *
 * All parsing, validation and vehicle matching lives here rather than in the
 * dialog, because this is the part with edge cases worth pinning in tests and
 * the repo's convention is pure-logic Vitest only — nothing renders.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not convert units and it does not write. It reports what each row
 * means and leaves both to the existing writers, so a CSV import and a typed
 * reading go through identical code — including `toStoredMiles`, which is the
 * only thing standing between a kilometre tenant and a corrupted burn median.
 */

/** A row that parsed, matched a vehicle, and carries at least one usable value. */
export interface ParsedOdometerRow {
  /** Registration exactly as the operator typed it, for echoing back in errors. */
  reg: string;
  vehicleId: string;
  /** In the TENANT's unit — the caller converts. Absent if the column was blank. */
  reading?: number;
  /** ISO date (YYYY-MM-DD). Absent if the column was blank. */
  lastServiceDate?: string;
  /** In the TENANT's unit. Absent if the column was blank. */
  lastServiceMileage?: number;
}

export interface RejectedRow {
  /** 1-based line number in the file as the operator sees it, header included. */
  line: number;
  reg: string;
  reason: string;
}

export interface CsvParseResult {
  rows: ParsedOdometerRow[];
  rejected: RejectedRow[];
  /** Header names we could not place, so the operator can see what was ignored. */
  ignoredColumns: string[];
}

export interface MatchableVehicle {
  id: string;
  reg: string | null;
}

/**
 * Column aliases.
 *
 * Operators export from wildly different places, and rejecting a file because
 * the column says "Registration" instead of "reg" is the kind of friction that
 * ends an import attempt permanently. Matching is case-insensitive and ignores
 * spaces, underscores and hyphens, so "Last Service Date" and "last_service_date"
 * are the same header.
 */
const COLUMN_ALIASES: Record<keyof typeof FIELDS, string[]> = {
  reg: ["reg", "registration", "registrationnumber", "plate", "numberplate", "vehicle", "vrm"],
  reading: ["odometer", "mileage", "currentmileage", "reading", "odo", "miles", "km"],
  lastServiceDate: ["lastservicedate", "servicedate", "lastserviced", "lastservice"],
  lastServiceMileage: ["lastservicemileage", "servicemileage", "lastservicemiles", "serviceodometer"],
};

const FIELDS = {
  reg: true,
  reading: true,
  lastServiceDate: true,
  lastServiceMileage: true,
} as const;

const normaliseHeader = (h: string): string => h.trim().toLowerCase().replace(/[\s_\-.]/g, "");

/** Registrations are compared with spaces and case removed: "AB12 CDE" === "ab12cde". */
export const normaliseReg = (reg: string): string => reg.trim().toLowerCase().replace(/[\s\-]/g, "");

/**
 * Split one CSV line, honouring double-quoted fields and "" escapes.
 *
 * Written out rather than pulled in: the portal has no CSV dependency, and a
 * regex split on commas breaks the moment a vendor or note contains one.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }

  out.push(field);
  return out.map((f) => f.trim());
}

/**
 * Parse a distance.
 *
 * Accepts thousands separators because every spreadsheet emits them. Rejects
 * negatives and non-numbers. Returns null for blank, which is a legitimate
 * "I don't have this one" rather than an error — distinct from 0, which is a
 * real reading on a new vehicle and must survive.
 */
function parseDistance(raw: string): { value?: number; error?: string } {
  const cleaned = raw.replace(/[, ]/g, "");
  if (cleaned === "") return {};

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { error: `"${raw}" is not a number` };
  if (n < 0) return { error: "cannot be negative" };
  return { value: Math.round(n) };
}

/**
 * Parse a date to YYYY-MM-DD.
 *
 * Accepts ISO and the two slash orderings, but only where the ordering is
 * unambiguous or explicitly ISO. A bare "05/03/2026" is genuinely ambiguous
 * between US and UK convention, and guessing would silently move a service
 * baseline by up to ten months — so it is rejected with an instruction rather
 * than resolved by assumption.
 */
function parseServiceDate(raw: string): { value?: string; error?: string } {
  const s = raw.trim();
  if (s === "") return {};

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    const mm = Number(m);
    const dd = Number(d);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return { error: `"${raw}" is not a valid date` };
    return { value: `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}` };
  }

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = slash[3];
    // Only safe when one of the two can only be a day.
    if (a > 12 && b <= 12) {
      return { value: `${y}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}` };
    }
    if (b > 12 && a <= 12) {
      return { value: `${y}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}` };
    }
    return { error: `"${raw}" is ambiguous — use YYYY-MM-DD` };
  }

  return { error: `"${raw}" is not a recognised date — use YYYY-MM-DD` };
}

/**
 * Parse a CSV against the tenant's vehicles.
 *
 * Every rejection carries the line number and the registration, because the
 * operator's next move is to fix the spreadsheet and the only way to do that is
 * to be told which row.
 */
export function parseFleetHealthCsv(text: string, vehicles: MatchableVehicle[]): CsvParseResult {
  const rows: ParsedOdometerRow[] = [];
  const rejected: RejectedRow[] = [];

  const byReg = new Map<string, string>();
  for (const v of vehicles) {
    if (v.reg) byReg.set(normaliseReg(v.reg), v.id);
  }

  // Strip a UTF-8 BOM — Excel writes one and it corrupts the first header.
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const headerIndex = lines.findIndex((l) => l.trim() !== "");
  if (headerIndex === -1) {
    return { rows, rejected, ignoredColumns: [] };
  }

  const headers = splitCsvLine(lines[headerIndex]).map(normaliseHeader);
  const columnFor: Partial<Record<keyof typeof FIELDS, number>> = {};
  const ignoredColumns: string[] = [];

  headers.forEach((h, i) => {
    const field = (Object.keys(COLUMN_ALIASES) as Array<keyof typeof FIELDS>).find((key) =>
      COLUMN_ALIASES[key].includes(h),
    );
    // First match wins: a duplicated column should not silently override.
    if (field && columnFor[field] === undefined) {
      columnFor[field] = i;
    } else if (!field && h !== "") {
      ignoredColumns.push(splitCsvLine(lines[headerIndex])[i]);
    }
  });

  if (columnFor.reg === undefined) {
    return {
      rows,
      rejected: [{ line: headerIndex + 1, reg: "", reason: "No registration column found" }],
      ignoredColumns,
    };
  }

  const seen = new Set<string>();

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;

    const line = i + 1;
    const cells = splitCsvLine(raw);
    const cell = (idx: number | undefined): string => (idx === undefined ? "" : (cells[idx] ?? ""));

    const reg = cell(columnFor.reg);
    if (reg === "") {
      rejected.push({ line, reg: "", reason: "Missing registration" });
      continue;
    }

    const key = normaliseReg(reg);
    const vehicleId = byReg.get(key);
    if (!vehicleId) {
      rejected.push({ line, reg, reason: "No vehicle with this registration" });
      continue;
    }

    // A second row for the same car is more likely a mistake than an intent,
    // and applying both would leave the outcome dependent on file order.
    if (seen.has(key)) {
      rejected.push({ line, reg, reason: "Duplicate row for this vehicle" });
      continue;
    }

    const reading = parseDistance(cell(columnFor.reading));
    if (reading.error) {
      rejected.push({ line, reg, reason: `Odometer ${reading.error}` });
      continue;
    }

    const serviceMileage = parseDistance(cell(columnFor.lastServiceMileage));
    if (serviceMileage.error) {
      rejected.push({ line, reg, reason: `Last service mileage ${serviceMileage.error}` });
      continue;
    }

    const serviceDate = parseServiceDate(cell(columnFor.lastServiceDate));
    if (serviceDate.error) {
      rejected.push({ line, reg, reason: `Last service date ${serviceDate.error}` });
      continue;
    }

    // A service mileage with no service date has nothing to attach itself to —
    // service_records requires a date, and inventing today's would date the work
    // to the day of the import.
    if (serviceMileage.value !== undefined && serviceDate.value === undefined) {
      rejected.push({ line, reg, reason: "Last service mileage needs a last service date" });
      continue;
    }

    if (reading.value === undefined && serviceDate.value === undefined) {
      rejected.push({ line, reg, reason: "Nothing to import on this row" });
      continue;
    }

    seen.add(key);
    rows.push({
      reg,
      vehicleId,
      ...(reading.value !== undefined ? { reading: reading.value } : {}),
      ...(serviceDate.value !== undefined ? { lastServiceDate: serviceDate.value } : {}),
      ...(serviceMileage.value !== undefined ? { lastServiceMileage: serviceMileage.value } : {}),
    });
  }

  return { rows, rejected, ignoredColumns };
}

/** The file offered by the "download a template" link. */
export const CSV_TEMPLATE = [
  "reg,odometer,last_service_date,last_service_mileage",
  "AB12CDE,42150,2026-03-14,38000",
  "XY68ZZZ,10500,,",
].join("\n");
