"use client";

/**
 * Needs attention (design §4) — what happened, in words, and its one-click fixes.
 *
 * Rendered only when there is something in it. Every fix is an EXISTING path:
 *
 *   card declined       Send link · Retry · Record payment   (the plan's own actions)
 *   needs the customer  Send link · Record payment           (the plan's own actions)
 *   awaiting review     Approve · Reject                     (the Payments tab's flow)
 *   possible duplicate  Review → the payments side by side, each with Refund
 *   unapplied credit    Open the customer / the rental, where it can be applied
 *
 * The page owns the dialogs; this list only says which fix was asked for. A
 * read-only user sees every item and every amount, and no buttons that move
 * money — only the ones that open a record.
 */

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/payment-plans-ui/format";
import { LIST_TONES } from "@/components/shared/list-table-v2";
import { stageHref } from "@/components/rentals-v2/rental-detail/stages";
import { sectionHref } from "@/components/customers-v2/customer-detail/sections";
import type { AttentionItem } from "@/lib/finances/types";
import { ATTENTION_LABEL, ATTENTION_TONE } from "./finance-words";

export type PlanFix = "send_link" | "retry" | "record_payment";

export interface AttentionHandlers {
  onPlanFix: (item: AttentionItem, fix: PlanFix) => void;
  onApprove: (paymentId: string) => void;
  onReject: (paymentId: string) => void;
  onReview: (paymentIds: string[]) => void;
  onOpenPayment: (paymentId: string) => void;
}

/** Items shown before "Show all". */
const FIRST = 5;

/** The fixes an item offers, in the order they are drawn. Pure, for tests. */
export function attentionFixes(
  item: AttentionItem,
  may: { payments: boolean; plans: boolean },
): { id: string; label: string; primary?: boolean }[] {
  switch (item.kind) {
    case "card_declined":
      if (!may.plans || !item.occurrenceId || !item.rentalId) return [];
      return [
        { id: "send_link", label: "Send link", primary: true },
        { id: "retry", label: "Retry" },
        { id: "record_payment", label: "Record payment" },
      ];
    case "needs_customer":
      if (!may.plans || !item.occurrenceId || !item.rentalId) return [];
      return [
        { id: "send_link", label: "Send link", primary: true },
        { id: "record_payment", label: "Record payment" },
      ];
    case "awaiting_review":
      if (!item.paymentIds[0]) return [];
      return may.payments
        ? [
            { id: "approve", label: "Approve", primary: true },
            { id: "reject", label: "Reject" },
            { id: "open_payment", label: "Details" },
          ]
        : [{ id: "open_payment", label: "Details" }];
    case "possible_duplicate":
      return item.paymentIds.length ? [{ id: "review", label: "Review", primary: true }] : [];
    case "unapplied_credit":
      return [
        ...(item.customerId ? [{ id: "open_customer", label: "Open customer", primary: !item.rentalId }] : []),
        ...(item.rentalId ? [{ id: "open_rental", label: "Open rental", primary: true }] : []),
      ];
  }
}

export function NeedsAttention({
  items,
  currency,
  mayActOnPayments,
  mayActOnPlans,
  busy,
  handlers,
}: {
  items: AttentionItem[];
  currency: string;
  /** `canEdit('payments')`: approve, reject. */
  mayActOnPayments: boolean;
  /** `canEdit('payments') && canEdit('rentals')`: the plan's own actions (the server asks for rentals). */
  mayActOnPlans: boolean;
  /** An approve is on its way; its buttons wait. */
  busy: boolean;
  handlers: AttentionHandlers;
}) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const shown = showAll ? items : items.slice(0, FIRST);

  const run = (item: AttentionItem, id: string) => {
    switch (id) {
      case "send_link":
      case "retry":
      case "record_payment":
        return handlers.onPlanFix(item, id);
      case "approve":
        return handlers.onApprove(item.paymentIds[0]);
      case "reject":
        return handlers.onReject(item.paymentIds[0]);
      case "open_payment":
        return handlers.onOpenPayment(item.paymentIds[0]);
      case "review":
        return handlers.onReview(item.paymentIds);
    }
  };

  return (
    <section
      aria-labelledby="finances-attention-heading"
      data-finances-attention=""
      className="rounded-2xl bg-card p-4 ring-1 ring-foreground/5 dark:ring-foreground/10"
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <h2 id="finances-attention-heading" className="font-heading text-base font-semibold tracking-tight text-foreground">
          Needs attention
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">{items.length}</span>
      </div>

      <ul className="divide-y divide-foreground/5">
        {shown.map((item) => {
          const fixes = attentionFixes(item, { payments: mayActOnPayments, plans: mayActOnPlans });
          return (
            <li
              key={item.key}
              data-attention-kind={item.kind}
              className="flex flex-col gap-2 px-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className={cn("text-[11px] font-semibold uppercase tracking-wider", LIST_TONES[ATTENTION_TONE[item.kind]])}>
                  {ATTENTION_LABEL[item.kind]}
                </p>
                <p className="mt-0.5 text-sm font-medium text-foreground [overflow-wrap:anywhere]">{item.title}</p>
                {item.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <span className="mr-1 text-sm font-semibold tabular-nums text-foreground">{formatMoney(item.amountCents, currency)}</span>
                {fixes.map((fix) =>
                  fix.id === "open_customer" && item.customerId ? (
                    <Button key={fix.id} asChild size="sm" variant={fix.primary ? "default" : "outline"}>
                      <Link href={sectionHref(item.customerId, "money")}>{fix.label}</Link>
                    </Button>
                  ) : fix.id === "open_rental" && item.rentalId ? (
                    <Button key={fix.id} asChild size="sm" variant={fix.primary ? "default" : "outline"}>
                      <Link href={stageHref(item.rentalId, "payments")}>{fix.label}</Link>
                    </Button>
                  ) : (
                    <Button
                      key={fix.id}
                      type="button"
                      size="sm"
                      variant={fix.primary ? "default" : "outline"}
                      disabled={busy && (fix.id === "approve" || fix.id === "reject")}
                      onClick={() => run(item, fix.id)}
                      data-attention-fix={fix.id}
                    >
                      {fix.label}
                    </Button>
                  ),
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {items.length > FIRST && (
        <div className="px-1 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${items.length}`}
          </Button>
        </div>
      )}
    </section>
  );
}
