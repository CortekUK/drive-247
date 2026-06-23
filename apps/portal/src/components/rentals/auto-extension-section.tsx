"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import {
  RefreshCw, Pause, Play, Zap, Ban, CreditCard, CalendarClock, Clock, AlertTriangle,
  Send, Eye, History, User, Loader2, Pencil, Info,
} from "lucide-react";
import { CadenceEditorDialog } from "@/components/rentals/cadence-editor-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRentalExtensionTotals } from "@/hooks/use-rental-extension-totals";
import { useTenant } from "@/contexts/TenantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  customerEmail?: string | null;
  customerName?: string | null;
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  awaiting_payment: { label: "Awaiting Payment", className: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  paused: { label: "Paused", className: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  ended: { label: "Ended", className: "bg-muted text-muted-foreground border-border" },
};

export function AutoExtensionSection({
  rentalId, rental, currencyCode, taxPercent, baseOutstanding, canEdit, timezone,
  customerEmail, customerName,
}: AutoExtensionSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { data: extensions } = useRentalExtensionTotals(rentalId);

  // Reminder history (drives the log + paid-through-link timestamps).
  const { data: reminders } = useQuery({
    queryKey: ["auto-ext-reminders", rentalId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("auto_extension_reminders")
        .select("id, reminder_type, channel, recipient, subject, amount, status, sent_at, paid_at")
        .eq("rental_id", rentalId)
        .order("sent_at", { ascending: false });
      return (data ?? []) as any[];
    },
    enabled: !!rentalId,
  });

  const [sending, setSending] = useState(false);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cadenceOpen, setCadenceOpen] = useState(false);

  if (!rental?.auto_extend_enabled) return null;

  const tz = timezone || "America/New_York";
  const status: string = rental.auto_extend_status || "active";
  const statusMeta = STATUS_META[status] ?? STATUS_META.active;
  const isPaused = !!rental.auto_extend_paused || status === "paused";
  const chargeMode: "pay_link" | "auto_charge" = rental.auto_extend_charge_mode || "pay_link";
  const periodUnit: string = rental.auto_extend_period_unit || "Weekly";
  const periodLabel = periodUnit === "Monthly" ? "month" : periodUnit === "Daily" ? "day" : "week";
  const intervalCount = Number(rental.auto_extend_interval_count ?? 1);
  const cadenceText = (periodUnit === "Daily" && intervalCount === 7)
    ? "Every week"
    : intervalCount === 1 ? `Every ${periodLabel}` : `Every ${intervalCount} ${periodLabel}s`;

  const saveCadence = async (data: { unit: string; count: number; anchorYmd: string; exceptions: any; overrides: any }) => {
    // Keep the original time-of-day; only change the calendar date to the picked anchor.
    const orig = new Date(rental.auto_extend_next_charge_at || rental.end_date || Date.now());
    const [y, m, d] = data.anchorYmd.split("-").map(Number);
    const next = new Date(orig);
    next.setFullYear(y, m - 1, d);
    await update(
      {
        auto_extend_period_unit: data.unit,
        auto_extend_interval_count: data.count,
        auto_extend_next_charge_at: next.toISOString(),
        auto_extend_exceptions: data.exceptions,
        auto_extend_overrides: data.overrides,
      },
      "Renewal schedule updated",
    );
  };

  const perPeriodRate = Math.round((Number(rental.monthly_amount) || 0) * (1 + (Number(taxPercent) || 0) / 100) * 100) / 100;

  const nextChargeAt = rental.auto_extend_next_charge_at
    ? formatInTimeZone(new Date(rental.auto_extend_next_charge_at), tz, "EEE dd MMM yyyy, h:mm a")
    : "—";

  // Extensions are shown in the standard Extension view; here we only need the count.
  const exts = (extensions ?? []).slice().sort((a: any, b: any) => a.sequence_number - b.sequence_number);

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

  const reminderEnabled = rental.auto_extend_reminder_enabled !== false;
  const reminderInterval = Number(rental.auto_extend_reminder_interval_days ?? 2);
  const reminderMax = Number(rental.auto_extend_reminder_max ?? 3);
  const remindersSent = Number(rental.auto_extend_reminder_count ?? 0);

  // Send a pay-link reminder now (optionally a custom amount) via the edge function.
  const sendReminder = async (amount?: number) => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-auto-extension-reminder", {
        body: { rentalId, ...(amount ? { customAmount: amount } : {}) },
      });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.reason || "Could not send");
      toast({ title: "Reminder sent", description: `Pay-link emailed to ${data?.recipient || customerEmail} for ${formatCurrency(Number(data?.amount || amount || perPeriodRate), currencyCode)}.` });
      setCustomAmount("");
      queryClient.invalidateQueries({ queryKey: ["auto-ext-reminders", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rental", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rental-extension-totals"] });
    } catch (e: any) {
      toast({ title: "Couldn't send reminder", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
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
          <div className="rounded-lg border p-3 relative">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><CalendarClock className="h-4 w-4" />Billing period</div>
            <div className="font-semibold text-sm truncate pr-5">{cadenceText}</div>
            {canEdit && status !== "ended" && (
              <button onClick={() => setCadenceOpen(true)} className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-violet-600" title="Edit renewal cadence">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Stat icon={<CreditCard className="h-4 w-4" />} label={`Per-${periodLabel} rate`} value={formatCurrency(perPeriodRate, currencyCode)} />
          <Stat icon={<RefreshCw className="h-4 w-4" />} label="Periods billed" value={String(rental.auto_extend_charge_count ?? exts.length + 1)} />
          <Stat icon={<Clock className="h-4 w-4" />} label="Next renewal" value={isPaused ? "Paused" : nextChargeAt} />
        </div>

        {/* Promo discounts never apply to renewal cycles — only to the original fixed term. */}
        <div className="flex items-start gap-2 rounded-md border border-muted bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Promo &amp; duration discounts apply only to the original fixed booking. Each auto-extension renewal is billed at the full per-{periodLabel} rate above — discounts are never carried into renewal cycles.
          </span>
        </div>

        {/* Next renewal (automation only). The per-extension payment breakdown,
            agreements & insurance live in the standard Extension view on this page. */}
        {status !== "ended" && (
          <div className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3 bg-violet-500/5">
            <div className="flex items-center gap-2 text-sm min-w-0">
              <CalendarClock className="h-4 w-4 text-violet-600 shrink-0" />
              <span className="text-muted-foreground">Next renewal:</span>
              {isPaused ? (
                <span className="font-medium text-amber-600">Paused</span>
              ) : (
                <span className="font-medium truncate">
                  {formatCurrency(perPeriodRate, currencyCode)} · {nextChargeAt} · {chargeMode === "auto_charge" ? "auto-charge card" : "pay-link email"}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">Per-extension breakdown, agreements & insurance are in the Extension section below.</span>
          </div>
        )}

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

        {/* ── Reminders & recipient ─────────────────────────────── */}
        {canEdit && status !== "ended" && (
          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm min-w-0">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Emails go to</span>
                <span className="font-medium truncate">{customerEmail || "— no email on file"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} className="gap-1.5"><Eye className="h-3.5 w-3.5" />Preview email</Button>
                <Button size="sm" onClick={() => sendReminder()} disabled={sending || !customerEmail} className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white">
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Send reminder now
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Custom amount</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} step="0.01" placeholder={String(perPeriodRate)} value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} className="h-8 w-28" />
                  <Button variant="outline" size="sm" disabled={sending || !customAmount || Number(customAmount) <= 0 || !customerEmail} onClick={() => sendReminder(Number(customAmount))}>Send</Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reminder every (days)</Label>
                <Input type="number" min={1} max={30} defaultValue={reminderInterval} className="h-8 w-24"
                  onBlur={(e) => { const v = Math.max(1, Math.min(30, Number(e.target.value) || 2)); if (v !== reminderInterval) update({ auto_extend_reminder_interval_days: v }, "Reminder frequency updated"); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max reminders</Label>
                <Input type="number" min={0} max={20} defaultValue={reminderMax} className="h-8 w-24"
                  onBlur={(e) => { const v = Math.max(0, Math.min(20, Number(e.target.value) || 3)); if (v !== reminderMax) update({ auto_extend_reminder_max: v }, "Reminder cap updated"); }} />
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Switch checked={reminderEnabled} onCheckedChange={(v) => update({ auto_extend_reminder_enabled: v }, v ? "Auto-reminders on" : "Auto-reminders off")} />
                <span className="text-xs text-muted-foreground">Auto-reminders {reminderEnabled ? "on" : "off"}</span>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-2"><History className="h-3.5 w-3.5" />Reminder history ({remindersSent} sent)</div>
              {reminders && reminders.length > 0 ? (
                <div className="space-y-1.5 max-h-44 overflow-auto">
                  {reminders.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between text-xs border-l-2 pl-3 py-1"
                      style={{ borderLeftColor: r.status === "paid" ? "#16a34a" : r.status === "failed" ? "#dc2626" : "#7c3aed" }}>
                      <div className="truncate">
                        <span className="font-medium capitalize">{r.reminder_type}</span> · {r.recipient} · {formatCurrency(Number(r.amount || 0), currencyCode)}
                        <span className="text-muted-foreground"> — {formatInTimeZone(new Date(r.sent_at), tz, "dd MMM, h:mm a")}</span>
                      </div>
                      <span className={`shrink-0 ml-2 ${r.status === "paid" ? "text-emerald-600" : r.status === "failed" ? "text-red-600" : "text-muted-foreground"}`}>
                        {r.status === "paid" ? `Paid${r.paid_at ? " " + formatInTimeZone(new Date(r.paid_at), tz, "dd MMM") : ""}` : r.status === "failed" ? "Failed" : "Sent"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">No reminders sent yet.</p>}
            </div>
          </div>
        )}

        {/* Renewal cadence editor */}
        <CadenceEditorDialog
          open={cadenceOpen}
          onOpenChange={setCadenceOpen}
          anchorDate={new Date(rental.auto_extend_next_charge_at || rental.end_date || Date.now())}
          initialUnit={(periodUnit as any) || "Weekly"}
          initialCount={intervalCount}
          initialExceptions={(rental.auto_extend_exceptions as any) || { skips: [], moves: {} }}
          initialOverrides={(rental.auto_extend_overrides as any) || {}}
          occurrenceDefaults={{
            emailSubject: `Pay ${formatCurrency(perPeriodRate, currencyCode)} to renew your rental`,
            emailBody: `Hi ${customerName || "there"},\n\nYour rental with ${tenant?.company_name || "us"} is due to renew for another ${periodLabel}. Please pay ${formatCurrency(perPeriodRate, currencyCode)} to continue.`,
            rateLabel: formatCurrency(perPeriodRate, currencyCode),
            companyName: tenant?.company_name || "us",
            customerName: customerName || "",
            periodLabel,
          }}
          occurrenceContext={{
            baseRate: perPeriodRate,
            currencyCode,
            periodUnit: (periodUnit === "Monthly" ? "Monthly" : periodUnit === "Daily" ? "Daily" : "Weekly") as "Daily" | "Weekly" | "Monthly",
            intervalCount,
            customerId: rental.customer_id,
            customerEmail,
            rental,
            vehicle: rental.vehicles,
          }}
          rateLabel={`${formatCurrency(perPeriodRate, currencyCode)} / period`}
          onSave={saveCadence}
        />

        {/* Email preview */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Email preview</DialogTitle></DialogHeader>
            <div className="text-sm space-y-2">
              <div className="text-xs text-muted-foreground">To: {customerEmail || "—"}</div>
              <div className="text-xs text-muted-foreground">Subject: Pay {formatCurrency(perPeriodRate, currencyCode)} to renew your rental</div>
              <div className="rounded-lg border p-4 bg-muted/30">
                <p className="font-semibold mb-2">Time to renew your rental</p>
                <p className="mb-2">Hi {customerName || "there"},</p>
                <p className="mb-2">Your rental with <strong>{tenant?.company_name || "us"}</strong> renews for another {periodLabel}. Please pay <strong>{formatCurrency(perPeriodRate, currencyCode)}</strong> to continue.</p>
                <div className="text-center my-3"><span className="inline-block bg-violet-600 text-white px-5 py-2 rounded-md text-sm font-semibold">Pay {formatCurrency(perPeriodRate, currencyCode)} Now</span></div>
                <p className="text-xs text-muted-foreground">If you've already paid or returned the vehicle, please disregard.</p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
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
