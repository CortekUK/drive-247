"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, PauseCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface VehiclePauseCardProps {
  vehicleId: string;
  reg?: string | null;
  isPaused: boolean;
  pausedReason?: string | null;
  pausedAt?: string | null;
}

/**
 * "Pause this vehicle" — takes a vehicle off every customer-facing surface
 * without deleting or disposing it.
 *
 * Why a dedicated `is_paused` column rather than `vehicles.status = 'Maintenance'`:
 * `status` is machine-owned. `update_vehicle_status_on_rental_change` resets it
 * to 'Available' unconditionally whenever a rental is completed or cancelled, so
 * a status-based pause silently disappears the next time a rental closes.
 *
 * Why not a `blocked_dates` row with `source_type = 'maintenance'`: that trips
 * `check_rental_overlap`, which raises 23P02 with the operator's own private
 * note interpolated into the message — and nothing in the booking app catches
 * that errcode, so the note would surface to a customer.
 */
export function VehiclePauseCard({
  vehicleId,
  reg,
  isPaused,
  pausedReason,
  pausedAt,
}: VehiclePauseCardProps) {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const { canEdit } = useManagerPermissions();
  const { logAction } = useAuditLog();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState(pausedReason ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Keep the input in step when the row refetches (e.g. another tab paused it).
  useEffect(() => {
    setReason(pausedReason ?? "");
  }, [pausedReason]);

  const editable = canEdit("vehicles");

  // Bookings that a pause would NOT cancel. Deliberately includes 'Pending':
  // the existing blocked-dates manager omits it, which under-reports conflicts.
  const {
    data: conflicts = [],
    // isPending, not isLoading: in react-query v5 a *disabled* query reports
    // isLoading === false, so a null tenant would skip the conflict check
    // entirely. isPending stays true until the query has actually resolved.
    isPending: conflictsPending,
    isError: conflictsError,
  } = useQuery({
    queryKey: ["vehicle-pause-conflicts", tenant?.id, vehicleId],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("rentals")
        .select("id, rental_number, start_date, end_date, status")
        .eq("vehicle_id", vehicleId)
        // 'Confirmed' is not a permitted value — rentals_status_check allows
        // Pending/Active/Closed/Rejected/Cancelled only.
        .in("status", ["Pending", "Active"])
        // An Active rental counts regardless of end_date: the car is physically
        // out with a customer. A flat end_date >= today misses overruns, which
        // are exactly the conflicts that matter most.
        .or(`status.eq.Active,end_date.gte.${today}`)
        .order("start_date", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!tenant && !!vehicleId && !isPaused,
  });

  const applyPause = async (nextPaused: boolean) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("vehicles")
        .update(
          nextPaused
            ? {
                is_paused: true,
                paused_reason: reason.trim() || null,
                paused_at: new Date().toISOString(),
                paused_by: appUser?.id ?? null,
              }
            : {
                is_paused: false,
                paused_reason: null,
                paused_at: null,
                paused_by: null,
              }
        )
        .eq("id", vehicleId);

      if (error) throw error;

      await logAction({
        action: nextPaused ? "vehicle_paused" : "vehicle_unpaused",
        entityType: "vehicle",
        entityId: vehicleId,
        details: {
          reg: reg ?? undefined,
          reason: nextPaused ? reason.trim() || undefined : undefined,
          conflicting_bookings:
            nextPaused && !conflictsPending && !conflictsError ? conflicts.length : undefined,
        },
      });

      queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-pause-conflicts", tenant?.id, vehicleId] });
      setConfirmOpen(false);

      toast({
        title: nextPaused ? "Vehicle paused" : "Vehicle unpaused",
        description: nextPaused
          ? "It's now hidden from your booking site."
          : "It's back on your booking site.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Could not update this vehicle. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (checked: boolean) => {
    // Unpausing never needs the warning.
    if (!checked) {
      void applyPause(false);
      return;
    }
    // Pausing: only skip the warning on a RESOLVED, SUCCESSFUL, empty check.
    // The `= []` default must never stand in for a verified zero, or a fast
    // click (or a failed query) silently bypasses the only safety net here.
    if (conflictsPending || conflictsError || conflicts.length > 0) {
      setConfirmOpen(true);
      return;
    }
    void applyPause(true);
  };

  return (
    <>
      <Card className="shadow-card rounded-lg">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <PauseCircle className="h-5 w-5" />
            Vehicle Status
          </CardTitle>
          <CardDescription>
            Take this vehicle off your booking site while it&apos;s off the road
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <label htmlFor="vehicle-pause" className="text-sm font-medium">
                Pause this vehicle
              </label>
              <p className="text-xs text-muted-foreground max-w-md">
                Hidden from your booking site until you switch it back on. Existing
                bookings are not affected, and nothing is deleted.
              </p>
            </div>
            <Switch
              id="vehicle-pause"
              checked={isPaused}
              disabled={!editable || saving}
              onCheckedChange={handleToggle}
            />
          </div>

          {isPaused ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-1">
              <p className="text-sm font-medium text-amber-700">
                Paused — customers can&apos;t see or book this vehicle
              </p>
              {pausedReason && (
                <p className="text-xs text-amber-700/90">Reason: {pausedReason}</p>
              )}
              {pausedAt && (
                <p className="text-xs text-amber-700/80">
                  Since {format(new Date(pausedAt), "d MMM yyyy, HH:mm")}
                </p>
              )}
            </div>
          ) : (
            editable && (
              <div className="space-y-1.5">
                <label htmlFor="vehicle-pause-reason" className="text-xs text-muted-foreground">
                  Reason (shown to your team — not displayed on your booking site)
                </label>
                <Input
                  id="vehicle-pause-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Bodywork after collision"
                  maxLength={200}
                  disabled={saving}
                />
              </div>
            )
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              This vehicle still has bookings
            </DialogTitle>
            <DialogDescription>
              Pausing hides {reg ? <strong>{reg}</strong> : "this vehicle"} from your
              booking site, but it will <strong>not</strong> cancel the{" "}
              {conflicts.length} booking{conflicts.length === 1 ? "" : "s"} below.
              You&apos;ll need to move or cancel {conflicts.length === 1 ? "it" : "them"}{" "}
              yourself.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
            {conflicts.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium">{r.rental_number || r.id.slice(0, 8)}</span>
                <span className="text-muted-foreground text-xs">
                  {r.start_date} → {r.end_date} · {r.status}
                </span>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => applyPause(true)} disabled={saving}>
              {saving ? "Pausing..." : "Pause anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
