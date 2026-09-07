/**
 * Notification categories and severity, DERIVED FROM THE REAL `type` COLUMN.
 *
 * ── why this is a lookup and not a guess ────────────────────────────────────
 *
 * `notifications.type` already carries everything needed. Every value below was
 * read out of the live table, not imagined:
 *
 *   booking_new 16224 · reminder_critical 324 · payment_received 297
 *   booking 258 · rental_extended 141 · signing_completed 112
 *   reminder_warning 100 · reminder_info 91 · chat_message 47
 *   rental_reminder 37 · booking_approved 36 · identity_verified 36
 *   rental_started 33 · payment_verification 20 · rental_completed 20
 *   refund_processed 16 · deposit_hold_failure 15 · fine_new 11
 *   booking_renewed 7 · system 6 · enquiry 5 · bonzah_insufficient_balance 3
 *   deposit_hold_chain_ended 2 · booking_rejected 1
 *
 * So the filters filter real data rather than a category invented to fill a
 * tab, and a type nobody has mapped yet falls to "system" — visible and
 * filterable — instead of vanishing from every filter, which is what a
 * `.filter(t => KNOWN.includes(t))` would have done to it.
 *
 * ── chat_message is deliberately absent ─────────────────────────────────────
 *
 * Messages have their own system, their own screen and their own unread badge.
 * They were a tab in this panel and are now excluded outright — see
 * `isNotificationCentreType`.
 */

export type NotificationCategory = "payments" | "rentals" | "customers" | "system";
export type NotificationSeverity = "critical" | "important" | "normal";

/** Money in, money out, money owed. */
const PAYMENTS = new Set([
  "payment_received",
  "payment_verification",
  "refund_processed",
  "deposit_hold_failure",
  "deposit_hold_chain_ended",
  "fine_new",
  "bonzah_insufficient_balance",
]);

/** The lifecycle of a booking, from taken to signed to handed back. */
const RENTALS = new Set([
  "booking",
  "booking_new",
  "booking_approved",
  "booking_rejected",
  "booking_renewed",
  "rental_started",
  "rental_completed",
  "rental_extended",
  "rental_reminder",
  "signing_completed",
]);

/** Something a person did, or needs doing about a person. */
const CUSTOMERS = new Set(["identity_verified", "enquiry"]);

/**
 * Things that need looking at NOW. Kept deliberately short: severity is only
 * useful while it is rare, and a panel where a third of the rows shout is a
 * panel nobody reads twice.
 */
const CRITICAL = new Set([
  "reminder_critical",
  "deposit_hold_failure",
  "booking_rejected",
  "bonzah_insufficient_balance",
]);

const IMPORTANT = new Set([
  "reminder_warning",
  "payment_verification",
  "fine_new",
  "deposit_hold_chain_ended",
]);

/**
 * Belongs in the notification centre at all?
 *
 * Chat messages do not: they have their own screen, their own realtime channel
 * and their own unread badge in the dock, and showing them here was double
 * counting dressed up as a tab.
 */
export function isNotificationCentreType(type: string | null | undefined): boolean {
  return (type ?? "") !== "chat_message";
}

export function categoryOf(type: string | null | undefined): NotificationCategory {
  const t = type ?? "";
  if (PAYMENTS.has(t)) return "payments";
  if (RENTALS.has(t)) return "rentals";
  if (CUSTOMERS.has(t)) return "customers";
  /* Everything else, INCLUDING TYPES ADDED AFTER THIS FILE. A new type lands in
     System rather than nowhere — the alternative silently hides it from every
     filter including "All", which is how a notification stops existing. */
  return "system";
}

export function severityOf(type: string | null | undefined): NotificationSeverity {
  const t = type ?? "";
  if (CRITICAL.has(t)) return "critical";
  if (IMPORTANT.has(t)) return "important";
  return "normal";
}

/** The tag shown on a row. Short enough to sit beside a timestamp. */
export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  payments: "Payment",
  rentals: "Rental",
  customers: "Customer",
  system: "System",
};

/**
 * One quiet tint per category. No category owns the accent colour: the accent
 * marks the ACTIVE FILTER and unread state, and a row that competes with it
 * makes both harder to see.
 */
export const CATEGORY_TONE: Record<NotificationCategory, string> = {
  payments: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  rentals: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  customers: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  system: "bg-muted text-muted-foreground",
};

export const SEVERITY_LABEL: Record<Exclude<NotificationSeverity, "normal">, string> = {
  critical: "Critical",
  important: "Important",
};

/**
 * Severity is a small pill and a left edge, never a filled red card. The brief
 * for this panel was explicit: critical must stand out without the UI becoming
 * aggressive or noisy.
 */
export const SEVERITY_TONE: Record<Exclude<NotificationSeverity, "normal">, string> = {
  critical: "bg-destructive/10 text-destructive",
  important: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

/** Today / Yesterday / Earlier — the only grouping this panel needs. */
export function dayBucket(iso: string): "today" | "yesterday" | "earlier" {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return "today";
  if (t >= startOfToday - 86_400_000) return "yesterday";
  return "earlier";
}

export const BUCKET_LABEL: Record<"today" | "yesterday" | "earlier", string> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};
