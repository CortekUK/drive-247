"use client";

import { CheckCircle2, Clock, AlertCircle, XCircle, Receipt } from "lucide-react";
import { parseLocalDate } from "@/lib/date-utils";
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
  /** Operator-facing controls (Pay button + Receipt). Customer view passes false. */
  isOperator?: boolean;
  /** Called when the operator clicks Pay on an open row. Opens the parent's
   * AddPaymentDialog with the row's id stamped as `installmentId` so the
   * Stripe-Charge / Email-Stripe-Link / Record-Payment paths all settle the
   * specific scheduled_installments row through `installment_settle_invoice`.
   * Mirrors PAYG's `onPay(accrualId)` contract. */
  onPay?: (id: string) => void;
  onReceipt?: (id: string) => void;
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
    return parseLocalDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return s;
  }
}

// Detailed visual status — mirrors what was on screen before: Paid /
// Overdue Nd / Due today / Scheduled / Superseded with leading icon and
// tone color. The cron evaluates open vs paid; the date-derived "overdue
// Nd" / "due today" labels are presentation-only.
function visualStatus(row: ScheduleRow): {
  label: string; tone: string; Icon: typeof CheckCircle2;
} {
  if (row.invoice_status === "paid") return { label: "Paid", tone: "text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 };
  if (row.invoice_status === "superseded") return { label: "Superseded", tone: "text-muted-foreground/70", Icon: XCircle };
  const today = new Date().toISOString().split("T")[0];
  if (row.due_date < today) {
    const days = Math.floor((Date.now() - parseLocalDate(row.due_date).getTime()) / (1000 * 60 * 60 * 24));
    return { label: `Overdue ${days}d`, tone: "text-red-600 dark:text-red-400", Icon: AlertCircle };
  }
  if (row.due_date === today) return { label: "Due today", tone: "text-indigo-600 dark:text-indigo-400 font-semibold", Icon: Clock };
  return { label: "Scheduled", tone: "text-muted-foreground", Icon: Clock };
}

export function InstallmentScheduleTable({
  rows,
  currencyCode = "USD",
  isOperator = false,
  onPay,
  onReceipt,
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
            return (
              <tr key={r.id} className="border-t border-border/60">
                <td className="px-4 py-3 text-muted-foreground">{r.installment_number}</td>
                <td className="px-4 py-3 text-foreground/90">{fmtDate(r.due_date)}</td>
                <td className="px-4 py-3 text-right font-medium text-foreground">{fmt(r.amount, currencyCode)}</td>
                <td className={cn("px-4 py-3", v.tone)}>
                  <span className="inline-flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5" /> {v.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {/* Action column — Pay for open rows (operator), Receipt
                      once paid. The dialog opened by onPay locks the amount
                      and forwards installmentId to create-checkout-session,
                      so the operator can't accidentally over- or under-
                      charge. Customer view (isOperator=false) shows nothing
                      in this column for open rows; their pay path is the
                      banner button + calendar click → magic-link page. */}
                  {r.invoice_status === "paid" && onReceipt ? (
                    <Button variant="ghost" size="sm" onClick={() => onReceipt(r.id)} className="h-7">
                      <Receipt className="w-3.5 h-3.5 mr-1" /> Receipt
                    </Button>
                  ) : r.invoice_status === "open" && isOperator && onPay ? (
                    (() => {
                      // Only allow Pay on installments that are at or past
                      // their due date. Scheduled (future) rows render the
                      // button in a disabled state with an explanatory
                      // tooltip — collecting an installment early would
                      // either trigger cumulative settlement (paying off
                      // everything up to that date via
                      // installment_settle_invoice's PAYG-style supersession)
                      // or leave the schedule out of order, neither of which
                      // matches operator expectations.
                      const today = new Date().toISOString().split("T")[0];
                      const isPayable = r.due_date <= today;
                      return (
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => isPayable && onPay(r.id)}
                          disabled={!isPayable}
                          title={isPayable ? undefined : "Available on the due date"}
                        >
                          Pay
                        </Button>
                      );
                    })()
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
