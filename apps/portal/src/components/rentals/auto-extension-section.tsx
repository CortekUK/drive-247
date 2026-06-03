"use client";

import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  RefreshCw, Pause, Play, Zap, Ban, CreditCard, CalendarClock, Check, Clock, AlertTriangle, FileText, Mail,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRentalExtensionTotals } from "@/hooks/use-rental-extension-totals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/format-utils";

interface AutoExtensionSectionProps {
  rentalId: string;
  rental: any;
  currencyCode: string;
  taxPercent: number;
  /** Non-extension (base) outstanding — 0 means the base week is paid. */
  baseOutstanding: number;
  canEdit: boolean;
  timezone: string;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  awaiting_payment: { label: "Awaiting Payment", className: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  paused: { label: "Paused", className: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  ended: { label: "Ended", className: "bg-muted text-muted-foreground border-border" },
};

export function AutoExtensionSection({
  rentalId, rental, currencyCode, taxPercent, baseOutstanding, canEdit, timezone,
}: AutoExtensionSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: extensions } = useRentalExtensionTotals(rentalId);

  if (!rental?.auto_extend_enabled) return null;

  const tz = timezone || "America/New_York";
  const status: string = rental.auto_extend_status || "active";
  const statusMeta = STATUS_META[status] ?? STATUS_META.active;
  const isPaused = !!rental.auto_extend_paused || status === "paused";
  const chargeMode: "pay_link" | "auto_charge" = rental.auto_extend_charge_mode || "pay_link";
  const periodUnit: string = rental.auto_extend_period_unit || "Weekly";
  const periodLabel = periodUnit === "Monthly" ? "month" : periodUnit === "Daily" ? "day" : "week";

  const perPeriodRate = Math.round((Number(rental.monthly_amount) || 0) * (1 + (Number(taxPercent) || 0) / 100) * 100) / 100;

  const nextChargeAt = rental.auto_extend_next_charge_at
    ? formatInTimeZone(new Date(rental.auto_extend_next_charge_at), tz, "EEE dd MMM yyyy, h:mm a")
    : "—";

  // Unified weekly schedule: base period + each extension.
  const exts = (extensions ?? []).slice().sort((a: any, b: any) => a.sequence_number - b.sequence_number);
  const baseEnd = rental.original_end_date || exts[0]?.previous_end_date || null;
  const fmtD = (d: string | null) => (d ? format(new Date(`${d}T00:00:00`), "dd MMM") : "—");

  const rows = [
    {
      key: "base",
      label: "Week 1",
      sub: "Base rental",
      period: `${fmtD(rental.start_date)} → ${fmtD(baseEnd)}`,
      amount: perPeriodRate,
      paid: baseOutstanding <= 0.01,
      pending: false,
      isExtension: false,
      checkoutUrl: null as string | null,
      reminderSentAt: null as string | null,
    },
    ...exts.map((e: any) => ({
      key: e.id,
      label: `Week ${e.sequence_number + 1}`,
      sub: `Extension #${e.sequence_number}`,
      period: `${fmtD(e.previous_end_date)} → ${fmtD(e.new_end_date)}`,
      amount: Number(e.total_amount) || perPeriodRate,
      paid: e.display_status === "paid",
      pending: e.display_status === "awaiting_payment" || e.display_status === "partial",
      isExtension: true,
      // For pay-link auto-extension, the link is emailed when the extension is
      // created — so a checkout_url means the reminder/pay-link was sent.
      checkoutUrl: (e.checkout_url as string | null) || null,
      reminderSentAt: e.checkout_url ? (e.created_at as string | null) : null,
    })),
  ];

  const update = async (patch: Record<string, any>, successMsg: string) => {
    const { error } = await supabase.from("rentals").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", rentalId);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: successMsg });
    queryClient.invalidateQueries({ queryKey: ["rental", rentalId] });
    queryClient.invalidateQueries({ queryKey: ["rental-extension-totals"] });
  };

  const togglePause = () =>
    isPaused
      ? update({ auto_extend_paused: false, auto_extend_paused_at: null, auto_extend_status: "active" }, "Auto-extension resumed")
      : update({ auto_extend_paused: true, auto_extend_paused_at: new Date().toISOString(), auto_extend_status: "paused" }, "Auto-extension paused");

  const changeMode = (mode: string) =>
    update({ auto_extend_charge_mode: mode }, `Charge method set to ${mode === "auto_charge" ? "Auto-charge" : "Pay-link"}`);

  const stop = () => {
    if (!window.confirm("Stop auto-extension for this rental? No further weeks will be billed automatically.")) return;
    update({ auto_extend_enabled: false, auto_extend_status: "ended" }, "Auto-extension stopped");
  };

  const chargeNow = () => {
    if (!window.confirm(`Bill the next ${periodLabel} now? The customer will be ${chargeMode === "auto_charge" ? "auto-charged" : "emailed a pay-link"} within ~15 minutes.`)) return;
    update({ auto_extend_next_charge_at: new Date().toISOString() }, `Next ${periodLabel} queued — processing shortly`);
  };

  return (
    <Card className="border-violet-500/30">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
            <RefreshCw className="h-5 w-5" />
            Auto-Extension
          </CardTitle>
          <Badge variant="outline" className={statusMeta.className}>{statusMeta.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Key figures */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat icon={<CalendarClock className="h-4 w-4" />} label="Billing period" value={`Every ${periodLabel}`} />
          <Stat icon={<CreditCard className="h-4 w-4" />} label={`Per-${periodLabel} rate`} value={formatCurrency(perPeriodRate, currencyCode)} />
          <Stat icon={<RefreshCw className="h-4 w-4" />} label="Weeks billed" value={String(rental.auto_extend_charge_count ?? exts.length + 1)} />
          <Stat icon={<Clock className="h-4 w-4" />} label="Next charge" value={isPaused ? "Paused" : nextChargeAt} />
        </div>

        {/* Weekly schedule */}
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2 bg-muted/50 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            <div className="col-span-3">Period</div>
            <div className="col-span-3">Dates</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1">Reminder</div>
            <div className="col-span-1 text-right">Invoice</div>
          </div>
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-12 px-4 py-2.5 border-t items-center text-sm gap-1">
              <div className="col-span-3">
                <div className="font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground">{r.sub}</div>
              </div>
              <div className="col-span-3 text-muted-foreground text-xs">{r.period}</div>
              <div className="col-span-2 text-right font-medium">{formatCurrency(r.amount, currencyCode)}</div>
              <div className="col-span-2">
                {r.paid ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium"><Check className="h-3.5 w-3.5" />Paid</span>
                ) : r.pending ? (
                  <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium"><Clock className="h-3.5 w-3.5" />Awaiting</span>
                ) : (
                  <span className="text-muted-foreground text-xs font-medium">Not paid</span>
                )}
              </div>
              {/* Reminder */}
              <div className="col-span-1">
                {!r.isExtension ? (
                  <span className="text-muted-foreground text-xs">—</span>
                ) : r.reminderSentAt ? (
                  <span className="inline-flex items-center gap-1 text-blue-600 text-xs font-medium" title={`Sent ${formatInTimeZone(new Date(r.reminderSentAt), tz, "dd MMM, h:mm a")}`}>
                    <Mail className="h-3.5 w-3.5" />Sent
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">Not sent</span>
                )}
              </div>
              {/* Invoice */}
              <div className="col-span-1 flex justify-end">
                {r.checkoutUrl ? (
                  <a href={r.checkoutUrl} target="_blank" rel="noopener noreferrer" title="Open invoice / pay-link" className="text-muted-foreground hover:text-violet-600">
                    <FileText className="h-4 w-4" />
                  </a>
                ) : (
                  <span className="text-muted-foreground/40"><FileText className="h-4 w-4" /></span>
                )}
              </div>
            </div>
          ))}
          {/* Upcoming (not yet created) week */}
          {!isPaused && status !== "ended" && (
            <div className="grid grid-cols-12 px-4 py-2.5 border-t items-center text-sm bg-violet-500/5 gap-1">
              <div className="col-span-3">
                <div className="font-medium">Week {rows.length + 1}</div>
                <div className="text-xs text-muted-foreground">Upcoming</div>
              </div>
              <div className="col-span-3 text-muted-foreground text-xs">charges {nextChargeAt}</div>
              <div className="col-span-2 text-right font-medium">{formatCurrency(perPeriodRate, currencyCode)}</div>
              <div className="col-span-2">
                <span className="inline-flex items-center gap-1 text-violet-600 text-xs font-medium">
                  {chargeMode === "auto_charge" ? "Auto-charge" : "Pay-link"}
                </span>
              </div>
              <div className="col-span-1"><span className="text-muted-foreground text-xs">Pending</span></div>
              <div className="col-span-1 flex justify-end"><span className="text-muted-foreground/40"><FileText className="h-4 w-4" /></span></div>
            </div>
          )}
        </div>

        {/* Controls */}
        {canEdit && status !== "ended" && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={togglePause} className="gap-1.5">
              {isPaused ? <><Play className="h-3.5 w-3.5" />Resume</> : <><Pause className="h-3.5 w-3.5" />Pause</>}
            </Button>
            <Button variant="outline" size="sm" onClick={chargeNow} disabled={isPaused} className="gap-1.5">
              <Zap className="h-3.5 w-3.5" />Bill next {periodLabel} now
            </Button>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-muted-foreground">Charge method</span>
              <Select value={chargeMode} onValueChange={changeMode}>
                <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pay_link">Pay-link (email)</SelectItem>
                  <SelectItem value="auto_charge">Auto-charge card</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={stop} className="gap-1.5 text-destructive hover:text-destructive">
                <Ban className="h-3.5 w-3.5" />Stop
              </Button>
            </div>
          </div>
        )}

        {chargeMode === "auto_charge" && !rental.deposit_hold_payment_method_id && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Auto-charge is selected but no saved card is on file for this rental. The next charge will fall back to a pay-link until a card is saved.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">{icon}{label}</div>
      <div className="font-semibold text-sm truncate">{value}</div>
    </div>
  );
}
