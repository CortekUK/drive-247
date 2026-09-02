"use client";

import { CheckCircle2, Clock, AlertCircle, XCircle, Receipt, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ScheduleRow {
  id: string;
  installment_number: number;
  due_date: string;
  amount: number;
  invoice_status: "open" | "paid" | "superseded";
  status?: string | null;
  paid_at?: string | null;
}

interface Props {
  rows: ScheduleRow[];
  currencyCode?: string;
  collectionMode?: "auto" | "manual";
  isOperator?: boolean;
  onCharge?: (id: string) => void;
  onMarkPaid?: (id: string) => void;
  onReceipt?: (id: string) => void;
  /** Customer-side per-row Pay button. Same contract as PAYG's onTakePayment:
   * gets the installment id + display amount, parent kicks off Stripe Checkout
   * directly (no dialog, no magic-link middleware). When provided, shows a
   * Pay button on every open row that's overdue/due-today. Future-dated open
   * rows render disabled with a tooltip — same rule the operator side uses. */
  onPay?: (id: string, amount: number) => void;
  busyId?: string | null;
}

function fmt(amount: number, code = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

function fmtDate(s: string) {
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return s;
  }
}

function visualStatus(row: ScheduleRow): {
  label: string; tone: string; Icon: typeof CheckCircle2;
} {
  if (row.invoice_status === "paid") return { label: "Paid", tone: "text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 };
  if (row.invoice_status === "superseded") return { label: "Superseded", tone: "text-muted-foreground/70", Icon: XCircle };
  const today = new Date().toISOString().split("T")[0];
  if (row.due_date < today) {
    const days = Math.floor((Date.now() - new Date(row.due_date).getTime()) / (1000*60*60*24));
    return { label: `Overdue ${days}d`, tone: "text-red-600 dark:text-red-400", Icon: AlertCircle };
  }
  if (row.due_date === today) return { label: "Due today", tone: "text-indigo-600 dark:text-indigo-400 font-semibold", Icon: Clock };
  return { label: "Scheduled", tone: "text-muted-foreground", Icon: Clock };
}

export function InstallmentScheduleTable({
  rows, currencyCode = "USD", collectionMode = "auto",
  isOperator = false, onCharge, onMarkPaid, onReceipt, onPay, busyId,
}: Props) {
  return (
    <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-primary/10">
          <tr>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-foreground uppercase tracking-wide w-12">#</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-foreground uppercase tracking-wide">Date</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-foreground uppercase tracking-wide">Amount</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-foreground uppercase tracking-wide">Status</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-foreground uppercase tracking-wide">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = visualStatus(r);
            const Icon = v.Icon;
            const isBusy = busyId === r.id;
            return (
              <tr key={r.id} className="border-t border-border/60">
                <td className="px-4 py-3 text-muted-foreground">{r.installment_number}</td>
                <td className="px-4 py-3 text-foreground/90">{fmtDate(r.due_date)}</td>
                <td className="px-4 py-3 text-right font-medium text-foreground">{fmt(r.amount, currencyCode)}</td>
                <td className={cn("px-4 py-3 inline-flex items-center gap-1.5", v.tone)}>
                  <Icon className="w-3.5 h-3.5" /> {v.label}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.invoice_status === "paid" && onReceipt ? (
                    <Button variant="ghost" size="sm" onClick={() => onReceipt(r.id)} className="h-7">
                      <Receipt className="w-3.5 h-3.5 mr-1" /> Receipt
                    </Button>
                  ) : r.invoice_status === "open" && onPay ? (
                    // Customer-side Pay button (and operator side too if onPay
                    // is wired). Mirrors PAYG: no dialog, click goes straight
                    // to Stripe via the parent's onPay handler. Disabled until
                    // the slot is at or past its due date — prevents early
                    // cumulative settlement.
                    (() => {
                      const today = new Date().toISOString().split("T")[0];
                      const isPayable = r.due_date <= today;
                      return (
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!isPayable || isBusy}
                          onClick={() => isPayable && onPay(r.id, r.amount)}
                          title={isPayable ? undefined : "Available on the due date"}
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Pay"}
                        </Button>
                      );
                    })()
                  ) : r.invoice_status === "open" && isOperator ? (
                    <div className="inline-flex gap-1">
                      {collectionMode === "auto" && onCharge ? (
                        <Button variant="outline" size="sm" disabled={isBusy} onClick={() => onCharge(r.id)} className="h-7">
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Charge now"}
                        </Button>
                      ) : null}
                      {onMarkPaid ? (
                        <Button variant="outline" size="sm" disabled={isBusy} onClick={() => onMarkPaid(r.id)} className="h-7">
                          Mark paid
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default InstallmentScheduleTable;
