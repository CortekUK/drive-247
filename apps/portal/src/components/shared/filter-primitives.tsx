"use client";

import { type ReactNode } from "react";
import { X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The shared vocabulary for the filter panels: a chip, a labelled section, and
 * the shell they sit in. Kept in one place so every list page filters the same
 * way — the panels differ only in which sections they hand to the shell.
 *
 * New file, no v1 counterpart: nothing in v1 imports this, so adding it cannot
 * change a single rendered pixel for the tenants still on the old filter bar.
 */

/**
 * Pill chip. Tints to its own colour when that colour carries meaning (status
 * chips borrow the same greens and reds the table uses, so the filter reads as
 * the thing it selects), and falls back to the brand accent otherwise.
 */
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
  // Inline rather than a class, because the colour comes from data — the status
  // palette — and Tailwind can only generate classes it can see at build time.
  const style =
    active && color
      ? { backgroundColor: `${color}1a`, color, borderColor: `${color}55` }
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
            ? ""
            : "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

/** One labelled group: a small tinted icon, a mini-label, and its controls. */
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
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {badge}
      </div>
      <div>{children}</div>
    </div>
  );
}

/**
 * The panel shell: a slim Reset · ✕ bar pinned top-right, then the sections in
 * a column grid. `content-center` matters when the shell is given a fixed box
 * to fill — it keeps the sections optically centred rather than top-heavy.
 */
export function FilterShell({
  onClear,
  onClose,
  activeCount = 0,
  children,
}: {
  onClear: () => void;
  onClose: () => void;
  /** Drives whether Reset is offered at all — nothing to reset, nothing to press. */
  activeCount?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="flex shrink-0 items-center justify-end gap-1.5 px-3 pt-2">
        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            <RotateCcw className="mr-1 size-3" />
            Reset
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          onClick={onClose}
          aria-label="Close filters"
          className="size-7 rounded-md"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="grid flex-1 content-center gap-x-8 gap-y-4 px-5 pb-4 pt-1 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    </div>
  );
}
