"use client";

/**
 * Upcoming — payments due on a plan: when, how much, and how each is collected.
 *
 * The row menu is the plan's own actions (Send a link · Retry the card ·
 * Record a payment), run through the slice-1 `payment-plan-manage` function.
 * Whether one can be used for THIS payment is decided when it is asked for,
 * against the plan itself, and a refusal says why — never a silent no-op.
 */

import Link from "next/link";
import { CreditCard, FileText, Mail, PanelRightOpen, Wallet } from "lucide-react";
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
import type { UpcomingRow } from "@/lib/finances/types";
import { UPCOMING_METHOD_LABEL, formatListDay, upcomingStatusWords } from "./finance-words";
import type { PlanFix } from "./needs-attention";
import { MobileFact, MobileRows, RowMenuTrigger } from "./finance-list-bits";

export function UpcomingTable({
  upcoming,
  resetKey,
  currency,
  mayAct,
  onOpen,
  onFix,
}: {
  upcoming: UpcomingRow[];
  resetKey: string;
  currency: string;
  /** `canEdit('payments') && canEdit('rentals')` — the plan function asks for rentals. */
  mayAct: boolean;
  onOpen: (row: UpcomingRow) => void;
  onFix: (row: UpcomingRow, fix: PlanFix) => void;
}) {
  const rows = useProgressiveRows(upcoming, resetKey);
  const $ = (c: number) => formatMoney(c, currency);

  return (
    <>
      <div className="hidden sm:block">
        <ListTable rows={rows} minWidth="min-w-[880px]">
          <ListTableHeader>
            <ListHead className="w-[11%]">Due</ListHead>
            <ListHead className="w-[20%]">Customer</ListHead>
            <ListHead className="w-[11%]">Rental</ListHead>
            <ListHead className="w-[12%]">Payment</ListHead>
            <ListHead className="w-[13%] text-right">Amount</ListHead>
            <ListHead className="w-[13%]">How</ListHead>
            <ListHead className="w-[15%]">Status</ListHead>
            <ListHead className="w-[5%] text-right">
              <span className="sr-only">Actions</span>
            </ListHead>
          </ListTableHeader>
          <ListBody>
            {rows.visible.map((u, i) => {
              const status = upcomingStatusWords(u);
              return (
                <ListRow
                  key={u.occurrenceId}
                  data-occurrence-id={u.occurrenceId}
                  data-tour={i === 0 ? "finances-row" : undefined}
                  onOpen={() => onOpen(u)}
                >
                  <ListCell className="tabular-nums">
                    <span className={LIST_CLASSES.text}>{formatListDay(u.effectiveOn ?? u.dueDate) ?? "—"}</span>
                    {u.effectiveOn && u.effectiveOn !== u.dueDate && (
                      <span className="block text-[11px] text-muted-foreground">was {formatListDay(u.dueDate)}</span>
                    )}
                  </ListCell>
                  <ListCell>
                    <span className={cn("block truncate", LIST_CLASSES.text)} title={u.customerName}>
                      {u.customerName}
                    </span>
                  </ListCell>
                  <ListCell className="tabular-nums">
                    <span className={cn("block truncate", LIST_CLASSES.text)}>{u.rentalRef}</span>
                  </ListCell>
                  <ListCell>
                    <ListMetaChip>{u.seqLabel}</ListMetaChip>
                  </ListCell>
                  <ListCell className="text-right tabular-nums">
                    <span className={LIST_CLASSES.identifier}>{$(u.amountCents)}</span>
                  </ListCell>
                  <ListCell>
                    <span className={cn("block truncate", LIST_CLASSES.text)}>{UPCOMING_METHOD_LABEL[u.method] ?? u.method}</span>
                  </ListCell>
                  <ListCell>
                    <span className="block truncate" title={status.label}>
                      <ListStatusText tone={status.tone}>{status.label}</ListStatusText>
                    </span>
                  </ListCell>
                  <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <RowMenuTrigger label={`Actions for ${u.seqLabel} on ${u.rentalRef}`} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-auto">
                        <DropdownMenuItem onClick={() => onOpen(u)}>
                          <PanelRightOpen className="h-4 w-4" />
                          See the whole plan
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={stageHref(u.rentalId, "payments")}>
                            <FileText className="h-4 w-4" />
                            Open the rental
                          </Link>
                        </DropdownMenuItem>
                        {mayAct && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onFix(u, "send_link")}>
                              <Mail className="h-4 w-4" />
                              Send a payment link…
                            </DropdownMenuItem>
                            {u.method === "auto_charge" && (
                              <DropdownMenuItem onClick={() => onFix(u, "retry")}>
                                <CreditCard className="h-4 w-4" />
                                Charge the card now…
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => onFix(u, "record_payment")}>
                              <Wallet className="h-4 w-4" />
                              Record a payment…
                            </DropdownMenuItem>
                          </>
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
        keyOf={(u) => u.occurrenceId}
        onOpen={onOpen}
        label={(u) => `Open ${u.seqLabel} on ${u.rentalRef}`}
      >
        {(u) => {
          const status = upcomingStatusWords(u);
          return (
            <>
              <MobileFact primary={u.customerName} secondary={`${formatListDay(u.effectiveOn ?? u.dueDate) ?? ""} · ${u.seqLabel}`} />
              <MobileFact align="right" primary={$(u.amountCents)} secondary={<span className={LIST_TONES[status.tone]}>{status.label}</span>} />
            </>
          );
        }}
      </MobileRows>

      <ListFooter rows={rows} one="payment" many="payments" />
    </>
  );
}
