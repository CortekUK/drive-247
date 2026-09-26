"use client";

/**
 * The side panel (design §5) — the whole story of one piece of money.
 *
 * "Show him the math. Tell him this whole story: this is what happened, this
 * is what was taken, this is what remains." Every row on Finances opens here:
 *
 *   a bill      every line · the payments that settled it · Total − Paid −
 *               Credited = Balance written out · collect what is left
 *   a payment   amount · method · date · status · the provider's reference
 *               with a dashboard link (or how to find it) · what it paid off
 *               · what is not applied · the plan it belongs to · who recorded
 *               it · refund
 *   upcoming    the plan's whole schedule, with this payment called out, and
 *               the plan's own actions
 *   a fine      its facts, and its record — where a fine is paid or waived
 *
 * A right-hand sheet on a desktop and the whole screen on a phone. It renders
 * from the rows Finances already holds; nothing here reads a money table.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Ban, CheckCircle, DollarSign, ExternalLink, Link2Off, Mail, RotateCcw, Trash2, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui-v2/sheet";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { LIST_TONES, ListStatusText } from "@/components/shared/list-table-v2";
import { stageHref } from "@/components/rentals-v2/rental-detail/stages";
import { PaymentPlanCard } from "@/components/payment-plans/payment-plan-card";
import { useTenant } from "@/contexts/TenantContext";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { usePaymentPlan, usePaymentPlanActions } from "@/hooks/use-payment-plan";
import { cn } from "@/lib/utils";
import { formatInstant, formatMoney, plural, todayInZone } from "@/lib/payment-plans-ui/format";
import { dashboardLinkFor, type DashboardAccounts } from "@/lib/payment-plans-ui/dashboard-link";
import { billMathText, billStatusText, tieOutText } from "@/lib/finances/bills";
import { toCents } from "@/lib/finances/balance";
import type { BillRow, ReceiptRow, UpcomingRow } from "@/lib/finances/types";
import type { EnhancedFine } from "@/hooks/use-fines-data";
import {
  BILL_TONE,
  RECEIPT_STATUS_LABEL,
  RECEIPT_TONE,
  UPCOMING_METHOD_LABEL,
  fineStatusWords,
  formatListDay,
  receiptMethodWords,
  upcomingStatusWords,
} from "./finance-words";
import { canCollectOnBill, canRefund, canRemoveLink, canReverse, canReview, customerHref, vehicleHref } from "./finance-rules";
import { fineCanCharge, fineCanWaive } from "@/components/fines/use-fine-row-actions";
import { billTitle } from "./billed-table";
import { fineReference } from "./fines-view";
import type { ReceiptAction } from "./received-table";
import type { PanelRef } from "./finances-url";
import { FINANCES_QUERY_KEY } from "./finance-dialogs";

export interface SidePanelData {
  bills: BillRow[];
  receipts: ReceiptRow[];
  upcoming: UpcomingRow[];
  fines: EnhancedFine[];
  loading: boolean;
}

export interface SidePanelActions {
  /** `canEdit('payments')`. */
  mayActOnPayments: boolean;
  /** `canEdit('payments') && canEdit('rentals')`. */
  mayActOnPlans: boolean;
  /** `canEdit('invoices')`. */
  mayEmailInvoice: boolean;
  busy: boolean;
  onReceiptAction: (row: ReceiptRow, action: ReceiptAction) => void;
  onCollect: (bill: BillRow) => void;
  onEmailInvoice: (bill: BillRow) => void;
  onOpen: (panel: PanelRef) => void;
  onClearFilters: () => void;
  /** `canEdit('invoices')` — the Invoices tab's Delete gate. */
  mayDeleteInvoice?: boolean;
  /** Opens the Invoices tab's own DeleteInvoiceDialog for the bill's invoice. */
  onDeleteInvoice?: (bill: BillRow) => void;
  /** `canEdit('fines')` — the fines tab's gate on Record Payment and Waive Fine. */
  mayActOnFines?: boolean;
  /** A waive is on its way. */
  finesBusy?: boolean;
  /** The fines tab's Record Payment (`useFineRowActions().openPaymentDialog`). */
  onFineRecordPayment?: (fine: EnhancedFine) => void;
  /** The fines tab's Waive Fine (`useFineRowActions().waiveFineAction.mutate`). */
  onFineWaive?: (fine: EnhancedFine) => void;
}

export function FinanceSidePanel({
  panel,
  onClose,
  data,
  currency,
  actions,
}: {
  panel: PanelRef | null;
  onClose: () => void;
  data: SidePanelData;
  currency: string;
  actions: SidePanelActions;
}) {
  return (
    <Sheet open={!!panel} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        data-finance-panel={panel?.kind ?? ""}
        data-tour="finances-side-panel"
        className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[520px]"
      >
        {panel && <PanelBody panel={panel} data={data} currency={currency} actions={actions} />}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({ panel, data, currency, actions }: { panel: PanelRef; data: SidePanelData; currency: string; actions: SidePanelActions }) {
  if (panel.kind === "bill") {
    const bill = data.bills.find((b) => b.key === panel.id);
    return bill ? <BillPanel bill={bill} data={data} currency={currency} actions={actions} /> : <Missing data={data} what="bill" actions={actions} />;
  }
  if (panel.kind === "payment") {
    const row = data.receipts.find((r) => r.paymentId === panel.id);
    return row ? <PaymentPanel row={row} currency={currency} actions={actions} /> : <Missing data={data} what="payment" actions={actions} />;
  }
  if (panel.kind === "upcoming") {
    const row = data.upcoming.find((u) => u.occurrenceId === panel.id);
    return row ? <UpcomingPanel row={row} currency={currency} mayAct={actions.mayActOnPlans} /> : <Missing data={data} what="payment" actions={actions} />;
  }
  if (panel.kind === "fine") {
    const fine = data.fines.find((f) => f.id === panel.id);
    return fine ? <FinePanel fine={fine} currency={currency} actions={actions} /> : <Missing data={data} what="fine" actions={actions} />;
  }
  const rows = panel.ids.map((id) => data.receipts.find((r) => r.paymentId === id)).filter((r): r is ReceiptRow => !!r);
  return <PaymentsPanel ids={panel.ids} rows={rows} data={data} currency={currency} actions={actions} />;
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

function Header({ title, description }: { title: string; description?: string }) {
  return (
    <SheetHeader className="border-b border-foreground/5 pr-14">
      <SheetTitle className="font-heading text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</SheetTitle>
      {description ? (
        <SheetDescription>{description}</SheetDescription>
      ) : (
        <SheetDescription className="sr-only">The whole story of this money.</SheetDescription>
      )}
    </SheetHeader>
  );
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2 px-6 py-4", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

function Missing({ data, what, actions }: { data: SidePanelData; what: string; actions: SidePanelActions }) {
  if (data.loading) {
    return (
      <div className="space-y-3 p-6" aria-busy="true">
        {/* A sheet always carries a title and a description for screen readers
            (Radix warns, and the dev overlay counts it, when it has none). */}
        <SheetHeader className="sr-only">
          <SheetTitle>Loading</SheetTitle>
          <SheetDescription>Reading the {what} from your records.</SheetDescription>
        </SheetHeader>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <>
      <Header title={`This ${what} isn't in the list`} />
      <div className="space-y-3 px-6 py-4 text-sm text-muted-foreground">
        <p>It may be hidden by the filters or the period you chose, or it may no longer exist.</p>
        <Button type="button" variant="outline" size="sm" onClick={actions.onClearFilters}>
          Clear the filters
        </Button>
      </div>
    </>
  );
}

/* ── a bill ──────────────────────────────────────────────────────────────── */

function BillPanel({ bill, data, currency, actions }: { bill: BillRow; data: SidePanelData; currency: string; actions: SidePanelActions }) {
  const $ = (c: number) => formatMoney(c, currency);
  const mismatch = tieOutText(bill, currency);
  const status = billStatusText(bill, currency);

  // The payments that settled this bill, from the lines' own applications.
  const byPayment = new Map<string, number>();
  for (const line of bill.lines) {
    for (const a of line.applications ?? []) byPayment.set(a.paymentId, (byPayment.get(a.paymentId) ?? 0) + a.amountCents);
  }
  const settled = [...byPayment.entries()];

  return (
    <div data-bill-panel={bill.key}>
      <Header
        title={billTitle(bill)}
        description={[bill.customerName, bill.vehicleReg, bill.invoiceNumber ? `Invoice ${bill.invoiceNumber}` : null].filter(Boolean).join(" · ")}
      />

      <Section title="The math">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Total">{$(bill.totalCents)}</Fact>
          <Fact label="Paid">{$(bill.paidCents)}</Fact>
          <Fact label="Credited">{$(bill.creditedCents)}</Fact>
          <Fact label="Balance">{$(bill.balanceCents)}</Fact>
        </dl>
        <p data-bill-math="" className="text-sm text-foreground tabular-nums">
          {billMathText(bill, currency)}
        </p>
        {mismatch ? (
          <p data-tie-out-marker="" className={cn("rounded-2xl bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed", LIST_TONES.danger)}>
            {mismatch}. The charges and payments below say one thing and the ledger&apos;s balance says another. Open the rental&apos;s
            Payments stage to put it right — nothing here changes it.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            <ListStatusText tone={BILL_TONE[bill.status]}>{status}</ListStatusText>
          </p>
        )}
        {bill.excludedReason && (
          <p className="text-xs text-muted-foreground">
            This rental was {bill.excludedReason}, so what is left on it does not count toward what you are owed.
          </p>
        )}
        {bill.paygOpenCents > 0 && (
          <p className="text-xs text-muted-foreground">
            Also owed on this rental: {$(bill.paygOpenCents)} for days already driven that have not been billed yet.
          </p>
        )}
      </Section>

      <Section title={`What was charged (${bill.lines.length})`}>
        <ul className="divide-y divide-foreground/5">
          {bill.lines.map((line) => (
            <li key={line.chargeId} className="flex items-start justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{line.category}</span>
                <span className="block text-xs text-muted-foreground">
                  {line.dueDate ? `Due ${formatListDay(line.dueDate)}` : "No due date"}
                  {line.appliedCents > 0 ? ` · ${$(line.appliedCents)} paid` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block font-medium text-foreground">{$(line.amountCents)}</span>
                <span className={cn("block text-xs", line.remainingCents > 0 ? "text-foreground" : "text-muted-foreground")}>
                  {line.remainingCents === 0 ? "Settled" : `${$(line.remainingCents)} left`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={settled.length ? `Paid by (${settled.length})` : "Paid by"}>
        {settled.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payment has been applied to this bill yet.</p>
        ) : (
          <ul className="divide-y divide-foreground/5">
            {settled.map(([paymentId, cents]) => {
              const r = data.receipts.find((x) => x.paymentId === paymentId);
              return (
                <li key={paymentId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => actions.onOpen({ kind: "payment", id: paymentId })}
                    className="min-w-0 text-left hover:underline"
                  >
                    <span className="block truncate font-medium text-foreground">
                      {r ? `${formatListDay(r.date) ?? ""} · ${receiptMethodWords(r)}` : `Payment …${paymentId.slice(-6)}`}
                    </span>
                    {r && <span className="block text-xs text-muted-foreground">{$(r.amountCents)} in total</span>}
                  </button>
                  <span className="shrink-0 font-medium tabular-nums text-foreground">{$(cents)} here</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="flex flex-wrap gap-2 px-6 pb-6 pt-2">
        {actions.mayActOnPayments && canCollectOnBill(bill) && (
          <>
            <Button type="button" onClick={() => actions.onCollect(bill)}>
              Send payment link
            </Button>
            <Button type="button" variant="outline" onClick={() => actions.onCollect(bill)}>
              Record payment
            </Button>
          </>
        )}
        {actions.mayEmailInvoice && bill.invoiceNumber && (
          <Button type="button" variant="outline" onClick={() => actions.onEmailInvoice(bill)}>
            <Mail data-icon="inline-start" />
            Email invoice
          </Button>
        )}
        {actions.mayDeleteInvoice && actions.onDeleteInvoice && bill.invoiceNumber && (
          <Button
            type="button"
            variant="outline"
            data-panel-action="delete_invoice"
            className="text-destructive hover:text-destructive"
            onClick={() => actions.onDeleteInvoice!(bill)}
          >
            <Trash2 data-icon="inline-start" />
            Delete invoice…
          </Button>
        )}
        {bill.onRental && bill.rentalId && (
          <Button asChild variant="ghost">
            <Link href={stageHref(bill.rentalId, "payments")}>
              Open the rental
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        )}
        <RecordLinks customerId={bill.customerId} vehicleId={bill.vehicleId} />
      </div>
    </div>
  );
}

/**
 * "Open the customer" · "Open the vehicle" — the records the Payments tab's
 * row linked its Customer and Vehicle cells to. Each only when the row names one.
 */
function RecordLinks({ customerId, vehicleId }: { customerId?: string | null; vehicleId?: string | null }) {
  const customer = customerHref(customerId);
  const vehicle = vehicleHref(vehicleId);
  return (
    <>
      {customer && (
        <Button asChild variant="ghost">
          <Link href={customer} data-panel-link="customer">
            Open the customer
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      )}
      {vehicle && (
        <Button asChild variant="ghost">
          <Link href={vehicle} data-panel-link="vehicle">
            Open the vehicle
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      )}
    </>
  );
}

/* ── a payment ───────────────────────────────────────────────────────────── */

/** The tenant's Stripe accounts, for the dashboard-link rules. A read of the tenant's own row. */
export function useFinanceStripeAccounts(enabled: boolean): DashboardAccounts | null {
  const { tenant } = useTenant();
  const q = useQuery({
    queryKey: [...FINANCES_QUERY_KEY, tenant?.id, "stripe-accounts"],
    enabled: !!tenant && enabled,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<DashboardAccounts> => {
      const { data, error } = await supabaseUntyped
        .from("tenants")
        .select("own_stripe_account_id, own_stripe_test_account_id, stripe_account_id")
        .eq("id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return {
        ownLive: data?.own_stripe_account_id ?? null,
        ownTest: data?.own_stripe_test_account_id ?? null,
        managed: data?.stripe_account_id ?? null,
      };
    },
  });
  return q.data ?? null;
}

/** Who recorded a plan payment, by `app_users` id. Null while unknown. */
function useRecorderName(appUserId: string | null): string | null {
  const { tenant } = useTenant();
  const q = useQuery({
    queryKey: [...FINANCES_QUERY_KEY, tenant?.id, "recorder", appUserId],
    enabled: !!tenant && !!appUserId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabaseUntyped.from("app_users").select("name, email").eq("id", appUserId).maybeSingle();
      if (error) throw error;
      return (data?.name || data?.email || null) as string | null;
    },
  });
  return q.data ?? null;
}

export function ReferenceBlock({ row, accounts }: { row: ReceiptRow; accounts: DashboardAccounts | null }) {
  const link = dashboardLinkFor(
    {
      provider: row.provider,
      providerAccount: row.providerAccount ?? null,
      providerMode: row.providerMode,
      providerRef: row.providerRef,
      checkoutSessionId: row.checkoutSessionId ?? null,
    },
    accounts,
  );
  return (
    <div data-reference-kind={link.kind} className="space-y-1.5">
      {link.reference && (
        <p className="break-all font-mono text-xs text-foreground" data-reference="">
          {link.reference}
        </p>
      )}
      {link.kind === "link" ? (
        <>
          <Button asChild size="sm" variant="outline">
            <a href={link.href} target="_blank" rel="noopener noreferrer">
              {link.label}
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">{link.note}</p>
        </>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">{link.text}</p>
      )}
    </div>
  );
}

/**
 * "$500.00 received − $50.00 refunded = $400.00 applied + $50.00 not applied",
 * or null. Written out ONLY when the figures on the rows really do add up that
 * way: a sentence that states a false sum is worse than no sentence.
 */
export function paymentMathText(
  row: Pick<ReceiptRow, "amountCents" | "refundedCents" | "unappliedCents" | "appliedTo" | "countsAsReceived">,
  currency: string,
): string | null {
  if (!row.countsAsReceived) return null;
  const applied = row.appliedTo.reduce((s, a) => s + a.amountCents, 0);
  if (row.amountCents - row.refundedCents !== applied + row.unappliedCents) return null;
  const $ = (c: number) => formatMoney(c, currency);
  return (
    `${$(row.amountCents)} received` +
    (row.refundedCents > 0 ? ` − ${$(row.refundedCents)} refunded` : "") +
    ` = ${$(applied)} applied` +
    (row.unappliedCents > 0 ? ` + ${$(row.unappliedCents)} not applied` : "")
  );
}

function PaymentPanel({ row, currency, actions }: { row: ReceiptRow; currency: string; actions: SidePanelActions }) {
  const $ = (c: number) => formatMoney(c, currency);
  const accounts = useFinanceStripeAccounts(row.provider === "stripe");
  const recorder = useRecorderName(row.recordedById ?? null);
  const may = actions.mayActOnPayments;
  const refundLeft = row.amountCents - row.refundedCents;

  return (
    <div data-payment-panel={row.paymentId}>
      <Header
        title={`${$(row.amountCents)} from ${row.customerName}`}
        description={[formatListDay(row.date), receiptMethodWords(row), row.rentalRef].filter(Boolean).join(" · ")}
      />

      <Section title="What happened">
        <dl className="grid grid-cols-2 gap-3">
          <Fact label="Amount">{$(row.amountCents)}</Fact>
          <Fact label="Status">
            <ListStatusText tone={RECEIPT_TONE[row.status]}>{RECEIPT_STATUS_LABEL[row.status]}</ListStatusText>
          </Fact>
          <Fact label="Method">{receiptMethodWords(row)}</Fact>
          <Fact label="Date">{formatListDay(row.date) ?? "—"}</Fact>
          {row.refundedCents > 0 && <Fact label="Refunded">{$(row.refundedCents)}</Fact>}
          {row.planLabel && <Fact label="Payment plan">{row.planLabel}</Fact>}
        </dl>
        {!row.countsAsReceived && row.status === "pending" && (
          <p className="text-xs text-muted-foreground">No money has arrived on this one yet — it is a link or a charge still waiting to be paid.</p>
        )}
      </Section>

      <Section title={row.provider === "manual" ? "Where it came from" : row.provider === "square" ? "At Square" : "At Stripe"}>
        <ReferenceBlock row={row} accounts={accounts} />
      </Section>

      <Section title="What it paid off">
        {row.appliedTo.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-foreground/5">
            {row.appliedTo.map((a) => (
              <li key={a.chargeId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-foreground">{a.category}</span>
                  {a.rentalRef && <span className="text-muted-foreground"> · {a.rentalRef}</span>}
                </span>
                <span className="shrink-0 font-medium tabular-nums text-foreground">{$(a.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
        {row.unappliedCents > 0 && row.countsAsReceived && (
          <p className={cn("text-sm", LIST_TONES.info)} data-unapplied="">
            {$(row.unappliedCents)} of it is not applied to any charge yet.
          </p>
        )}
        {paymentMathText(row, currency) && (
          <p data-payment-math="" className="text-xs text-muted-foreground tabular-nums">
            {paymentMathText(row, currency)}
          </p>
        )}
      </Section>

      <Section title="Recorded">
        <p className="text-sm text-foreground">
          {row.recordedAt ? formatInstant(row.recordedAt) : "When it was recorded is not known"}
          {recorder ? ` by ${recorder}` : ""}
        </p>
      </Section>

      <div className="flex flex-wrap gap-2 px-6 pb-6 pt-2">
        {may && canReview(row) && (
          <>
            <Button type="button" disabled={actions.busy} onClick={() => actions.onReceiptAction(row, "approve")}>
              <CheckCircle data-icon="inline-start" />
              Approve
            </Button>
            <Button type="button" variant="destructive" disabled={actions.busy} onClick={() => actions.onReceiptAction(row, "reject")}>
              <XCircle data-icon="inline-start" />
              Reject…
            </Button>
          </>
        )}
        {may && canRefund(row) && (
          <Button type="button" variant="outline" onClick={() => actions.onReceiptAction(row, "refund")}>
            <RotateCcw data-icon="inline-start" />
            Refund (up to {$(refundLeft)})
          </Button>
        )}
        {may && canRemoveLink(row) && (
          <Button type="button" variant="outline" onClick={() => actions.onReceiptAction(row, "remove_link")}>
            <Link2Off data-icon="inline-start" />
            Remove payment link…
          </Button>
        )}
        {may && canReverse(row) && (
          <Button type="button" variant="outline" onClick={() => actions.onReceiptAction(row, "reverse")}>
            <Undo2 data-icon="inline-start" />
            Reverse…
          </Button>
        )}
        {row.rentalId && (
          <Button asChild variant="ghost">
            <Link href={stageHref(row.rentalId, "payments")}>
              Open the rental
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        )}
        <RecordLinks customerId={row.customerId} vehicleId={row.vehicleId} />
      </div>
    </div>
  );
}

/* ── several payments: the duplicate review ──────────────────────────────── */

function PaymentsPanel({
  ids,
  rows,
  data,
  currency,
  actions,
}: {
  ids: string[];
  rows: ReceiptRow[];
  data: SidePanelData;
  currency: string;
  actions: SidePanelActions;
}) {
  const $ = (c: number) => formatMoney(c, currency);
  if (rows.length === 0) return <Missing data={data} what="payment" actions={actions} />;
  return (
    <div data-payments-panel="">
      <Header
        title="Possible duplicate"
        description={`${plural(ids.length, "payment")} for the same rental, the same amount, on the same day. If one was taken twice, refund it here.`}
      />
      <ul className="space-y-3 px-6 py-4">
        {rows.map((r) => (
          <li key={r.paymentId} className="rounded-2xl bg-muted/40 p-4 ring-1 ring-foreground/5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {$(r.amountCents)} · {receiptMethodWords(r)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[formatListDay(r.date), r.rentalRef, r.recordedAt ? `recorded ${formatInstant(r.recordedAt)}` : null].filter(Boolean).join(" · ")}
                </p>
                {r.providerRef && <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{r.providerRef}</p>}
              </div>
              <ListStatusText tone={RECEIPT_TONE[r.status]}>{RECEIPT_STATUS_LABEL[r.status]}</ListStatusText>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => actions.onOpen({ kind: "payment", id: r.paymentId })}>
                Details
              </Button>
              {actions.mayActOnPayments && canRefund(r) && (
                <Button type="button" size="sm" variant="outline" onClick={() => actions.onReceiptAction(r, "refund")}>
                  <RotateCcw data-icon="inline-start" />
                  Refund this one
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── an upcoming payment: the plan it belongs to ─────────────────────────── */

function UpcomingPanel({ row, currency, mayAct }: { row: UpcomingRow; currency: string; mayAct: boolean }) {
  const $ = (c: number) => formatMoney(c, currency);
  const status = upcomingStatusWords(row);
  return (
    <div data-upcoming-panel={row.occurrenceId}>
      <Header title={`${row.seqLabel} · ${row.rentalRef}`} description={row.customerName} />
      <Section title="This payment">
        <div className="rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20" data-highlighted-occurrence="">
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Due">{formatListDay(row.effectiveOn ?? row.dueDate) ?? "—"}</Fact>
            <Fact label="Amount">{$(row.amountCents)}</Fact>
            <Fact label="How">{UPCOMING_METHOD_LABEL[row.method] ?? row.method}</Fact>
            <Fact label="Status">
              <ListStatusText tone={status.tone}>{status.label}</ListStatusText>
            </Fact>
          </dl>
        </div>
      </Section>
      <Section title="The whole plan">
        <PlanSchedule rentalId={row.rentalId} mayAct={mayAct} />
      </Section>
    </div>
  );
}

/**
 * The rental's plan card, exactly as the rental's Payments stage draws it,
 * with its own actions. Editing the plan's shape stays on the rental (it needs
 * the rental's dates and balance); everything else is here.
 */
function PlanSchedule({ rentalId, mayAct }: { rentalId: string; mayAct: boolean }) {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const currency = (tenant?.currency_code || "USD").toUpperCase();
  const q = usePaymentPlan(rentalId, null);
  const act = usePaymentPlanActions(rentalId);
  const accounts = useFinanceStripeAccounts(true);
  const after = <T,>(p: Promise<T>) =>
    p.then((v) => {
      void qc.invalidateQueries({ queryKey: FINANCES_QUERY_KEY });
      return v;
    });

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.error) return <p className="text-sm text-destructive">The payment plan would not load: {(q.error as Error).message}</p>;
  const data = q.data;
  if (!data) return <p className="text-sm text-muted-foreground">This rental has no payment plan any more.</p>;
  const plan = data.plan;
  const live = plan.status === "active" || plan.status === "paused";
  const today = todayInZone(plan.timezone ?? tenant?.timezone);

  return (
    <div className="-mx-2">
      <PaymentPlanCard
        plan={plan}
        occurrences={data.occurrences}
        attempts={data.attempts}
        events={data.events}
        currency={currency}
        today={today}
        accounts={accounts}
        actions={
          mayAct && live
            ? {
                retry: (o) => after(act.retry(o.id)),
                sendLink: (o) => after(act.sendLink(o.id)),
                recordPayment: (o, input) => after(act.recordPayment(o.id, input)),
                move: (o, to) => after(act.move(o.id, to)),
                skip: (o) => after(act.skip(o.id)),
                pause: () => after(act.pause(plan.id)),
                resume: () => after(act.resume(plan.id)),
                cancel: () => after(act.cancel(plan.id)),
              }
            : undefined
        }
      />
    </div>
  );
}

/* ── a fine ──────────────────────────────────────────────────────────────── */

function FinePanel({ fine, currency, actions }: { fine: EnhancedFine; currency: string; actions: SidePanelActions }) {
  const status = fineStatusWords(fine.status, fine.isOverdue);
  // The fines tab's own row actions, on its own gates: an Open fine, and
  // someone who may edit fines.
  const charge = !!actions.mayActOnFines && !!actions.onFineRecordPayment && fineCanCharge(fine);
  const waive = !!actions.mayActOnFines && !!actions.onFineWaive && fineCanWaive(fine);
  return (
    <div data-fine-panel={fine.id}>
      <Header title={`Fine ${fineReference(fine)}`} description={[fine.type, fine.customers?.name].filter(Boolean).join(" · ")} />
      <Section title="The fine">
        <dl className="grid grid-cols-2 gap-3">
          <Fact label="Amount">{formatMoney(toCents(fine.amount), currency)}</Fact>
          <Fact label="Status">
            <ListStatusText tone={status.tone}>{status.label}</ListStatusText>
          </Fact>
          <Fact label="Issued">{formatListDay(fine.issue_date) ?? "—"}</Fact>
          <Fact label="Due">{formatListDay(fine.due_date) ?? "—"}</Fact>
          <Fact label="Vehicle">{fine.vehicles?.reg || "—"}</Fact>
          <Fact label="Rental">{fine.rentals?.rental_number || "—"}</Fact>
        </dl>
        {fine.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{fine.notes}</p>}
      </Section>
      <div className="flex flex-wrap gap-2 px-6 pb-6 pt-2">
        {charge && (
          <Button type="button" data-panel-action="fine_record_payment" onClick={() => actions.onFineRecordPayment!(fine)}>
            <DollarSign data-icon="inline-start" />
            Record payment
          </Button>
        )}
        {waive && (
          <Button
            type="button"
            variant="outline"
            data-panel-action="fine_waive"
            disabled={!!actions.finesBusy}
            onClick={() => actions.onFineWaive!(fine)}
          >
            <Ban data-icon="inline-start" />
            Waive fine
          </Button>
        )}
        <Button asChild variant={charge ? "outline" : "default"}>
          <Link href={`/fines/${fine.id}`}>
            Open the fine
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
        {fine.rental_id && (
          <Button asChild variant="ghost">
            <Link href={stageHref(fine.rental_id, "payments")}>Open the rental</Link>
          </Button>
        )}
        <RecordLinks customerId={fine.customer_id} vehicleId={fine.vehicle_id} />
      </div>
      {!charge && !waive && (
        <p className="px-6 pb-6 text-xs text-muted-foreground">
          {fineCanCharge(fine) ? "Take a payment for it or waive it from the fine itself." : "Its full history, appeals and documents are on the fine itself."}
        </p>
      )}
    </div>
  );
}
