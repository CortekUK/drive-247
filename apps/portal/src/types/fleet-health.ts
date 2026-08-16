/**
 * Fleet Health — shared types.
 *
 * Naming note: everything here is namespaced `vehicle*` / `FleetHealth*` on purpose.
 * The words "maintenance" and "health" are already taken three times in this codebase
 * and mean completely different things:
 *   - `maintenance_banner_*` / MaintenanceBanner  → platform software downtime notice
 *   - `maintenance_runs`                          → data-operations batch jobs
 *   - `health_score_*` / `tenant_health_*`        → tenant churn risk
 * None of those relate to vehicles. Do not shorten these names.
 */

/** Derived per-vehicle status. `unknown` is first-class and must never be shown as "OK". */
export type VehicleHealthStatus =
  | "ok"
  | "attention"
  | "overdue"
  | "not_road_legal"
  | "off_road"
  | "unknown";

/** How trustworthy a mileage projection is. */
export type BurnConfidence = "observed" | "tenant_median" | "platform_median" | "none";

export type HealthReasonKind = "service" | "compliance" | "job" | "hold";

export interface HealthReason {
  kind: HealthReasonKind;
  label: string;
  /** service: ok|due_soon|overdue|unknown · compliance: ok|due_soon|expired · job/hold: open|active */
  state: string;
  rule_id?: string;
  due_date?: string | null;
  due_miles?: number | null;
  miles_remaining?: number | null;
  days?: number | null;
  confidence?: BurnConfidence | null;
  /** Present only on `unknown` — tells the operator exactly what input is missing. */
  hint?: string;
}

export interface VehicleHealth {
  vehicle_id: string;
  tenant_id: string;
  status: VehicleHealthStatus;
  reasons: HealthReason[];
  next_due_date: string | null;
  next_due_miles: number | null;
  confidence: BurnConfidence | null;
  daily_burn: number | null;
  open_job_count: number;
  computed_at: string;
}

export interface VehicleHealthRow extends VehicleHealth {
  reg: string;
  make: string | null;
  model: string | null;
  current_mileage: number | null;
  vehicle_status: string | null;
}

export const HEALTH_STATUS_LABEL: Record<VehicleHealthStatus, string> = {
  ok: "OK",
  attention: "Attention",
  overdue: "Overdue",
  not_road_legal: "Not road legal",
  off_road: "Off road",
  unknown: "Unknown",
};

/**
 * Portal design system: flat, 1px borders, no shadows, indigo #6366f1 as the accent.
 * Status colour is carried by text + a tinted chip, never a heavy pill.
 */
export const HEALTH_STATUS_CLASS: Record<VehicleHealthStatus, string> = {
  ok: "bg-green-50 text-green-700 border-green-200",
  attention: "bg-amber-50 text-amber-700 border-amber-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
  not_road_legal: "bg-red-100 text-red-800 border-red-300",
  off_road: "bg-slate-100 text-slate-700 border-slate-300",
  unknown: "bg-slate-50 text-slate-500 border-slate-200",
};

/** Sort order for "what needs my attention" — the 5-second question. */
export const HEALTH_STATUS_RANK: Record<VehicleHealthStatus, number> = {
  not_road_legal: 0,
  overdue: 1,
  attention: 2,
  off_road: 3,
  unknown: 4,
  ok: 5,
};

export type JobStatus =
  | "reported"
  | "scheduled"
  | "in_progress"
  | "awaiting_parts"
  | "completed"
  | "cancelled";

export type JobPriority = "critical" | "high" | "medium" | "low";

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  reported: "Reported",
  scheduled: "Scheduled",
  in_progress: "In repair",
  awaiting_parts: "Awaiting parts",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const JOB_PRIORITY_LABEL: Record<JobPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const JOB_CATEGORIES = [
  "Engine",
  "Tyres",
  "Brakes",
  "Bodywork",
  "Electrical",
  "Fluids",
  "Interior",
  "Glass",
  "Routine maintenance",
  "Other",
] as const;

/**
 * These strings MUST stay identical to the options in add-service-record-dialog.tsx.
 * A rule matches its completed work by `service_type`, so a mismatch silently makes
 * every rule read as "no service history for this item".
 */
export const SERVICE_TYPES = [
  "Oil Change",
  "Tire Rotation",
  "Brake Service",
  "Battery Replacement",
  "Air Filter",
  "Transmission Service",
  "Coolant Flush",
  "Spark Plugs",
  "Wheel Alignment",
  "AC Service",
  "General Inspection",
  "MOT",
  "Full Service",
  "Other",
] as const;

export interface MaintenanceRule {
  id: string;
  tenant_id: string;
  /** null = a tenant-wide default that applies to every vehicle without an override. */
  vehicle_id: string | null;
  name: string;
  service_type: string | null;
  interval_miles: number | null;
  interval_months: number | null;
  lead_miles: number;
  lead_days: number;
  is_active: boolean;
  is_excluded: boolean;
  sort_order: number;
}

export interface MaintenanceJob {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  rule_id: string | null;
  title: string;
  category: string | null;
  priority: JobPriority;
  status: JobStatus;
  service_type: string | null;
  vendor_name: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  blocked_date_id: string | null;
  service_record_id: string | null;
  rental_id: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  vehicles?: { reg: string; make: string | null; model: string | null } | null;
}

export type OdometerSource =
  | "handover"
  | "manual"
  | "customer"
  | "telematics"
  | "service"
  | "import";

export interface OdometerReading {
  id: string;
  vehicle_id: string;
  reading: number;
  observed_at: string;
  source: OdometerSource;
  unit: "mi" | "km";
  is_suspect: boolean;
  note: string | null;
}

export interface MaintenanceConflict {
  rental_id: string;
  rental_number: string | null;
  status: string;
  start_date: string;
  end_date: string | null;
  payment_status: string | null;
  monthly_amount: number | null;
  customer_name: string | null;
}

/** A vehicle is "set up" once it has an odometer reading — the gate for mileage rules. */
export function isVehicleSeeded(v: { current_mileage: number | null }): boolean {
  return v.current_mileage !== null && v.current_mileage !== undefined;
}

/**
 * Human phrasing for a projection's trustworthiness. An estimate built from the
 * platform median is a materially weaker claim than one from two real readings on
 * this car, and the UI must say so rather than present both as a due date.
 */
export function confidenceLabel(c: BurnConfidence | null | undefined): string {
  switch (c) {
    case "observed":
      return "Based on this vehicle's own usage";
    case "tenant_median":
      return "Estimated from your fleet's average usage";
    case "platform_median":
      return "Rough estimate — no usage data for this vehicle yet";
    default:
      return "No usage data";
  }
}
