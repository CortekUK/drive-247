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
// ⚠️ ISOLATION (V2_PLAN §5). `vehicles` has RLS OFF — `.eq('tenant_id',
// tenant.id)` is the only thing scoping the reads and the one direct write
// below. `tesla_supercharger_charges` has RLS ON with a tenant policy, and is
// filtered anyway: a super admin's `is_super_admin()` bypass would otherwise
// return every operator's sessions. `tenants` is read by `.eq('id', tenant.id)`.
// Every edge-function call passes `tenantId` explicitly; the functions refuse a
// cross-tenant id unless the caller is a super admin.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  Link2,
  Loader2,
  RefreshCw,
  Unplug,
  Zap,
} from "lucide-react";

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
import {
  PanelCard,
  PanelError,
  PanelLoading,
  PanelNote,
  PanelRow,
  PanelSection,
  StatusChip,
} from "./_kit";

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

/* ─────────────────────────────── chip ───────────────────────────────────── */

export function TeslaStatus({ tenant }: { tenant: PanelTenant }) {
  const { data, isLoading, isError } = useTeslaStatus(tenant);

  if (isLoading) return <StatusChip state="loading" />;
  // A failed READ is not a disconnected integration. "Not connected" here
  // invites an operator to reconnect — and reconnecting re-authorises with
  // Tesla and can hand back a token without renewal rights.
  if (isError || !data) return <StatusChip state="attention" label="Status unavailable" />;

  const view = derive(data);
  return <StatusChip state={view.state} label={view.label} />;
}

/* ────────────────────────────── panel ───────────────────────────────────── */

export default function TeslaPanel({ tenant, onClose }: IntegrationPanelProps) {
  const queryClient = useQueryClient();
  const status = useTeslaStatus(tenant);
  const vehicles = useTeslaVehicles(tenant);

  const view = useMemo(() => (status.data ? derive(status.data) : null), [status.data]);
  const sessions = useTeslaSessions(tenant, !!view?.connected);

  // The TenantContext carries `integration_tesla_fleet`, and the rental and
  // vehicle pages read it from there — so after a disconnect it is refetched,
  // or those pages keep rendering Tesla affordances for a connection that is gone.
  const { refetchTenant } = useTenant();

  // `tesla-fleet-api` itself has NO role gate — any app user in the tenant may
  // call it. Restricting the controls here to admins is therefore a UI choice,
  // made because every one of them either moves money (a sync writes ledger
  // charges onto customers' rentals) or stops it (disconnect). Read-only roles
  // still see the whole truth; they just cannot act on it.
  const { appUser } = useAuth();
  const canManage =
    !!appUser?.is_super_admin || ["admin", "head_admin"].includes(appUser?.role ?? "");

  // The OAuth callback lands on `/integrations?tesla_connected=true` (see
  // `connect` below). The dialog is closed by then and the board is not this
  // file's to change, so the chip flipping state is the operator's first
  // confirmation; this note is the second, when they open the card. Rendering,
  // not an effect — the chip stays side-effect free.
  const searchParams = useSearchParams();
  const justReturned = searchParams?.get("tesla_connected") === "true";

  const [connecting, setConnecting] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: statusKey(tenant.id) });
    queryClient.invalidateQueries({ queryKey: vehiclesKey(tenant.id) });
    queryClient.invalidateQueries({ queryKey: sessionsKey(tenant.id) });
    // v1's own keys, in case its Settings tab is mounted somewhere for this
    // tenant. Harmless when it is not.
    queryClient.invalidateQueries({ queryKey: ["tesla-fleet-status"] });
    queryClient.invalidateQueries({ queryKey: ["tesla-fleet-vehicles-count"] });
  }, [queryClient, tenant.id]);

  const fail = (title: string) => (e: Error) =>
    toast({ title, description: e.message || "Please try again.", variant: "destructive" });

  /* ── connect ──────────────────────────────────────────────────────────── */

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      // Same-tab, unlike v1's `window.open`: a popup here is blocked by default
      // and the operator sees a button that does nothing. The edge function
      // signs `tenantId` + `returnUrl` into an HMAC state with a 10-minute TTL
      // and, after Tesla calls back, redirects to `returnUrl?tesla_connected=true`.
      // v1 returned to `/settings?tab=tesla`, a tab the lean gate hides from the
      // canary — so this returns to the board instead.
      const res = await invokeFn<{ authUrl?: string }>("tesla-fleet-api", {
        action: "get_auth_url",
        tenantId: tenant.id,
        returnUrl: `${window.location.origin}/integrations`,
      });
      if (!res?.authUrl) throw new Error("Tesla did not return an authorisation link");
      // Latched: the button must keep spinning until the browser actually leaves.
      window.location.href = res.authUrl;
    } catch (e) {
      fail("Could not open Tesla")(e instanceof Error ? e : new Error("Please try again."));
      setConnecting(false);
    }
  }, [tenant.id]);

  /* ── sync now ─────────────────────────────────────────────────────────── */

  /**
   * The same engine the hourly cron runs, scoped to this tenant. This is a real
   * money action: a new session inside a rental becomes a ledger charge on that
   * rental the moment it is found. It is offered because it is exactly what the
   * cron will do at :17 anyway — it brings that forward, it does not add to it.
   */
  const syncNow = useMutation({
    mutationFn: () => invokeFn<SyncResult>("sync-tesla-charges", { tenantId: tenant.id }),
    onSuccess: (result) => {
      setLastSync(result);
      invalidateAll();
      const failed = result.results?.filter((r) => r.error).length ?? 0;
      toast({
        title: failed ? "Sync finished with problems" : "Checked with Tesla",
        description: result.message
          ? result.message
          : `${result.vehiclesChecked} vehicle${result.vehiclesChecked === 1 ? "" : "s"} checked · ${result.synced} new session${result.synced === 1 ? "" : "s"}${failed ? ` · ${failed} could not be read` : ""}`,
        variant: failed ? "destructive" : undefined,
      });
    },
    onError: fail("Could not sync with Tesla"),
  });

  /* ── link / unlink a vehicle ──────────────────────────────────────────── */

  /**
   * `check_vehicle` is v1's "Check Tesla Fleet Compatibility" button: it looks
   * the VIN up in the operator's Tesla account and, on a match, writes
   * `tesla_fleet_enabled` + `tesla_fleet_vehicle_id` on the vehicle (tenant-
   * filtered, in the function). Offered HERE because the vehicle page's copy of
   * it is behind the lean gate — a connected canary would otherwise have no way
   * to link anything, and a connection that syncs nothing is not connected.
   */
  const linkVehicle = useMutation({
    mutationFn: (v: VehicleRow) =>
      invokeFn<{ compatible: boolean; vehicleName?: string; message?: string }>("tesla-fleet-api", {
        action: "check_vehicle",
        tenantId: tenant.id,
        vehicleId: v.id,
        vin: v.vin,
      }),
    onSuccess: (res, v) => {
      invalidateAll();
      if (res.compatible) {
        toast({
          title: `${v.reg} linked`,
          description: `Tesla knows it as ${res.vehicleName || "this vehicle"}. Sessions are checked from the next hourly sync.`,
        });
      } else {
        toast({
          title: `${v.reg} is not in your Tesla account`,
          description: res.message || "Add the vehicle to the Tesla account you authorised, then try again.",
          variant: "destructive",
        });
      }
    },
    onError: fail("Could not check with Tesla"),
  });

  /**
   * The inverse, which v1 does not have — its only way off is a full
   * disconnect. A direct update, because there is no edge-function action for
   * it: mirrors exactly what `disconnect` writes per vehicle. Existing sessions
   * and their ledger lines are untouched; only future polling stops.
   */
  const stopTracking = useMutation({
    mutationFn: async (v: VehicleRow) => {
      const { error } = await supabase
        .from("vehicles")
        .update({ tesla_fleet_enabled: false, tesla_fleet_vehicle_id: null })
        .eq("id", v.id)
        // ⚠️ RLS is OFF on `vehicles`. Without this, a guessed id writes into
        // another operator's fleet.
        .eq("tenant_id", tenant.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      invalidateAll();
      toast({ title: `${v.reg} no longer tracked`, description: "Link it again any time — its recorded sessions are kept." });
    },
    onError: fail("Could not stop tracking"),
  });

  /* ── disconnect ───────────────────────────────────────────────────────── */

  const disconnect = useMutation({
    mutationFn: () =>
      invokeFn<{ success: boolean }>("tesla-fleet-api", { action: "disconnect", tenantId: tenant.id }),
    onSuccess: async () => {
      invalidateAll();
      setLastSync(null);
      try {
        await refetchTenant();
      } catch {
        /* the context refresh is a courtesy; the panel's own reads are already invalidated */
      }
      toast({
        title: "Tesla disconnected",
        description: "Hourly Supercharger sync has stopped. Recorded sessions are kept.",
      });
    },
    onError: fail("Could not disconnect"),
  });

  /* ── render ───────────────────────────────────────────────────────────── */

  if (status.isLoading) return <PanelLoading rows={4} />;
  if (status.isError || !status.data || !view) {
    return (
      <PanelError
        message={status.error instanceof Error ? status.error.message : "Unknown error"}
        onRetry={() => void status.refetch()}
      />
    );
  }

  const fleet = vehicles.data ?? [];
  const linked = fleet.filter((v) => v.tesla_fleet_enabled && v.tesla_fleet_vehicle_id);
  const candidates = fleet.filter((v) => !(v.tesla_fleet_enabled && v.tesla_fleet_vehicle_id));
  const hasAnyTesla = fleet.length > 0;
  const busy = syncNow.isPending || linkVehicle.isPending || stopTracking.isPending || disconnect.isPending;

  /* ── not connected ────────────────────────────────────────────────────── */

  if (!view.connected) {
    return (
      <div className="space-y-5 pt-1">
        <PanelNote>{view.headline}</PanelNote>

        {/* Said before the Connect button, not after: for the canary this is the
            actual state, and an operator who connects first and discovers this
            second has done a Tesla login for nothing. */}
        {!vehicles.isLoading && !hasAnyTesla && (
          <PanelNote tone="warn">
            <span className="flex gap-2">
              <Car className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <strong className="font-medium">Your fleet has no Tesla vehicles yet</strong>, so
                connecting on its own would sync nothing. Add the Tesla with its VIN on the{" "}
                <Link href="/vehicles" onClick={onClose} className="underline">
                  Vehicles page
                </Link>{" "}
                first — or connect now and link it here once it exists.
              </span>
            </span>
          </PanelNote>
        )}

        <PanelSection title="What happens when you connect">
          <ol className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            {[
              "Sign in to the Tesla account that owns your cars and allow Drive247 to read vehicle and charging data.",
              "Back here, link each Tesla by its VIN — Tesla confirms it is on that account.",
              "Every hour, new Supercharger sessions are matched to the rental that covered that time and added to its balance.",
              "On the rental you decide, per session, whether to charge the customer or waive it.",
            ].map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="shrink-0 text-primary">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </PanelSection>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void connect()} disabled={!canManage || connecting}>
            {connecting ? <Loader2 className="animate-spin" /> : <Link2 />}
            {connecting ? "Opening Tesla…" : "Connect Tesla"}
          </Button>
        </div>

        {!canManage && (
          <PanelNote>
            You can see this integration but not change it. Connecting Tesla can only be done by an
            admin or head admin.
          </PanelNote>
        )}
      </div>
    );
  }

  /* ── connected ────────────────────────────────────────────────────────── */

  const recent = sessions.data?.recent ?? [];
  const unmatched = recent.filter((s) => !s.rental_id).length;
  const pending = recent.filter((s) => s.rental_id && (s.status ?? "pending") === "pending").length;
  const total = recent.reduce((sum, s) => sum + Number(s.amount || 0), 0);
  const totalCurrency = recent[0]?.currency ?? null;

  return (
    <div className="space-y-5 pt-1">
      {justReturned && (
        <PanelNote>
          <span className="flex gap-2">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
            <span>
              Tesla authorised.{" "}
              {view.linkedCount === 0
                ? "Next: link your Tesla vehicles below so sessions can be matched to rentals."
                : "Sessions will be checked from the next hourly sync."}
            </span>
          </span>
        </PanelNote>
      )}

      <PanelNote tone={view.tone}>{view.headline}</PanelNote>

      {/* ── Authorisation ─────────────────────────────────────────────── */}
      <PanelSection title="Authorisation">
        <PanelCard className="divide-y divide-border/60">
          <PanelRow
            label="Hourly sync"
            hint={
              view.renewalStalled
                ? "Tesla's access lapsed and no sync has renewed it since — nothing is being checked."
                : "Each pass renews Tesla's access as it nears expiry, so a live expiry below means the sync is reaching this account."
            }
          >
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

          <PanelRow label="Tesla access" hint={view.renewalStalled ? undefined : "Renews itself; you do not need to do anything."}>
            {view.accessValidUntil ? (
              <span title={formatDateTime(view.accessValidUntil)}>
                {view.renewalStalled ? "Lapsed " : "Valid "}
                {relativeTime(view.accessValidUntil)}
              </span>
            ) : (
              <span className="text-muted-foreground">Unknown</span>
            )}
          </PanelRow>

          <PanelRow label="Can renew">
            {view.canRenew ? "Yes" : <span className="text-warning">No renewal token</span>}
          </PanelRow>

          <PanelRow label="Vehicles linked">
            {view.linkedCount === 0 ? <span className="text-warning">None</span> : view.linkedCount}
          </PanelRow>
        </PanelCard>

        {view.needsReconnect && (
          <Button onClick={() => void connect()} disabled={!canManage || connecting}>
            {connecting ? <Loader2 className="animate-spin" /> : <Link2 />}
            {connecting ? "Opening Tesla…" : "Reconnect Tesla"}
          </Button>
        )}
      </PanelSection>

      {/* ── Vehicles ──────────────────────────────────────────────────── */}
      <PanelSection
        title="Vehicles"
        description="Only linked vehicles are polled. Tesla confirms each one by VIN against the account you authorised."
      >
        {vehicles.isLoading ? (
          <PanelLoading rows={2} />
        ) : vehicles.isError ? (
          <p className="text-xs text-muted-foreground">Could not load your vehicles.</p>
        ) : !hasAnyTesla ? (
          <PanelNote tone="warn">
            <span className="flex gap-2">
              <Car className="mt-0.5 size-3.5 shrink-0" />
              <span>
                No Tesla in your fleet yet. Add one with its VIN on the{" "}
                <Link href="/vehicles" onClick={onClose} className="underline">
                  Vehicles page
                </Link>{" "}
                and it will appear here to link. Vehicles are recognised by a make of
                &ldquo;Tesla&rdquo;.
              </span>
            </span>
          </PanelNote>
        ) : (
          <PanelCard className="divide-y divide-border/60 px-0 py-0">
            {linked.map((v) => (
              <div key={v.id} className="flex items-center gap-2.5 px-3.5 py-2">
                <Zap className="size-3.5 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    <span className="font-mono text-[13px]">{v.reg}</span>
                    <span className="text-muted-foreground"> · {vehicleName(v)}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">Tracking Supercharger sessions</p>
                </div>
                <ConfirmAction
                  trigger={
                    <Button size="xs" variant="ghost" disabled={!canManage || busy}>
                      Stop tracking
                    </Button>
                  }
                  title={`Stop tracking ${v.reg}?`}
                  description={
                    <>
                      Supercharger sessions on this car will no longer be picked up or added to its
                      rentals. Sessions already recorded, and any charges already on a rental, are
                      kept. You can link it again at any time.
                    </>
                  }
                  confirmLabel="Stop tracking"
                  onConfirm={() => stopTracking.mutate(v)}
                />
              </div>
            ))}
            {candidates.map((v) => (
              <div key={v.id} className="flex items-center gap-2.5 px-3.5 py-2">
                <Car className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    <span className="font-mono text-[13px]">{v.reg}</span>
                    <span className="text-muted-foreground"> · {vehicleName(v)}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {v.vin ? (
                      "Not linked"
                    ) : (
                      <>
                        Needs a VIN first —{" "}
                        <Link href={`/vehicles/${v.id}`} onClick={onClose} className="underline">
                          add it on the vehicle
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canManage || !v.vin || busy}
                  onClick={() => linkVehicle.mutate(v)}
                >
                  {linkVehicle.isPending && linkVehicle.variables?.id === v.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Link2 />
                  )}
                  Link
                </Button>
              </div>
            ))}
          </PanelCard>
        )}
      </PanelSection>

      {/* ── Supercharger sessions ─────────────────────────────────────── */}
      <PanelSection
        title="Supercharger sessions"
        description="Last 30 days. A session inside a rental becomes a Supercharger line on that rental, to charge or waive; one outside any rental is recorded but billed to nobody."
        action={
          // Deliberately NOT disabled while renewal looks stalled: a manual
          // pass is the operator's one way to retry the refresh, and if Tesla
          // has revoked it the error that comes back says so in Tesla's words.
          <Button
            size="sm"
            variant="outline"
            disabled={!canManage || busy}
            onClick={() => syncNow.mutate()}
          >
            {syncNow.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {syncNow.isPending ? "Checking…" : "Sync now"}
          </Button>
        }
      >
        {sessions.isLoading ? (
          <PanelLoading rows={2} />
        ) : sessions.isError ? (
          // A failed read of history says nothing about whether the sync works,
          // so it stays a quiet line rather than the panel-wide PanelError.
          <p className="text-xs text-muted-foreground">Could not load recent sessions.</p>
        ) : (
          <>
            <PanelCard className="divide-y divide-border/60">
              <PanelRow label="Sessions">{recent.length}</PanelRow>
              <PanelRow label="Total" hint={pending ? `${pending} still to charge or waive` : undefined}>
                {recent.length ? formatMoney(total, totalCurrency) : "—"}
              </PanelRow>
              <PanelRow
                label="Outside any rental"
                hint={unmatched ? "Nobody is billed for these. Matching happens once, when a session is first seen." : undefined}
              >
                {unmatched ? <span className="text-warning">{unmatched}</span> : 0}
              </PanelRow>
              <PanelRow
                label="Last new session recorded"
                // The engine writes nothing on a pass that finds nothing, so
                // this is the last time it found something — not the last
                // time it ran. The "Hourly sync" row above answers that.
                hint="A quiet hour leaves no trace; the sync itself is tracked above."
              >
                {sessions.data?.lastRecordedAt ? (
                  <span title={formatDateTime(sessions.data.lastRecordedAt)}>
                    {relativeTime(sessions.data.lastRecordedAt)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </PanelRow>
            </PanelCard>

            {recent.length > 0 && (
              <PanelCard className="divide-y divide-border/60 px-0 py-0">
                {recent.slice(0, 5).map((s) => {
                  const car = fleet.find((v) => v.id === s.vehicle_id);
                  return (
                    <div key={s.id} className="flex items-center gap-2.5 px-3.5 py-2">
                      <Zap className={cn("size-3.5 shrink-0", s.rental_id ? "text-primary" : "text-muted-foreground/50")} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          {formatMoney(Number(s.amount || 0), s.currency)}
                          <span className="text-muted-foreground">
                            {" "}· {s.location || "Supercharger"}
                            {s.kwh_used != null ? ` · ${Number(s.kwh_used).toFixed(0)} kWh` : ""}
                          </span>
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {formatDateTime(s.charge_date)}
                          {car ? ` · ${car.reg}` : ""}
                          {s.rental_id && (
                            <>
                              {" "}·{" "}
                              <Link href={`/rentals/${s.rental_id}`} onClick={onClose} className="underline">
                                Open rental
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs">
                        <SessionStatus status={s.status} matched={!!s.rental_id} />
                      </span>
                    </div>
                  );
                })}
              </PanelCard>
            )}
          </>
        )}

        {/* What the last manual pass actually did, per vehicle. Kept on screen
            because a toast is gone before "1 could not be read" has been read. */}
        {lastSync && (
          <PanelCard className="space-y-1.5">
            <p className="text-xs text-foreground">
              {lastSync.message
                ? lastSync.message
                : `Checked ${lastSync.vehiclesChecked} vehicle${lastSync.vehiclesChecked === 1 ? "" : "s"} with a rental in the window · ${lastSync.synced} new session${lastSync.synced === 1 ? "" : "s"}.`}
            </p>
            {lastSync.results?.some((r) => r.error) && (
              <ul className="space-y-1">
                {lastSync.results
                  .filter((r) => r.error)
                  .map((r) => (
                    <li key={r.vehicleId} className="flex gap-2 text-[11px] text-destructive">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      <span>
                        <span className="font-mono">{r.vehicleReg}</span>: {r.error}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </PanelCard>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Sync now runs the same check the hourly pass will run at :17 — any session it finds inside
          a rental is added to that rental straight away. Only vehicles with a current rental, or one
          closed in the last 30 days, are checked.
        </p>
      </PanelSection>

      {/* ── Disconnect ────────────────────────────────────────────────── */}
      <PanelSection title="Disconnecting">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Stops the hourly sync and unlinks every vehicle. Sessions already recorded, and charges
            already on rentals, are kept.
          </p>
          <ConfirmAction
            destructive
            trigger={
              <Button size="sm" variant="destructive" disabled={!canManage || busy}>
                <Unplug className="size-3.5" />
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            }
            title="Disconnect Tesla?"
            description={
              <>
                From now on, Supercharger sessions on your Teslas will not be checked every hour and
                will not be added to rentals as billable lines — a customer who Supercharges after
                this is not charged for it unless you add it by hand.{" "}
                {view.linkedCount > 0 && (
                  <>
                    All {view.linkedCount} linked vehicle{view.linkedCount === 1 ? "" : "s"} will be
                    unlinked and must be linked again after reconnecting.{" "}
                  </>
                )}
                Tesla&rsquo;s authorisation is revoked on our side; sessions already recorded and
                charges already on rentals stay exactly as they are.
              </>
            }
            confirmLabel="Disconnect Tesla"
            onConfirm={() => disconnect.mutate()}
          />
        </div>
      </PanelSection>

      {!canManage && (
        <PanelNote>
          You can see this integration but not change it. Linking vehicles, syncing and disconnecting
          can only be done by an admin or head admin.
        </PanelNote>
      )}
    </div>
  );
}
