"use client";

/**
 * The v2 filter panel's parts (apps/portal/src/components/shared/filter-primitives.tsx):
 * a chip per option, a titled section per group (STATUS, USER TYPE …), and the
 * shell around them with Reset and the close button top right. The customer
 * portal's Bookings filters are built from these.
 *
 * A COPY, kept in step by a test. The operator file draws its Reset and close
 * with the operator Button component, which stays in the operator app, so it
 * cannot move here as it is. Every class string below is the operator's, with
 * semantic colours swapped for their shared twins (class-map.ts), and the two
 * buttons use the operator Button's own looks (button-styles.ts).
 * apps/portal/src/__tests__/components/shared-v2-copies.test.ts fails on drift.
 */

import { type CSSProperties, type ReactNode } from "react";
import { RotateCcw, X } from "lucide-react";
import { V2_BUTTON_GHOST_SM, V2_BUTTON_OUTLINE_ICON } from "./button-styles";
import { cn } from "./cn";

/** One option. `color` (a status hex) tints it while chosen, as the operator status chips do. */
export function FilterChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string | null;
  onClick: () => void;
  children: ReactNode;
}) {
  // Inline rather than a class: the colour comes from data. The text reads it
  // through `--chip` so dark mode can lift it 40% toward white.
  const style =
    active && color
      ? ({ backgroundColor: `${color}1a`, borderColor: `${color}55`, "--chip": color } as CSSProperties)
      : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={style}
      className={cn(
        "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? color
            ? "text-[var(--chip)] dark:text-[color-mix(in_srgb,var(--chip)_60%,white)]"
            : "border-v2-primary/40 bg-v2-primary/10 text-v2-primary dark:border-[hsl(var(--v2-link,var(--primary))_/_0.4)] dark:text-[hsl(var(--v2-link,var(--primary)))]"
          : "border-v2-border bg-transparent text-v2-muted-fg hover:border-v2-primary/30 hover:bg-v2-primary/5 hover:text-v2-fg dark:hover:border-[hsl(var(--v2-link,var(--primary))_/_0.3)] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]"
      )}
    >
      {children}
    </button>
  );
}

/** A titled group: a small tinted icon, an uppercase micro-type title, then its chips. */
export function FilterSection({
  icon,
  tint,
  title,
  badge,
  className,
  children,
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  badge?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1.5">
        <span className={cn("flex size-5 shrink-0 items-center justify-center rounded", tint)}>
          {icon}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-v2-muted-fg">
          {title}
        </span>
        {badge}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** The panel: Reset (only while a filter is in force) and the close button top right, sections in a grid. */
export function FilterShell({
  onClear,
  onClose,
  activeCount = 0,
  children,
}: {
  onClear: () => void;
  onClose: () => void;
  activeCount?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[var(--v2-radius-2xl,1rem)] border border-v2-border bg-v2-card shadow-sm">
      <div className="flex shrink-0 items-center justify-end gap-1.5 px-3 pt-2">
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className={cn(V2_BUTTON_GHOST_SM, "h-7 px-2 text-xs text-v2-muted-fg")}
          >
            <RotateCcw className="mr-1 size-3" />
            Reset
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className={cn(V2_BUTTON_OUTLINE_ICON, "size-7 rounded-[calc(var(--v2-radius,var(--radius))_-_2px)]")}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="grid flex-1 content-center gap-x-8 gap-y-4 px-5 pb-4 pt-1 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    </div>
  );
}
