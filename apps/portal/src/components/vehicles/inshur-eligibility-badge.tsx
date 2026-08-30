"use client";

// INSHUR / ABI "Period Z" — the per-vehicle eligibility surface.
//
// One file holds the state machine, the badge and the vehicle-detail card,
// because all three move together: the badge's precedence order IS the
// operator's to-do list, and the card is that list unrolled. Config and
// per-vehicle reads come from the shared `use-inshur*` hooks so this surface
// and the rental one can never show different verdicts for the same VIN.
//
// Two things here are load-bearing and easy to break:
//
//   1. A garaging state is required on EVERY Create Rental Period. ABI's
//      eligibility answer says nothing about it, so a fleet can report a clean
//      "Insurable" while every single bind fails for want of a STATE. That gap
//      is therefore its own badge state and its own row on the detail card,
//      and it is checked AFTER ABI's own verdict so a green badge can never be
//      wrong — only quiet about a longer-pole problem.
//
//   2. Every answer carries the mode that produced it. A row written in mock
//      mode is a fixture, not evidence that a real vehicle is really insurable,
//      and it is labelled as such on every render — including in the table,
//      where a glance is all anyone gives it.

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  MinusCircle,
  RefreshCw,
  Satellite,
  ShieldCheck,
  ShieldQuestion,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useInshur, type InshurMode } from "@/hooks/use-inshur";
import { useInshurEligibility, useRefreshInshurEligibility } from "@/hooks/use-inshur-eligibility";
import { useToast } from "@/hooks/use-toast";
import { US_STATES } from "@/lib/us-states";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { InshurMode };

export type InshurEligibilityState =
  | "eligible"
  | "eligible_liability_only"
  | "no_garaging_state"
  | "needs_period_x"
  | "no_tracking_device"
  | "no_comp_collision"
  | "ineligible_state"
  | "ineligible"
  | "no_vin"
  | "invalid_vin"
  | "not_checked"
  | "check_failed"
  | "checking";

/** A row of `inshur_vehicle_eligibility`. */
export interface InshurEligibilityRow {
  id: string;
  vehicle_id: string;
  vin: string;
  eligible: boolean;
  on_period_x: boolean;
  has_tracking_device: boolean;
  has_comp_coll: boolean;
  reason: string | null;
  source_mode: InshurMode;
  checked_at: string;
}

export interface InshurEligibilityInput {
  vin: string | null | undefined;
  garagingState: string | null | undefined;
  row: InshurEligibilityRow | null | undefined;
  statesAllowed: string[] | null | undefined;
  /** Set when the most recent manual re-check could not reach ABI. */
  lastCheckFailed?: boolean;
}

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const ABI_PORTAL_URL = "https://portal.abiweb.com";

// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

/**
 * Local mirror of the VIN rules in `supabase/functions/_shared/inshur-client.ts`.
 * Duplicated rather than shared because that module is Deno-only; the point of
 * checking here is to say "VIN looks wrong" in the badge instead of letting ABI
 * answer with its characteristic empty `{}` and a 400.
 */
export function isVinShaped(vin: string | null | undefined): boolean {
  const v = (vin || "").trim().toUpperCase();
  return v.length === 17 && !/[IOQ]/.test(v);
}

function normalizeStates(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
  }
  if (typeof raw === "string") {
    try {
      return normalizeStates(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * `inshur-check-eligibility` deliberately does NOT cache a verdict it could not
 * obtain, so a transport failure normally leaves the previous row untouched and
 * is surfaced through `lastCheckFailed` instead. This guards the other route in:
 * a row written by some other path whose reason is code-prefixed. Without it an
 * ABI outage recorded that way would read to the operator as "this vehicle isn't
 * on Period X", sending them to portal.abiweb.com to fix nothing.
 */
function rowIsCheckFailure(row: InshurEligibilityRow | null | undefined): boolean {
  return !!row?.reason && /^check_failed\b/i.test(row.reason.trim());
}

export function deriveInshurEligibilityState({
  vin,
  garagingState,
  row,
  statesAllowed,
  lastCheckFailed,
}: InshurEligibilityInput): InshurEligibilityState {
  if (!vin || !vin.trim()) return "no_vin";
  if (!isVinShaped(vin)) return "invalid_vin";

  const allowed = normalizeStates(statesAllowed);
  const state = (garagingState || "").trim().toUpperCase();

  // Checked ahead of the ABI verdict on purpose: an uncovered state is decided
  // by the policy, is knowable without asking ABI at all, and cannot be fixed
  // by anything the other states tell you to do.
  if (state && allowed.length > 0 && !allowed.includes(state)) return "ineligible_state";

  if (lastCheckFailed || rowIsCheckFailure(row)) return "check_failed";
  if (!row) return "not_checked";

  if (row.eligible !== true) {
    if (!row.on_period_x) return "needs_period_x";
    if (!row.has_tracking_device) return "no_tracking_device";
    if (!row.has_comp_coll) return "no_comp_collision";
    return "ineligible";
  }

  // ABI is happy — but Create Rental Period still needs a STATE, and nothing in
  // the eligibility answer supplies one.
  if (!state) return "no_garaging_state";

  return row.has_comp_coll ? "eligible" : "eligible_liability_only";
}

/**
 * States that exist without ABI ever having answered. They must not be labelled
 * "simulated" — there is no simulated result to disclaim, and stamping one on
 * "Not checked" trains operators to read the marker as decoration.
 */
const ANSWERLESS_STATES: InshurEligibilityState[] = [
  "no_vin",
  "invalid_vin",
  "not_checked",
  "check_failed",
  "checking",
];

// ---------------------------------------------------------------------------
// Presentation config
// ---------------------------------------------------------------------------

type Tone = "success" | "warning" | "danger" | "info" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/15",
  warning: "bg-amber-500/10 text-amber-600 border-amber-500/30 hover:bg-amber-500/15",
  danger: "bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-500/15",
  info: "bg-blue-500/10 text-blue-600 border-blue-500/30 hover:bg-blue-500/15",
  muted: "bg-muted text-muted-foreground border-border hover:bg-muted",
};

interface EligibilityCopy {
  label: string;
  tone: Tone;
  icon: typeof ShieldCheck;
  tooltip: string;
  /** Shown as a link in the tooltip and as a secondary button on the card. */
  externalFix?: boolean;
}

interface CopyContext {
  vin?: string | null;
  vehicleState?: string | null;
  statesAllowed?: string[] | null;
}

export function getInshurEligibilityCopy(
  state: InshurEligibilityState,
  ctx: CopyContext = {}
): EligibilityCopy {
  const statesList = normalizeStates(ctx.statesAllowed).join(", ");

  switch (state) {
    case "eligible":
      return {
        label: "Insurable",
        tone: "success",
        icon: ShieldCheck,
        tooltip: "INSHUR can cover rentals on this vehicle. Nothing to do.",
      };
    case "eligible_liability_only":
      return {
        label: "Insurable · liability only",
        tone: "success",
        icon: ShieldCheck,
        tooltip:
          "INSHUR can cover this vehicle, but your Period X policy carries liability only for this VIN. The ID card will not show comprehensive or collision. Speak to INSHUR if you need it added.",
      };
    case "no_garaging_state":
      return {
        label: "No garaging state",
        tone: "warning",
        icon: MapPin,
        tooltip:
          "Every INSHUR rental period must name the US state this vehicle is garaged in, and this one has none. The vehicle passes ABI's checks, so nothing else will warn you — but cover will fail the moment someone books it. Set the garaging state on this vehicle.",
      };
    case "needs_period_x":
      return {
        label: "Not on Period X",
        tone: "warning",
        icon: AlertTriangle,
        externalFix: true,
        tooltip:
          "This VIN isn't on your ABI Period X policy, so per-rental cover can't be started. Add it at portal.abiweb.com, then re-check here. Drive247 can't add it for you — ABI has no API for this.",
      };
    case "no_tracking_device":
      return {
        label: "No tracking device",
        tone: "warning",
        icon: Satellite,
        externalFix: true,
        tooltip:
          "ABI hasn't received GPS data for this VIN. Your telematics provider sends this to ABI directly — Drive247 can't fix it from here. Contact your tracking supplier or INSHUR.",
      };
    case "no_comp_collision":
      return {
        label: "No comp/collision",
        tone: "info",
        icon: AlertTriangle,
        tooltip:
          "Your Period X policy covers liability only for this VIN. Speak to INSHUR if you need comprehensive and collision on rental cover.",
      };
    case "ineligible_state":
      return {
        label: "State not covered",
        tone: "danger",
        icon: MapPin,
        tooltip: statesList
          ? `Your policy covers ${statesList}. This vehicle is garaged in ${ctx.vehicleState}, which isn't on the list. Contact INSHUR to add a state, or change the garaging state if it's wrong.`
          : `This vehicle is garaged in ${ctx.vehicleState}, which isn't covered by your policy. Contact INSHUR to add a state.`,
      };
    case "ineligible":
      return {
        label: "Not insurable",
        tone: "danger",
        icon: XCircle,
        externalFix: true,
        tooltip:
          "ABI says this VIN can't be covered and didn't say why. Check it at portal.abiweb.com, or ask INSHUR.",
      };
    case "no_vin":
      return {
        label: "No VIN",
        tone: "muted",
        icon: MinusCircle,
        tooltip:
          "INSHUR identifies vehicles by VIN only. Add the 17-character VIN to this vehicle before checking.",
      };
    case "invalid_vin":
      return {
        label: "VIN looks wrong",
        tone: "danger",
        icon: XCircle,
        tooltip: `A VIN is exactly 17 characters and never contains the letters I, O or Q. "${ctx.vin ?? ""}" doesn't match — check for a typo on the vehicle record.`,
      };
    case "check_failed":
      return {
        label: "Check failed",
        tone: "warning",
        icon: AlertTriangle,
        tooltip:
          "ABI didn't answer when we asked about this VIN. Try again — if it keeps failing, ABI may be having problems.",
      };
    case "checking":
      return {
        label: "Checking…",
        tone: "muted",
        icon: Loader2,
        tooltip: "Asking ABI about this VIN.",
      };
    case "not_checked":
    default:
      return {
        label: "Not checked",
        tone: "muted",
        icon: ShieldQuestion,
        tooltip:
          "We haven't asked ABI about this VIN yet. Run a check to see whether it can be insured.",
      };
  }
}

/**
 * Simulation and test answers are labelled at every render, not just where the
 * integration is configured. An operator scanning a table of green "Insurable"
 * badges has no other cue that ABI was never contacted.
 */
function getModeDecoration(mode: InshurMode | null | undefined): {
  suffix: string;
  tooltipPrefix: string;
  extraClass: string;
} | null {
  if (mode === "mock") {
    return {
      suffix: " · simulated",
      tooltipPrefix: "Simulated result — ABI was not contacted. ",
      extraClass: "border-dashed border-amber-400/70",
    };
  }
  if (mode === "test") {
    return {
      suffix: " · test",
      tooltipPrefix:
        "Test-account result — checked against ABI's test credentials, not your live policy. ",
      extraClass: "border-dashed border-blue-400/70",
    };
  }
  return null;
}

function isStale(checkedAt: string | null | undefined): boolean {
  if (!checkedAt) return false;
  const t = new Date(checkedAt).getTime();
  return Number.isFinite(t) && Date.now() - t > STALE_AFTER_MS;
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export interface InshurEligibilityBadgeProps {
  state: InshurEligibilityState;
  /** Mode that produced the answer — drives the simulated/test decoration. */
  sourceMode?: InshurMode | null;
  checkedAt?: string | null;
  vin?: string | null;
  vehicleState?: string | null;
  statesAllowed?: string[] | null;
  compact?: boolean;
  showTooltip?: boolean;
  /** When supplied, an inline re-check affordance is rendered beside the badge. */
  onRecheck?: () => void;
  isRechecking?: boolean;
  className?: string;
}

export function InshurEligibilityBadge({
  state,
  sourceMode,
  checkedAt,
  vin,
  vehicleState,
  statesAllowed,
  compact = false,
  showTooltip = true,
  onRecheck,
  isRechecking = false,
  className,
}: InshurEligibilityBadgeProps) {
  const effectiveState: InshurEligibilityState = isRechecking ? "checking" : state;
  const copy = getInshurEligibilityCopy(effectiveState, { vin, vehicleState, statesAllowed });
  const Icon = copy.icon;
  const decoration = ANSWERLESS_STATES.includes(effectiveState) ? null : getModeDecoration(sourceMode);
  const stale =
    isStale(checkedAt) && (effectiveState === "eligible" || effectiveState === "eligible_liability_only");

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "flex items-center gap-1 font-medium whitespace-nowrap",
        TONE_CLASS[copy.tone],
        decoration?.extraClass,
        compact ? "text-xs px-2 py-0.5" : "",
        className
      )}
    >
      <Icon className={cn("h-3 w-3 shrink-0", effectiveState === "checking" && "animate-spin")} />
      <span>
        {copy.label}
        {decoration?.suffix}
      </span>
      {stale && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />}
    </Badge>
  );

  const tooltipBody = [
    decoration?.tooltipPrefix ?? "",
    copy.tooltip,
    stale && checkedAt
      ? ` Last checked ${formatDistanceToNow(new Date(checkedAt), { addSuffix: true })} — Period X membership can change without notice. Re-check before relying on it.`
      : "",
  ]
    .join("")
    .trim();

  const wrapped = showTooltip ? (
    <TooltipProvider>
      <Tooltip>
        {/* Badge is a plain function component with no forwarded ref, so the
            trigger needs a real element to anchor to. */}
        <TooltipTrigger asChild>
          <span className="inline-flex">{badge}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[320px]">
          <p className="text-xs leading-relaxed">{tooltipBody}</p>
          {copy.externalFix && (
            <p className="mt-1 text-xs text-muted-foreground">portal.abiweb.com</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    badge
  );

  if (!onRecheck) return wrapped;

  return (
    <div className="flex items-center gap-1">
      {wrapped}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              disabled={isRechecking}
              aria-label="Re-check INSHUR eligibility"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onRecheck();
              }}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRechecking && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Ask ABI about this VIN again</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface InshurEligibilityConfig {
  enabled: boolean;
  mode: InshurMode;
  statesAllowed: string[];
  isLoading: boolean;
}

/**
 * Thin adapter over the shared config hook. Going through it rather than
 * reading `tenants` again means the badge reacts the instant Settings saves
 * credentials (that save invalidates `['inshur-config']`), which is the entire
 * handover story: paste four values, the fleet lights up, nothing is deployed.
 *
 * Fails closed — `enabled` is null until the read succeeds, so an unreadable
 * config renders no INSHUR surface at all rather than an empty one.
 */
export function useInshurEligibilityConfig(): InshurEligibilityConfig {
  const { enabled, mode, statesAllowed, isLoading } = useInshur();

  return useMemo(
    () => ({
      enabled: enabled === true,
      mode: (mode ?? "mock") as InshurMode,
      // null means "never synced with ABI", which for every consumer here means
      // the same thing as an empty list: we cannot judge a state.
      statesAllowed: statesAllowed ?? [],
      isLoading,
    }),
    [enabled, mode, statesAllowed, isLoading]
  );
}

/**
 * Every cached eligibility answer for the tenant, keyed by vehicle id.
 *
 * Deliberately not `useInshurFleetEligibility()`: that hook also reads the
 * vehicle table and runs for every tenant, and the vehicles list is the most
 * visited page in the portal. This one is gated on the integration actually
 * being on, so tenants without INSHUR pay nothing for it. The shared re-check
 * mutation invalidates this key too, so the two caches cannot disagree.
 */
export function useInshurEligibilityMap(enabled: boolean) {
  const { tenant } = useTenant();

  const { data, isLoading } = useQuery({
    queryKey: ["inshur-eligibility-map", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabaseUntyped
        .from("inshur_vehicle_eligibility")
        .select(
          "id, vehicle_id, vin, eligible, on_period_x, has_tracking_device, has_comp_coll, reason, source_mode, checked_at"
        )
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
      return (data || []) as InshurEligibilityRow[];
    },
    enabled: enabled && !!tenant?.id,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const byVehicleId = useMemo(() => {
    const map = new Map<string, InshurEligibilityRow>();
    (data || []).forEach((row) => map.set(row.vehicle_id, row));
    return map;
  }, [data]);

  return { byVehicleId, isLoading };
}


/**
 * Manual re-check. Delegates to the shared mutation so the edge-function call,
 * the error extraction, the toasts and — critically — the cache invalidation
 * are identical wherever a re-check is triggered from. It invalidates both this
 * surface's query keys and the fleet/settings ones, so no view can be left
 * showing a verdict another view has already replaced.
 *
 * The per-vehicle pending id is local because the shared mutation only knows
 * "something is in flight", and a table needs to spin exactly one row.
 */
export function useInshurRecheck() {
  const refresh = useRefreshInshurEligibility();
  const [pendingVehicleId, setPendingVehicleId] = useState<string | null>(null);
  const [failedVehicleIds, setFailedVehicleIds] = useState<Set<string>>(new Set());

  const recheck = useCallback(
    async (vehicleId: string) => {
      // Serialised on purpose: ABI publishes no rate limits, so a fan-out from
      // a 60-row table is a gamble nobody has to take.
      if (pendingVehicleId) return;
      setPendingVehicleId(vehicleId);
      try {
        await refresh.mutateAsync({ vehicleId });
        setFailedVehicleIds((prev) => {
          if (!prev.has(vehicleId)) return prev;
          const next = new Set(prev);
          next.delete(vehicleId);
          return next;
        });
      } catch {
        // The shared mutation has already explained the failure to the operator.
        // Remembering it here is what lets the badge say "Check failed" rather
        // than silently reverting to "Not checked".
        setFailedVehicleIds((prev) => new Set(prev).add(vehicleId));
      } finally {
        setPendingVehicleId(null);
      }
    },
    [pendingVehicleId, refresh]
  );

  return { recheck, pendingVehicleId, failedVehicleIds };
}

// ---------------------------------------------------------------------------
// List filtering
//
// Settings' fleet-readiness counters and the dashboard metric both deep-link
// into /vehicles?inshur=… , so the mapping from URL value to badge states has
// to live next to the states themselves.
// ---------------------------------------------------------------------------

export const INSHUR_VEHICLE_FILTERS: Record<
  string,
  { predicate: string; states: InshurEligibilityState[] }
> = {
  eligible: { predicate: "are insurable", states: ["eligible", "eligible_liability_only"] },
  needs_period_x: { predicate: "aren't on Period X", states: ["needs_period_x"] },
  no_tracker: { predicate: "have no tracking device", states: ["no_tracking_device"] },
  no_comp_coll: { predicate: "carry liability only", states: ["no_comp_collision"] },
  no_state: { predicate: "have no garaging state", states: ["no_garaging_state"] },
  state_blocked: { predicate: "are garaged in an uncovered state", states: ["ineligible_state"] },
  unchecked: { predicate: "haven't been checked", states: ["not_checked", "check_failed"] },
  no_vin: { predicate: "have no VIN", states: ["no_vin", "invalid_vin"] },
  blocked: {
    predicate: "can't be insured yet",
    states: [
      "no_garaging_state",
      "needs_period_x",
      "no_tracking_device",
      "ineligible_state",
      "ineligible",
      "no_vin",
      "invalid_vin",
    ],
  },
};

// ---------------------------------------------------------------------------
// Detail card
// ---------------------------------------------------------------------------

type RowTone = "pass" | "fail" | "warn" | "unknown";

function RequirementRow({
  tone,
  label,
  detail,
}: {
  tone: RowTone;
  label: string;
  detail: string;
}) {
  const Icon =
    tone === "pass"
      ? CheckCircle2
      : tone === "unknown"
        ? MinusCircle
        : tone === "warn"
          ? AlertTriangle
          : XCircle;
  const iconClass =
    tone === "pass"
      ? "text-emerald-500"
      : tone === "fail"
        ? "text-red-500"
        : tone === "warn"
          ? "text-amber-500"
          : "text-muted-foreground";

  return (
    <div className="flex items-start gap-2.5 border-b border-[#f1f5f9] dark:border-gray-800 pb-3 last:border-0 last:pb-0">
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", iconClass)} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#080812] dark:text-gray-100">{label}</p>
        <p className="text-xs text-[#737373] dark:text-gray-400">{detail}</p>
      </div>
    </div>
  );
}

export interface InshurEligibilityCardProps {
  vehicleId: string;
  vehicleReg: string;
  vin: string | null | undefined;
  garagingState: string | null | undefined;
  canEdit: boolean;
  /** Called after the garaging state is saved, so the page can refetch. */
  onGaragingStateSaved?: () => void;
}

export function InshurEligibilityCard({
  vehicleId,
  vehicleReg,
  vin,
  garagingState,
  canEdit,
  onGaragingStateSaved,
}: InshurEligibilityCardProps) {
  const { toast } = useToast();
  const config = useInshurEligibilityConfig();
  // Shared with the rental coverage block, so a verdict read here and a verdict
  // read there are the same cached row rather than two racing copies.
  const { eligibility: row, isLoading } = useInshurEligibility(vehicleId);
  const { recheck, pendingVehicleId, failedVehicleIds } = useInshurRecheck();
  const [savingState, setSavingState] = useState(false);

  const isRechecking = pendingVehicleId === vehicleId;
  const state = deriveInshurEligibilityState({
    vin,
    garagingState,
    row,
    statesAllowed: config.statesAllowed,
    lastCheckFailed: failedVehicleIds.has(vehicleId),
  });
  const copy = getInshurEligibilityCopy(state, {
    vin,
    vehicleState: garagingState,
    statesAllowed: config.statesAllowed,
  });

  const saveGaragingState = async (value: string) => {
    setSavingState(true);
    try {
      const { error } = await supabaseUntyped
        .from("vehicles")
        .update({ garaging_state: value })
        .eq("id", vehicleId);
      if (error) throw error;
      toast({
        title: "Garaging state saved",
        description: `${vehicleReg} is now recorded as garaged in ${value}.`,
      });
      onGaragingStateSaved?.();
    } catch (err: any) {
      toast({
        title: "Couldn't save the garaging state",
        description: err?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSavingState(false);
    }
  };

  if (!config.enabled) return null;

  const hasVin = !!vin && isVinShaped(vin);
  const stateKnown = !!(garagingState || "").trim();
  const stateCovered =
    stateKnown &&
    (config.statesAllowed.length === 0 ||
      config.statesAllowed.includes((garagingState || "").trim().toUpperCase()));

  return (
    <Card
      className={cn(
        "shadow-card rounded-lg border-indigo-200/60 dark:border-indigo-900/40",
        // Separable by shape as well as colour — the card is the loudest place
        // we can say "none of this is real cover" without shouting on every row.
        config.mode === "mock" && "border-dashed border-2 border-amber-400/60",
        config.mode === "test" && "border-dashed border-2 border-blue-400/50"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-500/10">
                <ShieldCheck className="h-[18px] w-[18px] text-indigo-500" />
              </div>
              INSHUR Period Z
            </CardTitle>
            <CardDescription>Per-rental cover eligibility for this vehicle</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {config.mode === "mock" && (
              <Badge className="bg-amber-400 hover:bg-amber-400 text-black text-[9px] px-1.5 h-4 font-bold">
                SIMULATED
              </Badge>
            )}
            {config.mode === "test" && (
              <Badge className="bg-blue-600 hover:bg-blue-700 text-white text-[9px] px-1.5 h-4 font-bold">
                TEST
              </Badge>
            )}
            <InshurEligibilityBadge
              state={state}
              sourceMode={row?.source_mode ?? config.mode}
              checkedAt={row?.checked_at}
              vin={vin}
              vehicleState={garagingState}
              statesAllowed={config.statesAllowed}
              isRechecking={isRechecking}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {config.mode === "mock" && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
            INSHUR is in simulation. Nothing on this card reached ABI and no vehicle is really
            insured — the results are fixtures so the flow can be tested before credentials arrive.
          </div>
        )}

        {!hasVin ? (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {vin
                ? `“${vin}” isn't a valid VIN — a VIN is exactly 17 characters and never contains I, O or Q. Edit the vehicle and correct it before INSHUR can check this car.`
                : "This vehicle needs a VIN before INSHUR can check it. INSHUR identifies vehicles by VIN only — edit the vehicle to add the 17-character number."}
            </p>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : (
          <>
            {state === "check_failed" && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  Couldn't check this vehicle
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  ABI didn't answer. This is usually temporary. If it keeps failing, ABI may be
                  having problems — try again later or check portal.abiweb.com.
                </p>
              </div>
            )}

            <div className="space-y-3">
              {/* Listed first because it is the one requirement ABI's eligibility
                  answer says nothing about, and the one that silently fails a bind. */}
              <RequirementRow
                tone={
                  !stateKnown
                    ? "warn"
                    : config.statesAllowed.length === 0
                      ? "unknown"
                      : stateCovered
                        ? "pass"
                        : "fail"
                }
                label="Garaging state"
                detail={
                  !stateKnown
                    ? "Not set. Every rental period sent to INSHUR must name a state — without it, cover fails at booking even though everything else passes."
                    : config.statesAllowed.length === 0
                      ? `Garaged in ${(garagingState || "").toUpperCase()}. Your policy's covered states haven't been synced yet, so we can't confirm INSHUR writes cover there.`
                      : stateCovered
                        ? `Garaged in ${(garagingState || "").toUpperCase()}, which your policy covers.`
                        : `Garaged in ${(garagingState || "").toUpperCase()}, which isn't on your policy (${config.statesAllowed.join(", ")}). Contact INSHUR to add it.`
                }
              />
              <RequirementRow
                tone={!row ? "unknown" : row.on_period_x ? "pass" : "fail"}
                label="On your Period X policy"
                detail={
                  !row
                    ? "Not checked yet."
                    : row.on_period_x
                      ? "This VIN is on your annual policy."
                      : "Add this VIN at portal.abiweb.com, then re-check. Drive247 can't add it — ABI has no API for this."
                }
              />
              <RequirementRow
                tone={!row ? "unknown" : row.has_tracking_device ? "pass" : "fail"}
                label="Tracking device reporting"
                detail={
                  !row
                    ? "Not checked yet."
                    : row.has_tracking_device
                      ? "ABI is receiving GPS data for this VIN."
                      : "ABI hasn't received GPS for this VIN. Your telematics provider sends this to ABI directly."
                }
              />
              <RequirementRow
                tone={!row ? "unknown" : row.has_comp_coll ? "pass" : "warn"}
                label="Comprehensive & collision"
                detail={
                  !row
                    ? "Not checked yet."
                    : row.has_comp_coll
                      ? "Included on this VIN."
                      : "Liability only. Rental cover can still be started; the ID card won't show comp/collision."
                }
              />
            </div>

            {row?.reason && !rowIsCheckFailure(row) && (
              <p className="text-xs text-[#737373] dark:text-gray-400">ABI said: {row.reason}</p>
            )}

            {!stateKnown && (
              <div className="rounded-lg border border-[#f1f5f9] dark:border-gray-800 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-indigo-500" />
                  <p className="text-sm font-medium text-[#080812] dark:text-gray-100">
                    Set the garaging state
                  </p>
                </div>
                <p className="text-xs text-[#737373] dark:text-gray-400">
                  The US state this vehicle is normally kept in. INSHUR sends it on every rental
                  period.
                </p>
                {canEdit ? (
                  <Select disabled={savingState} onValueChange={saveGaragingState}>
                    <SelectTrigger className="w-full sm:w-[240px]">
                      <SelectValue placeholder={savingState ? "Saving…" : "Choose a state"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-[280px]">
                      {US_STATES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label} ({s.value})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-[#737373] dark:text-gray-400">
                    You don't have permission to edit vehicles — ask an admin to set this.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="gap-2"
              disabled={!hasVin || isRechecking}
              onClick={() => recheck(vehicleId)}
            >
              <RefreshCw className={cn("h-4 w-4", isRechecking && "animate-spin")} />
              {isRechecking ? "Checking…" : row ? "Re-check with ABI" : "Check with ABI"}
            </Button>
            {copy.externalFix && (
              <Button variant="ghost" className="gap-2" asChild>
                <a href={ABI_PORTAL_URL} target="_blank" rel="noopener noreferrer">
                  Open ABI portal
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </div>
          <p className="text-xs text-[#737373] dark:text-gray-400">
            {row?.checked_at
              ? `Last checked ${format(new Date(row.checked_at), "d MMM yyyy, HH:mm")}`
              : "Never checked"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
