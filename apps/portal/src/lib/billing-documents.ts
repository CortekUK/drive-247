/**
 * Invoice and receipt are two different documents, and this decides which one a
 * row actually has.
 *
 * ── the distinction, and why it is not cosmetic ─────────────────────────────
 *
 *   INVOICE — the bill. It exists as soon as Stripe raises it, whether or not
 *             anybody has paid. `stripe_hosted_invoice_url` (view) and
 *             `stripe_invoice_pdf` (download).
 *   RECEIPT — proof it was paid. It exists only once a charge has SUCCEEDED,
 *             and it comes from the charge, not from the invoice:
 *             `stripe_receipt_url`, fetched by `subscription-webhook` on
 *             `invoice.paid`.
 *
 * The rule that matters: a failed or unpaid invoice has a bill and no receipt.
 * Offering a "receipt" for money that never arrived is the one thing this file
 * exists to prevent, so `receipt` is derived from the STORED Stripe URL and
 * never from the status alone — a row marked paid whose receipt never synced
 * still gets no receipt action, because we have nothing real to show.
 *
 * ── statuses ────────────────────────────────────────────────────────────────
 *
 * Stripe's own invoice statuses are `draft | open | paid | void |
 * uncollectible`, and the local table adds nothing. "Overdue" and "Failed" are
 * not statuses Stripe stores — they are an OPEN invoice read against its due
 * date and its retry count — so they are derived here rather than invented as
 * new values nothing would ever write.
 */

export type BillingDocStatus = "paid" | "failed" | "overdue" | "due" | "refunded" | "void";

export interface BillingDocRow {
  status: string;
  due_date: string | null;
  attempt_count: number | null;
  amount_paid: number;
  amount_refunded?: number | null;
  stripe_hosted_invoice_url: string | null;
  stripe_invoice_pdf: string | null;
  stripe_receipt_url: string | null;
}

/**
 * What to call this row's payment state.
 *
 * Order matters. `void` and refunds are terminal facts and win over everything;
 * a failed attempt is more informative than "overdue", which is in turn more
 * informative than a bare "due".
 */
export function billingStatusOf(inv: BillingDocRow): BillingDocStatus {
  const s = (inv.status || "").toLowerCase();

  if (s === "void" || s === "uncollectible") return "void";
  if ((inv.amount_refunded ?? 0) > 0) return "refunded";
  if (s === "paid") return "paid";

  /* Everything below is an OPEN invoice — Stripe has raised the bill and not
     been paid. Which of the three it is depends on the clock and on whether a
     card was actually tried. */
  const attempted = (inv.attempt_count ?? 0) > 0;
  if (attempted) return "failed";

  const due = inv.due_date ? new Date(inv.due_date).getTime() : NaN;
  if (!Number.isNaN(due) && due < Date.now()) return "overdue";

  return "due";
}

export const BILLING_STATUS_LABEL: Record<BillingDocStatus, string> = {
  paid: "Paid",
  failed: "Failed",
  overdue: "Overdue",
  due: "Due",
  refunded: "Refunded",
  void: "Void",
};

/**
 * Quiet pills. Only the two states that need a person to act carry the
 * destructive colour — a page where every row shouts is a page nobody reads,
 * and most rows on a healthy account are simply "Paid".
 */
export const BILLING_STATUS_TONE: Record<BillingDocStatus, string> = {
  paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-destructive/10 text-destructive",
  overdue: "bg-destructive/10 text-destructive",
  due: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  refunded: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  void: "bg-muted text-muted-foreground",
};

/** The documents a row can actually offer. Absent links are absent actions. */
export interface BillingDocuments {
  invoiceView: string | null;
  invoiceDownload: string | null;
  receiptView: string | null;
  /** Stripe's receipt page carries its own print/download; the URL serves both. */
  receiptDownload: string | null;
  hasInvoice: boolean;
  hasReceipt: boolean;
}

export function billingDocumentsOf(inv: BillingDocRow): BillingDocuments {
  const invoiceView = inv.stripe_hosted_invoice_url || null;
  const invoiceDownload = inv.stripe_invoice_pdf || null;

  /* Derived from the STORED URL, never from the status. A row marked paid whose
     receipt never synced has nothing real to show, and a fabricated one would
     be worse than none — see the header. */
  const receipt = inv.stripe_receipt_url || null;

  return {
    invoiceView,
    invoiceDownload,
    receiptView: receipt,
    receiptDownload: receipt,
    hasInvoice: !!(invoiceView || invoiceDownload),
    hasReceipt: !!receipt,
  };
}
