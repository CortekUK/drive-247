// Re-exports the JSON manifests bundled alongside this function so the same
// data drives sim-control AND scripts/sim/* (single source of truth).
// The JSON lives inside this function dir so it is included in the deploy bundle.
import cronManifest from "./cron-manifest.json" with { type: "json" };
import shiftManifest from "./sim-shift-manifest.json" with { type: "json" };

export type CronJob = {
  kind: "fn" | "sql";
  path?: string;
  rpc?: string;
  cronJobName: string;
  schedule: string;
  authType?: string;
  expectedRef: string;
  simDispatchable?: boolean;
  settlesVia?: string;
  note?: string;
};

export type ShiftDomain = {
  table: string;
  driveCols: string[];
  idField: string;
  fireJobs: string[];
  note?: string;
  eligibility?: string;
};

// Drop the leading "_comment" documentation keys.
function strip<T>(obj: Record<string, unknown>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_")) continue;
    out[k] = v as T;
  }
  return out;
}

export const CRON_MANIFEST = strip<CronJob>(cronManifest as Record<string, unknown>);
export const SHIFT_MANIFEST = strip<ShiftDomain>(shiftManifest as Record<string, unknown>);
export const SCENARIOS: string[] = [];
