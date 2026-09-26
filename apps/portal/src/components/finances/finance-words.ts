/**
 * Finances — every label on the screen, in words an operator uses.
 *
 * Plain language only: never "PAYG", "installment" or "FIFO" (design §2 and
 * the lead's "Show him the math"). Status is coloured TEXT through the v2 list
 * kit's `ListTone`, never a pill. Pure, so a test can pin a label without
 * rendering anything.
 */
import type { ListTone } from "@/components/shared/list-table-v2";
import type {
  AttentionKind,
  BillStatus,
  FinanceView,
  ReceiptRow,
  ReceiptStatus,
  UpcomingMethod,
  UpcomingRow,
} from "@/lib/finances/types";
import type { PeriodKey } from "./finances-url";

export const VIEW_LABEL: Record<FinanceView, string> = {
  billed: "Billed",
  received: "Received",
  upcoming: "Upcoming",
  fines: "Fines",
};

/** One line under each view's name: the question it answers. */
export const VIEW_HINT: Record<FinanceView, string> = {
  billed: "What each rental and extension was charged, what was paid, and what is left.",
  received: "Every payment that came in, where it went, and how to find it at Stripe or Square.",
  upcoming: "Payments due on a plan, by card, emailed link or recorded by hand.",
  fines: "Tolls, tickets and other fines charged to customers.",
};

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: "Today",
  "7d": "7 days",
  month: "This month",
  all: "All",
  custom: "Custom",
};

/* ── Billed ──────────────────────────────────────────────────────────────── */

export const BILL_STATUS_OPTIONS: { value: BillStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "credit", label: "In credit" },
];

export const BILL_TONE: Record<BillStatus, ListTone> = {
  paid: "success",
  open: "info",
  overdue: "danger",
  credit: "muted",
};

/* ── Received ────────────────────────────────────────────────────────────── */

export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = {
  approved: "Received",
  pending_review: "Awaiting review",
  rejected: "Rejected",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
  pending: "Not paid yet",
};

export const RECEIPT_TONE: Record<ReceiptStatus, ListTone> = {
  approved: "success",
  pending_review: "warning",
  rejected: "danger",
  refunded: "muted",
  partially_refunded: "info",
  pending: "muted",
};

export const RECEIPT_STATUS_OPTIONS = (Object.keys(RECEIPT_STATUS_LABEL) as ReceiptStatus[]).map((value) => ({
  value,
  label: RECEIPT_STATUS_LABEL[value],
}));

/** "Stripe", "Square", or the method as recorded ("Cash", "Bank transfer"). */
export function receiptMethodWords(row: Pick<ReceiptRow, "provider" | "method">): string {
  if (row.provider === "stripe") return "Stripe";
  if (row.provider === "square") return "Square";
  const m = (row.method ?? "").trim();
  if (!m) return "Recorded by hand";
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Upcoming ────────────────────────────────────────────────────────────── */

export const UPCOMING_METHOD_LABEL: Record<UpcomingMethod, string> = {
  auto_charge: "Card on file",
  checkout_link: "Emailed link",
  manual: "Recorded by hand",
};

export const UPCOMING_METHOD_OPTIONS = (Object.keys(UPCOMING_METHOD_LABEL) as UpcomingMethod[]).map((value) => ({
  value,
  label: UPCOMING_METHOD_LABEL[value],
}));

const UPCOMING_STATUS: Record<string, { label: string; tone: ListTone }> = {
  scheduled: { label: "Scheduled", tone: "muted" },
  due: { label: "Due", tone: "info" },
  processing: { label: "Going through", tone: "info" },
  partially_paid: { label: "Part paid", tone: "info" },
  requires_action: { label: "Waiting for the customer", tone: "warning" },
  failed: { label: "Declined", tone: "danger" },
};

export const UPCOMING_STATUS_OPTIONS = ["scheduled", "due", "processing", "partially_paid", "requires_action", "failed"].map((value) => ({
  value,
  label: UPCOMING_STATUS[value].label,
}));

/** A plan payment's status in words. A declined one with a retry says when. */
export function upcomingStatusWords(row: Pick<UpcomingRow, "status" | "nextAttemptOn" | "planStatus">): {
  label: string;
  tone: ListTone;
} {
  if (row.planStatus === "paused") return { label: "Plan paused", tone: "muted" };
  const known = UPCOMING_STATUS[row.status];
  if (row.status === "failed" && row.nextAttemptOn) {
    return { label: `Declined · retry ${formatListDay(row.nextAttemptOn) ?? row.nextAttemptOn}`, tone: "danger" };
  }
  return known ?? { label: row.status.replace(/_/g, " "), tone: "muted" };
}

/* ── Needs attention ─────────────────────────────────────────────────────── */

export const ATTENTION_LABEL: Record<AttentionKind, string> = {
  card_declined: "Card declined",
  needs_customer: "Needs the customer",
  awaiting_review: "Awaiting review",
  possible_duplicate: "Possible duplicate",
  unapplied_credit: "Money not yet applied",
};

export const ATTENTION_TONE: Record<AttentionKind, ListTone> = {
  card_declined: "danger",
  needs_customer: "warning",
  awaiting_review: "warning",
  possible_duplicate: "warning",
  unapplied_credit: "info",
};

/* ── Fines ───────────────────────────────────────────────────────────────── */

/** The statuses the fines list filters on (the fines table's own values). */
export const FINE_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "Open", label: "Open" },
  /** Not a stored status: Open or Charged, past its due date (the fines list's own quick filter). */
  { value: "overdue", label: "Overdue" },
  { value: "Charged", label: "Charged" },
  { value: "Paid", label: "Paid" },
  { value: "Waived", label: "Waived" },
  { value: "Appealed", label: "Appealed" },
];

/**
 * A fine's status label, as the fines list prints it: an Open fine past its
 * due date reads "Overdue". Same rule as `FineStatusBadge`.
 */
export function fineStatusWords(status: string | null | undefined, isOverdue: boolean): { label: string; tone: ListTone } {
  const s = status || "Open";
  if (s === "Open") return isOverdue ? { label: "Overdue", tone: "danger" } : { label: "Open", tone: "warning" };
  const tone: Record<string, ListTone> = {
    Paid: "success",
    Charged: "info",
    "Partially Paid": "info",
    Appealed: "info",
    "Appeal Submitted": "info",
    "Appeal Rejected": "danger",
    Waived: "muted",
    "Appeal Successful": "muted",
    Refunded: "muted",
    "Partially Refunded": "muted",
  };
  return { label: s, tone: tone[s] ?? "muted" };
}

/* ── dates ───────────────────────────────────────────────────────────────── */

const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_YEAR = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * "14 Sep", or "14 Sep 2025" when it is not this year — the v2 lists' date.
 * Takes a 'YYYY-MM-DD' calendar day and formats it AS that day (UTC on both
 * sides), so it never slips to the day before west of Greenwich.
 */
export function formatListDay(day: string | null | undefined, thisYear: number = new Date().getFullYear()): string | null {
  if (!day) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  return Number(m[1]) === thisYear ? DAY.format(d) : DAY_YEAR.format(d);
}
