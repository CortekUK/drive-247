"use client";

// DevPanel "Time Machine" section — fast-forward a staging rental and fire cron
// jobs on demand. Renders only inside the DevPanel, which itself renders only
// under NODE_ENV==='development' (never in a deployed build).
//
// Safety: all privileged work happens in the staging-only `sim-control` edge
// function. This component holds NO secrets — supabase.functions.invoke attaches
// the logged-in super-admin's JWT. When pointed at production it shows a red
// PROD badge and disables every control.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Zap, AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

const PROD_REF = "hviqoaokxvlancmftwuo";
const isProd = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PROD_REF);

async function callSim(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("sim-control", { body });
  if (error) {
    // functions.invoke hides the response body on non-2xx; recover it.
    let detail = error.message;
    try {
      // deno-lint-ignore no-explicit-any
      const j = await (error as any).context?.json?.();
      if (j?.error) detail = j.error;
    } catch {
      /* keep default */
    }
    throw new Error(detail);
  }
  if (data?.ok === false) throw new Error(data?.error ?? "sim-control failed");
  return data;
}

export function TimeMachineSection({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const [jobs, setJobs] = useState<string[]>([]);
  const [job, setJob] = useState("");
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState<"" | "shift" | "fire">("");

  useEffect(() => {
    if (!expanded || isProd || jobs.length) return;
    callSim({ action: "list" })
      .then((d) => {
        const names = Object.entries(d.jobs ?? {})
          // deno-lint-ignore no-explicit-any
          .filter(([, v]: [string, any]) => v?.simDispatchable)
          .map(([k]) => k);
        setJobs(names);
        setJob(names[0] ?? "");
      })
      .catch((e) => toast.error(`sim-control: ${e.message}`));
  }, [expanded, jobs.length]);

  useEffect(() => {
    if (expanded) setTarget(sessionStorage.getItem("dev:lastRentalId") ?? "");
  }, [expanded]);

  const setTargetPersisted = (v: string) => {
    setTarget(v);
    if (v) sessionStorage.setItem("dev:lastRentalId", v);
  };

  const refresh = () => qc.invalidateQueries();

  const doShift = async (days: number) => {
    if (!target) return toast.error("No target rental — paste a rental id first");
    setBusy("shift");
    const id = toast.loading(`Jumping +${days}d…`);
    try {
      const d = await callSim({ action: "shift", domain: "payg", id: target, days });
      toast.success(`Shifted +${days}d (${d.rowsUpdated} row)`, { id });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id });
    } finally {
      setBusy("");
    }
  };

  const doFire = async () => {
    if (!job) return;
    setBusy("fire");
    const id = toast.loading(`Firing ${job}…`);
    try {
      const d = await callSim({ action: "fire", name: job, onlyId: target || null });
      const disp = d.dispatch?.[0] ?? {};
      const detail = disp.body?.processed ?? disp.body?.charged;
      toast.success(`${job} → ${disp.status ?? "ok"}${detail != null ? ` (processed ${detail})` : ""}`, { id });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="border border-border rounded-lg">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium">
        <span className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" /> Time Machine / Cron
        </span>
        <span className="flex items-center gap-2">
          <Badge variant="outline" className={isProd ? "border-red-500/50 text-red-600" : "border-green-500/50 text-green-600"}>
            {isProd ? "PROD" : "STAGING"}
          </Badge>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-2">
          {isProd ? (
            <div className="flex items-start gap-2 text-[11px] text-red-600 p-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Disabled on production. Point local env at staging (<code>node scripts/db-switch.mjs staging</code>), then restart the dev server, to use the Time Machine.
              </span>
            </div>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground">Staging + local dev only. Fires the REAL cron function against staging data.</p>

              <div className="text-[10px] uppercase text-muted-foreground">Target rental id</div>
              <input
                value={target}
                onChange={(e) => setTargetPersisted(e.target.value.trim())}
                placeholder="paste an Active PAYG rental id"
                className="w-full text-xs h-7 rounded border border-border bg-background px-2"
              />

              <div className="text-[10px] uppercase text-muted-foreground">Jump forward</div>
              <div className="flex gap-1">
                {[1, 7, 14, 30].map((d) => (
                  <Button
                    key={d}
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs h-7"
                    disabled={busy !== "" || !target}
                    onClick={() => doShift(d)}
                  >
                    {busy === "shift" ? <Loader2 className="h-3 w-3 animate-spin" /> : `+${d}d`}
                  </Button>
                ))}
              </div>

              <div className="text-[10px] uppercase text-muted-foreground">Fire cron</div>
              <select
                className="w-full text-xs h-7 rounded border border-border bg-background px-1"
                value={job}
                onChange={(e) => setJob(e.target.value)}
              >
                {jobs.length === 0 && <option value="">(loading…)</option>}
                {jobs.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" className="w-full text-xs h-7" disabled={busy !== "" || !job} onClick={doFire}>
                {busy === "fire" ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Zap className="h-3 w-3 mr-1" /> Fire</>}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
