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
  if (row.invoice_status === "paid") return { label: "Paid", tone: "text-emerald-600", Icon: CheckCircle2 };
  if (row.invoice_status === "superseded") return { label: "Superseded", tone: "text-slate-400", Icon: XCircle };
  const today = new Date().toISOString().split("T")[0];
  if (row.due_date < today) {
    const days = Math.floor((Date.now() - new Date(row.due_date).getTime()) / (1000*60*60*24));
    return { label: `Overdue ${days}d`, tone: "text-red-600", Icon: AlertCircle };
  }
  if (row.due_date === today) return { label: "Due today", tone: "text-indigo-600 font-semibold", Icon: Clock };
  return { label: "Scheduled", tone: "text-slate-600", Icon: Clock };
}

export function InstallmentScheduleTable({
  rows, currencyCode = "USD", collectionMode = "auto",
  isOperator = false, onCharge, onMarkPaid, onReceipt, busyId,
}: Props) {
  return (
    <div className="bg-white border border-slate-100 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-indigo-50/60">
          <tr>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-indigo-900 uppercase tracking-wide w-12">#</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-indigo-900 uppercase tracking-wide">Date</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-indigo-900 uppercase tracking-wide">Amount</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-indigo-900 uppercase tracking-wide">Status</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-indigo-900 uppercase tracking-wide">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = visualStatus(r);
            const Icon = v.Icon;
            const isBusy = busyId === r.id;
            return (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-600">{r.installment_number}</td>
                <td className="px-4 py-3 text-slate-700">{fmtDate(r.due_date)}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-900">{fmt(r.amount, currencyCode)}</td>
                <td className={cn("px-4 py-3 inline-flex items-center gap-1.5", v.tone)}>
                  <Icon className="w-3.5 h-3.5" /> {v.label}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.invoice_status === "paid" && onReceipt ? (
                    <Button variant="ghost" size="sm" onClick={() => onReceipt(r.id)} className="h-7">
                      <Receipt className="w-3.5 h-3.5 mr-1" /> Receipt
                    </Button>
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
