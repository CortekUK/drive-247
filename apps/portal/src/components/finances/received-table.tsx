"use client";

/**
 * Received — every payment that came in: where it went, and how to find it.
 *
 * The provider's reference sits on the row (Stripe or Square), and the side
 * panel turns it into a dashboard link where one can honestly be offered
 * (`dashboardLinkFor`). The row menu carries every action the Payments tab
 * had — approve, reject, remove an unpaid link, reverse a hand-recorded
 * payment — plus the refund the rental's Payments stage offers.
 */

import Link from "next/link";
import { CheckCircle, FileText, Link2Off, PanelRightOpen, Undo2, XCircle, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
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
import type { ReceiptRow } from "@/lib/finances/types";
import { RECEIPT_STATUS_LABEL, RECEIPT_TONE, formatListDay, receiptMethodWords } from "./finance-words";
import { canRefund, canRemoveLink, canReverse, canReview } from "./finance-rules";
import { MobileFact, MobileRows, RowMenuTrigger } from "./finance-list-bits";

export type ReceiptAction = "approve" | "reject" | "refund" | "remove_link" | "reverse";

/** The reference as it fits a cell: the tail is what people match on. */
export function shortRef(ref: string | null): string | null {
  if (!ref) return null;
  return ref.length > 14 ? `…${ref.slice(-10)}` : ref;
}

export function ReceivedTable({
  receipts,
  resetKey,
  currency,
  mayAct,
  busy,
  onOpen,
  onAction,
}: {
  receipts: ReceiptRow[];
  resetKey: string;
  currency: string;
  /** `canEdit('payments')`. A read-only user sees every row and no actions. */
  mayAct: boolean;
  /** An approve is on its way. */
  busy: boolean;
  onOpen: (row: ReceiptRow) => void;
  onAction: (row: ReceiptRow, action: ReceiptAction) => void;
}) {
  const rows = useProgressiveRows(receipts, resetKey);
  const $ = (c: number) => formatMoney(c, currency);

  return (
    <>
      <div className="hidden sm:block">
        <ListTable rows={rows} minWidth="min-w-[960px]">
          <ListTableHeader>
            <ListHead className="w-[9%]">Date</ListHead>
            <ListHead className="w-[17%]">Customer</ListHead>
            <ListHead className="w-[10%]">Rental</ListHead>
            <ListHead className="w-[13%] text-right">Amount</ListHead>
            <ListHead className="w-[12%]">Method</ListHead>
            <ListHead className="w-[15%]">Reference</ListHead>
            <ListHead className="w-[14%]">Status</ListHead>
            <ListHead className="w-[5%] text-right">
              <span className="sr-only">Actions</span>
            </ListHead>
          </ListTableHeader>
          <ListBody>
            {rows.visible.map((r) => {
              const status = RECEIPT_STATUS_LABEL[r.status];
              const ref = shortRef(r.providerRef);
              return (
                <ListRow key={r.paymentId} data-payment-id={r.paymentId} onOpen={() => onOpen(r)}>
                  <ListCell className="tabular-nums">
                    <span className={LIST_CLASSES.text}>{formatListDay(r.date) ?? "—"}</span>
                  </ListCell>
                  <ListCell>
                    <span className={cn("block truncate", LIST_CLASSES.text)} title={r.customerName}>
                      {r.customerName}
                    </span>
                    {r.planLabel && (
                      <span className="mt-0.5 block truncate">
                        <ListMetaChip>{r.planLabel}</ListMetaChip>
                      </span>
                    )}
                  </ListCell>
                  <ListCell className="tabular-nums">
                    {r.rentalRef ? (
                      <span className={cn("block truncate", LIST_CLASSES.text)}>{r.rentalRef}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </ListCell>
                  <ListCell className="text-right tabular-nums">
                    <span className={cn("block", LIST_CLASSES.identifier)}>{$(r.amountCents)}</span>
                    {r.refundedCents > 0 && (
                      <span className="block text-[11px] text-muted-foreground">Refunded {$(r.refundedCents)}</span>
                    )}
                    {r.unappliedCents > 0 && r.countsAsReceived && (
                      <span className={cn("block text-[11px]", LIST_TONES.info)}>{$(r.unappliedCents)} not applied</span>
                    )}
                  </ListCell>
                  <ListCell>
                    <span className={cn("block truncate", LIST_CLASSES.text)}>{receiptMethodWords(r)}</span>
                    {r.providerMode === "test" && <span className="block text-[11px] text-muted-foreground">Test mode</span>}
                  </ListCell>
                  <ListCell>
                    {ref ? (
                      <span className="block truncate font-mono text-xs text-muted-foreground" title={r.providerRef ?? undefined}>
                        {ref}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </ListCell>
                  <ListCell>
                    <span className="block truncate" title={status}>
                      <ListStatusText tone={RECEIPT_TONE[r.status]}>{status}</ListStatusText>
                    </span>
                  </ListCell>
                  <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                    <ReceiptMenu row={r} mayAct={mayAct} busy={busy} onOpen={onOpen} onAction={onAction} currency={currency} />
                  </ListCell>
                </ListRow>
              );
            })}
          </ListBody>
        </ListTable>
      </div>

      <MobileRows
        rows={rows.visible}
        keyOf={(r) => r.paymentId}
        onOpen={onOpen}
        label={(r) => `Open the payment from ${r.customerName}`}
      >
        {(r) => (
          <>
            <MobileFact primary={r.customerName} secondary={[formatListDay(r.date), receiptMethodWords(r)].filter(Boolean).join(" · ")} />
            <MobileFact
              align="right"
              primary={$(r.amountCents)}
              secondary={<span className={LIST_TONES[RECEIPT_TONE[r.status]]}>{RECEIPT_STATUS_LABEL[r.status]}</span>}
            />
          </>
        )}
      </MobileRows>

      <ListFooter rows={rows} one="payment" many="payments" />
    </>
  );
}

function ReceiptMenu({
  row,
  mayAct,
  busy,
  currency,
  onOpen,
  onAction,
}: {
  row: ReceiptRow;
  mayAct: boolean;
  busy: boolean;
  currency: string;
  onOpen: (row: ReceiptRow) => void;
  onAction: (row: ReceiptRow, action: ReceiptAction) => void;
}) {
  const review = mayAct && canReview(row);
  const refund = mayAct && canRefund(row);
  const removeLink = mayAct && canRemoveLink(row);
  const reverse = mayAct && canReverse(row);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <RowMenuTrigger label={`Actions for the payment from ${row.customerName}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem onClick={() => onOpen(row)}>
          <PanelRightOpen className="h-4 w-4" />
          See where it went
        </DropdownMenuItem>
        {row.rentalId && (
          <DropdownMenuItem asChild>
            <Link href={stageHref(row.rentalId, "payments")}>
              <FileText className="h-4 w-4" />
              Open the rental
            </Link>
          </DropdownMenuItem>
        )}
        {(review || refund || removeLink || reverse) && <DropdownMenuSeparator />}
        {review && (
          <>
            <DropdownMenuItem disabled={busy} onClick={() => onAction(row, "approve")}>
              <CheckCircle className="h-4 w-4 text-emerald-600" />
              Approve
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onClick={() => onAction(row, "reject")} className="text-red-600 focus:text-red-600">
              <XCircle className="h-4 w-4" />
              Reject…
            </DropdownMenuItem>
          </>
        )}
        {refund && (
          <DropdownMenuItem onClick={() => onAction(row, "refund")}>
            <RotateCcw className="h-4 w-4" />
            Refund up to {formatMoney(row.amountCents - row.refundedCents, currency)}…
          </DropdownMenuItem>
        )}
        {removeLink && (
          <DropdownMenuItem onClick={() => onAction(row, "remove_link")} className="text-red-600 focus:text-red-600">
            <Link2Off className="h-4 w-4" />
            Remove payment link…
          </DropdownMenuItem>
        )}
        {reverse && (
          <DropdownMenuItem onClick={() => onAction(row, "reverse")} className="text-orange-600 focus:text-orange-600">
            <Undo2 className="h-4 w-4" />
            Reverse payment…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
