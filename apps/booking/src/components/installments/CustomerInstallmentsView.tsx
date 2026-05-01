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

// Mirrors the helper in apps/portal/.../InstallmentSection.tsx so the customer
// calendar shows the same day-zero amount as the operator-side calendar and as
// the new-rental form preview at booking time. scheduled_installments rows
// only carry the rental-installment portion of each payment; on day zero the
// customer also pays deposit + service fee + (optionally) tax, all bundled
// into installment_plans.upfront_amount. Without this, the day-zero tile would
// understate what's actually owed today.
function buildCalendarItems(
  schedule: any[],
  plan: any,
  rentalStart?: string,
): InstallmentCalendarItem[] {
  const today = new Date().toISOString().split("T")[0];
  const chargeFirst = plan?.config?.charge_first_upfront !== false;
  const upfrontAmount = Number(plan?.upfront_amount || 0);
  const upfrontPaid = plan?.upfront_paid === true;

  const items = schedule.map((row) => {
    const item = calendarItem(row);
    if (chargeFirst && row.installment_number === 1 && upfrontAmount > 0) {
      return { ...item, amount: upfrontAmount };
    }
    return item;
  });

  if (!chargeFirst && upfrontAmount > 0 && rentalStart) {
    const status: InstallmentCalendarItem["status"] = upfrontPaid
      ? "paid"
      : rentalStart < today
        ? "overdue"
        : rentalStart === today
          ? "due_today"
          : "scheduled";
    items.unshift({
      number: 0,
      date: rentalStart,
      amount: upfrontAmount,
      status,
    });
  }

  return items;
}

export function CustomerInstallmentsView({ rentalId, rentalStart, rentalEnd, currencyCode = "USD" }: Props) {
  const [busy, setBusy] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

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

    // Day-zero override: slot 1 on a charge-first plan is presented as the
    // cumulative upfront amount (deposit + fees + 1st installment) on both
    // the calendar and the table — fold that into the overdue/paid totals so
    // the "due now" banner, the Pay-Now button, and the progress bar all
    // agree on one number.
    const planAny = data.plan as any;
    const chargeFirst = planAny?.config?.charge_first_upfront !== false;
    const upfrontAmount = Number(planAny?.upfront_amount || 0);
    const displayAmount = (row: any) =>
      (chargeFirst && row.installment_number === 1 && upfrontAmount > 0)
        ? upfrontAmount
        : Number(row.amount);

    const overdueTotal = overdue.reduce((s, r) => s + displayAmount(r), 0);
    const totalPaid = paid.reduce((s, r) => s + displayAmount(r), 0);
    const totalAmount = data.schedule.reduce((s, r) => s + displayAmount(r), 0);
    return { overdueTotal, overdueCount: overdue.length, totalPaid, totalAmount };
  }, [data]);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!data || !data.plan) return null;

  // Direct Stripe Checkout — same flow as PAYG's customer-side Pay and as
  // the operator's "Charge via Stripe". No magic-link middleware: we mint a
  // Checkout Session here and redirect straight to Stripe. The webhook calls
  // installment_settle_invoice on completion via the installment_id metadata.
  async function startStripeCheckout(args: { installmentId: string; amount: number }) {
    if (!data?.plan) return;
    try {
      const { data: session, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId,
          totalAmount: args.amount,
          tenantId: data.plan.tenant_id,
          source: 'booking',
          targetCategories: ['Rental', 'Tax', 'Service Fee'],
          installmentId: args.installmentId,
          successUrl: `${window.location.origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rentalId}&type=invoice`,
          cancelUrl: `${window.location.origin}/portal/bookings/${rentalId}`,
        },
      });
      if (error) throw error;
      if (!session?.url) throw new Error('No checkout URL returned');
      window.location.href = session.url;
    } catch (e: any) {
      toast.error("Couldn't open payment", { description: e?.message });
      throw e;
    }
  }

  async function handlePayNow() {
    if (!data?.plan || !data?.schedule) return;
    const today = new Date().toISOString().split("T")[0];
    const overdue = data.schedule
      .filter((s) => s.invoice_status === "open" && s.due_date <= today)
      .sort((a, b) => a.installment_number - b.installment_number);
    const latest = overdue[overdue.length - 1];
    if (!latest) return;
    const cumulative = overdue.reduce((s, r) => s + Number(r.amount || 0), 0);
    setBusy(true);
    try {
      // Cumulative settle: pay the total of all overdue rows, stamp the
      // latest one as installment_id so the webhook supersedes earlier slots.
      await startStripeCheckout({ installmentId: latest.id, amount: cumulative });
    } catch {
      setBusy(false);
    }
  }

  async function handlePayInstallment(id: string, amount: number) {
    setBusyRowId(id);
    try {
      await startStripeCheckout({ installmentId: id, amount });
    } catch {
      setBusyRowId(null);
    }
  }

  const calendarItems = buildCalendarItems(data.schedule, data.plan, rentalStart);
  // Same day-zero override as the calendar so customer's table and calendar
  // tell the same story about what was/is owed today. plan.config is typed
  // as Json so we cast through any to read the discriminator.
  const planConfig = (data.plan as any)?.config;
  const chargeFirstUpfront = planConfig?.charge_first_upfront !== false;
  const planUpfrontAmount = Number((data.plan as any)?.upfront_amount || 0);
  const tableRows: ScheduleRow[] = data.schedule.map((s) => {
    const useUpfrontDisplay = chargeFirstUpfront && s.installment_number === 1 && planUpfrontAmount > 0;
    return {
      id: s.id,
      installment_number: s.installment_number,
      due_date: s.due_date,
      amount: useUpfrontDisplay ? planUpfrontAmount : Number(s.amount),
      invoice_status: s.invoice_status === "superseded" ? "paid" : s.invoice_status,
      status: s.status,
      paid_at: s.paid_at,
    };
  });

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
          // Customer-side: clicking any actionable tile creates a Stripe
          // Checkout Session for that specific installment and redirects.
          // Mirrors the per-row Pay button — no magic-link middleware.
          // Synthetic day-zero tiles (number=0) have no scheduled_installments
          // row to settle, so they're skipped.
          onItemClick={(item) => {
            if (item.number === 0) return;
            const row = data?.schedule.find((s) => s.installment_number === item.number);
            if (row && row.invoice_status === "open") {
              const today = new Date().toISOString().split("T")[0];
              if (row.due_date <= today) {
                handlePayInstallment(row.id, Number(row.amount));
              }
            }
          }}
        />

        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">Payments</h3>
          <InstallmentScheduleTable
            rows={tableRows}
            currencyCode={currencyCode}
            collectionMode={data.plan.collection_mode || "auto"}
            onPay={handlePayInstallment}
            busyId={busyRowId}
          />
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
