"use client";

/**
 * v2 (northwind): the Invoices tab's table, built from the rentals list's kit
 * (`components/shared/list-table-v2`). No pager: rows arrive 25 at a time as
 * the table scrolls, with one line under the card saying how much is shown.
 *
 * Rows do not open anything. There is no invoice record route, and the v1 row
 * opens nothing either: its only control is the ⋯ menu, which is kept here with
 * the same two items, the same `canEdit('invoices')` gates and the page's own
 * dialog handlers.
 *
 * The progressive-rows hook lives HERE, not on the page, because the table sits
 * inside a Radix `TabsContent` that unmounts when the Payment Requests tab is
 * open. Mounting the hook with its table mounts it with its sentinel.
 */

import { Mail, MoreHorizontal, Trash2 } from "lucide-react";
import { format } from "date-fns";
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
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListRow,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from "@/components/shared/list-table-v2";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import type { useManagerPermissions } from "@/hooks/use-manager-permissions";

/** The fields this table reads. The page's own `Invoice` satisfies it. */
export interface InvoiceRowV2 {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total_amount: number;
  customers: { name: string } | null;
  vehicles: { reg: string; make: string; model: string } | null;
}

const Blank = () => <span className="text-muted-foreground">—</span>;

export function InvoicesTableV2<T extends InvoiceRowV2>({
  invoices,
  resetKey,
  currencyCode,
  canEdit,
  onSendEmail,
  onDelete,
}: {
  /** Every filtered invoice, already in memory: growing the list is a bigger slice. */
  invoices: T[];
  /** Changes with the result set (search, status, dates) and never on a refetch. */
  resetKey: string;
  currencyCode: string;
  canEdit: ReturnType<typeof useManagerPermissions>["canEdit"];
  onSendEmail: (invoice: T) => void;
  onDelete: (invoice: T) => void;
}) {
  const invoiceRows = useProgressiveRows(invoices, resetKey);

  return (
    <>
      <ListTable rows={invoiceRows} minWidth="min-w-[800px]">
        <ListTableHeader>
          <ListHead className="w-[15%]">Invoice #</ListHead>
          <ListHead className="w-[20%]">Customer</ListHead>
          {/* Vehicle gives Amount 3 points: a vehicle cell truncates with its full
              text in a tooltip, while a cut amount loses money with no way back. */}
          <ListHead className="w-[19%]">Vehicle</ListHead>
          <ListHead className="w-[13%]">Invoice date</ListHead>
          <ListHead className="w-[13%]">Due date</ListHead>
          {/* The one money column: right, so the figures stack. */}
          <ListHead className="w-[14%] text-right">Amount</ListHead>
          <ListHead className="w-[6%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {invoiceRows.visible.map((invoice) => {
            const reg = invoice.vehicles?.reg;
            // v1 prints make and model as a second line under the plate. Here
            // they follow the plate on the same line, quieter, so the row stays
            // the height of a rentals row.
            const makeModel = [invoice.vehicles?.make, invoice.vehicles?.model].filter(Boolean).join(" ");

            return (
              <ListRow key={invoice.id}>
                <ListCell>
                  <span className={`block truncate ${LIST_CLASSES.identifier}`} title={invoice.invoice_number}>
                    {invoice.invoice_number}
                  </span>
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
                <ListCell>
                  {reg || makeModel ? (
                    <span className="block truncate" title={[reg, makeModel].filter(Boolean).join(" · ")}>
                      {reg ? <span className={`tabular-nums ${LIST_CLASSES.text}`}>{reg}</span> : <Blank />}
                      {makeModel && <span className="ml-1.5 text-muted-foreground">{makeModel}</span>}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="tabular-nums">
                  {invoice.invoice_date ? (
                    <span className={LIST_CLASSES.text}>{format(parseLocalDate(invoice.invoice_date), "PP")}</span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="tabular-nums">
                  {invoice.due_date ? (
                    <span className={LIST_CLASSES.text}>{format(parseLocalDate(invoice.due_date), "PP")}</span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                {/* Never truncated: an ellipsis here hides money. The cell does not
                    wrap, and 14% holds "AED 123,456.78" at the 944px card. */}
                <ListCell className="text-right tabular-nums">
                  <span className={LIST_CLASSES.text}>
                    {formatCurrency(invoice.total_amount, currencyCode)}
                  </span>
                </ListCell>
                {/* The same menu as v1. Clicks on the trigger and on its items
                    (portalled, but still React children of this cell) stop
                    here, so nothing a row is ever given can fire from them. */}
                <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
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
                      {canEdit('invoices') && (
                        <DropdownMenuItem onClick={() => onSendEmail(invoice)}>
                          <Mail className="h-4 w-4" />
                          Send Email
                        </DropdownMenuItem>
                      )}
                      {canEdit('invoices') && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => onDelete(invoice)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      <ListFooter rows={invoiceRows} one="invoice" many="invoices" />
    </>
  );
}
