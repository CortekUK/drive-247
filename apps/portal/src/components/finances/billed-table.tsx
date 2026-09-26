"use client";

/**
 * Billed — one row per bill: a rental's own charges, and one per extension.
 *
 * Total · Paid · Credited · Balance, read left to right as a sum. When the
 * ledger's balance is not what the other three say it should be, the row says
 * "Doesn't add up by $X" rather than quietly showing a number (design §3).
 *
 * An INVOICE-ONLY row (an `invoices` row with no ledger bill behind it) shows
 * the invoice's own total and a dash for Paid, Credited and Balance: it claims
 * no math, because there are no charges to do it with.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { Car, CreditCard, FileText, PanelRightOpen, User } from "lucide-react";
import Link from "next/link";
import {
  LIST_CLASSES,
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
import { stageHref } from "@/components/rentals-v2/rental-detail/stages";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/payment-plans-ui/format";
import { billStatusText, tieOutText } from "@/lib/finances/bills";
import type { BillRow } from "@/lib/finances/types";
import { BILL_TONE, formatListDay } from "./finance-words";
import { canCollectOnBill, customerHref, vehicleHref } from "./finance-rules";
import { MobileFact, MobileRows, RowMenuTrigger } from "./finance-list-bits";

export function billTitle(bill: Pick<BillRow, "rentalRef" | "label" | "onRental">): string {
  return bill.onRental ? `${bill.rentalRef} · ${bill.label}` : bill.label;
}

export function BilledTable({
  bills,
  resetKey,
  currency,
  mayCollect,
  onOpen,
  onCollect,
}: {
  bills: BillRow[];
  resetKey: string;
  currency: string;
  /** `canEdit('payments')`: the row's Send link / Record payment. */
  mayCollect: boolean;
  onOpen: (bill: BillRow) => void;
  onCollect: (bill: BillRow) => void;
}) {
  const rows = useProgressiveRows(bills, resetKey);
  const $ = (c: number) => formatMoney(c, currency);

  return (
    <>
      <div className="hidden sm:block">
        <ListTable rows={rows} minWidth="min-w-[960px]">
          <ListTableHeader>
            <ListHead className="w-[17%]">Bill</ListHead>
            <ListHead className="w-[15%]">Customer</ListHead>
            <ListHead className="w-[9%]">Issued</ListHead>
            <ListHead className="w-[11%] text-right">Total</ListHead>
            <ListHead className="w-[11%] text-right">Paid</ListHead>
            <ListHead className="w-[10%] text-right">Credited</ListHead>
            <ListHead className="w-[12%] text-right">Balance</ListHead>
            <ListHead className="w-[11%]">Status</ListHead>
            <ListHead className="w-[4%] text-right">
              <span className="sr-only">Actions</span>
            </ListHead>
          </ListTableHeader>
          <ListBody>
            {rows.visible.map((bill, i) => {
              const status = billStatusText(bill, currency);
              const mismatch = tieOutText(bill, currency);
              const invoiceOnly = bill.invoiceOnly === true;
              return (
                <ListRow
                  key={bill.key}
                  data-bill-key={bill.key}
                  data-tour={i === 0 ? "finances-row" : undefined}
                  data-tie-out={bill.tiesOut ? "ok" : "mismatch"}
                  data-invoice-only={invoiceOnly ? "" : undefined}
                  onOpen={() => onOpen(bill)}
                >
                  <ListCell>
                    <span className={cn("block truncate", LIST_CLASSES.identifier)} title={billTitle(bill)}>
                      {bill.onRental ? bill.rentalRef : bill.label}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      {bill.onRental && <span className="truncate">{bill.label}</span>}
                      {bill.invoiceNumber && <ListMetaChip>{bill.invoiceNumber}</ListMetaChip>}
                      {bill.invoiceNumber && (bill.invoices?.length ?? 0) > 1 && (
                        <span className="shrink-0" data-more-invoices="" title="This rental has more invoices — open the bill to see them all">
                          +{(bill.invoices?.length ?? 1) - 1}
                        </span>
                      )}
                    </span>
                  </ListCell>
                  <ListCell>
                    <span className={cn("block truncate", LIST_CLASSES.text)} title={bill.customerName}>
                      {bill.customerName}
                    </span>
                    {bill.vehicleReg && <span className="block truncate text-[11px] text-muted-foreground">{bill.vehicleReg}</span>}
                  </ListCell>
                  <ListCell className="tabular-nums">
                    <span className={LIST_CLASSES.text}>{formatListDay(bill.issuedOn) ?? "—"}</span>
                  </ListCell>
                  <ListCell className="text-right tabular-nums">
                    {invoiceOnly ? (
                      <span title="The invoice's own total — no charges on the ledger stand behind it">
                        {$(bill.invoiceTotalCents ?? 0)}
                      </span>
                    ) : (
                      $(bill.totalCents)
                    )}
                  </ListCell>
                  <ListCell className="text-right tabular-nums">{invoiceOnly ? <span className="text-muted-foreground">—</span> : $(bill.paidCents)}</ListCell>
                  <ListCell className="text-right tabular-nums">{!invoiceOnly && bill.creditedCents ? $(bill.creditedCents) : "—"}</ListCell>
                  <ListCell className="text-right tabular-nums">
                    <span className={cn("block", invoiceOnly ? "text-muted-foreground" : LIST_CLASSES.identifier)}>
                      {invoiceOnly ? "—" : $(bill.balanceCents)}
                    </span>
                    {mismatch && (
                      <span data-tie-out-marker="" className={cn("mt-0.5 block text-[11px] font-medium", LIST_TONES.danger)}>
                        {mismatch}
                      </span>
                    )}
                  </ListCell>
                  <ListCell>
                    <span className="block truncate" title={status}>
                      <ListStatusText tone={BILL_TONE[bill.status]}>{status}</ListStatusText>
                    </span>
                  </ListCell>
                  <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <RowMenuTrigger label={`Actions for ${billTitle(bill)}`} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-auto">
                        <DropdownMenuItem onClick={() => onOpen(bill)}>
                          <PanelRightOpen className="h-4 w-4" />
                          {invoiceOnly ? "See the invoice" : "See the whole bill"}
                        </DropdownMenuItem>
                        {mayCollect && canCollectOnBill(bill) && (
                          <DropdownMenuItem onClick={() => onCollect(bill)}>
                            <CreditCard className="h-4 w-4" />
                            Collect {$(bill.balanceCents)}
                          </DropdownMenuItem>
                        )}
                        {bill.onRental && bill.rentalId && (
                          <DropdownMenuItem asChild>
                            <Link href={stageHref(bill.rentalId, "payments")}>
                              <FileText className="h-4 w-4" />
                              Open the rental
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {customerHref(bill.customerId) && (
                          <DropdownMenuItem asChild>
                            <Link href={customerHref(bill.customerId)!} data-row-link="customer">
                              <User className="h-4 w-4" />
                              Open the customer
                            </Link>
                          </DropdownMenuItem>
                        )}
                        {vehicleHref(bill.vehicleId) && (
                          <DropdownMenuItem asChild>
                            <Link href={vehicleHref(bill.vehicleId)!} data-row-link="vehicle">
                              <Car className="h-4 w-4" />
                              Open the vehicle
                            </Link>
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
      </div>

      <MobileRows
        rows={rows.visible}
        keyOf={(b) => b.key}
        onOpen={onOpen}
        label={(b) => `Open ${billTitle(b)}`}
      >
        {(bill) => (
          <>
            <MobileFact primary={billTitle(bill)} secondary={bill.customerName} />
            <MobileFact
              align="right"
              primary={bill.invoiceOnly ? $(bill.invoiceTotalCents ?? 0) : $(bill.balanceCents)}
              secondary={
                <span className={LIST_TONES[bill.tiesOut ? BILL_TONE[bill.status] : "danger"]}>
                  {tieOutText(bill, currency) ?? billStatusText(bill, currency)}
                </span>
              }
            />
          </>
        )}
      </MobileRows>

      <ListFooter rows={rows} one="bill" many="bills" />
    </>
  );
}
