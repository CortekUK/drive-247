"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format-utils";
import { usePaygInvoices, type PaygInvoiceRow } from "@/hooks/use-payg-invoices";
import { InvoiceDialog } from "@/components/InvoiceDialog";

interface PaygDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  isPayg: boolean;
  currencyCode: string;
  customerName: string;
  customerEmail?: string;
  vehicle: { reg?: string; make?: string; model?: string };
  rental: {
    start_date?: string | null;
    end_date?: string | null;
    monthly_amount?: number | null;
  };
  onTakePayment?: (args: {
    categories: string[];
    amount: number;
    paygAccrualId: string;
  }) => void;
}

export function PaygDetailsDialog({
  open,
  onOpenChange,
  rentalId,
  isPayg,
  currencyCode,
  customerName,
  customerEmail,
  vehicle,
  rental,
  onTakePayment,
}: PaygDetailsDialogProps) {
  const { data, isLoading } = usePaygInvoices(rentalId, open && isPayg);
  const [invoicePreview, setInvoicePreview] = useState<PaygInvoiceRow | null>(null);

  const displayInvoices = useMemo(
    () => [...data.invoices].reverse(),
    [data.invoices],
  );

  const handlePayLatest = () => {
    const latest = data.latestOpenInvoice;
    if (!latest) return;
    onOpenChange(false);
    onTakePayment?.({
      categories: ["Rental", "Tax", "Service Fee"],
      amount: latest.cumulativeAmount,
      paygAccrualId: latest.id,
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pay-As-You-Go Details</DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Collected"
                  value={formatCurrency(data.totals.collected, currencyCode)}
                  valueClassName="text-emerald-600 dark:text-emerald-400"
                />
                <StatCard
                  label="Balance Due"
                  value={formatCurrency(data.totals.balanceDue, currencyCode)}
                  valueClassName={
                    data.totals.balanceDue > 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
                  }
                />
                <StatCard
                  label="Refunded"
                  value={formatCurrency(data.totals.refunded, currencyCode)}
                  sub={data.totals.refunded > 0 ? undefined : "No refunds"}
                />
                <StatCard
                  label="Net Received"
                  value={formatCurrency(data.totals.netReceived, currencyCode)}
                  valueClassName="text-indigo-600 dark:text-indigo-400"
                />
              </div>

              <div className="flex flex-wrap items-center gap-6 pb-3 border-b border-border text-sm">
                <div>
                  <span className="text-muted-foreground">Daily charge: </span>
                  <span className="font-medium">
                    {formatCurrency(data.dailyRate, currencyCode)} / day
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Last updated: </span>
                  <span className="font-medium">
                    {data.lastUpdatedAt
                      ? format(parseISO(data.lastUpdatedAt), "dd MMM yyyy, HH:mm")
                      : "—"}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Timeline
                </div>
                {displayInvoices.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-md">
                    No invoices yet — charges will appear daily once the rental is active.
                  </div>
                ) : (
                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-indigo-50 dark:bg-indigo-950/30">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                            #
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                            Date / time
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                            Amount
                          </th>
                          <th className="px-3 py-2 text-center text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                            Pay
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-3 py-2 text-center text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                            Invoice
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayInvoices.map((inv) => {
                          const isLatestOpen = data.latestOpenInvoice?.id === inv.id;
                          const showBreakdown =
                            Math.abs(inv.cumulativeAmount - inv.dayTotal) > 0.001;
                          return (
                            <tr
                              key={inv.id}
                              className="border-t border-border hover:bg-muted/40"
                            >
                              <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                                #{inv.invoiceRef}
                              </td>
                              <td className="px-3 py-2.5 text-sm">
                                {format(parseISO(inv.createdAt), "dd MMM · HH:mm")}
                              </td>
                              <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                                {formatCurrency(inv.cumulativeAmount, currencyCode)}
                                {showBreakdown && (
                                  <span className="block text-xs text-muted-foreground font-normal">
                                    incl. prior
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                {isLatestOpen ? (
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={handlePayLatest}
                                  >
                                    Pay
                                  </Button>
                                ) : (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                <StatusPill inv={inv} />
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <button
                                  onClick={() => setInvoicePreview(inv)}
                                  className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                  aria-label="Open invoice"
                                >
                                  <FileText className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {data.reminders.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Reminder log
                  </div>
                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            #
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Date / time
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Invoice
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Channel
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.reminders.map((r) => (
                          <tr key={r.id} className="border-t border-border">
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                              {r.reminderNumber}
                            </td>
                            <td className="px-3 py-2">
                              {format(parseISO(r.sentAt), "dd MMM · HH:mm")}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                              {r.invoiceRef ? `#${r.invoiceRef}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-xs capitalize">
                              {r.channel}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {invoicePreview && (
        <InvoiceDialog
          open={!!invoicePreview}
          onOpenChange={(o) => !o && setInvoicePreview(null)}
          invoice={{
            invoice_number: invoicePreview.invoiceRef,
            invoice_date: invoicePreview.createdAt.split("T")[0],
            subtotal: invoicePreview.cumulativeAmount,
            tax_amount: 0,
            total_amount: invoicePreview.cumulativeAmount,
          }}
          customer={{
            name: customerName,
            email: customerEmail,
          }}
          vehicle={{
            reg: vehicle.reg || "",
            make: vehicle.make,
            model: vehicle.model,
          }}
          rental={{
            start_date: rental.start_date || "",
            end_date: rental.end_date || "",
            monthly_amount: rental.monthly_amount || 0,
          }}
        />
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground font-medium mb-1">{label}</div>
        <div className={`text-2xl font-bold ${valueClassName || ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function StatusPill({ inv }: { inv: PaygInvoiceRow }) {
  if (inv.status === "paid") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
      >
        Paid
      </Badge>
    );
  }
  if (inv.status === "superseded") {
    return (
      <span className="text-xs text-muted-foreground">
        Superseded by <span className="font-mono">#{inv.supersededBy}</span>
      </span>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
      Not paid
    </Badge>
  );
}
