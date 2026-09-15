import { type InsurancePolicy } from "@/hooks/use-insurance-data";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";

export function exportInsuranceToCSV(policies: InsurancePolicy[], filename?: string) {
  const headers = [
    "Policy Number",
    "Customer Name",
    "Customer Email", 
    "Customer Phone",
    "Vehicle Registration",
    "Vehicle Make/Model",
    "Provider",
    "Start Date",
    "Expiry Date",
    "Status",
    "Documents Count",
    "Notes",
    "Created Date"
  ];

  const rows = policies.map(policy => [
    policy.policy_number,
    policy.customers.name,
    policy.customers.email || "",
    policy.customers.phone || "",
    policy.vehicles?.reg || "",
    policy.vehicles ? `${policy.vehicles.make} ${policy.vehicles.model}` : "",
    policy.provider || "",
    format(parseLocalDate(policy.start_date), "yyyy-MM-dd"),
    format(parseLocalDate(policy.expiry_date), "yyyy-MM-dd"),
    policy.status,
    policy.docs_count.toString(),
    policy.notes || "",
    format(new Date(policy.created_at), "yyyy-MM-dd HH:mm")
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename || `insurance-policies-${format(new Date(), "yyyy-MM-dd")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * CSV export for the v2 list headers (Rentals, Customers, Vehicles).
 *
 * One writer, so every export quotes the same way. The old Rentals export
 * joined raw values with commas, so a customer named "Smith, John" split into
 * two columns and a note with a line break started a new row. Here a cell is
 * quoted whenever it holds a comma, a quote, a line break or edge spaces.
 *
 * SPREADSHEET FORMULAS. Excel, Sheets and Numbers run a cell that starts with
 * `=`, `+`, `-`, `@`, a tab or a carriage return as a formula, and names,
 * emails and notes in these lists are typed by customers. So a text cell that
 * starts that way is written with a leading apostrophe and read back as text.
 * A number written as a number (`-12.5`) is left alone.
 *
 * The file starts with a byte-order mark so Excel reads it as UTF-8, and names
 * with accents survive the round trip.
 */

export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text !== text.trim()) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Builds the file and hands it to the browser as a download named `filename`. */
export function downloadCsv(filename: string, header: readonly string[], rows: readonly (readonly CsvCell[])[]): void {
  const blob = new Blob(["﻿", toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next task: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A calendar day as `yyyy-MM-dd`, the form spreadsheets sort and parse. A bare
 * date column is passed through as it is; an instant is read on the viewer's
 * local calendar, the clock the tables print dates with. "" for no date.
 */
export function csvDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "rentals" → "rentals-2026-09-15.csv" */
export function csvFilename(base: string, today: Date = new Date()): string {
  return `${base}-${csvDate(today)}.csv`;
}
