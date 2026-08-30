/**
 * AccountingBackfillWizard — Sprint 4, Spec §10.8 + §12.
 *
 * 3-step modal:
 *   Step 1 — Date range picker (All time / Last 12 months / Custom) + estimated
 *            event count + estimated time
 *   Step 2 — Confirm mappings are set (operator can't backfill without them)
 *   Step 3 — Review + Start
 *
 * On Start → call backfill-accounting-sync → progress modal that polls
 * get-accounting-sync-status?backfillJobId=... every 5s until status=completed.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar, ChevronRight, ChevronLeft, Check, AlertCircle, Loader2, Sparkles, ExternalLink,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  useStartBackfill, useBackfillJob, useBackfillEventCount,
} from "@/hooks/use-accounting-backfill";
import { useAccountingMappings } from "@/hooks/use-accounting-sync";
import type { AccountingProvider } from "@/hooks/use-accounting-connection";

type RangeChoice = "all" | "12m" | "custom";
type Step = 1 | 2 | 3 | 4;            // 4 = progress

interface Props {
  open: boolean;
  provider: AccountingProvider;
  onClose: () => void;
  onOpenMappings: () => void;
}

export function AccountingBackfillWizard({ open, provider, onClose, onOpenMappings }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [rangeChoice, setRangeChoice] = useState<RangeChoice>("12m");
  const [customFrom, setCustomFrom] = useState<string>(() => new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(1);
      setRangeChoice("12m");
      setActiveJobId(null);
    }
  }, [open]);

  const today = new Date().toISOString().slice(0, 10);
  const { dateFrom, dateTo } = useMemo(() => {
    if (rangeChoice === "all") return { dateFrom: null, dateTo: today };
    if (rangeChoice === "12m") return { dateFrom: new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10), dateTo: today };
    return { dateFrom: customFrom, dateTo: customTo };
  }, [rangeChoice, customFrom, customTo, today]);

  const eventCount = useBackfillEventCount({ dateFrom, dateTo, enabled: open && step === 1 });
  const mappings = useAccountingMappings(open ? provider : null);
  const startMutation = useStartBackfill();
  const jobQuery = useBackfillJob(activeJobId);

  const eligibleMappingCount = (mappings.data ?? []).filter((m) => !m.is_payment_account_sentinel && m.external_account_code).length;
  const hasPaymentAccount = (mappings.data ?? []).some((m) => m.is_payment_account_sentinel);
  const mappingsReady = eligibleMappingCount >= 1 && hasPaymentAccount;

  const estimatedMinutes = Math.max(2, Math.ceil((eventCount.data ?? 0) / 100) * 2);
  const isJobDone = jobQuery.data?.status === "completed" || jobQuery.data?.status === "failed";
  const progressPercent = jobQuery.data && jobQuery.data.total_events > 0
    ? Math.min(100, Math.round((jobQuery.data.processed_events / jobQuery.data.total_events) * 100))
    : 0;

  const onStart = async () => {
    try {
      const res = await startMutation.mutateAsync({ provider, dateFrom, dateTo });
      setActiveJobId(res.backfillJobId);
      setStep(4);
    } catch {
      // toast already fired by mutation
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        {/* Step 1 — date range */}
        {step === 1 && (
          <>
            <DialogHeader>
              <DialogTitle>Sync historical data to {provider === "xero" ? "Xero" : "Zoho Books"}</DialogTitle>
              <DialogDescription>Step 1 of 3 — Which date range should we sync?</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <RangeOption
                value="12m" current={rangeChoice} onSelect={setRangeChoice}
                label="Last 12 months" description="Recommended for most operators"
              />
              <RangeOption
                value="all" current={rangeChoice} onSelect={setRangeChoice}
                label="All time" description="Sync every event Drive247 has on file"
              />
              <RangeOption
                value="custom" current={rangeChoice} onSelect={setRangeChoice}
                label="Custom range" description="Pick exact start and end dates"
              />

              {rangeChoice === "custom" && (
                <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3">
                  <div>
                    <Label className="text-xs">From</Label>
                    <Input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="mt-1 h-9 text-xs"
                      max={customTo}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">To</Label>
                    <Input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="mt-1 h-9 text-xs"
                      max={today}
                      min={customFrom}
                    />
                  </div>
                </div>
              )}

              <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
                <div className="font-medium">What&apos;s included</div>
                {eventCount.isLoading ? (
                  <Skeleton className="mt-1 h-4 w-32" />
                ) : (
                  <>
                    <div className="mt-1 text-muted-foreground">
                      <span className="font-medium text-foreground">{(eventCount.data ?? 0).toLocaleString()}</span> events to sync
                    </div>
                    <div className="text-muted-foreground">
                      Estimated time: <span className="font-medium text-foreground">~{estimatedMinutes} minutes</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={() => setStep(2)}
                disabled={(eventCount.data ?? 0) === 0}
                className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
              >
                Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 2 — mappings check */}
        {step === 2 && (
          <>
            <DialogHeader>
              <DialogTitle>Confirm your mappings are set</DialogTitle>
              <DialogDescription>Step 2 of 3 — Every event type should map to a provider account before we backfill.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {mappings.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : mappingsReady ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 text-emerald-700" />
                    <div>
                      <div className="font-medium text-emerald-900">All set</div>
                      <p className="mt-0.5 text-emerald-800">
                        {eligibleMappingCount} event types mapped + payment account configured.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 text-amber-700" />
                    <div>
                      <div className="font-medium text-amber-900">Mappings incomplete</div>
                      <p className="mt-0.5 text-amber-800">
                        {!hasPaymentAccount && "Payment account not picked. "}
                        {eligibleMappingCount < 1 && "No event types have account codes."}
                      </p>
                      <Button
                        size="sm" variant="outline" className="mt-2 text-xs"
                        onClick={() => { onClose(); onOpenMappings(); }}
                      >
                        Open mappings <ExternalLink className="ml-1 h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!mappingsReady}
                className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
              >
                Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 3 — review */}
        {step === 3 && (
          <>
            <DialogHeader>
              <DialogTitle>Review and start</DialogTitle>
              <DialogDescription>Step 3 of 3 — Ready to sync.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <ReviewRow label="Provider" value={provider === "xero" ? "Xero" : "Zoho Books"} />
              <ReviewRow label="Date range" value={
                rangeChoice === "all" ? "All time" :
                rangeChoice === "12m" ? "Last 12 months" :
                `${customFrom} → ${customTo}`
              } />
              <ReviewRow label="Events to sync" value={(eventCount.data ?? 0).toLocaleString()} />
              <ReviewRow label="Estimated time" value={`~${estimatedMinutes} minutes`} />
              <p className="rounded-md border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                <Sparkles className="mr-1 inline h-3 w-3 text-indigo-600" />
                The backfill runs in the background. You can close this window — the next time you open Sync log
                you&apos;ll see new rows appearing.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(2)}>
                <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button
                onClick={onStart}
                disabled={startMutation.isPending}
                className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90"
              >
                {startMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Calendar className="mr-1 h-3.5 w-3.5" />}
                Start backfill
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 4 — progress */}
        {step === 4 && (
          <>
            <DialogHeader>
              <DialogTitle>
                {jobQuery.data?.status === "completed" ? "Backfill complete" :
                 jobQuery.data?.status === "failed" ? "Backfill failed" :
                 "Backfill in progress…"}
              </DialogTitle>
              <DialogDescription>
                {jobQuery.data?.status === "completed" ? "All events are queued — they'll sync to the provider over the next few minutes." :
                 jobQuery.data?.status === "failed" ? "Something went wrong. See details below." :
                 "Queuing your historical events for sync. This window updates every 5 seconds."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Progress value={progressPercent} className="h-2" />
              <div className="grid grid-cols-3 gap-3 text-center text-xs">
                <div className="rounded-md border border-border bg-muted/20 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
                  <div className="mt-0.5 text-base font-medium tabular-nums">{(jobQuery.data?.total_events ?? 0).toLocaleString()}</div>
                </div>
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-700">Queued</div>
                  <div className="mt-0.5 text-base font-medium tabular-nums text-emerald-700">{(jobQuery.data?.processed_events ?? 0).toLocaleString()}</div>
                </div>
                <div className="rounded-md border border-red-200 bg-red-50 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-red-700">Failed</div>
                  <div className="mt-0.5 text-base font-medium tabular-nums text-red-700">{(jobQuery.data?.failed_events ?? 0).toLocaleString()}</div>
                </div>
              </div>
              {jobQuery.data?.last_error && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  {jobQuery.data.last_error}
                </div>
              )}
            </div>
            <DialogFooter>
              {isJobDone ? (
                <Button onClick={onClose} className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90">Close</Button>
              ) : (
                <Button variant="outline" onClick={onClose}>Run in background</Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RangeOption({
  value, current, onSelect, label, description,
}: { value: RangeChoice; current: RangeChoice; onSelect: (v: RangeChoice) => void; label: string; description: string }) {
  const isSelected = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors
        ${isSelected ? "border-indigo-300 bg-indigo-50/50" : "border-border bg-background hover:border-indigo-200"}`}
    >
      <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isSelected ? "border-indigo-600 bg-indigo-600" : "border-muted-foreground/30"}`}>
        {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
    </button>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
