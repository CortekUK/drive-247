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
 * ── these arrays are also the DATABASE QUERY ────────────────────────────────
 *
 * The panel does not filter a loaded page in the browser. It cannot: the list
 * is paginated, so a browser-side filter would show "Critical 5" beside a list
 * holding the two criticals that happened to land on page one. The arrays
 * exported here build the PostgREST filter for both the list AND its count
 * (see `notification-filters.ts`), so a pill's number and the rows under it are
 * two answers to one question asked of the same table.
 *
 * That only holds while `categoryOf` / `severityOf` agree with the arrays they
 * are built from, which is not something to take on trust — the test file
 * asserts the agreement for every type in every set, in both directions.
 *
 * ── chat_message is deliberately absent ─────────────────────────────────────
 *
 * Messages have their own system, their own screen and their own unread badge.
 * They were a tab in this panel and are now excluded outright — see
 * `isNotificationCentreType`.
 */

export type NotificationCategory = "payments" | "rentals" | "customers" | "system";
export type NotificationSeverity = "critical" | "normal";

/** Not a notification. It has its own screen, and counting it here doubled it. */
export const CHAT_TYPE = "chat_message";

/** Money in, money out, money owed. */
export const PAYMENT_TYPES = [
  "payment_received",
  "payment_verification",
  "refund_processed",
  "deposit_hold_failure",
  "deposit_hold_chain_ended",
  "fine_new",
  "bonzah_insufficient_balance",
] as const;

/** The lifecycle of a booking, from taken to signed to handed back. */
export const RENTAL_TYPES = [
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
] as const;

/** Something a person did, or needs doing about a person. */
export const CUSTOMER_TYPES = ["identity_verified", "enquiry"] as const;

/**
 * Every type that has a home. "System" is the COMPLEMENT of this, not a list of
 * its own, which is what keeps a type invented next week visible in the panel
 * instead of filtered out of existence.
 */
export const CATEGORISED_TYPES: readonly string[] = [
  ...PAYMENT_TYPES,
  ...RENTAL_TYPES,
  ...CUSTOMER_TYPES,
];

/**
 * CRITICAL — the operator has to act, and acting later costs money or a
 * booking. This list IS the Critical filter:
 *
 *   deposit_hold_failure         the security hold did not go through, and the
 *                                car is due out against nothing
 *   bonzah_insufficient_balance  insurance cannot be bought until the balance
 *                                is topped up, so covered bookings will fail
 *   payment_verification         money arrived but has not cleared; somebody
 *                                has to look at it by hand before handover
 *   reminder_critical            the reminder engine's own top tier — it is
 *                                named critical because it is
 *
 * ── two levels, not three ───────────────────────────────────────────────────
 *
 * There used to be a middle tier ("Important"). A middle tier is a tier nobody
 * can act on: not urgent enough to interrupt, not quiet enough to skip, so it
 * reads as decoration and drags the eye off the rows that ARE urgent. Severity
 * is binary, and everything that was merely Important is Normal — which is what
 * it always behaved like.
 *
 * Kept deliberately short for the same reason: severity is only useful while it
 * is rare. A panel where a third of the rows shout is a panel nobody reads
 * twice. `booking_rejected` is the closest call and is deliberately OUT — by
 * the time it exists a person has already decided, so there is nothing left to
 * do about it now. `fine_new` likewise: money owed, but not money lost today.
 */
export const CRITICAL_TYPES = [
  "deposit_hold_failure",
  "bonzah_insufficient_balance",
  "payment_verification",
  "reminder_critical",
] as const;

/**
 * The same judgement for types this file has never seen.
 *
 * New `notifications.type` values ship from triggers and edge functions
 * regularly, and a failure arriving under a name added after this file was
 * written must not render as calm. So a name that SAYS it failed is treated as
 * critical: `payment_failed`, `webhook_error`, `card_declined`, and whatever
 * the next one is called.
 *
 * Narrow on purpose — failure words only, never `webhook_received` or
 * `payment_received` — because a pattern that over-matches rebuilds the exact
 * problem the middle tier had. Fragments rather than a regex because the
 * DATABASE has to ask the same question: each one becomes a
 * `type.ilike.*fragment*` in the PostgREST filter, which is how the Critical
 * count can include a type this file has never heard of.
 */
export const CRITICAL_NAME_FRAGMENTS = ["fail", "error", "declin", "urgent"] as const;

const PAYMENTS = new Set<string>(PAYMENT_TYPES);
const RENTALS = new Set<string>(RENTAL_TYPES);
const CUSTOMERS = new Set<string>(CUSTOMER_TYPES);
const CRITICAL = new Set<string>(CRITICAL_TYPES);

/**
 * Belongs in the notification centre at all?
 *
 * Chat messages do not: they have their own screen, their own realtime channel
 * and their own unread badge in the dock, and showing them here was double
 * counting dressed up as a tab. A NULL type is NOT a chat message and is kept —
 * the column is nullable, and dropping a row for having no type is how a
 * notification silently stops existing.
 */
export function isNotificationCentreType(type: string | null | undefined): boolean {
  return type !== CHAT_TYPE;
}

export function categoryOf(type: string | null | undefined): NotificationCategory {
  const t = type ?? "";
  if (PAYMENTS.has(t)) return "payments";
  if (RENTALS.has(t)) return "rentals";
  if (CUSTOMERS.has(t)) return "customers";
  /* Everything else, INCLUDING TYPES ADDED AFTER THIS FILE, and including a row
     with no type at all. A new type lands in System rather than nowhere — the
     alternative silently hides it from every filter including "All", which is
     how a notification stops existing. */
  return "system";
}

export function severityOf(type: string | null | undefined): NotificationSeverity {
  const t = (type ?? "").toLowerCase();
  if (CRITICAL.has(t)) return "critical";
  if (CRITICAL_NAME_FRAGMENTS.some((f) => t.includes(f))) return "critical";
  /* Everything else. There is no third level to fall into. */
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
};

/**
 * Severity is a small pill and a hairline left edge, never a filled red card.
 * The brief for this panel was explicit: critical must stand out without the
 * notification centre becoming alarming. So the destructive colour appears at
 * 10% behind a 10px label and as a 3px rule — enough to find the row while
 * scanning, not enough to make the panel feel like an incident report.
 */
export const SEVERITY_TONE: Record<Exclude<NotificationSeverity, "normal">, string> = {
  critical: "bg-destructive/10 text-destructive",
};

/**
 * `created_at` is NULLABLE in this table, `new Date(null)` is 1970, and
 * `new Date("nonsense")` is an Invalid Date — which makes `formatDistanceToNow`
 * THROW, taking the whole panel down with it rather than the one bad row. Every
 * read of the timestamp goes through here, so a bad row costs that row its date
 * and nothing more.
 */
export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Today / Yesterday / Earlier — the only grouping this panel needs. */
export function dayBucket(iso: string | null | undefined): "today" | "yesterday" | "earlier" {
  const d = parseDate(iso);
  /* An undated row sorts to the bottom of a descending list anyway, so
     "Earlier" is where it already is. */
  if (!d) return "earlier";
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
