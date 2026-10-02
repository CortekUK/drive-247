"use client";

// ── Tesla Fleet API ───────────────────────────────────────────────────────────
//
// Supercharger billing. Once an operator authorises their Tesla account, the
// hourly sync (`sync-tesla-charges-cron`, pg_cron job 36, :17 past every hour)
// pulls each linked vehicle's charging history, matches every session to the
// rental that covered that moment, and writes it onto the rental as a
// `Supercharger` ledger charge the operator can then charge or waive.
//
// READ THIS BEFORE "SIMPLIFYING" ANYTHING HERE. This integration was deleted
// from main twice and reverted twice (see the `tesla` entry in
// `lib/lean-areas.ts`). During the gap Jangram Rentals — a live Denver operator
// with five Teslas wired to the Fleet API — silently stopped billing
// Supercharger sessions. The server side (three edge functions, the sync
// engine, the cron) is live and moving real money every hour for Jangram and
// Open Bay. This file is a v2 UI over that path: it CALLS the existing
// functions and never re-implements what they do.
//
// WHAT "CONNECTED" HAS TO MEAN. Three things fail independently:
//   1. the authorisation — `integration_tesla_fleet` plus two Vault secret ids
//      on `tenants`. The ids are pointers into Supabase Vault, never the tokens;
//      nothing here reads the Vault and nothing here renders an id.
//   2. the renewal — Tesla access tokens live ~8 hours. `getValidTeslaToken`
//      refreshes one on the first hourly pass that finds it within 5 minutes of
//      expiry, so `tesla_fleet_token_expires_at` on a HEALTHY tenant sits
//      anywhere from 8h in the future to ~1h in the past. That is why the
//      generic "expiring within 7 days" rule is NOT applied here: it would flag
//      every working Tesla tenant, permanently. The honest signal is the
//      inverse — an expiry more than two hours old means the hourly pass has had
//      at least one chance to renew it and could not (refresh revoked, or the
//      cron is down). Either way the sync is not running for this tenant.
//   3. the vehicles — a connection with no `tesla_fleet_enabled` vehicle syncs
//      nothing, so it is `attention`, not `connected`. Northwind is exactly
//      here: no Teslas in its fleet at all, so the panel says so up front.
//
// NO TEST MODE, deliberately. Tesla has no sandbox (the client says so: "Single
// production endpoint"), there is no `tesla_mode` column, and `isTestModeUiHidden`
// has nothing to hide. Every action below runs against the live Fleet API.
//
// THE SCREEN STANDARD (Ghulam, Oct 2 2026 — see `_screens.tsx`). One main
// screen per state — a picture, a headline, one sentence, one button — and the
// rest behind quiet links: Account details (with the connection test),
// Vehicles, Sessions, Disconnecting. Every rule below is unchanged; only where
// it is drawn moved.
//
// ⚠️ ISOLATION (V2_PLAN §5). `vehicles` has RLS OFF — `.eq('tenant_id',
// tenant.id)` is the only thing scoping the reads and the one direct write
// below. `tesla_supercharger_charges` has RLS ON with a tenant policy, and is
// filtered anyway: a super admin's `is_super_admin()` bypass would otherwise
// return every operator's sessions. `tenants` is read by `.eq('id', tenant.id)`.
// Every edge-function call passes `tenantId` explicitly; the functions refuse a
// cross-tenant id unless the caller is a super admin.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Car, Link2, Loader2, RefreshCw, Zap } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui-v2/alert-dialog";

import type { IntegrationPanelProps, IntegrationState, PanelTenant } from "./_kit";
import { PanelCard, PanelError, PanelLoading, PanelNote, PanelRow, StatusChip } from "./_kit";
import { ConnectionTest, DisconnectScreen, Hero, QuietNav, ScreenNav, SubScreen } from "./_screens";
import { VehiclesEmptyArt } from "@/components/illustrations-v2/empty-scenes";
import { ExpensesEmptyArt } from "@/components/illustrations-v2/scenes/expenses";
import { InvoicesEmptyArt } from "@/components/illustrations-v2/scenes/invoices";

/* ─────────────────────────────── data ───────────────────────────────────── */

/**
 * The tenant columns this integration lives in. All four exist today; none are
 * added. The two `*_secret_id` columns are read only to answer "is there one" —
 * they are Vault pointers and mean nothing to an operator, so they are never
 * rendered, copied or logged.
 */
const TENANT_COLUMNS =
  "id, integration_tesla_fleet, tesla_fleet_api_token_secret_id, " +
  "tesla_fleet_refresh_token_secret_id, tesla_fleet_token_expires_at";

interface TeslaRow {
  id: string;
  integration_tesla_fleet: boolean | null;
  tesla_fleet_api_token_secret_id: string | null;
  tesla_fleet_refresh_token_secret_id: string | null;
  tesla_fleet_token_expires_at: string | null;
}

interface TeslaStatusData {
  row: TeslaRow;
  /** Vehicles the sync engine will actually poll: enabled AND carrying a Fleet id. */
  linkedCount: number;
}

interface VehicleRow {
  id: string;
  reg: string;
  make: string | null;
  model: string | null;
  vin: string | null;
  tesla_fleet_enabled: boolean | null;
  tesla_fleet_vehicle_id: string | null;
}

interface SessionRow {
  id: string;
  charge_date: string;
  location: string | null;
  amount: number;
  currency: string | null;
  status: string | null;
  rental_id: string | null;
  vehicle_id: string;
  kwh_used: number | null;
}

interface SessionsData {
  /** Sessions whose charge fell in the last 30 days, newest first. */
  recent: SessionRow[];
  /** When the engine last wrote ANY row for this tenant — see the hint on that row. */
  lastRecordedAt: string | null;
}

const statusKey = (tenantId: string) => ["v2-tesla", tenantId] as const;
const vehiclesKey = (tenantId: string) => ["v2-tesla-vehicles", tenantId] as const;
const sessionsKey = (tenantId: string) => ["v2-tesla-sessions", tenantId] as const;

/**
 * One fetch shared by the board chip and the dialog.
 *
 * Read straight off the tables rather than through `tesla-fleet-api`'s
 * `get_status`: the board paints a chip for every card on first load, and a row
 * read answers for every role in one hop where an edge-function round trip
 * would not. The vehicle count is a `head` count, so nothing about the fleet
 * crosses the wire for the chip.
 */
function useTeslaStatus(tenant: PanelTenant) {
  return useQuery({
    queryKey: statusKey(tenant.id),
    queryFn: async (): Promise<TeslaStatusData> => {
      const [tenantRes, countRes] = await Promise.all([
        supabase
          .from("tenants")
          .select(TENANT_COLUMNS)
          // ⚠️ the only isolation on `tenants` — its SELECT policy is USING (true)
          .eq("id", tenant.id)
          .single(),
        supabase
          .from("vehicles")
          .select("id", { count: "exact", head: true })
          // ⚠️ RLS is OFF on `vehicles`. Without this the count is every
          // operator's Teslas on the platform.
          .eq("tenant_id", tenant.id)
          .eq("tesla_fleet_enabled", true)
          .not("tesla_fleet_vehicle_id", "is", null),
      ]);
      if (tenantRes.error) throw tenantRes.error;
      if (countRes.error) throw countRes.error;
      return { row: tenantRes.data as unknown as TeslaRow, linkedCount: countRes.count ?? 0 };
    },
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * The tenant's Teslas — linked or not.
 *
 * `make ilike *tesla*` is how a candidate is recognised. There is no
 * `is_electric` column and no brand enum, so a Tesla entered as "TESLA" or
 * "Tesla Motors" still shows; one entered under another make does not, and the
 * panel says so rather than listing a 60-car fleet in a narrow dialog.
 * Fetched even while disconnected: "you have no Teslas" is the first thing the
 * canary needs to hear, before it is offered a Connect button.
 */
function useTeslaVehicles(tenant: PanelTenant) {
  return useQuery({
    queryKey: vehiclesKey(tenant.id),
    queryFn: async (): Promise<VehicleRow[]> => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model, vin, tesla_fleet_enabled, tesla_fleet_vehicle_id")
        .eq("tenant_id", tenant.id) // ⚠️ RLS OFF — this is the boundary
        .or("tesla_fleet_enabled.eq.true,make.ilike.*tesla*")
        .order("reg", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (data || []) as VehicleRow[];
    },
    staleTime: 30_000,
  });
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function useTeslaSessions(tenant: PanelTenant, enabled: boolean) {
  return useQuery({
    queryKey: sessionsKey(tenant.id),
    queryFn: async (): Promise<SessionsData> => {
      const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
      const [recentRes, lastRes] = await Promise.all([
        supabase
          .from("tesla_supercharger_charges")
          .select("id, charge_date, location, amount, currency, status, rental_id, vehicle_id, kwh_used")
          // RLS is on here, but a super admin bypasses it — filter regardless.
          .eq("tenant_id", tenant.id)
          .gte("charge_date", since)
          .order("charge_date", { ascending: false })
          .limit(100),
        supabase
          .from("tesla_supercharger_charges")
          .select("created_at")
          .eq("tenant_id", tenant.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (recentRes.error) throw recentRes.error;
      if (lastRes.error) throw lastRes.error;
      return {
        recent: (recentRes.data || []) as SessionRow[],
        lastRecordedAt: (lastRes.data as { created_at: string | null } | null)?.created_at ?? null,
      };
    },
    enabled,
    staleTime: 30_000,
  });
}

/* ──────────────────────────── derivation ────────────────────────────────── */

/**
 * How stale `tesla_fleet_token_expires_at` may be before it means the hourly
 * pass is failing to renew it. One missed tick of slack over the ~1h a healthy
 * tenant can legitimately show — see the header note for the arithmetic.
 */
const RENEWAL_GRACE_MS = 2 * 60 * 60 * 1000;

interface TeslaView {
  connected: boolean;
  /** The access token's own expiry, as recorded. Informational once renewal is healthy. */
  accessValidUntil: string | null;
  /** Is there a refresh token to renew with? Without one the sync dies within 8h. */
  canRenew: boolean;
  /** Renewal has demonstrably stopped: expiry is more than RENEWAL_GRACE_MS old (or never set). */
  renewalStalled: boolean;
  linkedCount: number;
  state: IntegrationState;
  label: string;
  headline: string;
  tone: "info" | "warn" | "danger";
  /** The one fix that applies, when the fix is to re-authorise. */
  needsReconnect: boolean;
}

function derive(data: TeslaStatusData): TeslaView {
  const { row, linkedCount } = data;
  const connected = row.integration_tesla_fleet === true;
  const hasAccess = !!row.tesla_fleet_api_token_secret_id;
  const canRenew = !!row.tesla_fleet_refresh_token_secret_id;
  const expiresMs = row.tesla_fleet_token_expires_at
    ? new Date(row.tesla_fleet_token_expires_at).getTime()
    : NaN;
  const renewalStalled = Number.isNaN(expiresMs) || Date.now() - expiresMs > RENEWAL_GRACE_MS;

  const base = {
    connected,
    accessValidUntil: row.tesla_fleet_token_expires_at,
    canRenew,
    renewalStalled,
    linkedCount,
    needsReconnect: false,
  };

  // `sync-tesla-charges-cron` selects on this flag alone, so false means the
  // sync never visits this tenant — whatever the token columns say.
  if (!connected) {
    return {
      ...base,
      state: "disconnected",
      label: "Not connected",
      tone: "info",
      headline:
        "Tesla is not connected, so Supercharger sessions on your rentals are not being tracked or billed.",
    };
  }

  // Ordered worst-first; each rung is a different fix.
  if (!hasAccess) {
    return {
      ...base,
      needsReconnect: true,
      state: "attention",
      label: "Authorisation missing",
      tone: "danger",
      headline:
        "The integration is switched on but Tesla's authorisation is gone, so every hourly sync fails before it starts. Reconnect to restore it.",
    };
  }

  if (!canRenew) {
    return {
      ...base,
      needsReconnect: true,
      state: "attention",
      label: "Cannot renew",
      tone: "warn",
      headline:
        "Tesla did not give us a renewal token, so this authorisation will stop working within hours and cannot be refreshed. Reconnect — Tesla asks for offline access on the next authorisation.",
    };
  }

  if (renewalStalled) {
    return {
      ...base,
      needsReconnect: true,
      state: "attention",
      label: "Authorisation lapsed",
      tone: "danger",
      headline:
        "Tesla's authorisation expired and the hourly sync has not been able to renew it, so no Supercharger sessions are being picked up. Run a sync to retry the renewal; if that fails, reconnect.",
    };
  }

  if (linkedCount === 0) {
    return {
      ...base,
      state: "attention",
      label: "No Tesla vehicles linked",
      tone: "warn",
      headline:
        "Tesla is authorised, but no vehicle is linked to it — the hourly sync runs and finds nothing to check. Link a Tesla below to start tracking.",
    };
  }

  return {
    ...base,
    state: "connected",
    label: "Connected",
    tone: "info",
    headline: `Supercharger sessions on ${linkedCount === 1 ? "your linked Tesla" : `${linkedCount} linked Teslas`} are checked every hour and added to the rental they fall inside.`,
  };
}

/* ─────────────────────────── copy helpers ───────────────────────────────── */

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Date.now() - then;
  const future = diff < 0;
  const seconds = Math.round(Math.abs(diff) / 1000);
  const fmt = (n: number, unit: string) =>
    `${future ? "in " : ""}${n} ${unit}${n === 1 ? "" : "s"}${future ? "" : " ago"}`;
  if (seconds < 60) return future ? "in under a minute" : "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return fmt(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return fmt(hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 31) return fmt(days, "day");
  return new Date(iso).toLocaleDateString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function formatMoney(amount: number, currency: string | null): string {
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(amount);
  } catch {
    // An unrecognised code from Tesla's payload must not take the row down.
    return `${amount.toFixed(2)} ${code}`;
  }
}

/** `tesla_supercharger_charges.status`, in the operator's language. Text-only, per the design system. */
function SessionStatus({ status, matched }: { status: string | null; matched: boolean }) {
  if (!matched) return <span className="text-muted-foreground">No rental</span>;
  switch (status) {
    case "charged":
      return <span className="text-success">Charged</span>;
    case "partially_charged":
      return <span className="text-success">Part charged</span>;
    case "waived":
      return <span className="text-muted-foreground">Waived</span>;
    default:
      return <span className="text-warning">Pending</span>;
  }
}

function vehicleName(v: VehicleRow): string {
  return [v.make, v.model].filter(Boolean).join(" ") || "Vehicle";
}

/* ──────────────────────── edge function plumbing ────────────────────────── */

/**
 * Invoke an edge function and recover the real message.
 *
 * supabase-js collapses any non-2xx into "Edge Function returned a non-2xx
 * status code" with the actual body hidden on `.context`. Everything
 * `tesla-fleet-api` tells an operator — "Vehicle VIN not found in your Tesla
 * account", "Tesla token expired…", the cross-tenant refusal — is in that body.
 */
async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) {
    if ((data as { error?: string } | null)?.error) throw new Error(String((data as { error: string }).error));
    return data as T;
  }
  const context = (error as { context?: Response }).context;
  let message = error.message || "Request failed";
  if (context && typeof context.json === "function") {
    try {
      const payload = await context.json();
      if (payload?.error) message = String(payload.error);
    } catch {
      /* body already consumed or not JSON — the generic message stands */
    }
  }
  throw new Error(message);
}

interface SyncResult {
  synced: number;
  vehiclesChecked: number;
  results: Array<{ vehicleId: string; vehicleReg: string; chargesChecked?: number; error?: string }>;
  message?: string;
}

/* ────────────────────────── small local pieces ─────────────────────────── */

/**
 * A billing-affecting action behind a confirmation. Local rather than in the
 * kit: the kit has no confirm primitive, and editing it is off limits while
 * seven panels are in flight.
 */
function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
}: {
  // `React.ReactNode` via the UMD global rather than an imported type: two
  // copies of @types/react sit in this tree, and an imported ReactNode resolves
  // to a different declaration than the one ui-v2 was typed against.
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <AlertDialog>
      {/* `asChild` so a disabled trigger stays disabled — a wrapper element
          would catch the click that `pointer-events-none` lets fall through. */}
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}


/* ───────────────────────────── the demo ─────────────────────────────────── */

/*
 * FIRST-RUN DEMO — northwind only, on screen only (Ghulam, Oct 2 2026), like
 * Stripe / Square / Twilio. northwind has no Teslas and no Tesla account, so
 * on the canary the panel reads STAND-INS: "Connect Tesla" opens Tesla's site
 * in a new tab, spins, and lands connected; three Teslas wait to be linked;
 * linking, the test, a sync and disconnecting all resolve in the browser.
 *
 * NOTHING IS CALLED OR WRITTEN — no edge function, no ledger line, no vehicle
 * row. Lasts until the page reloads; Disconnecting puts it back to the start.
 * To remove: delete this block and every `demo` branch in the panel.
 */
const TESLA_DEMO_SLUGS: readonly string[] = ["northwind"];

type TeslaDemo = { live: boolean; linked: string[]; synced: boolean };
const DEMO_START: TeslaDemo = { live: false, linked: [], synced: false };

const teslaDemo = (() => {
  let state = DEMO_START;
  const ls = new Set<() => void>();
  return {
    get: () => state,
    patch: (p: Partial<TeslaDemo>) => {
      state = { ...state, ...p };
      ls.forEach((l) => l());
    },
    reset: () => {
      state = DEMO_START;
      ls.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      ls.add(l);
      return () => ls.delete(l);
    },
  };
})();

/** The same official mark the board's Tesla card uses (logo.dev, publishable key). */
const TESLA_LOGO = "https://img.logo.dev/tesla.com?token=pk_EmodMTbiSPiHDa2fIPUo3w&size=128&format=png";

const pause = <T,>(v: T, ms: number) => new Promise<T>((r) => window.setTimeout(() => r(v), ms));

const DEMO_CARS: VehicleRow[] = [
  { id: "demo-y", reg: "NW-Y01", make: "Tesla", model: "Model Y", vin: "7SAYGDEE5PA000101", tesla_fleet_enabled: false, tesla_fleet_vehicle_id: null },
  { id: "demo-3", reg: "NW-302", make: "Tesla", model: "Model 3", vin: "5YJ3E1EA1PF000302", tesla_fleet_enabled: false, tesla_fleet_vehicle_id: null },
  { id: "demo-s", reg: "NW-S03", make: "Tesla", model: "Model S", vin: "5YJSA1E26PF000303", tesla_fleet_enabled: false, tesla_fleet_vehicle_id: null },
];

function demoSessions(d: TeslaDemo): SessionRow[] {
  if (!d.synced) return [];
  const day = 86_400_000;
  const at = (n: number) => new Date(Date.now() - n * day).toISOString();
  const rows: SessionRow[] = [
    { id: "s1", charge_date: at(1), location: "Fremont, CA", amount: 18.42, currency: "USD", status: "pending", rental_id: "demo", vehicle_id: "demo-y", kwh_used: 46 },
    { id: "s2", charge_date: at(3), location: "Gilroy, CA", amount: 24.1, currency: "USD", status: "charged", rental_id: "demo", vehicle_id: "demo-3", kwh_used: 61 },
    { id: "s3", charge_date: at(6), location: "San Mateo, CA", amount: 12.75, currency: "USD", status: "waived", rental_id: "demo", vehicle_id: "demo-y", kwh_used: 31 },
    { id: "s4", charge_date: at(9), location: "Burlingame, CA", amount: 9.6, currency: "USD", status: null, rental_id: null, vehicle_id: "demo-s", kwh_used: 22 },
  ];
  return rows.filter((r) => d.linked.includes(r.vehicle_id));
}

/** The real reads, or the demo's stand-ins on the canary. */
function useTeslaData(tenant: PanelTenant) {
  const demo = TESLA_DEMO_SLUGS.includes(tenant.slug);
  const d = useSyncExternalStore(teslaDemo.subscribe, teslaDemo.get, teslaDemo.get);
  const status = useTeslaStatus(tenant);
  const realVehicles = useTeslaVehicles(tenant);

  const statusData = useMemo<TeslaStatusData | undefined>(() => {
    if (!demo) return status.data;
    if (!status.data) return undefined;
    return {
      row: {
        id: tenant.id,
        integration_tesla_fleet: d.live,
        tesla_fleet_api_token_secret_id: d.live ? "demo" : null,
        tesla_fleet_refresh_token_secret_id: d.live ? "demo" : null,
        tesla_fleet_token_expires_at: d.live ? new Date(Date.now() + 6 * 3_600_000).toISOString() : null,
      },
      linkedCount: d.linked.length,
    };
  }, [demo, status.data, d, tenant.id]);

  const fleet = useMemo<VehicleRow[] | undefined>(
    () =>
      demo
        ? DEMO_CARS.map((c) => (d.linked.includes(c.id) ? { ...c, tesla_fleet_enabled: true, tesla_fleet_vehicle_id: `TV-${c.id}` } : c))
        : realVehicles.data,
    [demo, d, realVehicles.data],
  );

  return { demo, d, status, statusData, vehicles: realVehicles, fleet };
}

/* ─────────────────────────────── chip ───────────────────────────────────── */

export function TeslaStatus({ tenant }: { tenant: PanelTenant }) {
  const { status, statusData } = useTeslaData(tenant);

  if (status.isLoading) return <StatusChip state="loading" />;
  // A failed READ is not a disconnected integration. "Not connected" here
  // invites an operator to reconnect — and reconnecting re-authorises with
  // Tesla and can hand back a token without renewal rights.
  if (status.isError || !statusData) return <StatusChip state="attention" label="Status unavailable" />;

  const view = derive(statusData);
  return <StatusChip state={view.state} label={view.label} />;
}

/* ────────────────────────────── panel ───────────────────────────────────── */

type Screen = "home" | "account" | "vehicles" | "sessions" | "disconnect" | "how";

export default function TeslaPanel({ tenant, onClose, onBack, fromIntro }: IntegrationPanelProps) {
  const queryClient = useQueryClient();
  const { demo, d, status, statusData, vehicles, fleet: fleetData } = useTeslaData(tenant);

  const view = useMemo(() => (statusData ? derive(statusData) : null), [statusData]);
  const realSessions = useTeslaSessions(tenant, !demo && !!view?.connected);
  const sessionsData: SessionsData | undefined = demo
    ? { recent: demoSessions(d), lastRecordedAt: d.synced ? new Date(Date.now() - 86_400_000).toISOString() : null }
    : realSessions.data;

  // The TenantContext carries `integration_tesla_fleet`, and the rental and
  // vehicle pages read it from there — so after a disconnect it is refetched,
  // or those pages keep rendering Tesla affordances for a connection that is gone.
  const { refetchTenant } = useTenant();

  // `tesla-fleet-api` itself has NO role gate — any app user in the tenant may
  // call it. Restricting the controls here to admins is a UI choice, made
  // because every one of them either moves money (a sync writes ledger charges
  // onto customers' rentals) or stops it (disconnect). Read-only roles still
  // see the whole truth; they just cannot act on it.
  const { appUser } = useAuth();
  const canManage = !!appUser?.is_super_admin || ["admin", "head_admin"].includes(appUser?.role ?? "");

  // The OAuth callback lands on `/integrations?tesla_connected=true`.
  const searchParams = useSearchParams();
  const justReturned = searchParams?.get("tesla_connected") === "true";

  const [screen, setScreen] = useState<Screen>("home");
  const home = () => setScreen("home");
  const [connecting, setConnecting] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: statusKey(tenant.id) });
    queryClient.invalidateQueries({ queryKey: vehiclesKey(tenant.id) });
    queryClient.invalidateQueries({ queryKey: sessionsKey(tenant.id) });
    // v1's own keys, in case its Settings tab is mounted somewhere for this tenant.
    queryClient.invalidateQueries({ queryKey: ["tesla-fleet-status"] });
    queryClient.invalidateQueries({ queryKey: ["tesla-fleet-vehicles-count"] });
  }, [queryClient, tenant.id]);

  const fail = (title: string) => (e: Error) =>
    toast({ title, description: e.message || "Please try again.", variant: "destructive" });

  /* ── connect ──────────────────────────────────────────────────────────── */

  const connect = useCallback(async () => {
    setConnecting(true);
    if (demo) {
      // Plays the hand-off: Tesla's sign-in opens in a new tab (nothing is
      // authorised), the button spins, then the dialog lands connected.
      window.open("https://auth.tesla.com", "_blank", "noopener,noreferrer");
      window.setTimeout(() => {
        teslaDemo.patch({ live: true });
        setConnecting(false);
      }, 2600);
      return;
    }
    try {
      // Same tab: the edge function signs `tenantId` + `returnUrl` into an HMAC
      // state (10-minute TTL) and, after Tesla calls back, redirects to
      // `returnUrl?tesla_connected=true` — the board, not v1's hidden Settings tab.
      const res = await invokeFn<{ authUrl?: string }>("tesla-fleet-api", {
        action: "get_auth_url",
        tenantId: tenant.id,
        returnUrl: `${window.location.origin}/integrations`,
      });
      if (!res?.authUrl) throw new Error("Tesla did not return an authorisation link");
      // Latched: the button keeps spinning until the browser actually leaves.
      window.location.href = res.authUrl;
    } catch (e) {
      fail("Could not open Tesla")(e instanceof Error ? e : new Error("Please try again."));
      setConnecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, tenant.id]);

  // "Connect Tesla" on the last education screen IS the connect button.
  const [autoStarted, setAutoStarted] = useState(false);
  useEffect(() => {
    if (!fromIntro || autoStarted || !view || view.connected || !canManage) return;
    setAutoStarted(true);
    void connect();
  }, [fromIntro, autoStarted, view, canManage, connect]);

  /* ── sync now ─────────────────────────────────────────────────────────── */

  /**
   * The same engine the hourly cron runs, scoped to this tenant. A real money
   * action: a new session inside a rental becomes a ledger charge on that
   * rental the moment it is found — it brings the :17 pass forward, it does
   * not add to it.
   */
  const syncNow = useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      if (demo) {
        await pause(null, 1600);
        teslaDemo.patch({ synced: true });
        const n = demoSessions({ ...teslaDemo.get(), synced: true }).length;
        return { synced: n, vehiclesChecked: teslaDemo.get().linked.length, results: [] };
      }
      return invokeFn<SyncResult>("sync-tesla-charges", { tenantId: tenant.id });
    },
    onSuccess: (result) => {
      setLastSync(result);
      if (!demo) invalidateAll();
    },
    onError: fail("Could not sync with Tesla"),
  });

  /* ── link / unlink a vehicle ──────────────────────────────────────────── */

  /**
   * `check_vehicle` looks the VIN up in the operator's Tesla account and, on a
   * match, writes `tesla_fleet_enabled` + `tesla_fleet_vehicle_id` on the
   * vehicle (tenant-filtered, in the function).
   */
  const linkVehicle = useMutation({
    mutationFn: async (v: VehicleRow) => {
      if (demo) {
        await pause(null, 1100);
        teslaDemo.patch({ linked: [...teslaDemo.get().linked, v.id] });
        return { compatible: true, vehicleName: `${v.model}` };
      }
      return invokeFn<{ compatible: boolean; vehicleName?: string; message?: string }>("tesla-fleet-api", {
        action: "check_vehicle",
        tenantId: tenant.id,
        vehicleId: v.id,
        vin: v.vin,
      });
    },
    onSuccess: (res, v) => {
      if (!demo) invalidateAll();
      if (!res.compatible) {
        toast({
          title: `${v.reg} isn't in your Tesla account`,
          description: res.message || "Add the car to the Tesla account you connected, then try again.",
          variant: "destructive",
        });
      }
    },
    onError: fail("Could not check with Tesla"),
  });

  /**
   * The inverse. A direct update — mirrors exactly what `disconnect` writes per
   * vehicle. Recorded sessions and their ledger lines are untouched.
   */
  const stopTracking = useMutation({
    mutationFn: async (v: VehicleRow) => {
      if (demo) {
        await pause(null, 500);
        teslaDemo.patch({ linked: teslaDemo.get().linked.filter((id) => id !== v.id) });
        return;
      }
      const { error } = await supabase
        .from("vehicles")
        .update({ tesla_fleet_enabled: false, tesla_fleet_vehicle_id: null })
        .eq("id", v.id)
        // ⚠️ RLS is OFF on `vehicles`. Without this, a guessed id writes into
        // another operator's fleet.
        .eq("tenant_id", tenant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      if (!demo) invalidateAll();
    },
    onError: fail("Could not stop tracking"),
  });

  /* ── disconnect ───────────────────────────────────────────────────────── */

  const disconnect = useMutation({
    mutationFn: async () => {
      if (demo) {
        await pause(null, 700);
        teslaDemo.reset();
        return { success: true };
      }
      return invokeFn<{ success: boolean }>("tesla-fleet-api", { action: "disconnect", tenantId: tenant.id });
    },
    onSuccess: async () => {
      setLastSync(null);
      home();
      if (demo) return;
      invalidateAll();
      try {
        await refetchTenant();
      } catch {
        /* the context refresh is a courtesy; the panel's own reads are already invalidated */
      }
      toast({ title: "Tesla disconnected", description: "Hourly Supercharger sync has stopped. Recorded sessions are kept." });
    },
    onError: fail("Could not disconnect"),
  });

  /* ── render ───────────────────────────────────────────────────────────── */

  if (status.isLoading) return <PanelLoading rows={4} />;
  if (status.isError || !statusData || !view) {
    return (
      <PanelError
        message={status.error instanceof Error ? status.error.message : "Unknown error"}
        onRetry={() => void status.refetch()}
      />
    );
  }

  const fleet = fleetData ?? [];
  const hasAnyTesla = fleet.length > 0;
  const busy = syncNow.isPending || linkVehicle.isPending || stopTracking.isPending || disconnect.isPending;

  /* ── not connected ────────────────────────────────────────────────────── */

  if (!view.connected) {
    if (screen === "how") {
      return (
        <SubScreen title="How connecting works" onBack={home}>
          <ol className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            {[
              "Sign in to the Tesla account that owns your cars and allow Drive247 to read vehicle and charging data.",
              "Back here, link each Tesla by its VIN — Tesla confirms it is on that account.",
              "Every hour, new Supercharger sessions are matched to the rental that covered that time and added to its balance.",
              "On the rental you decide, per session, whether to charge the customer or waive it.",
            ].map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </SubScreen>
      );
    }

    // Said before the button, not after: an operator who connects first and
    // learns this second has done a Tesla login for nothing.
    const noTeslas = !demo && !vehicles.isLoading && !hasAnyTesla;
    return (
      <>
        <Hero
          art={VehiclesEmptyArt}
          title="Connect your Tesla account."
          actions={
            canManage && (
              <div className="flex justify-center">
                <Button className="h-10 rounded-2xl px-6" onClick={() => void connect()} disabled={connecting}>
                  {connecting ? <Loader2 className="animate-spin" /> : <Link2 />}
                  {connecting ? "Opening Tesla…" : "Connect Tesla"}
                </Button>
              </div>
            )
          }
          footer={<QuietNav items={[{ label: "How connecting works", onClick: () => setScreen("how") }]} />}
        >
          {connecting
            ? "Finish in the Tesla tab — sign in and allow charging data. I'll pick it up here the moment Tesla hands the account back."
            : "Sign in to Tesla and allow charging data, then pick which cars I watch."}
          {noTeslas && (
            <span className="mt-2 block text-warning">
              Your fleet has no Tesla yet — add one with its VIN on{" "}
              <Link href="/vehicles" onClick={onClose} className="underline">
                Vehicles
              </Link>{" "}
              first, or connect now and link it later.
            </span>
          )}
          {!canManage && <span className="mt-2 block">Only an admin or head admin can connect Tesla.</span>}
        </Hero>
        <ScreenNav className="mt-5" onBack={onBack} />
      </>
    );
  }

  /* ── screens behind quiet links ───────────────────────────────────────── */

  if (screen === "account") {
    return (
      <SubScreen title="Account details" description="The Tesla account your Supercharging is read from." onBack={home}>
        <PanelCard className="divide-y divide-border/60">
          <PanelRow label="Hourly sync">
            {view.renewalStalled ? (
              <span className="text-destructive">Not running</span>
            ) : view.linkedCount === 0 ? (
              <span className="text-warning">Nothing to check</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-success">
                <Zap className="size-3.5" />
                Running
              </span>
            )}
          </PanelRow>
          <PanelRow label="Tesla access" hint={view.renewalStalled ? undefined : "Renews itself every hour"}>
            {view.accessValidUntil ? (
              <span title={formatDateTime(view.accessValidUntil)}>
                {view.renewalStalled ? "Lapsed " : "Valid "}
                {relativeTime(view.accessValidUntil)}
              </span>
            ) : (
              <span className="text-muted-foreground">Unknown</span>
            )}
          </PanelRow>
          <PanelRow label="Can renew">{view.canRenew ? "Yes" : <span className="text-warning">No renewal token</span>}</PanelRow>
          <PanelRow label="Cars linked">{view.linkedCount === 0 ? <span className="text-warning">None</span> : view.linkedCount}</PanelRow>
        </PanelCard>
        {/* `list_vehicles` — a READ: it renews the token if due and asks Tesla
            for the cars on the account. Never `sync-tesla-charges`, which
            writes ledger charges: a test must not move money. */}
        {view.needsReconnect && canManage ? (
          <div className="flex justify-center">
            <Button variant="outline" className="rounded-2xl" onClick={() => void connect()} disabled={connecting}>
              {connecting ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {connecting ? "Opening Tesla…" : "Reconnect Tesla"}
            </Button>
          </div>
        ) : (
          <ConnectionTest
            idle="Ask Tesla for the cars on your account — reads only, never bills."
            disabled={!canManage}
            run={async (say) => {
              say("Checking Tesla's sign-in…");
              if (demo) {
                await pause(null, 700);
                say("Asking Tesla for your cars…");
                await pause(null, 900);
                return `Working · Tesla answered, ${DEMO_CARS.length} cars on the account, ${view.linkedCount} linked`;
              }
              say("Asking Tesla for your cars…");
              const res = await invokeFn<{ vehicles: unknown[] }>("tesla-fleet-api", { action: "list_vehicles", tenantId: tenant.id });
              const n = res?.vehicles?.length ?? 0;
              return `Working · Tesla answered, ${n} car${n === 1 ? "" : "s"} on the account, ${view.linkedCount} linked`;
            }}
          />
        )}
      </SubScreen>
    );
  }

  if (screen === "vehicles") {
    const shown = fleet.slice(0, 5);
    return (
      <SubScreen
        title="Your Teslas"
        description="Only linked cars are checked. Tesla confirms each one by its VIN."
        onBack={home}
      >
        {!demo && vehicles.isLoading ? (
          <PanelLoading rows={2} />
        ) : !hasAnyTesla ? (
          <PanelNote tone="warn">
            No Tesla in your fleet yet. Add one with its VIN on{" "}
            <Link href="/vehicles" onClick={onClose} className="underline">
              Vehicles
            </Link>{" "}
            and it shows up here to link.
          </PanelNote>
        ) : (
          <PanelCard className="divide-y divide-border/60 px-0 py-0">
            {shown.map((v) => {
              const isLinked = !!(v.tesla_fleet_enabled && v.tesla_fleet_vehicle_id);
              const linking = linkVehicle.isPending && linkVehicle.variables?.id === v.id;
              return (
                <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
                  {/* The Tesla mark (the board's own logo.dev source) — a green
                      ring and a charging badge once the car is linked. */}
                  <span className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={TESLA_LOGO}
                      alt=""
                      aria-hidden
                      className={cn(
                        "size-8 rounded-full object-cover ring-2 transition-[box-shadow,opacity] duration-200",
                        isLinked ? "ring-success/50" : "opacity-60 ring-transparent",
                      )}
                    />
                    {isLinked && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-success text-white ring-2 ring-background">
                        <Zap className="size-2.5" />
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {vehicleName(v)} <span className="font-mono text-[12px] text-muted-foreground">· {v.reg}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {isLinked ? "Watching Supercharging" : v.vin ? "Not linked" : "Needs a VIN first"}
                    </p>
                  </div>
                  {isLinked ? (
                    <ConfirmAction
                      trigger={
                        <Button size="sm" variant="ghost" className="rounded-full" disabled={!canManage || busy}>
                          Stop
                        </Button>
                      }
                      title={`Stop watching ${v.reg}?`}
                      description="Supercharging on this car won't be picked up or added to its rentals. Sessions already recorded, and charges already on rentals, are kept."
                      confirmLabel="Stop watching"
                      onConfirm={() => stopTracking.mutate(v)}
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      disabled={!canManage || !v.vin || busy}
                      onClick={() => linkVehicle.mutate(v)}
                    >
                      {linking ? <Loader2 className="animate-spin" /> : <Link2 />}
                      {linking ? "Checking…" : "Link"}
                    </Button>
                  )}
                </div>
              );
            })}
          </PanelCard>
        )}
        {fleet.length > shown.length && (
          <p className="text-center text-xs text-muted-foreground">
            {fleet.length - shown.length} more on{" "}
            <Link href="/vehicles" onClick={onClose} className="underline">
              Vehicles
            </Link>
            .
          </p>
        )}
      </SubScreen>
    );
  }

  if (screen === "sessions") {
    const recent = sessionsData?.recent ?? [];
    const pending = recent.filter((s) => s.rental_id && (s.status ?? "pending") === "pending").length;
    const total = recent.reduce((sum, s) => sum + Number(s.amount || 0), 0);
    const currency = recent[0]?.currency ?? null;
    return (
      <SubScreen title="Supercharger sessions" description="The last 30 days. A session inside a rental lands on it to charge or waive." onBack={home}>
        {!demo && realSessions.isLoading ? (
          <PanelLoading rows={2} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                ["Sessions", String(recent.length)],
                ["Total", recent.length ? formatMoney(total, currency) : "—"],
                ["To charge or waive", String(pending)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border bg-background/70 px-3.5 py-2.5">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="mt-0.5 text-base font-medium text-foreground">{value}</p>
                </div>
              ))}
            </div>
            {recent.length > 0 ? (
              <PanelCard className="divide-y divide-border/60 px-0 py-0">
                {recent.slice(0, 2).map((s) => {
                  const car = fleet.find((v) => v.id === s.vehicle_id);
                  return (
                    <div key={s.id} className="flex items-center gap-2.5 px-4 py-2">
                      <Zap className={cn("size-3.5 shrink-0", s.rental_id ? "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-muted-foreground/50")} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          {formatMoney(Number(s.amount || 0), s.currency)}
                          <span className="text-muted-foreground"> · {s.location || "Supercharger"}{s.kwh_used != null ? ` · ${Number(s.kwh_used).toFixed(0)} kWh` : ""}</span>
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {new Date(s.charge_date).toLocaleDateString()}
                          {car ? ` · ${car.reg}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs">
                        <SessionStatus status={s.status} matched={!!s.rental_id} />
                      </span>
                    </div>
                  );
                })}
              </PanelCard>
            ) : (
              <PanelNote>No Supercharging in the last 30 days{view.linkedCount === 0 ? " — link a car first" : ""}.</PanelNote>
            )}
            {lastSync?.results?.some((r) => r.error) && (
              <p className="flex gap-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {lastSync.results.filter((r) => r.error).map((r) => `${r.vehicleReg}: ${r.error}`).join(" · ")}
              </p>
            )}
            {/* The same check the hourly pass runs at :17, brought forward —
                anything it finds inside a rental is added to that rental. */}
            <div className="flex flex-col items-center gap-1.5">
              <Button
                variant="outline"
                className="rounded-2xl"
                disabled={!canManage || busy || view.linkedCount === 0}
                onClick={() => syncNow.mutate()}
              >
                {syncNow.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {syncNow.isPending ? "Checking with Tesla…" : "Check for new sessions"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {lastSync
                  ? lastSync.message ?? `${lastSync.vehiclesChecked} car${lastSync.vehiclesChecked === 1 ? "" : "s"} checked · ${lastSync.synced} new session${lastSync.synced === 1 ? "" : "s"}`
                  : "I check every hour anyway — this just does it now."}
              </p>
            </div>
          </>
        )}
      </SubScreen>
    );
  }

  if (screen === "disconnect") {
    return (
      <DisconnectScreen
        name="Tesla"
        canManage={canManage}
        pending={disconnect.isPending}
        onBack={home}
        onConfirm={() => disconnect.mutate()}
        consequence={
          <>
            Supercharging stops being checked and added to rentals
            {view.linkedCount > 0 ? `, and your ${view.linkedCount} linked car${view.linkedCount === 1 ? " is" : "s are"} unlinked` : ""}. Sessions
            already recorded and charges already on rentals stay as they are.
          </>
        }
      />
    );
  }

  /* ── the main screen ──────────────────────────────────────────────────── */

  const recentCount = sessionsData?.recent.length ?? 0;
  const healthy = view.state === "connected";
  const title = view.needsReconnect
    ? view.label === "Cannot renew"
      ? "Tesla can't renew its access."
      : "Tesla's access has lapsed."
    : view.linkedCount === 0
      ? "Pick the cars I should watch."
      : "Supercharging bills itself.";
  const body = view.linkedCount === 0 && !view.needsReconnect
    ? justReturned || demo
      ? "Tesla is connected. Link the cars you rent out, and I'll start matching their Supercharging to rentals."
      : view.headline
    : view.headline;

  const action = !canManage ? null : view.needsReconnect ? (
    <Button className="h-10 rounded-2xl px-6" onClick={() => void connect()} disabled={connecting}>
      {connecting ? <Loader2 className="animate-spin" /> : <Link2 />}
      {connecting ? "Opening Tesla…" : "Reconnect Tesla"}
    </Button>
  ) : view.linkedCount === 0 ? (
    <Button className="h-10 rounded-2xl px-6" onClick={() => setScreen("vehicles")}>
      <Car /> Link your Teslas
    </Button>
  ) : (
    <Button className="h-10 rounded-2xl px-6" onClick={() => setScreen("sessions")}>
      {recentCount ? `See ${recentCount} session${recentCount === 1 ? "" : "s"}` : "See sessions"}
      <ArrowRight />
    </Button>
  );

  return (
    <>
      <Hero
        art={healthy ? ExpensesEmptyArt : view.linkedCount === 0 ? VehiclesEmptyArt : InvoicesEmptyArt}
        eyebrow={healthy ? "Live" : view.label}
        title={title}
        actions={action && <div className="flex justify-center">{action}</div>}
        footer={
          <QuietNav
            items={[
              { label: "Account details", onClick: () => setScreen("account") },
              { label: "Vehicles", onClick: () => setScreen("vehicles") },
              { label: "Sessions", onClick: () => setScreen("sessions") },
              ...(canManage ? [{ label: "Disconnecting", onClick: () => setScreen("disconnect") }] : []),
            ]}
          />
        }
      >
        {body}
      </Hero>
      <ScreenNav className="mt-5" onBack={onBack} />
    </>
  );
}
