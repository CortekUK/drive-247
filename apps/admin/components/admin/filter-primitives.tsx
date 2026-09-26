'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The Northwind filter vocabulary, ported.
 *
 * Asked for Sep 25 2026: "use that design in super admin" — and the previous
 * attempt had not. It invented its own shapes: a circular toggle sitting BESIDE
 * the search field, and a card that expanded downward on a partial `rotateX`.
 * Northwind does neither. Its toggle lives INSIDE the field, and its filters
 * are the far face of the overview card, which turns over.
 *
 * These are `apps/portal/src/components/shared/filter-primitives.tsx` with the
 * v2 token fallbacks (`--v2-link`, `--v2-hover`) dropped, because this app has
 * no v2 canary — it has one theme per mode and the plain tokens resolve.
 * Nothing else is changed, deliberately: the point is that the two products
 * filter identically, so the divergence should be zero.
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
        'cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? color
            ? ''
            : 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-transparent text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-foreground',
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
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1.5">
        <span className={cn('flex size-5 shrink-0 items-center justify-center rounded', tint)}>
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
    // Plain `border-border`, never a slash modifier on it. Tailwind compiles
    // `border-border/70` to `hsl(var(--border) / 0.7)`, and a token that already
    // carries its own alpha makes that two slashes — an invalid declaration, so
    // `border-color` falls back to `currentcolor` and the panel gets a bright
    // text-coloured outline.
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
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

/**
 * The toggle itself: a 28px square, not a round button with its own standing.
 *
 * Inside a search field it is absolutely placed against the right edge; on a
 * page with nothing to search it stands alone and `standalone` gives it the
 * static positioning and field-height box it needs to sit on a row by itself.
 *
 * The count badge shows only while the panel is SHUT. Open, the chips say it
 * better; shut, this is the one thing on screen telling you the list you are
 * reading is not the whole list.
 */
export function FilterToggle({
  open,
  onOpenChange,
  activeCount = 0,
  standalone = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeCount?: number;
  standalone?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={open ? 'Hide filters' : 'Show filters'}
      aria-pressed={open}
      onClick={() => onOpenChange(!open)}
      className={cn(
        'flex size-7 cursor-pointer items-center justify-center rounded-lg transition-colors',
        standalone ? 'relative shrink-0' : 'absolute right-1.5 top-1/2 -translate-y-1/2',
        open ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary hover:bg-primary/20',
      )}
    >
      <SlidersHorizontal className="size-4" />
      {!open && activeCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
          {activeCount}
        </span>
      )}
    </button>
  );
}

/**
 * The search field with the filter toggle INSIDE it.
 *
 * This is the detail the first attempt got wrong, and it is not cosmetic: a
 * separate round button beside the field reads as a second control with its own
 * standing, while a 28px square tucked against the field's right edge reads as
 * part of the field — "narrow what I am searching". Northwind has always drawn
 * it the second way.
 *
 * `onOpenChange` is optional, because one page (blocked customers) searches
 * without filtering. Left off, the field is drawn on its own and keeps the
 * right-hand padding it would otherwise need for the button — so a page with
 * nothing to filter still wears the same search box as every page that does,
 * rather than a hand-rolled input that happens to look close.
 *
 * Search is debounced before it leaves this component so a page that pushes its
 * query to the URL does not navigate once per keystroke. A page that keeps
 * search in local state passes `debounceMs={0}` and gets every keystroke.
 */
export function FilterSearch({
  value,
  onChange,
  placeholder,
  open = false,
  onOpenChange,
  activeCount = 0,
  debounceMs = 0,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  activeCount?: number;
  debounceMs?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);

  // Keeps the box in step when the page resets search from outside (a Reset
  // press, a cleared query string).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (debounceMs <= 0) return;
    const t = setTimeout(() => {
      if (draft !== value) onChange(draft);
    }, debounceMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, debounceMs]);

  return (
    <div className={cn('group relative w-full sm:max-w-md', className)}>
      {/* The icon is brand-coloured at rest, not grey. In the portal the whole
          field reads as one tinted object — rim, fill and glyph all drawn from
          `primary` — and a grey magnifier in a lavender field breaks that. */}
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
      <Input
        value={debounceMs > 0 ? draft : value}
        onChange={(e) => (debounceMs > 0 ? setDraft(e.target.value) : onChange(e.target.value))}
        placeholder={placeholder}
        /*
         * The lavender fill, taken from the portal's own search field
         * (`top-bar-v2.tsx`, the `FIELD` constant): a 7% wash of `primary`
         * inside a 25% rim, deepening to 10% on hover and focus.
         *
         * Asked for Sep 26 2026 — admin's field was `bg-card`, so it was a
         * white box on a white page and the two products did not look like
         * one. The numbers are copied rather than eyeballed; they are low
         * enough that placeholder text keeps its contrast against the tint.
         */
        className="border-primary/25 bg-primary/[0.07] pl-9 pr-11 shadow-sm transition-colors placeholder:text-muted-foreground/70 hover:border-primary/40 hover:bg-primary/10 focus-visible:border-primary/50 focus-visible:bg-primary/10"
      />
      {onOpenChange && (
        <FilterToggle open={open} onOpenChange={onOpenChange} activeCount={activeCount} />
      )}
    </div>
  );
}
