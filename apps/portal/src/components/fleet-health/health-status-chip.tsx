"use client";

import { cn } from "@/lib/utils";
import {
  HEALTH_STATUS_CLASS,
  HEALTH_STATUS_LABEL,
  type VehicleHealthStatus,
} from "@/types/fleet-health";

/**
 * Dot fills only — the chip already carries the tinted background and border from
 * HEALTH_STATUS_CLASS, so these are just the solid marker inside it.
 */
const HEALTH_DOT_CLASS: Record<VehicleHealthStatus, string> = {
  ok: "bg-green-600",
  attention: "bg-amber-500",
  overdue: "bg-red-600",
  not_road_legal: "bg-red-700",
  off_road: "bg-slate-500",
  unknown: "bg-slate-400",
};

interface HealthStatusChipProps {
  status: VehicleHealthStatus;
  compact?: boolean;
  className?: string;
}

/**
 * Flat bordered chip, never a heavy pill. `unknown` is styled as its own grey
 * state so it can never be mistaken for `ok` at a glance.
 */
export function HealthStatusChip({ status, compact, className }: HealthStatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border font-medium",
        compact ? "px-1.5 py-0 text-[11px]" : "px-2 py-0.5 text-xs",
        HEALTH_STATUS_CLASS[status],
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", HEALTH_DOT_CLASS[status])} />
      {HEALTH_STATUS_LABEL[status]}
    </span>
  );
}

/** Bare marker for dense rows where the label is carried by an adjacent column. */
export function HealthDot({
  status,
  className,
}: {
  status: VehicleHealthStatus;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={HEALTH_STATUS_LABEL[status]}
      title={HEALTH_STATUS_LABEL[status]}
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        HEALTH_DOT_CLASS[status],
        className
      )}
    />
  );
}
