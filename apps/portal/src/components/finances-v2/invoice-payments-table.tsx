"use client";

/**
 * Finances → Invoices: one flat row per invoice. Clicking a row opens the
 * invoice sheet, where its charges, their payments and each payment's receipt
 * are shown and managed. See `finance-data.ts` for where each level comes from.
 */

import { useMemo, useState } from "react";
import { Mail, MoreHorizontal, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import {
  LIST_CLASSES,
  LIST_ROW_ACTION,
  LIST_TONES,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListMetaChip,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from "@/components/shared/list-table-v2";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import type { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  EPS,
  dueDateOf,
  dueState,
  invoiceTotals,
  entityLabel,
  isLanded,
  paymentState,
  useFinanceIndex,
  type FinanceInvoice,
  type State,
} from "./finance-data";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui-v2/hover-card";
import { cn } from "@/lib/utils";
import { InvoiceDetailSheet } from "./invoice-detail-sheet";
import { FINANCES_PREVIEW, usePreviewFinance } from "./finance-mock";
import { CopyOnHover } from "./copy-on-hover";
import { PayInvoiceDialog } from "./pay-invoice-dialog";

const Blank = () => <span className="text-muted-foreground">—</span>;

/**
 * Total − Paid = Remaining, as ONE cell that reads as a sum:
 *
 *     $679.10 − $305.60 = $373.50
 *
 * The two inputs are quiet and the answer is the figure that stands out, so
 * the eye lands on what is left to collect — always, including $0.00, at the
 * very right of the row. Owed amounts are a weight heavier. The signs are
 * hidden from screen readers; the cell's label spells the sum out instead.
 */
const Op = ({ children }: { children: string }) => (
  <span aria-hidden className="mx-1.5 text-muted-foreground/50">
    {children}
  </span>
);

/**
 * How wide each figure's slot is, in `ch`: the longest formatted amount in the
 * list, per position. Every row gives its figures slots this wide and right-
 * aligns inside them, so the "−", "=" and each figure stack in straight
 * columns however long a single amount is. `tabular-nums` makes every digit
 * the same width, so equal-length strings are equal width.
 */
export type SumWidths = { total: number; paid: number; remaining: number };

/** Why the remaining figure is the colour it is — the payment status, carried by the number. */
const SUM_TONE: Record<string, string> = {
  Paid: LIST_TONES.success,
  "Part paid": LIST_TONES.warning,
  Unpaid: "text-muted-foreground",
  // The row's red line says cancelled; the figure itself stays quiet.
  Cancelled: "text-muted-foreground",
};

/** What each figure is made of, for the hover explanation. */
/** What each figure is made of: counts, and the paid / credited split of what is settled. */
export type SumDetail = { charges: number; payments: number; paid: number; credited: number };

function AmountSum({ total, paid, remaining, money, widths, status, detail }: {
  total: number;
  paid: number;
  remaining: number;
  money: (n: number) => string;
  widths: SumWidths;
  /** The payment status. It has no column of its own: the answer's colour says it. */
  status: State;
  detail: SumDetail;
}) {
  const cancelled = status.label === "Cancelled";
  const settled = remaining <= EPS;
  const spoken = `${status.label}. Total ${money(total)}, paid ${money(paid)}, remaining ${money(remaining)}`;
  const tone = SUM_TONE[status.label] ?? "text-foreground";

  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span
          tabIndex={0}
          aria-label={spoken}
          className={cn(
            "relative inline-flex cursor-pointer items-baseline whitespace-nowrap rounded tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {/* Cancelled: ONE red line through the sum, overhanging it a little on
              the right. The figures keep their own colours. text-decoration
              would draw a line per figure, each at its own font size's height. */}
          {cancelled && (
            <span
              aria-hidden
              className="pointer-events-none absolute -right-2 left-0 top-1/2 h-px -translate-y-px bg-red-500 dark:bg-red-400"
            />
          )}
          <span
            className="inline-block text-right text-[13px] text-muted-foreground"
            style={{ minWidth: `${widths.total}ch` }}
          >
            {money(total)}
          </span>
          <Op>−</Op>
          <span
            className="inline-block text-right text-[13px] text-muted-foreground"
            style={{ minWidth: `${widths.paid}ch` }}
          >
            {money(paid)}
          </span>
          <Op>=</Op>
          {/* The answer, in the payment status's colour: green paid, amber part
              paid, grey unpaid, red and struck through when cancelled. */}
          <span
            className={cn("inline-block text-right text-[15px]", settled ? "font-medium" : "font-semibold", tone)}
            style={{ minWidth: `${widths.remaining}ch` }}
          >
            {money(remaining)}
          </span>
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-72 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between pb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            How this adds up
          </span>
          <ListStatusText tone={status.tone}>{status.label}</ListStatusText>
        </div>
        <div className="space-y-2 text-sm tabular-nums">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className="font-medium">Total</div>
              <div className="text-xs text-muted-foreground">
                {detail.charges === 0
                  ? "The invoice's own total"
                  : `Sum of ${detail.charges} ${detail.charges === 1 ? "charge" : "charges"}`}
              </div>
            </div>
            <span>{money(total)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className="font-medium">Paid</div>
              <div className="text-xs text-muted-foreground">
                {detail.payments === 0
                  ? "No payments yet"
                  : `From ${detail.payments} ${detail.payments === 1 ? "payment" : "payments"}`}
              </div>
            </div>
            <span>− {money(detail.paid)}</span>
          </div>
          {detail.credited > EPS && (
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <div className="font-medium">Credited</div>
                <div className="text-xs text-muted-foreground">Forgiven by credit notes</div>
              </div>
              <span>− {money(detail.credited)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t pt-2">
            <div>
              <div className="font-semibold">Remaining</div>
              <div className="text-xs text-muted-foreground">
                {cancelled ? "Cancelled: nothing is collected" : settled ? "Nothing left to collect" : "Still to collect"}
              </div>
            </div>
            <span className={cn("font-semibold", tone, cancelled && "line-through")}>{money(remaining)}</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function InvoicePaymentsTable<T extends FinanceInvoice>({
  invoices,
  resetKey,
  currencyCode,
  canEdit,
  onSendEmail,
  onDelete,
}: {
  invoices: T[];
  resetKey: string;
  currencyCode: string;
  canEdit: ReturnType<typeof useManagerPermissions>["canEdit"];
  onSendEmail: (invoice: T) => void;
  onDelete: (invoice: T) => void;
}) {
  const { tenant } = useTenant();
  const invoiceRows = useProgressiveRows(invoices, resetKey);
  const liveIndex = useFinanceIndex(FINANCES_PREVIEW ? undefined : tenant?.id);
  const preview = usePreviewFinance();
  const index = FINANCES_PREVIEW ? preview.index : liveIndex;
  const [openId, setOpenId] = useState<string | null>(null);
  const [payId, setPayId] = useState<string | null>(null);
  const payInvoice = payId ? invoices.find((i) => i.id === payId) ?? null : null;
  // Looked up by id, so the dialog shows fresh figures after a payment refetch.
  const openInvoice = openId ? invoices.find((i) => i.id === openId) ?? null : null;

  const money = (n: number) => formatCurrency(n, currencyCode);

  /** How many separate payments (that landed) paid toward these charges. */
  const paymentCount = (charges: readonly { id: string }[]) => {
    const ids = new Set<string>();
    for (const c of charges) {
      for (const a of index.allocsByCharge.get(c.id) ?? []) {
        const p = index.paymentById.get(a.payment_id);
        if (p && isLanded(p)) ids.add(p.id);
      }
    }
    return ids.size;
  };

  // Slot widths for the sum column, from every invoice in the list (not only
  // the rows on screen), so the columns do not shift as more rows load.
  const sumWidths = useMemo<SumWidths>(() => {
    const w = { total: 0, paid: 0, remaining: 0 };
    for (const invoice of invoices) {
      const { total, settled, owes } = invoiceTotals(invoice, index);
      w.total = Math.max(w.total, money(total).length);
      w.paid = Math.max(w.paid, money(settled).length);
      w.remaining = Math.max(w.remaining, money(owes).length);
    }
    return w;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, index, currencyCode]);

  return (
    <>
      <ListTable rows={invoiceRows} minWidth="min-w-[960px]">
        <ListTableHeader>
          <ListHead className="w-[14%]">Invoice #</ListHead>
          {/* What the invoice is FOR, and WHICH one: the rental (R-1041,
              R-1041 · Ext 2) or, for a Standalone, the customer account (C-0042). */}
          <ListHead className="w-[10%]">Entity</ListHead>
          <ListHead className="w-[13%]">Entity ref</ListHead>
          <ListHead className="w-[15%]">Customer</ListHead>
          {/* No status columns. The payment status is the remaining figure's
              colour (AmountSum); the time status is this date's colour — red
              when overdue, normal otherwise. The issue date is in the dialog. */}
          <ListHead className="w-[11%]">Due date</ListHead>
          {/* The sum sits at the very right of the row: the last thing the eye
              reaches, and the answer is its last figure. */}
          <ListHead className="w-[29%] text-right">
            {/* The same slots as the cells, so each heading sits over its
                figure. The widths are in the cells' own type sizes (13px and
                15px), restated for this 11px heading. */}
            <span className="inline-flex items-baseline whitespace-nowrap">
              <span className="inline-block text-right" style={{ minWidth: `${(sumWidths.total * 13) / 11}ch` }}>Total</span>
              <Op>−</Op>
              <span className="inline-block text-right" style={{ minWidth: `${(sumWidths.paid * 13) / 11}ch` }}>Paid</span>
              <Op>=</Op>
              <span className="inline-block text-right" style={{ minWidth: `${(sumWidths.remaining * 15) / 11}ch` }}>Remaining</span>
            </span>
          </ListHead>
          <ListHead className="w-[8%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {invoiceRows.visible.map((invoice) => {
            const { charges, total, paid, credited, settled, owes } = invoiceTotals(invoice, index);
            const payment = paymentState(total, settled, invoice.status === "cancelled", invoice.status === "draft");
            const due = dueState(invoice, charges, owes);
            const cancelled = invoice.status === "cancelled";
            // While money is owed, the date that matters is the earliest unpaid
            // charge's (an extension carries its own); once settled, the
            // invoice's own due date.
            const dueDate = owes > EPS && !cancelled ? dueDateOf(invoice, charges) : invoice.due_date;
            const overdue = due?.tone === "danger";

            return (
              <ListRow
                key={invoice.id}
                onOpen={() => setOpenId(invoice.id)}
                className="group/copy"
                aria-label={cancelled ? `Invoice ${invoice.invoice_number}, cancelled` : undefined}
              >
                <ListCell>
                  {/* The number, and a copy button that appears on row hover. */}
                  <span className="flex min-w-0 items-center gap-1">
                    <span className={`truncate ${LIST_CLASSES.identifier}`} title={invoice.invoice_number}>
                      {invoice.invoice_number}
                    </span>
                    <CopyOnHover value={invoice.invoice_number} label="Copy invoice number" />
                  </span>
                </ListCell>
                <ListCell>
                  <ListMetaChip>{entityLabel(invoice)}</ListMetaChip>
                </ListCell>
                <ListCell>
                  {invoice.entity_ref ? (
                    <span className={`block truncate tabular-nums ${LIST_CLASSES.text}`} title={invoice.entity_ref}>
                      {invoice.entity_ref}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {invoice.customers?.name ? (
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={invoice.customers.name}>
                      {invoice.customers.name}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="tabular-nums">
                  {dueDate ? (
                    <span
                      className={cn(
                        "font-medium",
                        cancelled ? "text-muted-foreground" : overdue ? LIST_TONES.danger : "text-foreground",
                      )}
                      title={due?.label}
                    >
                      {format(parseLocalDate(dueDate.slice(0, 10)), "PP")}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="text-right">
                  <AmountSum
                    total={total}
                    paid={settled}
                    remaining={owes}
                    money={money}
                    widths={sumWidths}
                    status={payment}
                    detail={{ charges: charges.length, payments: paymentCount(charges), paid, credited }}
                  />
                </ListCell>
                <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <span className="inline-flex items-center justify-end gap-1">
                  {/* Pay — on hover, on every invoice that still owes money
                      (not drafts, not cancelled). */}
                  {FINANCES_PREVIEW &&
                    canEdit("payments") &&
                    owes > EPS &&
                    invoice.status !== "cancelled" &&
                    invoice.status !== "draft" && (
                      <Button
                        size="sm"
                        className="h-7 rounded-full px-3 text-xs opacity-0 transition-opacity duration-200 ease-out group-hover/copy:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
                        onClick={() => setPayId(invoice.id)}
                      >
                        Pay
                      </Button>
                    )}
                  {canEdit("invoices") && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={LIST_ROW_ACTION}
                          aria-label={`Actions for invoice ${invoice.invoice_number}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-auto">
                        <DropdownMenuItem onClick={() => onSendEmail(invoice)}>
                          <Mail className="h-4 w-4" />
                          Send Email
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => onDelete(invoice)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  </span>
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      <ListFooter rows={invoiceRows} one="invoice" many="invoices" />

      <PayInvoiceDialog
        invoice={payInvoice}
        index={index}
        currencyCode={currencyCode}
        onOpenChange={(open) => !open && setPayId(null)}
      />
      <InvoiceDetailSheet
        invoice={openInvoice}
        index={index}
        currencyCode={currencyCode}
        canEdit={canEdit}
        onOpenChange={(open) => !open && setOpenId(null)}
        onDelete={(inv) => {
          setOpenId(null);
          onDelete(inv as T);
        }}
      />
    </>
  );
}
