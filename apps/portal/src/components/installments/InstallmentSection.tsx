"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Send, CheckCircle2, AlertCircle, Pause, Ban, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { InstallmentCalendar, type InstallmentCalendarItem } from "./InstallmentCalendar";
import { InstallmentScheduleTable, type ScheduleRow } from "./InstallmentScheduleTable";
import { InstallmentBreakdown } from "./InstallmentBreakdown";
import { useInstallmentPlanRealtime } from "@/hooks/use-installment-plan-realtime";
import { cn } from "@/lib/utils";

interface Props {
  rentalId: string;
  rentalStart?: string;
  rentalEnd?: string;
}

function fmtCurrency(amount: number, code = "USD") {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount); }
  catch { return `${code} ${amount.toFixed(2)}`; }
}

function fmtDateTime(s: string) {
  try {
    return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return s; }
}

function calendarItem(row: any): InstallmentCalendarItem {
  const today = new Date().toISOString().split("T")[0];
  const status: InstallmentCalendarItem["status"] =
    row.invoice_status === "paid" ? "paid" :
    row.invoice_status === "superseded" ? "superseded" :
    row.due_date < today ? "overdue" :
    row.due_date === today ? "due_today" : "scheduled";
  return {
    number: row.installment_number,
    date: row.due_date,
    amount: Number(row.amount),
    status,
  };
}

export function InstallmentSection({ rentalId, rentalStart, rentalEnd }: Props) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const currency = tenant?.currency_code || "USD";

  const { data, isLoading } = useQuery({
    queryKey: ["installment-plan-full", rentalId, tenant?.id],
    enabled: !!rentalId && !!tenant?.id,
    queryFn: async () => {
      const { data: plan } = await supabase
        .from("installment_plans")
        .select("*")
        .eq("rental_id", rentalId)
        .maybeSingle();
      if (!plan) return null;
      const { data: schedule } = await supabase
        .from("scheduled_installments")
        .select("*")
        .eq("installment_plan_id", plan.id)
        .order("installment_number", { ascending: true });
      return { plan, schedule: (schedule ?? []) as any[] };
    },
  });

  const { data: events } = useQuery({
    queryKey: ["installment-plan-events", data?.plan?.id],
    enabled: !!data?.plan?.id,
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("installment_notifications")
        .select("*")
        .eq("installment_plan_id", data!.plan.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return (rows ?? []) as any[];
    },
  });

  useInstallmentPlanRealtime(data?.plan?.id);

  const summary = useMemo(() => {
    if (!data) return null;
    const open = data.schedule.filter((s) => s.invoice_status === "open");
    const paid = data.schedule.filter((s) => s.invoice_status === "paid");
    const today = new Date().toISOString().split("T")[0];
    const overdue = open.filter((s) => s.due_date < today);
    const overdueTotal = overdue.reduce((s, r) => s + Number(r.amount), 0);
    const totalPaid = paid.reduce((s, r) => s + Number(r.amount), 0);
    const totalAmount = data.schedule.reduce((s, r) => s + Number(r.amount), 0);
    return { overdue, overdueTotal, totalPaid, totalAmount, openCount: open.length, paidCount: paid.length };
  }, [data]);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading installment plan…</div>;
  if (!data || !data.plan) return null;
  const plan = data.plan as any;

  async function handleSendReminder() {
    setBusyId("reminder");
    try {
      const { error } = await supabase.functions.invoke("send-installment-reminders", {
        body: { planId: plan.id, reason: "Operator-triggered reminder" },
      });
      if (error) throw error;
      toast({ title: "Reminder sent" });
      qc.invalidateQueries({ queryKey: ["installment-plan-events"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setBusyId(null); }
  }

  async function handleMarkPaid(installmentId: string) {
    setBusyId(installmentId);
    try {
      const { error } = await supabase.functions.invoke("mark-installment-paid", {
        body: { installmentId, method: "cash", reference: "Marked paid by operator" },
      });
      if (error) throw error;
      toast({ title: "Marked as paid" });
      qc.invalidateQueries({ queryKey: ["installment-plan-full"] });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setBusyId(null); }
  }

  async function handlePauseToggle() {
    setBusyId("pause");
    const newStatus = plan.status === "paused" ? "active" : "paused";
    const { error } = await supabase.from("installment_plans").update({ status: newStatus }).eq("id", plan.id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else toast({ title: newStatus === "paused" ? "Plan paused" : "Plan resumed" });
    qc.invalidateQueries({ queryKey: ["installment-plan-full"] });
    setBusyId(null);
  }

  async function handleCancel() {
    if (!confirm("Cancel this installment plan? Future charges will stop.")) return;
    setBusyId("cancel");
    const { error } = await supabase.from("installment_plans").update({ status: "cancelled" }).eq("id", plan.id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else toast({ title: "Plan cancelled" });
    qc.invalidateQueries({ queryKey: ["installment-plan-full"] });
    setBusyId(null);
  }

  const calendarItems = data.schedule.map(calendarItem);
  const tableRows: ScheduleRow[] = data.schedule.map((s) => ({
    id: s.id,
    installment_number: s.installment_number,
    due_date: s.due_date,
    amount: Number(s.amount),
    invoice_status: s.invoice_status,
    status: s.status,
    paid_at: s.paid_at,
  }));

  const planTypeLabel = plan.unit === "week"
    ? (plan.payments_per_unit === 2 ? "Twice weekly" : "Weekly")
    : (plan.payments_per_unit === 4 ? "Weekly via monthly" : plan.payments_per_unit === 2 ? "Twice monthly" : "Monthly");

  return (
    <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
      <div className="px-6 py-5 border-b border-border/60 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-foreground">Payment Plan</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{planTypeLabel} · {plan.number_of_installments} installments</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={cn("border", plan.collection_mode === "auto"
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30")}>
            {plan.collection_mode === "auto" ? "🟢 AUTO" : "🟡 MANUAL"}
          </Badge>
          {plan.status !== "active" ? (
            <Badge className="bg-muted text-foreground/90 border border-border capitalize">{plan.status}</Badge>
          ) : null}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {summary && summary.overdueTotal > 0 ? (
          <div className="flex items-start gap-3 rounded-md bg-red-500/10 border border-red-500/30 px-4 py-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium text-red-700 dark:text-red-300">
                {fmtCurrency(summary.overdueTotal, currency)} overdue across {summary.overdue.length} missed installment{summary.overdue.length === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                {plan.collection_mode === "auto"
                  ? "Auto-charge will retry on the next cron tick (24h cooldown after last attempt)."
                  : "Manual collection — record payment when the customer settles."}
              </div>
            </div>
          </div>
        ) : null}

        {summary ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Progress</span>
              <span className="text-sm text-muted-foreground">
                {fmtCurrency(summary.totalPaid, currency)} of {fmtCurrency(summary.totalAmount, currency)} · {summary.paidCount}/{plan.number_of_installments} paid
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, Math.round((summary.totalPaid / Math.max(1, summary.totalAmount)) * 100))}%` }}
              />
            </div>
          </div>
        ) : null}

        <InstallmentCalendar
          schedule={calendarItems}
          rentalStart={rentalStart}
          rentalEnd={rentalEnd}
          currencyCode={currency}
        />

        <InstallmentScheduleTable
          rows={tableRows}
          currencyCode={currency}
          collectionMode={plan.collection_mode || "auto"}
          isOperator
          onMarkPaid={handleMarkPaid}
          busyId={busyId}
        />

        <div className="rounded-md border border-border/60 px-4 py-3 flex items-center gap-3">
          <CreditCard className="w-5 h-5 text-muted-foreground" />
          <div className="flex-1 text-sm">
            {plan.stripe_payment_method_id ? (
              <span className="text-foreground/90">Card on file (Stripe payment method <span className="font-mono text-xs text-muted-foreground">{String(plan.stripe_payment_method_id).slice(-8)}</span>)</span>
            ) : (
              <span className="text-muted-foreground">No card on file — manual collection</span>
            )}
          </div>
        </div>

        {events && events.length > 0 ? (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">Activity</div>
            <ul className="space-y-2">
              {events.map((ev) => {
                const tone =
                  ev.status === "success" ? "text-emerald-700 dark:text-emerald-300" :
                  ev.status === "failed"  ? "text-red-700 dark:text-red-300" :
                  ev.status === "warning" ? "text-amber-700 dark:text-amber-300" : "text-foreground/90";
                const Icon =
                  ev.status === "success" ? CheckCircle2 :
                  ev.status === "failed"  ? AlertCircle :
                  ev.status === "warning" ? AlertCircle : Clock;
                return (
                  <li key={ev.id} className="flex items-start gap-2 text-sm">
                    <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", tone)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground">{ev.message || ev.notification_type}</div>
                      <div className="text-xs text-muted-foreground/70">{fmtDateTime(ev.created_at || ev.sent_at)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="border-t border-border/60 pt-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busyId === "reminder"} onClick={handleSendReminder}>
            <Send className="w-3.5 h-3.5 mr-1.5" /> Send reminder
          </Button>
          <Button variant="outline" size="sm" disabled={busyId === "pause"} onClick={handlePauseToggle}>
            <Pause className="w-3.5 h-3.5 mr-1.5" />
            {plan.status === "paused" ? "Resume plan" : "Pause plan"}
          </Button>
          <Button variant="outline" size="sm" disabled={busyId === "cancel"} onClick={handleCancel} className="text-red-700 dark:text-red-300 hover:bg-red-500/10">
            <Ban className="w-3.5 h-3.5 mr-1.5" /> Cancel plan
          </Button>
        </div>
      </div>
    </div>
  );
}

export default InstallmentSection;
