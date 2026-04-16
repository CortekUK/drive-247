"use client";

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, Play, Square, Plus, FastForward, RotateCcw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format-utils";

interface PaygTestPanelProps {
  rentalId: string;
  currencyCode: string;
  currentDay: number;
  isPaused: boolean;
  isClosed: boolean;
  status: string;
  onRefresh: () => void;
}

/**
 * PAYG Test Panel — built into the rental detail page.
 * Provides instant day simulation for testing the PAYG lifecycle.
 * Only visible on localhost / dev environments.
 */
export function PaygTestPanel({
  rentalId,
  currencyCode,
  currentDay,
  isPaused,
  isClosed,
  status,
  onRefresh,
}: PaygTestPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);
  const [timelapse, setTimelapse] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  const isActive = status === "Active" && !isClosed && !isPaused;

  const simulateDays = useCallback(async (days: number) => {
    setLoading(`+${days}`);
    try {
      const { data, error } = await supabase.functions.invoke("simulate-payg-days", {
        body: { rental_id: rentalId, days },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Simulation failed");

      setLastResult(data);
      toast({
        title: `+${data.simulation.days_accrued} day${data.simulation.days_accrued !== 1 ? "s" : ""} accrued`,
        description: `Outstanding: ${formatCurrency(data.rental_state.total_outstanding, currencyCode)}`,
      });
      onRefresh();
    } catch (err: any) {
      toast({ title: "Simulation failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }, [rentalId, currencyCode, onRefresh, toast]);

  const startTimelapse = useCallback(async (totalDays: number) => {
    setLoading("timelapse");
    try {
      const { data, error } = await supabase.functions.invoke("simulate-payg-timelapse", {
        body: { action: "start", rental_id: rentalId, total_days: totalDays },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to start");

      setTimelapse(true);
      toast({
        title: "Time-lapse started",
        description: `1 day/min for ${totalDays} days. Refresh the page to see charges appear.`,
      });
    } catch (err: any) {
      toast({ title: "Failed to start time-lapse", description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }, [rentalId, toast]);

  const stopTimelapse = useCallback(async () => {
    setLoading("stop");
    try {
      await supabase.functions.invoke("simulate-payg-timelapse", {
        body: { action: "stop", rental_id: rentalId },
      });
      setTimelapse(false);
      toast({ title: "Time-lapse stopped" });
      onRefresh();
    } catch (err: any) {
      toast({ title: "Failed to stop", description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }, [rentalId, toast, onRefresh]);

  const triggerReminder = useCallback(async () => {
    setLoading("reminder");
    try {
      const { data, error } = await supabase.functions.invoke("send-payg-reminders", {
        body: {},
      });
      if (error) throw error;
      toast({
        title: "Reminder cron triggered",
        description: data?.sent > 0
          ? `${data.sent} reminder(s) sent`
          : `No reminders due (${data?.skipped || 0} skipped)`,
      });
    } catch (err: any) {
      toast({ title: "Reminder failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }, [toast]);

  const resetSimulation = useCallback(async () => {
    if (!window.confirm(
      "This will delete all PAYG accruals and ledger entries for this rental and reset the day counter to 0. Continue?"
    )) return;

    setLoading("reset");
    try {
      // Delete accruals
      const { error: accrualErr } = await (supabase as any)
        .from("payg_accruals")
        .delete()
        .eq("rental_id", rentalId);
      if (accrualErr) throw accrualErr;

      // Delete PAYG ledger entries (reference starts with payg-)
      const { error: ledgerErr } = await (supabase as any)
        .from("ledger_entries")
        .delete()
        .eq("rental_id", rentalId)
        .eq("type", "Charge")
        .like("reference", `payg-${rentalId}%`);
      if (ledgerErr) throw ledgerErr;

      // Reset rental state
      const now = new Date();
      const { error: rentalErr } = await (supabase as any)
        .from("rentals")
        .update({
          payg_accrual_day_count: 0,
          payg_last_accrual_at: null,
          payg_next_accrual_at: now.toISOString(),
          payg_start_ts: now.toISOString(),
          payg_reminder_count: 0,
          payg_last_reminder_sent_at: null,
          payg_max_duration_alerted: false,
        })
        .eq("id", rentalId);
      if (rentalErr) throw rentalErr;

      // Also delete reminder logs
      await (supabase as any)
        .from("payg_reminder_log")
        .delete()
        .eq("rental_id", rentalId);

      setLastResult(null);
      setTimelapse(false);
      toast({ title: "Simulation reset", description: "All PAYG data cleared. Day counter back to 0." });
      onRefresh();
    } catch (err: any) {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }, [rentalId, toast, onRefresh]);

  return (
    <Card className="border-dashed border-amber-300 bg-amber-50/30 dark:bg-amber-950/10 dark:border-amber-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <FlaskConical className="h-4 w-4" />
            PAYG Test Mode
          </CardTitle>
          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 bg-amber-100 dark:text-amber-400 dark:border-amber-700">
            DEV ONLY
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Instant simulation buttons */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Instant Simulation</p>
          <div className="flex flex-wrap gap-2">
            {[1, 3, 5, 10, 30].map((d) => (
              <Button
                key={d}
                variant="outline"
                size="sm"
                disabled={!isActive || loading !== null}
                onClick={() => simulateDays(d)}
                className="h-8 text-xs"
              >
                {loading === `+${d}` ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3 mr-1" />
                )}
                {d} day{d !== 1 ? "s" : ""}
              </Button>
            ))}
          </div>
        </div>

        {/* Time-lapse controls */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Time-Lapse (1 min = 1 day)</p>
          <div className="flex flex-wrap gap-2">
            {!timelapse ? (
              <>
                {[5, 10, 20].map((d) => (
                  <Button
                    key={d}
                    variant="outline"
                    size="sm"
                    disabled={!isActive || loading !== null}
                    onClick={() => startTimelapse(d)}
                    className="h-8 text-xs"
                  >
                    {loading === "timelapse" ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3 mr-1" />
                    )}
                    {d} days
                  </Button>
                ))}
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={stopTimelapse}
                disabled={loading !== null}
                className="h-8 text-xs border-red-300 text-red-600 hover:bg-red-50"
              >
                {loading === "stop" ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Square className="h-3 w-3 mr-1" />
                )}
                Stop Time-Lapse
              </Button>
            )}
            {timelapse && (
              <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 bg-green-100 animate-pulse">
                Running — refresh to see new charges
              </Badge>
            )}
          </div>
        </div>

        {/* Utility actions */}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-amber-200 dark:border-amber-800">
          <Button
            variant="ghost"
            size="sm"
            disabled={loading !== null}
            onClick={triggerReminder}
            className="h-7 text-xs text-muted-foreground"
          >
            {loading === "reminder" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FastForward className="h-3 w-3 mr-1" />}
            Trigger Reminder
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading !== null}
            onClick={resetSimulation}
            className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
          >
            {loading === "reset" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
            Reset All
          </Button>
        </div>

        {/* Last result summary */}
        {lastResult?.simulation && (
          <div className="text-xs text-muted-foreground bg-white dark:bg-black/20 rounded p-2 border border-amber-200 dark:border-amber-800">
            Last: +{lastResult.simulation.days_accrued} days accrued
            {lastResult.simulation.max_duration_capped && " (hit max duration cap)"}
            {" · "}Day {lastResult.rental_state.payg_accrual_day_count}
            {" · "}Outstanding: {formatCurrency(lastResult.rental_state.total_outstanding, currencyCode)}
          </div>
        )}

        {/* Status hints */}
        {!isActive && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {isClosed ? "Rental is closed — reset to simulate again."
              : isPaused ? "Rental is paused — resume to simulate."
              : status !== "Active" ? `Rental status is "${status}" — set to Active to simulate.`
              : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
