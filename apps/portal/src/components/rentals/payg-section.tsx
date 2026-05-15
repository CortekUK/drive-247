"use client";

import { useMemo, useState } from "react";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { BellOff, BellRing, Download, Loader2, PauseCircle, RotateCcw, RefreshCw, FileText, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/format-utils";
import {
  usePaygInvoices,
  type PaygInvoiceRow,
  type PaygReminderStatus,
} from "@/hooks/use-payg-invoices";
import { InvoiceDialog } from "@/components/shared/dialogs/invoice-dialog";
import { PaygStatementDialog } from "@/components/rentals/payg-statement-dialog";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";

interface PaygSectionProps {
  rentalId: string;
  isPayg: boolean;
  currencyCode: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  /** Required for the admin Record-Payment dialog so the payment is correctly attributed. */
  customerId?: string;
  vehicleId?: string;
  vehicle: { reg?: string; make?: string; model?: string };
  rental: {
    start_date?: string | null;
    end_date?: string | null;
    monthly_amount?: number | null;
    rental_number?: string | null;
    payg_closed_at?: string | null;
  };
  /** Admin-only actions. Hide in customer portal. */
  showAdminActions?: boolean;
  /**
   * Customer flow: clicking Pay opens Stripe Checkout. Admin flow ignores this
   * and uses the in-section Record-Payment dialog instead (see showAdminActions).
   */
  onTakePayment?: (args: {
    categories: string[];
    amount: number;
    paygAccrualId: string;
  }) => void;
  onRefund?: () => void;
  onRefresh?: () => void;
}

/**
 * Inline PAYG rolling-invoice view. Renders as a Card (no dialog wrapper) so
 * it can live directly on the rental page above the Payment Breakdown.
 */
export function PaygSection({
  rentalId,
  isPayg,
  currencyCode,
  customerName,
  customerEmail,
  customerPhone,
  customerId,
  vehicleId,
  vehicle,
  rental,
  showAdminActions = false,
  onTakePayment,
  onRefund,
  onRefresh,
}: PaygSectionProps) {
  const { toast } = useToast();
  const { data, isLoading, refetch } = usePaygInvoices(rentalId, isPayg);
  const [remindLoading, setRemindLoading] = useState(false);
  const [autoTogglePending, setAutoTogglePending] = useState(false);

  // Per-rental auto-reminders toggle. Flipping this writes to
  // rentals.payg_auto_reminders_enabled — the send-payg-reminders cron
  // skips rentals where it's false. The manual "Send reminder" button
  // below ignores the flag, so operators always have the escape hatch.
  const handleToggleAutoReminders = async (nextValue: boolean) => {
    if (autoTogglePending) return;
    setAutoTogglePending(true);
    try {
      const { error } = await (supabase as any)
        .from("rentals")
        .update({ payg_auto_reminders_enabled: nextValue })
        .eq("id", rentalId);
      if (error) throw error;
      toast({
        title: nextValue ? "Auto-reminders enabled" : "Auto-reminders disabled",
        description: nextValue
          ? "The reminder cron will resume firing on this rental's schedule."
          : "The cron will skip this rental. Use Send reminder to nudge manually.",
      });
      await refetch();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Failed to update auto-reminders setting",
        variant: "destructive",
      });
    } finally {
      setAutoTogglePending(false);
    }
  };
  const [invoicePreview, setInvoicePreview] = useState<PaygInvoiceRow | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  // Admin "Record Payment" dialog target — set when an admin clicks Pay on a PAYG row.
  // Holds the locked amount AND the accrual id so the dialog can:
  //   - pre-fill amount via defaultAmount (auto-locks the input)
  //   - forward accrualId to create-checkout-session for the Charge-via-Stripe /
  //     Email-Stripe-Link paths, so the Stripe webhook can settle this exact invoice.
  const [recordPaymentTarget, setRecordPaymentTarget] = useState<{ amount: number; paygAccrualId: string } | null>(null);

  const displayInvoices = useMemo(
    () => [...data.invoices].reverse(),
    [data.invoices],
  );

  const sendManualReminder = async () => {
    setRemindLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke(
        "send-payg-manual-reminder",
        { body: { rental_id: rentalId } },
      );
      // Network / function-crash level error
      if (error) throw error;

      // Function ran but reported a client error (no open invoice, no email, etc.)
      if (res && res.success === false && !res.logged) {
        throw new Error(res.error || "Reminder failed");
      }

      // Function logged the attempt; differentiate "sent" vs "logged-but-email-failed"
      if (res?.email_sent) {
        toast({
          title: "Reminder sent",
          description: `Invoice ${res.invoice} · ${formatCurrency(res.outstanding, currencyCode)} outstanding · sent to ${res.recipient}`,
        });
      } else {
        toast({
          title: "Reminder logged, email failed",
          description:
            (res?.error ? `${res.error}. ` : "") +
            "The attempt is recorded in the reminder log; email delivery failed downstream (check AWS SES).",
          variant: "destructive",
        });
      }

      await refetch();
      onRefresh?.();
    } catch (err: any) {
      toast({
        title: "Reminder failed",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRemindLoading(false);
    }
  };

  const handlePayLatest = () => {
    const latest = data.latestOpenInvoice;
    if (!latest) return;
    // Round defensively: cumulativeAmount can carry FP noise (e.g. 59785.4999...).
    const amount = Math.round(latest.cumulativeAmount * 100) / 100;

    // Admin path: open the Record-Payment dialog with the amount locked.
    // Pass the accrual id so the dialog's Charge-via-Stripe / Email-Stripe-Link
    // paths can stamp it on the Checkout session metadata. The Stripe webhook
    // then settles THIS invoice (not just FIFO-applies the payment) so the
    // invoice flips to Paid the moment the customer completes checkout.
    if (showAdminActions) {
      setRecordPaymentTarget({ amount, paygAccrualId: latest.id });
      return;
    }

    // Customer path: kick off Stripe Checkout via the parent-supplied callback.
    onTakePayment?.({
      categories: ["Rental", "Tax", "Service Fee"],
      amount,
      paygAccrualId: latest.id,
    });
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-medium">
            Pay-As-You-Go
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-border">
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-6 text-sm">
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
                  <ReminderStatusLine status={data.reminderStatus} />
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => refetch()}
                    title="Refresh — pulls newly accrued invoices and any payment status changes"
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

                  {showAdminActions && (
                    <>
                      {/* Per-rental auto-reminders toggle. Defaults to ON for new
                          rentals; operator flips it OFF for trusted customers who
                          pay on time and don't want automated nags. The cron
                          (send-payg-reminders) reads this flag; the manual
                          "Send reminder" button below ignores it on purpose. */}
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1.5 h-9 px-2 rounded-md border bg-background">
                              {data.reminderStatus.rentalAutoEnabled ? (
                                <BellRing className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              <Label
                                htmlFor={`auto-reminders-${rentalId}`}
                                className="text-xs font-medium select-none cursor-pointer"
                              >
                                Auto-reminders
                              </Label>
                              <Switch
                                id={`auto-reminders-${rentalId}`}
                                checked={data.reminderStatus.rentalAutoEnabled}
                                disabled={autoTogglePending}
                                onCheckedChange={handleToggleAutoReminders}
                                aria-label="Toggle automatic PAYG reminders for this rental"
                              />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-relaxed">
                            {data.reminderStatus.rentalAutoEnabled
                              ? "ON — the cron will send PAYG reminders on the normal cadence while a balance is outstanding. Flip off for trusted customers who don't want automated nags."
                              : "OFF — the cron will skip this rental. You can still send a payment link manually with the Send reminder button on the right."}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={sendManualReminder}
                        disabled={remindLoading || !data.latestOpenInvoice}
                      >
                        {remindLoading ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <BellRing className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Send reminder
                      </Button>
                      {onRefund && data.totals.collected > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={onRefund}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          Refund
                        </Button>
                      )}
                    </>
                  )}
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
                          const showBreakdown =
                            Math.abs(inv.cumulativeAmount - inv.dayTotal) > 0.001;
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

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Reminder log
                </div>
                {data.reminders.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-md">
                    No reminders sent yet.
                  </div>
                ) : (
                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date / time</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Invoice</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Channel</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Result</th>
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
                            <td className="px-3 py-2 text-xs">
                              {r.success ? (
                                <span className="text-emerald-600 dark:text-emerald-400">Sent</span>
                              ) : (
                                <span className="text-red-600 dark:text-red-400">Failed</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
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
            make: vehicle.make || "",
            model: vehicle.model || "",
          }}
          rental={{
            // PAYG rentals have no end_date (open-ended) and each invoice represents
            // a single day, so pass the invoice's own date for both start and end.
            start_date: invoicePreview.createdAt.split("T")[0],
            end_date: invoicePreview.createdAt.split("T")[0],
            monthly_amount: rental.monthly_amount || 0,
          }}
          currencyCode={currencyCode}
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

      {/* Admin-only Record-Payment dialog. Opened from the Pay button on a PAYG row.
          Amount field is auto-locked because defaultAmount is supplied (existing behavior). */}
      {showAdminActions && recordPaymentTarget && (
        <AddPaymentDialog
          open={!!recordPaymentTarget}
          onOpenChange={(o) => !o && setRecordPaymentTarget(null)}
          rental_id={rentalId}
          customer_id={customerId}
          vehicle_id={vehicleId}
          defaultAmount={recordPaymentTarget.amount}
          targetCategories={["Rental", "Tax", "Service Fee"]}
          paygAccrualId={recordPaymentTarget.paygAccrualId}
          onPaymentSuccess={async (kind) => {
            // ONLY settle when the dialog actually committed a payment (manual Record
            // Payment). For 'pending' (Charge-via-Stripe / Email-Stripe-Link) the
            // Stripe webhook will commit + settle when the customer pays — flipping
            // anything to 'paid' here would be a false positive.
            if (kind === 'recorded') {
              try {
                const latestOpen = data.latestOpenInvoice;
                if (latestOpen) {
                  // Look up the most recent payment for this rental — the one we just
                  // created. Race-window < 1s so created_at DESC LIMIT 1 picks ours.
                  const { data: latestPayment } = await supabase
                    .from("payments")
                    .select("id")
                    .eq("rental_id", rentalId)
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  if (latestPayment?.id) {
                    // RPC name not yet in the generated types — cast to bypass.
                    const { error: rpcErr } = await (supabase as any).rpc("payg_settle_invoice", {
                      p_payment_id: latestPayment.id,
                      p_accrual_id: latestOpen.id,
                    });
                    if (rpcErr) {
                      console.error("payg_settle_invoice failed:", rpcErr.message);
                      toast({
                        title: "Payment recorded",
                        description: "Payment saved, but invoice status could not be updated automatically. Refresh in a moment.",
                      });
                    }
                  }
                }
              } catch (err: any) {
                console.error("Settlement post-process failed:", err?.message ?? err);
                // Non-fatal — payment itself succeeded.
              }
            }
            // For 'pending', settlement is the Stripe webhook's job — we just close
            // the dialog and let the 5s polling pick up the eventual status flip.

            // Always refetch + invalidate parent queries so the UI shows the most
            // up-to-date state regardless of which path was taken.
            await refetch();
            onRefresh?.();
            setRecordPaymentTarget(null);
          }}
        />
      )}
    </>
  );
}

function ReminderStatusLine({ status }: { status: PaygReminderStatus }) {
  const cadenceText = (() => {
    const n = status.intervalDays;
    const suffix = status.isCustomInterval ? " (custom)" : "";
    return `every ${n} day${n === 1 ? "" : "s"}${suffix}`;
  })();

  // Off at the tenant level — gray bell
  if (!status.autoEnabled) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellOff className="h-3.5 w-3.5" />
        <span>
          Automated reminders are <span className="font-medium">off</span>
          {" · "}
          <span>Use Send reminder to nudge manually</span>
        </span>
      </div>
    );
  }

  // Off at the rental level — operator flipped the per-rental toggle
  // for a trusted customer who pays on time and doesn't want auto-nags.
  // Manual "Send reminder" still works (it ignores all flags).
  if (status.blockReason === "rental_reminders_disabled") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellOff className="h-3.5 w-3.5" />
        <span>
          Automated reminders <span className="font-medium">off for this rental</span>
          {" · "}
          <span>Use Send reminder to nudge manually</span>
        </span>
      </div>
    );
  }

  // Rental is closed — reminders permanently stopped. Different copy + icon
  // from "paused" because the operator can't un-close a rental like they can
  // un-pause one.
  if (status.blockReason === "rental_closed") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellOff className="h-3.5 w-3.5" />
        <span>
          Automated reminders <span className="font-medium">stopped</span> — rental is closed
        </span>
      </div>
    );
  }

  // Operator manually paused billing on this rental — actual paused state.
  if (status.blockReason === "rental_paused") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
        <PauseCircle className="h-3.5 w-3.5" />
        <span>
          Automated reminders <span className="font-medium">paused</span> — billing is paused for this rental
        </span>
      </div>
    );
  }

  // Rental is still Pending (not yet signed/activated). Reminders ARE on —
  // they're just waiting for the rental to become Active before firing. This
  // used to render as "paused" with a struck-through bell, which made it look
  // disabled when actually it's just deferred. Show the "on" green bell + a
  // scheduling clock to make it clear nothing is broken.
  if (status.blockReason === "rental_inactive") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellRing className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        <span>
          Automated reminders <span className="font-medium text-foreground">on</span> ·{" "}
          <Clock className="inline-block h-3 w-3 -mt-0.5 mr-0.5" />
          Will fire {cadenceText} once the rental is active
        </span>
      </div>
    );
  }

  // Auto on, no invoice has accrued yet — green bell, "on · idle" copy
  if (status.blockReason === "no_open_invoice") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellRing className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        <span>
          Automated reminders <span className="font-medium text-foreground">on</span>
          {" · "}
          No unpaid invoice yet — reminders will fire {cadenceText} once charges accrue
        </span>
      </div>
    );
  }

  // Auto on and unblocked, but no anchor yet (rental just activated, no last_sent / no start_ts)
  if (!status.nextReminderAt) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellRing className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        <span>
          Automated reminders <span className="font-medium text-foreground">on</span> · cadence: {cadenceText}
        </span>
      </div>
    );
  }

  // Auto on, all clear — show next scheduled time
  const next = parseISO(status.nextReminderAt);
  const isPast = next.getTime() <= Date.now();
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <BellRing className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
      <span>
        Automated reminders <span className="font-medium text-foreground">on</span>
        {" · "}
        {isPast ? (
          <>
            Next reminder due now — cadence {cadenceText}
          </>
        ) : (
          <>
            Next reminder{" "}
            <span className="font-medium text-foreground">
              {format(next, "dd MMM yyyy, HH:mm")}
            </span>{" "}
            (in {formatDistanceToNowStrict(next)}, cadence {cadenceText})
          </>
        )}
      </span>
    </div>
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
