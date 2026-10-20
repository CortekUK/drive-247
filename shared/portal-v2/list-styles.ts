/**
 * The v2 list table's class strings, in the shared `v2-*` colours, for lists
 * outside the operator portal (the customer portal's Bookings table).
 *
 * The operator portal's own strings stay in
 * apps/portal/src/components/shared/list-table-v2.tsx (LIST_CLASSES,
 * LIST_TONES): its rentals list is the reference, and a test there keeps them
 * word for word in step with it. These are the SAME strings with each
 * semantic colour (`text-muted-foreground`) swapped for its shared twin
 * (`text-v2-muted-fg`), which computes to the same colour inside `.v2-theme`.
 * apps/portal/src/__tests__/components/shared-list-styles.test.ts checks that,
 * key by key, so the two cannot drift.
 */

/**
 * The card a list sits in: the operator ui-v2 Card (components/ui-v2/card.tsx)
 * as its lists draw it. No border: white, a 26px radius (`rounded-4xl`, which
 * v2-theme.css resolves to --v2-radius × 2.6), 24px above the heading row and
 * below the last row, `shadow-md` and a 5% hairline ring.
 */
export const V2_LIST_CARD =
  "overflow-hidden rounded-[calc(var(--v2-radius)*2.6)] bg-v2-card py-6 text-sm text-v2-card-fg shadow-md ring-1 ring-v2-fg/5 dark:ring-v2-fg/10";

export const V2_LIST_CLASSES = {
  /** Column headings: small, uppercase, letter-spaced, muted. */
  head: "h-10 text-[11px] font-semibold uppercase tracking-wider text-v2-muted-fg text-left",
  /** The row's identifier: weighted. */
  identifier: "font-semibold tabular-nums tracking-tight text-v2-fg",
  text: "font-medium text-v2-fg",
  /** The quiet line under the card: "All 6 bookings shown". */
  footer: "flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-v2-muted-fg",
} as const;

/**
 * Status is coloured TEXT, never a pill, and hue is the only thing that
 * changes: the operator lists' palette (Available/Active success, Rented and
 * Upcoming info, Paused and Pending warning, Cancelled danger, Completed
 * muted). `brand` is the one addition, for a status the customer portal draws
 * in the portal purple (Upcoming), where the operator lists use blue.
 */
export type V2ListTone = "success" | "info" | "warning" | "danger" | "muted" | "brand";

export const V2_LIST_TONES: Record<V2ListTone, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  info: "text-blue-600 dark:text-blue-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-red-500 dark:text-red-400",
  muted: "text-v2-muted-fg",
  brand: "text-v2-link",
};
