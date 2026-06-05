/**
 * AttachAutomationDropdown — Spec Section 7.6.
 *
 * Surfaces published manual-trigger automations + lets operator force-start an
 * event-driven one on this lead. Lists active runs for this lead inline.
 */
"use client";

import { useState } from "react";
import { Plus, Loader2, Pause, Play, Workflow } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

import { useAutomations } from "@/hooks/use-automations";
import { useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/integrations/supabase/client";

interface ActiveRun {
  id: string;
  automation_id: string;
  status: string;
  current_step_id: string | null;
  resume_at: string | null;
  started_at: string;
}

interface Props {
  leadId: string;
  tenantId: string;
}

export function AttachAutomationDropdown({ leadId, tenantId }: Props) {
  const { data: automations = [] } = useAutomations();
  const { appUser } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<ActiveRun[]>([]);

  // Lightweight inline load of active runs for THIS lead.
  const loadRuns = async () => {
    const { data } = await supabase
      .from("automation_runs")
      .select("id, automation_id, status, current_step_id, resume_at, started_at")
      .eq("entity_type", "lead")
      .eq("entity_id", leadId)
      .in("status", ["running", "waiting", "paused"])
      .order("started_at", { ascending: false });
    setRuns((data ?? []) as ActiveRun[]);
  };

  const trigger = async (automationId: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("automation-trigger-event", {
        body: {
          tenantId,
          eventType: "manual",
          entityType: "lead",
          entityId: leadId,
          automationId,
          triggeredByUserId: appUser?.id,
          payload: { manualStart: true },
        },
      });
      if (error) throw error;
      toast.success("Automation started");
      await loadRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start automation");
    } finally {
      setBusy(false);
    }
  };

  const setRunStatus = async (runId: string, status: "paused" | "running" | "stopped") => {
    setBusy(true);
    try {
      const update: Record<string, unknown> = { status };
      if (status === "stopped") update.ended_at = new Date().toISOString();
      const { error } = await supabase.from("automation_runs").update(update).eq("id", runId);
      if (error) throw error;
      toast.success(`Run ${status}`);
      await loadRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const published = automations.filter((a) => a.status === "published");
  const manual = published.filter((a) => a.trigger_type === "manual");
  const eventDriven = published.filter((a) => a.trigger_type !== "manual");

  return (
    <div className="space-y-2">
      <DropdownMenu onOpenChange={(o) => { if (o) loadRuns(); }}>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="w-full justify-start" disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            Attach automation
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start">
          {manual.length === 0 && eventDriven.length === 0 && (
            <DropdownMenuItem disabled className="text-xs text-[#737373]">
              No published automations
            </DropdownMenuItem>
          )}
          {manual.length > 0 && (
            <>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-[#737373]">
                Manual triggers
              </DropdownMenuLabel>
              {manual.map((a) => (
                <DropdownMenuItem key={a.id} onClick={() => trigger(a.id)}>
                  <Workflow className="mr-1.5 h-3.5 w-3.5" />
                  {a.name}
                </DropdownMenuItem>
              ))}
            </>
          )}
          {eventDriven.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-[#737373]">
                Event-driven (force start)
              </DropdownMenuLabel>
              {eventDriven.map((a) => (
                <DropdownMenuItem key={a.id} onClick={() => trigger(a.id)}>
                  <Workflow className="mr-1.5 h-3.5 w-3.5" />
                  <span className="flex-1 truncate">{a.name}</span>
                  <span className="ml-2 text-[10px] text-[#737373]">{a.trigger_type}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {runs.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#737373]">
            Active automations
          </p>
          {runs.map((r) => {
            const automation = automations.find((a) => a.id === r.automation_id);
            return (
              <div key={r.id} className="flex items-center justify-between rounded border border-[#f1f5f9] bg-[#f8fafc] p-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[#080812]">
                    {automation?.name ?? "(deleted)"}
                  </div>
                  <div className="text-[10px] text-[#737373]">
                    {r.status}
                    {r.resume_at && r.status === "waiting" && (
                      <> · resumes {new Date(r.resume_at).toLocaleString()}</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  {r.status === "waiting" || r.status === "running" ? (
                    <button
                      type="button"
                      onClick={() => setRunStatus(r.id, "paused")}
                      className="rounded p-1 hover:bg-[#eef2ff]"
                      title="Pause"
                    >
                      <Pause className="h-3 w-3" />
                    </button>
                  ) : r.status === "paused" ? (
                    <button
                      type="button"
                      onClick={() => setRunStatus(r.id, "running")}
                      className="rounded p-1 hover:bg-[#eef2ff]"
                      title="Resume"
                    >
                      <Play className="h-3 w-3" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setRunStatus(r.id, "stopped")}
                    className="rounded p-1 text-red-600 hover:bg-red-50"
                    title="Stop"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
