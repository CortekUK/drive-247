"use client";

// DevPanel "Time Machine" section — an ISOLATED, MULTI-SERVICE cron sandbox.
//
// Drives EVERY cron-driven rental service (PAYG accrual, installments,
// auto-extension, deposit holds, and the three reminder jobs) against a set of
// dedicated STAGING fixtures — one rental per service. Talks to a dev-only
// server route (/api/dev/sandbox) that proxies the staging `sim-control`. You
// stay on your normal (production-pointed) portal — NO env switching, NO
// commands — and NOTHING here EVER touches production.
//
// Because the sandbox data lives on STAGING, results are shown INLINE below —
// they will NOT appear on your prod portal pages. Renders only under
// NODE_ENV==='development'.
//
// Route actions used:
//   status                         -> { ok, services: { [key]: {...fields} } }
//   advance    { service, days }   -> advance ONE service (honors its stepping)
//   advanceAll { days }            -> advance every service in cron-clock order
//   reset      { service }         -> reseed ONE service's fixture
//   resetAll                       -> reseed all fixtures
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  Beaker,
  FastForward,
  Gauge,
  CalendarClock,
  CalendarPlus,
  ShieldCheck,
  BellRing,
  CalendarCheck,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  SERVICE_DISPLAY,
  SERVICE_ORDER,
  type ServiceKey,
  type StatusField,
  type StatusFieldFormat,
} from "./time-machine/service-display";

// Map the lucide icon NAMES from the client-safe manifest to components.
const ICONS: Record<string, LucideIcon> = {
  Gauge,
  CalendarClock,
  CalendarPlus,
  ShieldCheck,
  BellRing,
  CalendarCheck,
  Bell,
};

type ServiceStatus = Record<string, unknown>;
type ServicesMap = Partial<Record<ServiceKey, ServiceStatus>>;
type SandboxResponse = {
  ok?: boolean;
  error?: string;
  services?: ServicesMap;
  summary?: string;
  [k: string]: unknown;
};

async function sandbox(body: Record<string, unknown>): Promise<SandboxResponse> {
  const res = await fetch("/api/dev/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: SandboxResponse = await res.json().catch(() => ({} as SandboxResponse));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `sandbox ${String(body.action)} failed`);
  }
  return data;
}

// Render a raw status value per its declared format. Null/empty -> em dash.
function fmt(value: unknown, format?: StatusFieldFormat): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "currency":
      return Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString() : String(value);
    }
    case "boolean":
      return value ? "Yes" : "No";
    case "date": {
      // Date-only columns must not be shifted by timezone — parse the parts.
      const s = String(value);
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;
      const d = new Date(s);
      return isNaN(d.getTime()) ? s : d.toLocaleDateString();
    }
    case "datetime": {
      const d = new Date(String(value));
      return isNaN(d.getTime())
        ? String(value)
        : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    }
    default:
      return String(value);
  }
}

// Best-effort one-line summary of what a mutation did, for the toast.
function summarize(data: SandboxResponse): string {
  if (typeof data.summary === "string" && data.summary) return data.summary;
  const parts: string[] = [];
  const push = (label: string, key: string) => {
    const v = data[key];
    // Only summarize scalar signals — never stringify the `fired` dispatch array.
    if (typeof v === "number" || typeof v === "string") parts.push(`${label} ${v}`);
  };
  if (typeof data.advancedDays === "number") parts.push(`+${data.advancedDays}d`);
  push("processed", "processed");
  push("charged", "charged");
  push("sent", "sent");
  return parts.length ? parts.join(", ") : "done";
}

async function fetchStatus(): Promise<ServicesMap> {
  const data = await sandbox({ action: "status" });
  return data.services ?? {};
}

// ---- one collapsible service row ------------------------------------------
function ServiceRow({
  serviceKey,
  status,
  open,
  onToggle,
  busy,
  onAdvance,
  onReset,
}: {
  serviceKey: ServiceKey;
  status: ServiceStatus | undefined;
  open: boolean;
  onToggle: () => void;
  busy: string;
  onAdvance: (days: number) => void;
  onReset: () => void;
}) {
  const display = SERVICE_DISPLAY[serviceKey];
  const Icon = ICONS[display.icon] ?? Clock;
  const anyBusy = busy !== "";

  return (
    <div className="border border-border rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-medium hover:bg-muted/50 transition-colors rounded-lg"
      >
        <span className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {display.label}
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-1.5">
          <p className="text-[10px] text-muted-foreground leading-relaxed">{display.description}</p>

          {/* Live sandbox state for this service */}
          <div className="rounded-md bg-muted/40 p-2 text-[11px] space-y-0.5">
            {status ? (
              display.statusFields.map((f: StatusField) => (
                <div key={f.key} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="font-medium text-right break-all">{fmt(status[f.key], f.format)}</span>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> loading…
              </div>
            )}
          </div>

          <div className="flex gap-1">
            {[1, 7].map((d) => (
              <Button
                key={d}
                variant="outline"
                size="sm"
                className="flex-1 text-xs h-7"
                disabled={anyBusy}
                onClick={() => onAdvance(d)}
              >
                {busy === `${serviceKey}:+${d}` ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  `+${d}d`
                )}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 px-2"
              disabled={anyBusy}
              onClick={onReset}
              title="Reset this service's fixture"
            >
              {busy === `${serviceKey}:reset` ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- the whole Time Machine section ---------------------------------------
export function TimeMachineSection({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const [services, setServices] = useState<ServicesMap | null>(null);
  const [openService, setOpenService] = useState<ServiceKey | null>(null);
  // busy holds the key of the in-flight action ("" = idle), which disables all
  // buttons and drives the per-button spinner. Keys: "all:+7", "all:reset",
  // "<service>:+1", "<service>:reset".
  const [busy, setBusy] = useState<string>("");

  // Fetch full status once, when the section is first expanded.
  useEffect(() => {
    if (!expanded || services) return;
    fetchStatus()
      .then(setServices)
      .catch((e) => toast.error(`Sandbox: ${e.message}`));
  }, [expanded, services]);

  // Apply a mutation response: prefer the fresh services it returns, else refetch.
  const applyResponse = async (data: SandboxResponse) => {
    if (data.services) setServices(data.services);
    else setServices(await fetchStatus());
  };

  const advanceAll = async (days: number) => {
    setBusy(`all:+${days}`);
    const id = toast.loading(`Advancing ALL services ${days} day${days > 1 ? "s" : ""}…`);
    try {
      const data = await sandbox({ action: "advanceAll", days });
      await applyResponse(data);
      const extra = summarize(data);
      toast.success(`All services +${days}d${extra ? ` — ${extra}` : ""}`, { id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id });
    } finally {
      setBusy("");
    }
  };

  const resetAll = async () => {
    setBusy("all:reset");
    const id = toast.loading("Resetting all sandbox fixtures…");
    try {
      await applyResponse(await sandbox({ action: "resetAll" }));
      toast.success("All fixtures reset", { id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id });
    } finally {
      setBusy("");
    }
  };

  const advanceService = async (service: ServiceKey, days: number) => {
    setBusy(`${service}:+${days}`);
    const label = SERVICE_DISPLAY[service].label;
    const id = toast.loading(`${label}: advancing ${days} day${days > 1 ? "s" : ""}…`);
    try {
      const data = await sandbox({ action: "advance", service, days });
      await applyResponse(data);
      const extra = summarize(data);
      toast.success(`${label} +${days}d${extra ? ` — ${extra}` : ""}`, { id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id });
    } finally {
      setBusy("");
    }
  };

  const resetService = async (service: ServiceKey) => {
    setBusy(`${service}:reset`);
    const label = SERVICE_DISPLAY[service].label;
    const id = toast.loading(`Resetting ${label}…`);
    try {
      await applyResponse(await sandbox({ action: "reset", service }));
      toast.success(`${label} reset`, { id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id });
    } finally {
      setBusy("");
    }
  };

  const anyBusy = busy !== "";

  return (
    <div className="border border-border rounded-lg">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium"
      >
        <span className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" /> Time Machine / Cron
        </span>
        <span className="flex items-center gap-2">
          <Badge variant="outline" className="border-green-500/50 text-green-600 gap-1">
            <Beaker className="h-3 w-3" /> SANDBOX
          </Badge>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Isolated STAGING sandbox — <strong>never touches production</strong>. Fast-forwards a
            dedicated test rental per service and runs the REAL cron for it. Results appear here (the
            sandbox data lives on staging, not on your portal pages).
          </p>

          {/* Global: advance / reset ALL services at once */}
          <div className="border border-border rounded-lg bg-muted/40">
            <div className="px-2 pt-2 flex items-center gap-1.5 text-[11px] font-medium">
              <FastForward className="h-3.5 w-3.5 text-muted-foreground" /> All services
            </div>
            <div className="px-2 py-2 space-y-1.5">
              <div className="text-[10px] uppercase text-muted-foreground">Advance every service</div>
              <div className="flex gap-1">
                {[1, 7, 30].map((d) => (
                  <Button
                    key={d}
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs h-7"
                    disabled={anyBusy}
                    onClick={() => advanceAll(d)}
                  >
                    {busy === `all:+${d}` ? <Loader2 className="h-3 w-3 animate-spin" /> : `+${d}d`}
                  </Button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-7"
                disabled={anyBusy}
                onClick={resetAll}
              >
                {busy === "all:reset" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <RotateCcw className="h-3 w-3 mr-1" /> Reset all fixtures
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Per-service collapsible rows */}
          <div className="text-[10px] uppercase text-muted-foreground pt-1">Services</div>
          {services === null ? (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground px-1 py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> loading sandbox…
            </div>
          ) : (
            <div className="space-y-1.5">
              {SERVICE_ORDER.map((key) => (
                <ServiceRow
                  key={key}
                  serviceKey={key}
                  status={services[key]}
                  open={openService === key}
                  onToggle={() => setOpenService((cur) => (cur === key ? null : key))}
                  busy={busy}
                  onAdvance={(days) => advanceService(key, days)}
                  onReset={() => resetService(key)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
