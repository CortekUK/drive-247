"use client";

/**
 * One invoice, in a sheet that slides in from the right — full height, with
 * the invoice list still beside it, so moving between invoices is quick.
 *
 *   INV-0024  RENTAL  Overdue · 34 days                     ✎  ⊘  🗑
 *   Nina Kowalski · NWD-4526 Ford Explorer · Issued Aug 25 · Due Aug 25
 *
 *   [ Total $3,747.05 ] − [ Paid $3,301.65 ] = [ Remaining $445.40 ]
 *
 *   CHARGES
 *   ├─ ▸ Service Fee                     $97.50    ← amber: part paid
 *   ├─ ▾ Rental                       $1,950.00    ← amber
 *   │    ├─ Cash  Sep 25          🧾     $300.00
 *   │    └─ Bank Transfer  Aug 18 🧾   $1,343.10
 *   └─ ▸ Extension Rental  Sep 10     $1,335.00    ← green: paid
 *
 *   The invoice's actions are icons at the top right: ✎ edit (dates, notes),
 *   ⊘ cancel / ↺ restore, 🗑 delete. Payments are taken from a charge's own
 *   "+ Add payment" row; Send Email stays in the table's ⋯ menu.
 *
 * Kept deliberately quiet:
 *  - no root row: the tree hangs from the header, which already names the
 *    invoice and its total;
 *  - charges start CLOSED — open one to see the payments that paid it;
 *  - no status words: a charge's amount is coloured by its state (green paid,
 *    amber part paid, grey unpaid), the same trick as the invoice table, with
 *    the words in the row's tooltip;
 *  - a charge shows a date only when it differs from the invoice date;
 *  - "Pay" appears on hover (and on keyboard focus), not on every row.
 *
 * The receipt opens in place of the charges, with a way back.
 */

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  ChevronRight,
  CornerDownRight,
  FileMinus,
  FilePlus,
  MoreHorizontal,
  PenLine,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { format } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui-v2/sheet";
import { Button } from "@/components/ui-v2/button";
import { ListStatusText, LIST_TONES, type ListTone } from "@/components/shared/list-table-v2";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { useTenant } from "@/contexts/TenantContext";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import type { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  EPS,
  PAYMENT_TONE,
  chargeState,
  financesQueryKey,
  dueState,
  invoiceTotals,
  entityLabel,
  isLanded,
  paymentState,
  paidOf,
  paymentLabel,
  paymentProvider,
  receiptNumber,
  refundOf,
  refundShare,
  type FinanceIndex,
  type FinanceInvoice,
  type FinancePayment,
} from "./finance-data";
import { ReceiptView } from "./receipt-view";
import { PaymentSourceIcon } from "./payment-source-icon";
import { CopyOnHover } from "./copy-on-hover";
import { FINANCES_PREVIEW, issueInvoice, markLinkPaid } from "./finance-mock";
import { PayInvoiceDialog } from "./pay-invoice-dialog";
import { ChangeAmountDialog, type ChangeAmountTarget } from "./change-amount-dialog";
import { useToast } from "@/hooks/use-toast";
import { HeaderIconButton } from "@/components/shared/header-icon-button-v2";
import { CancelInvoiceDialog, EditInvoiceDialog } from "./invoice-actions";

type PayTarget = { amount: number; categories?: string[] };

/**
 * A low-toned status pill: a faint tint of its colour behind darker text of the
 * same hue, a hairline border, and rounded but not round corners (rounded-md).
 */
const PILL_TONE: Record<ListTone, string> = {
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
  info: "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  muted: "border-border bg-muted/60 text-muted-foreground",
};

function Pill({ tone, children }: { tone: ListTone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", PILL_TONE[tone])}>
      {children}
    </span>
  );
}


/**
 * One row of Details: a quiet label, then its value. No card and no tinted
 * column — just faint rules between rows (the list's `divide-y`), so the list
 * sits in the sheet rather than on top of it.
 */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** A link from Details to the record it names, in the accent colour. */
function DetailLink({ href, children }: { href: string; children: React.ReactNode }) {
  // Preview records have no pages to open.
  if (FINANCES_PREVIEW) return <span className="text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">{children}</span>;
  return (
    <Link href={href} className="text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] hover:underline">
      {children}
    </Link>
  );
}

/** A charge's state, carried by its amount's colour. */
const AMOUNT_TONE: Record<ListTone, string> = {
  success: LIST_TONES.success,
  warning: LIST_TONES.warning,
  muted: "text-muted-foreground",
  info: LIST_TONES.info,
  danger: LIST_TONES.danger,
};

/**
 * A tree node, with its connector drawn by the <li> itself: a rail down the
 * left (stopping at the elbow on the last child, so it never runs past the
 * final branch) and an elbow into the middle of the row. `top` is that middle.
 */
function treeNode(last: boolean, top: "18px" | "16px") {
  return cn(
    "relative pl-5",
    "before:absolute before:left-0 before:top-0 before:border-l before:border-border before:content-['']",
    last ? (top === "18px" ? "before:h-[18px]" : "before:h-[16px]") : "before:h-full",
    "after:absolute after:left-0 after:w-3.5 after:border-t after:border-border after:content-['']",
    top === "18px" ? "after:top-[18px]" : "after:top-[16px]",
  );
}


export function InvoiceDetailSheet({
  invoice,
  index,
  currencyCode,
  canEdit,
  onOpenChange,
  onDelete,
}: {
  invoice: FinanceInvoice | null;
  index: FinanceIndex;
  currencyCode: string;
  canEdit: ReturnType<typeof useManagerPermissions>["canEdit"];
  onOpenChange: (open: boolean) => void;
  onDelete: (invoice: FinanceInvoice) => void;
}) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  // The ONE charge that is open — opening another closes it. Null = all closed,
  // which is the default.
  const [openCharge, setOpenCharge] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<FinancePayment | null>(null);
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [changeTarget, setChangeTarget] = useState<ChangeAmountTarget | null>(null);
  // The Pay dialog: open for the whole invoice ({}), or one line ({ only }).
  const [payFor, setPayFor] = useState<{ only?: string } | null>(null);

  const money = (n: number) => formatCurrency(n, currencyCode);
  const { toast } = useToast();
  /** In preview the data is a mock: actions explain themselves instead of writing. */
  const previewOnly = () =>
    toast({ title: "Preview data", description: "This is the ideal-model mock — actions are switched off." });
  /** The amount without its currency sign, for where an icon takes the sign's place. */
  const figure = (n: number) =>
    new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const close = (open: boolean) => {
    if (!open) {
      setOpenCharge(null);
      setDetailsOpen(false);
      setReceiptFor(null);
    }
    onOpenChange(open);
  };

  const toggleCharge = (id: string) => setOpenCharge((prev) => (prev === id ? null : id));

  if (!invoice) return <Sheet open={false} onOpenChange={close} />;

  /**
   * "+ Add payment", inside an open charge that still owes money: a full-width,
   * low-toned row where the next payment would go — dashed, muted, and only
   * warming to the accent on hover. It records a payment aimed at this charge
   * for what is still owed on it.
   */
  const addPaymentRow = (charge: { id: string; category: string | null }, owed: number, last = false) => (
    <li key="add-payment" className={treeNode(last, "18px")}>
      <button
        type="button"
        onClick={() =>
          FINANCES_PREVIEW
            ? setPayFor({ only: charge.id })
            : setPayTarget({ amount: owed, categories: charge.category ? [charge.category] : undefined })
        }
        className="my-1 flex h-7 w-full items-center gap-2 rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground transition-colors duration-200 ease-out hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">Add payment</span>
        <span className="tabular-nums">{money(owed)}</span>
      </button>
    </li>
  );

  const { charges, total, paid, credited, settled, owes } = invoiceTotals(invoice, index);
  const isDraft = invoice.status === "draft";
  const isCancelled = invoice.status === "cancelled";
  const payment = paymentState(total, settled, isCancelled, isDraft);
  const due = dueState(invoice, charges, owes);
  const reg = invoice.vehicles?.reg;
  const makeModel = [invoice.vehicles?.make, invoice.vehicles?.model].filter(Boolean).join(" ");
  const vehicle = [reg, makeModel].filter(Boolean).join(" · ") || null;
  const canPay = canEdit("payments") && !!invoice.rental_id;
  const invoiceDay = invoice.invoice_date?.slice(0, 10) ?? null;

  return (
    <>
      <Sheet open onOpenChange={close}>
        <SheetContent
          side="right"
          // No ✕: the sheet closes on a click outside it or on Esc, and the
          // receipt has its own "Back to" link.
          showCloseButton={false}
          // max-h + overflow on the panel itself, as well as on its body: if
          // the body is ever not held to the panel's height, the panel scrolls
          // rather than letting the receipt run off the bottom of the screen.
          // bg-app-gradient: the same brand wash as the page behind (v2-theme.css).
          // Its layer is `position: fixed`, so the panel needs a transform of its
          // own (transform-gpu) for that layer to fill the panel rather than the
          // whole screen — the same arrangement as the Trax panel.
          //
          // The solid ground is restated as an arbitrary property ON PURPOSE:
          // tailwind-merge reads `bg-app-gradient` as a background COLOUR and
          // drops the sheet's own `bg-popover` as a conflict, which left the
          // panel see-through. `[background-color:…]` is not a `bg-*` utility,
          // so the merge keeps it.
          className="bg-app-gradient [background-color:hsl(var(--popover))] transform-gpu max-h-dvh gap-0 overflow-y-auto overscroll-contain data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        >
          {receiptFor ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <Button variant="ghost" size="sm" className="-ml-2 mb-3 h-7 px-2" onClick={() => setReceiptFor(null)}>
                <ArrowLeft className="h-4 w-4" />
                Back to {invoice.invoice_number}
              </Button>
              <div className="space-y-4">
                <ReceiptView
                  payment={receiptFor}
                  companyName={tenant?.company_name ?? ""}
                  invoiceNumber={invoice.invoice_number}
                  customerName={invoice.customers?.name ?? null}
                  vehicle={vehicle}
                  appliedTo={(index.allocsByPayment.get(receiptFor.id) ?? []).map((a) => ({
                    category: index.chargeById.get(a.charge_entry_id)?.category ?? "Charge",
                    amount: Number(a.amount_applied || 0),
                    date: index.chargeById.get(a.charge_entry_id)?.entry_date ?? null,
                  }))}
                  currencyCode={currencyCode}
                />
              </div>
            </div>
          ) : (
            <>
              <SheetHeader>
                <div className="flex items-start justify-between gap-3">
                <div className="group/copy flex min-w-0 items-center gap-1">
                  <SheetTitle className="truncate text-lg tabular-nums">{invoice.invoice_number}</SheetTitle>
                  <CopyOnHover value={invoice.invoice_number} label="Copy invoice number" />
                </div>
                {/* The invoice's own actions, as quiet icons: edit its dates and
                    notes, cancel (or restore) it, delete it. Payments are taken
                    from each charge's "Add payment" row. */}
                {canEdit("invoices") && (
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Pay: on an issued invoice that still owes money. */}
                    {FINANCES_PREVIEW && canEdit("payments") && !isDraft && !isCancelled && owes > EPS && (
                      <Button size="sm" className="h-8 rounded-full px-3.5 text-[13px]" onClick={() => setPayFor({})}>
                        Pay {money(owes)}
                      </Button>
                    )}
                    {/* A draft is editable until it is issued; issuing locks its lines. */}
                    {isDraft && FINANCES_PREVIEW && (
                      <Button
                        size="sm"
                        className="h-8 rounded-full px-3.5 text-[13px]"
                        onClick={() => {
                          issueInvoice(invoice.id);
                          toast({ title: "Invoice issued", description: `${invoice.invoice_number} is now due.` });
                        }}
                      >
                        Issue invoice
                      </Button>
                    )}
                    {/* The same round, tinted icon buttons as the Rentals, Vehicles
                        and Customers headers (HeaderIconButton), with their tooltips. */}
                    <HeaderIconButton label="Edit invoice" onClick={() => (FINANCES_PREVIEW ? previewOnly() : setEditOpen(true))}>
                      <Pencil />
                    </HeaderIconButton>
                    <HeaderIconButton
                      label={invoice.status === "cancelled" ? "Restore invoice" : "Cancel invoice"}
                      onClick={() => (FINANCES_PREVIEW ? previewOnly() : setCancelOpen(true))}
                    >
                      {invoice.status === "cancelled" ? <RotateCcw /> : <Ban />}
                    </HeaderIconButton>
                    <HeaderIconButton label="Delete invoice" onClick={() => (FINANCES_PREVIEW ? previewOnly() : onDelete(invoice))}>
                      <Trash2 />
                    </HeaderIconButton>
                  </div>
                )}
                </div>
                {/* The one-line summary is for screen readers; the facts live in Details. */}
                <SheetDescription className="sr-only">
                  {[invoice.customers?.name, vehicle].filter(Boolean).join(" · ")}
                  {invoice.invoice_date && ` · Issued ${format(parseLocalDate(invoice.invoice_date), "PP")}`}
                  {invoice.due_date && ` · Due ${format(parseLocalDate(invoice.due_date), "PP")}`}
                </SheetDescription>

                {/* Details: everything else about the invoice, folded away by default so
                    the header stays one line. New facts about an invoice go in here. */}
                <div className="pt-1">
                  <div className="flex items-center">
                  <button
                    type="button"
                    aria-expanded={detailsOpen}
                    onClick={() => setDetailsOpen((v) => !v)}
                    className="-ml-1 inline-flex items-center gap-1 rounded px-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none",
                        detailsOpen && "rotate-90",
                      )}
                    />
                    Details
                  </button>
                  </div>
                  {/* Opens smoothly rather than popping in: the rows track animates
                      0fr → 1fr so what sits below slides down with it, while the list
                      itself fades and rises 12px (the Trax motion — 200ms, ease-out in,
                      ease-in out). It stays mounted, so closing animates too; `inert`
                      keeps its links out of the tab order while folded away. */}
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none",
                      detailsOpen ? "grid-rows-[1fr] ease-out" : "grid-rows-[0fr] ease-in",
                    )}
                    inert={!detailsOpen ? true : undefined}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div
                        className={cn(
                          "pt-2 [transition:transform_200ms,opacity_200ms] motion-reduce:transition-none",
                          detailsOpen
                            ? "translate-y-0 opacity-100 [transition-timing-function:ease-out]"
                            : "-translate-y-3 opacity-0 [transition-timing-function:ease-in]",
                        )}
                      >
                        <dl className="divide-y divide-border/60 text-sm">
                          <Detail label="Customer">
                            {invoice.customer_id && invoice.customers?.name ? (
                              <DetailLink href={`/customers/${invoice.customer_id}`}>{invoice.customers.name}</DetailLink>
                            ) : (
                              invoice.customers?.name ?? "—"
                            )}
                          </Detail>
                          {vehicle && (
                            <Detail label="Vehicle">
                              {invoice.vehicle_id ? (
                                <DetailLink href={`/vehicles/${invoice.vehicle_id}`}>{vehicle}</DetailLink>
                              ) : (
                                vehicle
                              )}
                            </Detail>
                          )}
                          {invoice.rental_id ? (
                            <Detail label="Rental">
                              <DetailLink href={`/rentals/${invoice.rental_id}`}>View rental</DetailLink>
                            </Detail>
                          ) : invoice.related_rental ? (
                            // A Standalone that happened during a rental: noted for
                            // context, not part of that rental's billing.
                            <Detail label="Related rental">
                              <DetailLink href={`/rentals/${invoice.related_rental}`}>{invoice.related_rental}</DetailLink>
                            </Detail>
                          ) : (
                            <Detail label="Rental">Not tied to a rental</Detail>
                          )}
                          <Detail label="Entity">
                            {entityLabel(invoice)}
                            {invoice.event && <span className="text-muted-foreground"> · {invoice.event}</span>}
                          </Detail>
                          {invoice.entity_ref && <Detail label="Entity ref">{invoice.entity_ref}</Detail>}
                          <Detail label="Issued">
                            {invoice.invoice_date ? format(parseLocalDate(invoice.invoice_date), "PPP") : "—"}
                          </Detail>
                          <Detail label="Due">
                            {invoice.due_date ? format(parseLocalDate(invoice.due_date), "PPP") : "No due date"}
                            {due && (
                              <>
                                <span className="text-muted-foreground"> · </span>
                                <ListStatusText tone={due.tone}>{due.label}</ListStatusText>
                              </>
                            )}
                          </Detail>
                          <Detail label="Payment">
                            <ListStatusText tone={payment.tone}>{payment.label}</ListStatusText>
                          </Detail>
                          <Detail label="Line items">{charges.length}</Detail>
                          {invoice.notes && <Detail label="Notes">{invoice.notes}</Detail>}
                        </dl>
                      </div>
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-6">
                {/* Charges, as a tree hung from the header */}
                <div>
                  {/* One light white card across the full width — the heading and, on
                      the same line, the invoice's sum. A hairline border and the faintest
                      shadow lift it off the sheet's wash without weighing it down.
                      The heading and the sum:
                      Total − Paid = Remaining, as big bold figures and the two
                      operators, nothing else. It ends over the charges' amount
                      column, so the answer sits above the figures it adds up.
                      The words are for screen readers and the hover titles. */}
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-card px-4 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Line items
                    </span>
                    <p
                      className="flex flex-wrap items-baseline gap-x-2.5 text-lg font-semibold tabular-nums"
                      aria-label={`Total ${money(total)}, paid ${money(paid)}${credited > EPS ? `, credited ${money(credited)}` : ""}, remaining ${money(owes)}`}
                    >
                      <span title="Total">{money(total)}</span>
                      <span aria-hidden className="font-normal text-muted-foreground/60">−</span>
                      <span title="Paid">{money(paid)}</span>
                      {/* Only when something was forgiven: the credit is its own term. */}
                      {credited > EPS && (
                        <>
                          <span aria-hidden className="font-normal text-muted-foreground/60">−</span>
                          <span title="Credited" className="text-muted-foreground">{money(credited)}</span>
                        </>
                      )}
                      <span aria-hidden className="font-normal text-muted-foreground/60">=</span>
                      <span
                        title="Remaining"
                        className={owes > EPS ? LIST_TONES[due?.tone ?? payment.tone] : "text-muted-foreground"}
                      >
                        {money(owes)}
                      </span>
                    </p>
                  </div>
                  {charges.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {invoice.rental_id
                        ? "No charges recorded on this rental yet."
                        : "Standalone invoice: it is not tied to a rental, so it has no rental charges."}
                    </p>
                  ) : (
                    <ul className="ml-1.5">
                      {charges.map((charge, ci) => {
                        // The line as billed: its original amount plus any debit notes.
                        // Credits are forgiven off it. So the sum below always adds up:
                        //   billed − paid − credited = remaining
                        const cOriginal = Number(charge.amount || 0);
                        const cDebits = index.debitsByCharge.get(charge.id) ?? [];
                        const cDebited = cDebits.reduce((sum, dn) => sum + Number(dn.amount || 0), 0);
                        const cAmount = cOriginal + cDebited;
                        const cCredits = index.creditsByCharge.get(charge.id) ?? [];
                        const cCredited = cCredits.reduce((sum, cn) => sum + Number(cn.amount || 0), 0);
                        const cOwes = Math.max(0, Number(charge.remaining_amount ?? cAmount));
                        const cPaid = Math.max(0, cAmount - cOwes); // settled: paid + credited
                        const cKept = Math.max(0, cPaid - cCredited);
                        const cState = chargeState(cAmount, cPaid);
                        const cNotes = cDebits.length + cCredits.length;
                        // Where a refund of this line would go: the latest payment on it.
                        const lastPay = [...(index.allocsByCharge.get(charge.id) ?? [])]
                          .reverse()
                          .map((a) => index.paymentById.get(a.payment_id))
                          .find(Boolean);
                        const refundTo = lastPay
                          ? paymentProvider(lastPay) === "stripe"
                            ? "card (Stripe)"
                            : paymentProvider(lastPay) === "square"
                              ? "card (Square)"
                              : null
                          : null;
                        const isOpen = openCharge === charge.id;
                        const allocs = index.allocsByCharge.get(charge.id) ?? [];
                        // Money given back on this charge's payments (their share of each refund).
                        const chargeRefunded = allocs.reduce((sum, a) => {
                          const pay = index.paymentById.get(a.payment_id);
                          return sum + (pay ? refundShare(pay, Number(a.amount_applied || 0), charge.id) : 0);
                        }, 0);
                        const chargeDay = charge.entry_date?.slice(0, 10) ?? null;
                        const showDate = !!chargeDay && chargeDay !== invoiceDay;
                        const summary =
                          cOwes > EPS ? `${cState.label} · ${money(cOwes)} remaining` : cState.label;

                        return (
                          <li key={charge.id} className={treeNode(ci === charges.length - 1, "18px")}>
                            {/* A charge: name, amount in its state's colour, Pay on hover */}
                            <div
                              role="button"
                              tabIndex={0}
                              aria-expanded={isOpen}
                              aria-label={`${charge.category ?? "Charge"}, ${money(cAmount)}, ${summary}`}
                              onClick={() => toggleCharge(charge.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleCharge(charge.id);
                                }
                              }}
                              className="group flex h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm hover:bg-muted/50"
                            >
                              <ChevronRight
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                                  isOpen && "rotate-90",
                                )}
                              />
                              <span className="flex min-w-0 flex-1 items-center">
                                <span className="truncate">
                                  {charge.category ?? "Charge"}
                                  {showDate && (
                                    <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                                      {format(parseLocalDate(chargeDay!), "MMM d")}
                                    </span>
                                  )}
                                  {/* Corrected after issue: a debit or credit note sits under it. */}
                                  {cNotes > 0 && (
                                    <span className="ml-2 rounded border border-border px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Adjusted
                                    </span>
                                  )}
                                </span>
                              </span>
                              {/* ⋯ on hover: change this line's amount. On a draft it edits the
                                  line; once issued it adds a debit / credit note. */}
                              {canEdit("invoices") && !isCancelled && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={`Actions for ${charge.category ?? "this line"}`}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => e.stopPropagation()}
                                      className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-auto" onClick={(e) => e.stopPropagation()}>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        FINANCES_PREVIEW
                                          ? setChangeTarget({
                                              chargeId: charge.id,
                                              label: charge.category ?? "Line",
                                              invoiceNumber: invoice.invoice_number,
                                              entityRef: invoice.entity_ref ?? null,
                                              current: Math.round((cAmount - cCredited) * 100) / 100,
                                              remaining: cOwes,
                                              isDraft,
                                              refundTo,
                                            })
                                          : previewOnly()
                                      }
                                    >
                                      <PenLine className="h-4 w-4" />
                                      {isDraft ? "Edit amount" : "Change amount"}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              <span
                                className={cn(
                                  "w-28 shrink-0 text-right font-medium tabular-nums",
                                  // Open with payments, the sum's answer (Remaining) carries the
                                  // colour and this figure is just its first line. Closed — or
                                  // open with no payments, so no answer row — it keeps it.
                                  isOpen && (allocs.length > 0 || cNotes > 0) ? "text-foreground" : AMOUNT_TONE[cState.tone],
                                )}
                              >
                                {money(cAmount)}
                              </span>
                            </div>

                            {/* Its payments */}
                            {/* pb-5, not mb-5: padding stays inside the charge's <li>, so its
                                branch line runs on through the gap to the next charge. */}
                            {isOpen && (
                              <ul className="ml-3.5 pb-5">
                                {allocs.length === 0 && cNotes === 0 && canPay && cOwes > EPS ? (
                                  addPaymentRow(charge, cOwes, true)
                                ) : allocs.length === 0 && cNotes === 0 ? (
                                  <li className={treeNode(true, "16px")}>
                                    <p className="flex h-8 items-center px-1.5 text-xs text-muted-foreground">
                                      No payments toward this charge yet.
                                    </p>
                                  </li>
                                ) : (
                                  allocs.map((alloc, ai) => {
                                    const p = index.paymentById.get(alloc.payment_id);
                                    const when = p?.paid_at ?? p?.payment_date;
                                    const whole = Number(p?.amount || 0);
                                    const applied = Number(alloc.amount_applied || 0);
                                    const split = Math.abs(whole - applied) > EPS;
                                    const landed = !!p && isLanded(p);
                                    const refund = p ? refundOf(p) : null;
                                    const refunded = p ? refundShare(p, applied, charge.id) : 0;
                                    return (
                                      <li key={alloc.id} className={treeNode(false, "16px")}>
                                        {/* How and when, then HOW MUCH — the amount sits in the same
                                            right-hand column as the charge's own amount above it, so a
                                            charge and its payments line up. */}
                                        {/* The whole row opens the payment's receipt — a hover wash
                                            says so. A payment whose money has not landed (Pending,
                                            Reversed) has no receipt, so its row is not interactive. */}
                                        <div
                                          {...(landed
                                            ? {
                                                role: "button",
                                                tabIndex: 0,
                                                "aria-label": `${paymentLabel(p!)}, ${money(applied)} — open receipt ${receiptNumber(p!.id)}`,
                                                title: `Receipt ${receiptNumber(p!.id)}`,
                                                onClick: () => setReceiptFor(p!),
                                                onKeyDown: (e: React.KeyboardEvent) => {
                                                  if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault();
                                                    setReceiptFor(p!);
                                                  }
                                                },
                                              }
                                            : {})}
                                          className={cn(
                                            "group/pay flex h-8 items-center gap-3 rounded-md px-1.5 text-sm",
                                            landed &&
                                              "cursor-pointer transition-colors duration-200 ease-out hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                                          )}
                                        >
                                          {/* Where it came from: the Stripe / Square mark or the manual
                                              mark, then how — "Link emailed", "At booking", "Auto-charge",
                                              or a manual payment's method ("Cash"). */}
                                          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
                                            {p && <PaymentSourceIcon provider={paymentProvider(p)} />}
                                            <span className="truncate">
                                            {p ? paymentLabel(p) : "Payment"}
                                            {split && ` · of a ${money(whole)} payment`}
                                            {when && ` · ${format(new Date(when), "MMM d")}`}
                                            {/* Only an exception earns a word: Pending, Reversed… */}
                                            {p?.status && !landed && (
                                              <span className="ml-2 text-xs">
                                                <ListStatusText tone={PAYMENT_TONE[p.status] ?? "muted"}>
                                                  {p.status === "Pending" && p.stripe_checkout_session_id
                                                    ? "Link sent · waiting"
                                                    : p.status}
                                                </ListStatusText>
                                              </span>
                                            )}
                                            {/* Preview only: play the customer paying the link. */}
                                            {FINANCES_PREVIEW && p?.status === "Pending" && (
                                              <button
                                                type="button"
                                                className="ml-2 text-xs font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] hover:underline"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  markLinkPaid(p.id);
                                                  toast({ title: "Link paid", description: "The customer paid — it's applied to its lines." });
                                                }}
                                              >
                                                Mark as paid (preview)
                                              </button>
                                            )}
                                            </span>
                                          </span>
                                          {/* The amount, with the receipt icon standing in for the
                                              currency sign. A payment with no receipt shows the plain
                                              figure. */}
                                          {landed ? (
                                            // On hover (or keyboard focus) the figure fades out and
                                            // "View receipt" fades in, in the same place. Both stay
                                            // painted and cross-fade on opacity only — 100ms, faster
                                            // than the app's 200ms on purpose: a swap of words under
                                            // the cursor has to feel instant (Ghulam, Sep 28 2026).
                                            <span className="relative w-28 shrink-0">
                                              <span className="flex items-center justify-end gap-0.5 font-medium tabular-nums text-foreground transition-opacity duration-100 ease-out group-hover/pay:opacity-0 group-hover/pay:ease-in group-focus-visible/pay:opacity-0 motion-reduce:transition-none">
                                                {/* Money in: "+". Refunds, money out, are "−". */}
                                                <span aria-hidden className="mr-1 text-muted-foreground">+</span>
                                                {/* The receipt icon stands in for the currency sign. */}
                                                <Receipt className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                {figure(applied)}
                                              </span>
                                              <span
                                                aria-hidden
                                                className="absolute inset-0 flex items-center justify-end gap-1 text-xs font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] opacity-0 transition-opacity duration-100 ease-in group-hover/pay:opacity-100 group-hover/pay:ease-out group-focus-visible/pay:opacity-100 motion-reduce:transition-none"
                                              >
                                                <Receipt className="h-3.5 w-3.5 shrink-0" />
                                                View receipt
                                              </span>
                                            </span>
                                          ) : (
                                            <span className="w-28 shrink-0 text-right font-medium tabular-nums text-muted-foreground">
                                              {money(applied)}
                                            </span>
                                          )}
                                        </div>
                                        {/* Its refund, if any: money OUT, under the payment it gave
                                            back — the same Stripe / Square / manual mark as payments,
                                            and "−". A split payment's refund is split pro rata. */}
                                        {refund && refunded > EPS && (
                                          <div className="flex h-7 items-center gap-3 px-1.5 text-sm">
                                            <span className="flex min-w-0 flex-1 items-center gap-1.5 pl-3 text-muted-foreground">
                                              <CornerDownRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                                              <PaymentSourceIcon provider={refund.provider} />
                                              <span className="truncate">
                                                {refund.provider === "manual" ? "Manual refund" : "Refund · to card"}
                                                {split && ` · of a ${money(refund.amount)} refund`}
                                                {refund.date && ` · ${format(new Date(refund.date), "MMM d")}`}
                                                {refund.pending && (
                                                  <span className="ml-2 text-xs">
                                                    <ListStatusText tone="warning">Processing</ListStatusText>
                                                  </span>
                                                )}
                                              </span>
                                            </span>
                                            <span className="flex w-28 shrink-0 items-center justify-end gap-0.5 font-medium tabular-nums text-red-600 dark:text-red-400">
                                              <span aria-hidden className="mr-1">−</span>
                                              <Undo2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
                                              {figure(refunded)}
                                              <span className="sr-only"> refunded</span>
                                            </span>
                                          </div>
                                        )}
                                      </li>
                                    );
                                  }).concat(
                                    /* Credit notes: part of the charge forgiven ("1 day not used",
                                       "Deposit returned"). Not money — so no + or −, and a quiet
                                       file-minus mark instead of a provider. */
                                    cCredits.map((cn) => (
                                      <li key={cn.id} className={treeNode(false, "16px")}>
                                        <div className="flex h-8 items-center gap-3 px-1.5 text-sm">
                                          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
                                            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                              <FileMinus className="h-2.5 w-2.5" />
                                            </span>
                                            <span className="truncate">
                                              {cn.number ? `Credit note ${cn.number}` : "Credit note"} · {cn.reason} ·{" "}
                                              {format(parseLocalDate(cn.date), "MMM d")}
                                              {cn.overpaid ? (
                                                <span className="text-emerald-700 dark:text-emerald-400">
                                                  {` · ${money(cn.overpaid)} ${cn.settled === "refund" ? "refunded" : "kept on account"}`}
                                                </span>
                                              ) : null}
                                            </span>
                                          </span>
                                          <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
                                            {money(cn.amount)}
                                          </span>
                                        </div>
                                      </li>
                                    )),
                                    /* Debit notes: the line corrected UP after issue — "+", with
                                       its reason; the original amount above stays as it was. */
                                    cDebits.map((dn) => (
                                      <li key={dn.id} className={treeNode(false, "16px")}>
                                        <div className="flex h-8 items-center gap-3 px-1.5 text-sm">
                                          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
                                            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                              <FilePlus className="h-2.5 w-2.5" />
                                            </span>
                                            <span className="truncate">
                                              Debit note {dn.number} · {dn.reason} · {format(parseLocalDate(dn.date), "MMM d")}
                                            </span>
                                          </span>
                                          <span className="w-28 shrink-0 text-right font-medium tabular-nums">
                                            <span aria-hidden className="mr-1 text-muted-foreground">+</span>
                                            {figure(dn.amount)}
                                          </span>
                                        </div>
                                      </li>
                                    )),
                                    canPay && cOwes > EPS ? [addPaymentRow(charge, cOwes)] : [],
                                    /* Under the rule: what was PAID and kept on this charge (any
                                       refund noted beside it), what was CREDITED, then what
                                       REMAINS: charge − paid − credited. */
                                    <li key="paid" className={treeNode(false, "16px")}>
                                      <div className="flex h-8 items-center gap-3 px-1.5 text-sm">
                                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                          Paid
                                          {chargeRefunded > EPS && (
                                            <span className="text-red-600 dark:text-red-400">
                                              {` · ${money(chargeRefunded)} refunded`}
                                            </span>
                                          )}
                                        </span>
                                        <span className="w-28 shrink-0 border-t border-foreground/30 pt-1 text-right font-medium tabular-nums">
                                          {money(cKept)}
                                        </span>
                                      </div>
                                    </li>,
                                    ...(cCredited > EPS
                                      ? [
                                          <li key="credited" className={treeNode(false, "16px")}>
                                            <div className="flex h-8 items-center gap-3 px-1.5 text-sm">
                                              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Credited</span>
                                              <span className="w-28 shrink-0 text-right font-medium tabular-nums">
                                                {money(cCredited)}
                                              </span>
                                            </div>
                                          </li>,
                                        ]
                                      : []),
                                    <li key="remaining" className={treeNode(true, "16px")}>
                                      <div className="flex h-8 items-center gap-3 px-1.5 text-sm">
                                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Remaining</span>
                                        <span
                                          className={cn(
                                            "w-28 shrink-0 text-right font-semibold tabular-nums",
                                            cOwes > EPS ? AMOUNT_TONE[cState.tone] : LIST_TONES.success,
                                          )}
                                        >
                                          {money(cOwes)}
                                        </span>
                                      </div>
                                    </li>,
                                  )
                                )}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

            </>
          )}
          {/* Pinned under the scrolling body (invoice view only): the invoice's
              three facts as low-toned pills on the left — its type, how much is
              paid, whether it is late — and when it was created on the right. */}
          {!receiptFor && (
            <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone="muted">{entityLabel(invoice)}</Pill>
                <Pill tone={payment.tone}>{payment.label}</Pill>
                {due && <Pill tone={due.tone}>{due.label}</Pill>}
              </div>
              {invoice.created_at && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  Created {format(new Date(invoice.created_at), "MMM d, yyyy")}
                </span>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <EditInvoiceDialog invoice={invoice} open={editOpen} onOpenChange={setEditOpen} />
      <PayInvoiceDialog
        invoice={payFor ? invoice : null}
        index={index}
        currencyCode={currencyCode}
        onlyChargeId={payFor?.only ?? null}
        onOpenChange={(open) => !open && setPayFor(null)}
      />
      <ChangeAmountDialog
        target={changeTarget}
        currencyCode={currencyCode}
        onOpenChange={(open) => !open && setChangeTarget(null)}
      />
      <CancelInvoiceDialog invoice={invoice} owes={owes} open={cancelOpen} onOpenChange={setCancelOpen} />

      {payTarget && (
        <AddPaymentDialog
          open
          onOpenChange={(open) => {
            if (open) return;
            setPayTarget(null);
            queryClient.invalidateQueries({ queryKey: financesQueryKey(tenant?.id) });
          }}
          customer_id={invoice.customer_id ?? undefined}
          vehicle_id={invoice.vehicle_id ?? undefined}
          rental_id={invoice.rental_id ?? undefined}
          defaultAmount={Math.round(payTarget.amount * 100) / 100}
          targetCategories={payTarget.categories}
        />
      )}
    </>
  );
}
