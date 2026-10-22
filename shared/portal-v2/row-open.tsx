import { cn } from "./cn";

/**
 * The open indicator at the end of a table row that opens something in place
 * (a dialog, a sheet, the record). NOT the boxed external-link glyph, which
 * reads as "opens in a new tab" — nothing here does (owner, Oct 22 2026).
 *
 * A chevron in a soft round tint that fades in and travels a few pixels in
 * toward the row's end while the row (`group/row`) is hovered or focused.
 * Absolutely placed: give the last cell `relative` and right padding
 * (ROW_OPEN_CELL) so it sits in room the cell keeps for it.
 */
export const ROW_OPEN_CELL = "relative pr-11";

export function RowOpenIndicator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute right-3 top-1/2 flex size-6 -translate-x-1 -translate-y-1/2 items-center justify-center rounded-full",
        "bg-v2-primary/10 text-v2-primary opacity-0 dark:text-v2-link",
        "transition-[opacity,transform] duration-200 ease-out",
        "group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-visible/row:translate-x-0 group-focus-visible/row:opacity-100",
        "motion-reduce:transition-none",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
        <path d="m9.5 6 6 6-6 6" />
      </svg>
    </span>
  );
}
