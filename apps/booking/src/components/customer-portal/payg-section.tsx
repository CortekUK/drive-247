"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2, FileText, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format-utils";
import { usePaygInvoices, type PaygInvoiceRow } from "@/hooks/use-payg-invoices";
import { InvoiceDialog } from "@/components/InvoiceDialog";
import { PaygStatementDialog } from "@/components/customer-portal/payg-statement-dialog";

interface PaygSectionProps {
  rentalId: string;
  isPayg: boolean;
  currencyCode: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  vehicle: { reg?: string; make?: string; model?: string };
  rental: {
    start_date?: string | null;
    end_date?: string | null;
    monthly_amount?: number | null;
    rental_number?: string | null;
    payg_closed_at?: string | null;
  };
  onTakePayment?: (args: {
    categories: string[];
    amount: number;
    paygAccrualId: string;
  }) => void;
}

export function PaygSection({
  rentalId,
  isPayg,
  currencyCode,
  customerName,
  customerEmail,
  customerPhone,
  vehicle,
  rental,
  onTakePayment,
}: PaygSectionProps) {
  const { data, isLoading, refetch } = usePaygInvoices(rentalId, isPayg);
  const [invoicePreview, setInvoicePreview] = useState<PaygInvoiceRow | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);

  const displayInvoices = useMemo(
    () => [...data.invoices].reverse(),
    [data.invoices],
  );

  const handlePayLatest = () => {
    const latest = data.latestOpenInvoice;
    if (!latest) return;
    onTakePayment?.({
      categories: ["Rental", "Tax", "Service Fee"],
      amount: latest.cumulativeAmount,
      paygAccrualId: latest.id,
    });
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-medium">Pay-As-You-Go</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
                <div className="flex flex-wrap items-center gap-6 text-sm">
                  <div>
                    <span className="text-muted-foreground">Daily charge: </span>
                    <span className="font-medium">{formatCurrency(data.dailyRate, currencyCode)} / day</span>
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
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => refetch()}
                    title="Refresh"
                    aria-label="Refresh PAYG data"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStatementOpen(true)}
                    disabled={data.invoices.length === 0}
                    title={data.invoices.length === 0 ? "No charges to download yet" : "Download a complete statement of account"}
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Download Statement
                  </Button>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Timeline</div>
                {displayInvoices.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-md">
                    No invoices yet — charges will appear daily once the rental is active.
                  </div>
                ) : (
                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-indigo-50 dark:bg-indigo-950/30">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">#</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Date / time</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Amount</th>
                          <th className="px-3 py-2 text-center text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Pay</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Status</th>
                          <th className="px-3 py-2 text-center text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">Invoice</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayInvoices.map((inv) => {
                          const isLatestOpen = data.latestOpenInvoice?.id === inv.id;
                          const showBreakdown = Math.abs(inv.cumulativeAmount - inv.dayTotal) > 0.001;
                          return (
                            <tr key={inv.id} className="border-t border-border hover:bg-muted/40">
                              <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">#{inv.invoiceRef}</td>
                              <td className="px-3 py-2.5 text-sm">{format(parseISO(inv.createdAt), "dd MMM · HH:mm")}</td>
                              <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                                {formatCurrency(inv.cumulativeAmount, currencyCode)}
                                {showBreakdown && (
                                  <span className="block text-xs text-muted-foreground font-normal">incl. prior</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                {isLatestOpen ? (
                                  <Button size="sm" className="h-7 text-xs" onClick={handlePayLatest}>Pay</Button>
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
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Reminder log</div>
                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date / time</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Invoice</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Channel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.reminders.map((r) => (
                          <tr key={r.id} className="border-t border-border">
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.reminderNumber}</td>
                            <td className="px-3 py-2">{format(parseISO(r.sentAt), "dd MMM · HH:mm")}</td>
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                              {r.invoiceRef ? `#${r.invoiceRef}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-xs capitalize">{r.channel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

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
          customer={{ name: customerName, email: customerEmail }}
          vehicle={{
            reg: vehicle.reg || "",
            make: vehicle.make,
            model: vehicle.model,
          }}
          rental={{
            // PAYG rentals have no end_date (open-ended) and each invoice represents
            // a single day, so pass the invoice's own date for both start and end.
            start_date: invoicePreview.createdAt.split("T")[0],
            end_date: invoicePreview.createdAt.split("T")[0],
            monthly_amount: rental.monthly_amount || 0,
          }}
        />
      )}

      <PaygStatementDialog
        open={statementOpen}
        onOpenChange={setStatementOpen}
        data={data}
        customer={{ name: customerName, email: customerEmail, phone: customerPhone }}
        vehicle={vehicle}
        rental={{
          rentalNumber: rental.rental_number || rentalId.slice(0, 8).toUpperCase(),
          startDate: rental.start_date ?? null,
          endDate: rental.end_date ?? null,
          isClosed: !!rental.payg_closed_at,
        }}
      />
    </>
  );
}

function StatusPill({ inv }: { inv: PaygInvoiceRow }) {
  if (inv.status === "paid") {
    return (
      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
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
