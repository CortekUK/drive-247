// feat-003: a RentID answer → our result line (spec 08.15 to 08.17). Pure, for Vitest.
// Report shapes from RentID's API Reference § Report Schemas.

export interface PremiumLine {
  result: "pass" | "fail" | "could_not_check";
  line: string;
  /** Set on the customer when a finished check comes back bad (spec 08.17). */
  warning: string | null;
}

const PRODUCT_KEY: Record<string, string> = {
  licence_status: "driver_license_check",
  driving_record: "motor_vehicle_report",
  criminal_record: "criminal_background_check",
};

/** The report may be the product object itself or wrapped under the product's name. */
export function reportFor(service: string, report: any): any {
  if (!report || typeof report !== "object") return null;
  return report[PRODUCT_KEY[service]] ?? report;
}

function day(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 10) : "";
}

export function premiumLine(service: string, rawReport: any, finishedAt?: string): PremiumLine {
  const r = reportFor(service, rawReport);
  if (!r) return { result: "could_not_check", line: "Could not check, try again", warning: null };
  const when = day(r.completed_at ?? finishedAt);

  if (service === "licence_status") {
    const status = String(r.passenger_license?.status ?? r.commercial_license?.status ?? r.outcome ?? "unknown").toLowerCase();
    if (r.outcome === "valid") return { result: "pass", line: `Licence active: ${status}`, warning: null };
    if (["pending", "failed"].includes(r.outcome)) return { result: "could_not_check", line: "Could not check, try again", warning: null };
    return { result: "fail", line: `Licence active: ${status}`, warning: `Licence ${status} (state check${when ? `, ${when}` : ""})` };
  }

  if (service === "driving_record") {
    const v = Array.isArray(r.violations) ? r.violations : [];
    const a = Array.isArray(r.accidents) ? r.accidents : [];
    const sus = Array.isArray(r.suspensions) ? r.suspensions : [];
    const duis = v.filter((x: any) => /\b(DUI|DWI|OWI|OVI|under the influence|intoxicat)/i.test(String(x?.description ?? ""))).length;
    const points = v.reduce((sum: number, x: any) => sum + (Number.isFinite(Number(x?.points)) ? Number(x.points) : 0), 0);
    const summary = `${v.length} violation${v.length === 1 ? "" : "s"}${duis ? ` (${duis} DUI)` : ""}, ${points} points, ` +
      `${a.length} accident${a.length === 1 ? "" : "s"}, ${sus.length} suspension${sus.length === 1 ? "" : "s"}`;
    if (r.outcome === "clear") return { result: "pass", line: `Driving record: clear`, warning: null };
    if (["pending", "failed", "unknown"].includes(r.outcome)) return { result: "could_not_check", line: "Could not check, try again", warning: null };
    return { result: "fail", line: `Driving record: ${summary}`, warning: `Driving record: ${summary}` };
  }

  if (service === "criminal_record") {
    const n = Number(r.record_count ?? (Array.isArray(r.records) ? r.records.length : 0));
    if (r.outcome === "clear") return { result: "pass", line: "Criminal record: clear", warning: null };
    if (r.outcome === "records_found") {
      return { result: "fail", line: `Criminal record: ${n} record${n === 1 ? "" : "s"} found`, warning: `Criminal record: ${n} found` };
    }
    return { result: "could_not_check", line: "Could not check, try again", warning: null };
  }

  return { result: "could_not_check", line: "Unknown check", warning: null };
}
