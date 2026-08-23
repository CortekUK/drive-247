"use client";

import { format, parseISO } from "date-fns";
import { AlertTriangle, Clock, Gauge, HelpCircle, ShieldAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { formatDistance, formatDistanceLong, type DistanceUnit } from "@/lib/format-utils";
import { confidenceLabel, type HealthReason, type HealthReasonKind } from "@/types/fleet-health";

type Tone = "critical" | "warning" | "unknown" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  critical: "text-red-700 dark:text-red-400",
  warning: "text-amber-700 dark:text-amber-400",
  unknown: "text-slate-500 dark:text-slate-400",
  neutral: "text-foreground/80",
};

const KIND_ORDER: Record<HealthReasonKind, number> = {
  compliance: 0,
  job: 1,
  hold: 2,
  service: 3,
};

const KIND_LABEL: Record<HealthReasonKind, string> = {
  compliance: "Road legal",
  job: "Open jobs",
  hold: "Off road",
  service: "Servicing",
};

const TONE_RANK: Record<Tone, number> = {
  critical: 0,
  warning: 1,
  unknown: 2,
  neutral: 3,
};

function toneFor(reason: HealthReason): Tone {
  switch (reason.state) {
    case "expired":
    case "overdue":
      return "critical";
    case "due_soon":
    case "open":
      return "warning";
    case "unknown":
      return "unknown";
    default:
      return "neutral";
  }
}

function iconFor(reason: HealthReason) {
  if (reason.state === "unknown") return HelpCircle;
  if (reason.kind === "compliance") return ShieldAlert;
  if (reason.kind === "hold") return Clock;
  if (reason.kind === "job") return AlertTriangle;
  return Wrench;
}

function safeDate(value?: string | null): string | null {
  if (!value) return null;
  try {
    return format(parseISO(value), "d MMM yyyy");
  } catch {
    return value;
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The measurable part of a reason, phrased for the state it is in.
 *
 * `days` and `miles_remaining` arrive signed, but the sign convention differs
 * between compliance dates and mileage projections, so the state drives the
 * wording and only the magnitude is read off the number.
 */
function detailFor(reason: HealthReason, unit: DistanceUnit): string | null {
  const parts: string[] = [];
  const due = safeDate(reason.due_date);

  switch (reason.state) {
    case "expired":
      if (reason.days != null) parts.push(`${plural(Math.abs(reason.days), "day")} overdue`);
      if (due) parts.push(`expired ${due}`);
      break;

    case "overdue":
      if (reason.miles_remaining != null) {
        parts.push(`${formatDistanceLong(Math.abs(reason.miles_remaining), unit)} past due`);
      }
      if (reason.days != null && reason.miles_remaining == null) {
        parts.push(`${plural(Math.abs(reason.days), "day")} past due`);
      }
      if (due) parts.push(`was due ${due}`);
      break;

    case "due_soon":
      if (reason.miles_remaining != null) {
        parts.push(`${formatDistanceLong(Math.abs(reason.miles_remaining), unit)} to go`);
      }
      if (reason.days != null) parts.push(`in ${plural(Math.abs(reason.days), "day")}`);
      if (due) parts.push(`due ${due}`);
      break;

    default:
      if (due) parts.push(`due ${due}`);
      break;
  }

  // The projected odometer target, added once for every state that has one.
  if (reason.due_miles != null && reason.state !== "unknown") {
    parts.push(`at ${formatDistance(reason.due_miles, unit)}`);
  }

  return parts.length ? parts.join(" · ") : null;
}

/** Does the missing input the hint describes get fixed by an odometer reading? */
function hintWantsOdometer(hint?: string): boolean {
  return /odomet|mileage|milage|reading/i.test(hint ?? "");
}

interface HealthReasonsListProps {
  reasons: HealthReason[];
  /** Table-row density: caps the visible rows and drops the group headings. */
  compact?: boolean;
  /** Wires the "Record a reading" affordance on `unknown` reasons that need one. */
  onRecordReading?: () => void;
  className?: string;
}

export function HealthReasonsList({
  reasons,
  compact,
  onRecordReading,
  className,
}: HealthReasonsListProps) {
  const { tenant } = useTenant();
  const unit: DistanceUnit = tenant?.distance_unit ?? "miles";

  if (!reasons.length) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        Nothing outstanding on this vehicle.
      </p>
    );
  }

  const sorted = [...reasons].sort(
    (a, b) =>
      TONE_RANK[toneFor(a)] - TONE_RANK[toneFor(b)] ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.label.localeCompare(b.label)
  );

  const visible = compact ? sorted.slice(0, 2) : sorted;
  const hidden = sorted.length - visible.length;

  if (compact) {
    return (
      <div className={cn("space-y-1", className)}>
        {visible.map((reason, i) => (
          <ReasonRow
            key={`${reason.kind}-${reason.rule_id ?? reason.label}-${i}`}
            reason={reason}
            unit={unit}
            compact
            onRecordReading={onRecordReading}
          />
        ))}
        {hidden > 0 && (
          <p className="text-xs text-muted-foreground">+{hidden} more</p>
        )}
      </div>
    );
  }

  // Full view keeps the grouping — an operator reading a single vehicle wants to
  // know whether the problem is legality, an open job, or a service interval.
  const groups = (Object.keys(KIND_ORDER) as HealthReasonKind[])
    .map((kind) => ({ kind, items: sorted.filter((r) => r.kind === kind) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className={cn("space-y-4", className)}>
      {groups.map((group) => (
        <div key={group.kind} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {KIND_LABEL[group.kind]}
          </p>
          <div className="space-y-2">
            {group.items.map((reason, i) => (
              <ReasonRow
                key={`${reason.kind}-${reason.rule_id ?? reason.label}-${i}`}
                reason={reason}
                unit={unit}
                onRecordReading={onRecordReading}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReasonRow({
  reason,
  unit,
  compact,
  onRecordReading,
}: {
  reason: HealthReason;
  unit: DistanceUnit;
  compact?: boolean;
  onRecordReading?: () => void;
}) {
  const tone = toneFor(reason);
  const Icon = iconFor(reason);
  const detail = detailFor(reason, unit);
  const isUnknown = reason.state === "unknown";

  // A projection with a target odometer is only as good as the burn rate behind
  // it — say so rather than presenting an estimate as a fact.
  const showConfidence = reason.due_miles != null && reason.confidence != null;

  return (
    <div className="flex items-start gap-2">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", TONE_TEXT[tone])} />
      <div className="min-w-0 space-y-0.5">
        <p className={cn("text-sm leading-snug", TONE_TEXT[tone])}>
          <span className="font-medium">{reason.label}</span>
          {detail && <span className="font-normal"> — {detail}</span>}
        </p>

        {isUnknown && (
          <div className={cn("space-y-1", compact ? "" : "pt-0.5")}>
            {/* Rule: `unknown` never reads as "not due". The hint names the missing input. */}
            <p className="text-xs leading-snug text-slate-600 dark:text-slate-300">
              {reason.hint ?? "Not enough information recorded to work this out yet."}
            </p>
            {onRecordReading && hintWantsOdometer(reason.hint) && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={onRecordReading}
                className="h-auto p-0 text-xs text-[#6366f1]"
              >
                <Gauge className="mr-1 h-3 w-3" />
                Record a reading
              </Button>
            )}
          </div>
        )}

        {showConfidence && !compact && (
          <p className="text-xs text-muted-foreground">{confidenceLabel(reason.confidence)}</p>
        )}
      </div>
    </div>
  );
}
