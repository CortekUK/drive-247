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

export const V2_LIST_CLASSES = {
  scrollRoot:
    "p-0 overflow-x-auto max-h-[520px] overflow-y-auto no-scrollbar-from-md relative [&>[data-slot=table-container]]:overflow-visible",
  fillViewport: "md:overscroll-contain",
  header: "sticky top-0 z-10 bg-v2-card/95 backdrop-blur-sm",
  headerRow: "border-b hover:bg-transparent",
  cell: "py-3 text-left",
  metaChip:
    "rounded-full bg-v2-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-v2-muted-fg",
  showMore: "h-7 px-2 text-xs font-normal text-v2-muted-fg hover:text-v2-fg",
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
