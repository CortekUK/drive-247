import { cn } from "./cn";

/**
 * The open indicator at the end of a table row that opens something in place
 * (a dialog, a sheet, the record). NOT the boxed external-link glyph, which
 * reads as "opens in a new tab" — nothing here does (owner, Oct 22 2026).
 *
 * A bare diagonal arrow — no box, no circle (owner, Oct 22 2026, second pass)
 * — that fades in and nudges up-right while the row (`group/row`) is hovered
 * or focused. Absolutely placed: give the last cell `relative` and right
 * padding (ROW_OPEN_CELL) so it sits in room the cell keeps for it.
 */
export const ROW_OPEN_CELL = "relative pr-11";

export function RowOpenIndicator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute right-3 top-1/2 flex size-5 -translate-x-0.5 -translate-y-1/2 items-center justify-center",
        "text-v2-fg opacity-0",
        "transition-[opacity,transform] duration-200 ease-out",
        "group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-visible/row:translate-x-0 group-focus-visible/row:opacity-100",
        "motion-reduce:transition-none",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="size-4">
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </svg>
    </span>
  );
}
