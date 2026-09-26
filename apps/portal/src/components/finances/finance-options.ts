/**
 * The status and method choices each Finances view offers — one definition,
 * used by the page's filter panel and by `ScopedFinances`' filter bar. Pure.
 */
import { receiptMethodOptions } from "@/lib/finances/filters";
import type { FinanceView, ReceiptRow } from "@/lib/finances/types";
import type { PanelOption } from "./finances-filter-panel";
import {
  AUTO_APPROVED_OPTION,
  BILL_STATUS_OPTIONS,
  BILL_TONE,
  DRAFT_BILL_OPTION,
  FINE_STATUS_OPTIONS,
  PAYMENT_REQUESTS_OPTION,
  RECEIPT_STATUS_OPTIONS,
  RECEIPT_TONE,
  UPCOMING_METHOD_OPTIONS,
  UPCOMING_STATUS_OPTIONS,
  fineStatusWords,
  upcomingStatusWords,
} from "./finance-words";

/**
 * A view's statuses, each tinted as the list paints it.
 *
 *   billed     Open · Overdue · Paid · In credit (+ Draft, only when an
 *              invoice-only row exists — nothing else can carry it)
 *   received   the receipt statuses · Auto-approved · Payment requests
 *   upcoming   the plan payment statuses
 *   fines      the fines statuses, and the fines tab's two quick filters
 */
export function statusOptionsFor(view: FinanceView, opts: { hasInvoiceOnly?: boolean } = {}): PanelOption[] {
  switch (view) {
    case "billed":
      return [...BILL_STATUS_OPTIONS, ...(opts.hasInvoiceOnly ? [DRAFT_BILL_OPTION] : [])].map((o) => ({ ...o, tone: BILL_TONE[o.value] }));
    case "received":
      return [
        ...RECEIPT_STATUS_OPTIONS.map((o) => ({ ...o, tone: RECEIPT_TONE[o.value] })),
        { ...AUTO_APPROVED_OPTION, tone: RECEIPT_TONE.approved },
        PAYMENT_REQUESTS_OPTION,
      ];
    case "upcoming":
      return UPCOMING_STATUS_OPTIONS.map((o) => ({
        ...o,
        tone: upcomingStatusWords({ status: o.value, nextAttemptOn: null, planStatus: "active" }).tone,
      }));
    case "fines":
      return FINE_STATUS_OPTIONS.map((o) => ({ ...o, tone: o.value === "overdue" ? "danger" : fineStatusWords(o.value, false).tone }));
  }
}

/** A view's methods: processors and the methods recorded on Received, collection methods on Upcoming, none elsewhere. */
export function methodOptionsFor(view: FinanceView, receipts: readonly ReceiptRow[]): PanelOption[] {
  if (view === "upcoming") return UPCOMING_METHOD_OPTIONS;
  if (view !== "received") return [];
  const recorded = receiptMethodOptions([...receipts]).map((m) => ({ value: m, label: m }));
  return [{ value: "stripe", label: "Stripe" }, { value: "square", label: "Square" }, ...recorded];
}
