"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { InstallmentCalendar, type InstallmentCalendarItem } from "./InstallmentCalendar";
import { InstallmentScheduleTable, type ScheduleRow } from "./InstallmentScheduleTable";
import { useInstallmentPlanRealtime } from "@/hooks/use-installment-plan-realtime";

interface Props {
  rentalId: string;
  rentalStart?: string;
  rentalEnd?: string;
  currencyCode?: string;
}

function fmt(amount: number, code = "USD") {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount); }
  catch { return `${code} ${amount.toFixed(2)}`; }
}

function calendarItem(row: any): InstallmentCalendarItem {
  const today = new Date().toISOString().split("T")[0];
  // Customer never sees "superseded" — show as paid
  if (row.invoice_status === "paid" || row.invoice_status === "superseded") {
    return { number: row.installment_number, date: row.due_date, amount: Number(row.amount), status: "paid" };
  }
  const status: InstallmentCalendarItem["status"] =
    row.due_date < today ? "overdue" :
    row.due_date === today ? "due_today" : "scheduled";
  return { number: row.installment_number, date: row.due_date, amount: Number(row.amount), status };
}

export function CustomerInstallmentsView({ rentalId, rentalStart, rentalEnd, currencyCode = "USD" }: Props) {
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["customer-installment-plan", rentalId],
    enabled: !!rentalId,
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

  useInstallmentPlanRealtime(data?.plan?.id);

  const summary = useMemo(() => {
    if (!data) return null;
    const today = new Date().toISOString().split("T")[0];
    const open = data.schedule.filter((s) => s.invoice_status === "open");
    const paid = data.schedule.filter((s) => s.invoice_status === "paid");
    const overdue = open.filter((s) => s.due_date <= today);
    const overdueTotal = overdue.reduce((s, r) => s + Number(r.amount), 0);
    const totalPaid = paid.reduce((s, r) => s + Number(r.amount), 0);
    const totalAmount = data.schedule.reduce((s, r) => s + Number(r.amount), 0);
    return { overdueTotal, overdueCount: overdue.length, totalPaid, totalAmount };
  }, [data]);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!data || !data.plan) return null;

  async function handlePayNow() {
    if (!data?.plan) return;
    setBusy(true);
    try {
      // Generate a magic-link token via direct insert (we own the customer-portal session)
      const token = crypto.randomUUID().replace(/-/g, "");
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const { error: linkErr } = await supabase.from("installment_payment_links").insert({
        token,
        installment_plan_id: data.plan.id,
        tenant_id: data.plan.tenant_id,
        expires_at: expiresAt,
      });
      if (linkErr) throw linkErr;
      window.location.href = `/pay/${token}`;
    } catch (e: any) {
      toast.error("Couldn't open payment", { description: e?.message });
      setBusy(false);
    }
  }

  const calendarItems = data.schedule.map(calendarItem);
  const tableRows: ScheduleRow[] = data.schedule.map((s) => ({
    id: s.id,
    installment_number: s.installment_number,
    due_date: s.due_date,
    amount: Number(s.amount),
    invoice_status: s.invoice_status === "superseded" ? "paid" : s.invoice_status,
    status: s.status,
    paid_at: s.paid_at,
  }));

  const planType = data.plan.unit === "week"
    ? (data.plan.payments_per_unit === 2 ? "Twice weekly" : "Weekly")
    : (data.plan.payments_per_unit === 4 ? "Weekly via monthly" : data.plan.payments_per_unit === 2 ? "Twice monthly" : "Monthly");

  return (
    <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
      <div className="px-6 py-5 border-b border-border/60">
        <h2 className="text-lg font-medium text-foreground">Your Payment Plan</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{planType} · {data.plan.number_of_installments} payments of {fmt(Number(data.plan.installment_amount), currencyCode)}</p>
      </div>

      <div className="p-6 space-y-6">
        {summary && summary.overdueTotal > 0 ? (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-red-700 dark:text-red-300">{fmt(summary.overdueTotal, currencyCode)} due now</div>
                <div className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                  You have {summary.overdueCount} unpaid installment{summary.overdueCount === 1 ? "" : "s"}. Pay today to keep your rental active.
                </div>
              </div>
            </div>
            <Button onClick={handlePayNow} disabled={busy} size="lg" className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Pay {fmt(summary.overdueTotal, currencyCode)} now
            </Button>
          </div>
        ) : null}

        {summary ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Progress</span>
              <span className="text-sm text-muted-foreground">{fmt(summary.totalPaid, currencyCode)} of {fmt(summary.totalAmount, currencyCode)} paid</span>
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
          currencyCode={currencyCode}
        />

        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">Payments</h3>
          <InstallmentScheduleTable rows={tableRows} currencyCode={currencyCode} collectionMode={data.plan.collection_mode || "auto"} />
        </div>

        {data.plan.stripe_payment_method_id ? (
          <div className="rounded-md border border-border/60 px-4 py-3 flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-muted-foreground" />
            <div className="flex-1 text-sm text-foreground/90">
              Card on file (•••• <span className="font-mono">{String(data.plan.stripe_payment_method_id).slice(-4)}</span>)
            </div>
          </div>
        ) : null}

        <div className="text-xs text-muted-foreground pt-2 border-t border-border/60">
          Need help? Contact your rental operator.
        </div>
      </div>
    </div>
  );
}

export default CustomerInstallmentsView;
