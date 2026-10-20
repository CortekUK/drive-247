"use client";

/**
 * A list page's search field, as the operator top bar draws it when a page
 * lends it one (apps/portal/src/components/shared/layout/top-bar-v2.tsx, the
 * `slot ?` branch). The customer portal's shell draws this for Bookings.
 *
 * A COPY, kept in step by a test. The operator field lives inside top-bar-v2,
 * the top bar on every v2 admin page, and extracting it is its own piece of
 * work (GitHub issue #32). Until then this reproduces it: every class string is
 * the operator's, with semantic colours swapped for their shared twins
 * (class-map.ts), and apps/portal/src/__tests__/components/shared-v2-copies.test.ts
 * fails if top-bar-v2's field changes without this one.
 *
 * Behaviour, as on the operator bar:
 *   - the field filters the page's own list as you type (pushed 400ms after
 *     the last keystroke, through the page's registration);
 *   - the scope chip ("in Bookings") says what it filters; its × searches
 *     everything instead;
 *   - the filter button opens the page's filter panel and, while it is shut,
 *     carries the number of filters in force;
 *   - with a term in the field, a "Search everywhere" row under it (click, or
 *     ⌘↵) hands the term to global search; with the field empty, a ⌘K key does.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Search, SlidersHorizontal, X } from "lucide-react";
import type { PageSearchRegistration } from "./page-search-slot";

const FIELD =
  "group relative flex h-8 w-full max-w-[380px] items-center gap-2 overflow-hidden rounded-full " +
  "border border-v2-primary/25 bg-v2-primary/[0.07] px-2.5 text-left backdrop-blur-[2px] transition-colors " +
  "hover:border-v2-primary/40 hover:bg-v2-primary/10 " +
  "dark:hover:border-[hsl(var(--v2-link,var(--primary))_/_0.4)] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:focus-visible:bg-[hsl(var(--v2-hover,var(--muted)))] " +
  "focus-visible:border-v2-primary/50 focus-visible:bg-v2-primary/10 focus-visible:outline-none " +
  "focus-visible:ring-3 focus-visible:ring-v2-ring/30";

export function SearchField({
  slot,
  onSearchEverywhere,
}: {
  slot: PageSearchRegistration;
  /** Opens global search seeded with the term ("" from the ⌘K key). */
  onSearchEverywhere: (q: string) => void;
}) {
  const [term, setTerm] = useState(slot.value ?? "");
  const [fieldFocused, setFieldFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(slot);
  latest.current = slot;

  // A different page lending the field starts it fresh.
  useEffect(() => {
    setTerm(slot.value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.placeholder]);

  // The page's own value changing elsewhere (a "clear" on the page) shows here.
  useEffect(() => {
    setTerm((current) => (current.trim() === (slot.value ?? "").trim() ? current : slot.value ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.value]);

  // Filter as you type: pushed 400ms after the last keystroke, as on the operator bar.
  useEffect(() => {
    if (term === (latest.current.value ?? "")) return;
    const timer = setTimeout(() => latest.current.onChange(term), 400);
    return () => clearTimeout(timer);
  }, [term]);

  const searchEverywhere = (q: string) => {
    onSearchEverywhere(q.trim());
    inputRef.current?.blur();
  };

  const trimmed = term.trim();
  const noLocalMatch = trimmed !== "" && term === (slot.value ?? "") && slot.resultCount === 0;
  const showEverywhere = trimmed !== "" && (fieldFocused || noLocalMatch);

  return (
    <div className="relative w-full max-w-[440px]">
      <div className={`${FIELD} max-w-none`} data-tour={slot.tourAnchor}>
        <Search className="size-4 shrink-0 text-v2-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden />
        {slot.scopeLabel && (
          <span className="flex shrink-0 items-center gap-1 rounded-[calc(var(--v2-radius,var(--radius))_-_2px)] border border-v2-primary/30 bg-v2-bg/70 py-0.5 pl-1.5 pr-0.5 text-[11px] font-medium text-v2-fg dark:bg-[hsl(var(--v2-hover,var(--muted)))]">
            <span className="text-v2-muted-fg">in</span>
            {slot.scopeLabel}
            <button
              type="button"
              onClick={() => searchEverywhere(term)}
              aria-label={`Remove ${slot.scopeLabel} filter and search everything`}
              className="flex size-4 cursor-pointer items-center justify-center rounded text-v2-muted-fg transition-colors hover:bg-v2-primary/15 hover:text-v2-fg"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => setFieldFocused(true)}
          onBlur={() => setFieldFocused(false)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && trimmed) {
              e.preventDefault();
              searchEverywhere(term);
            } else if (e.key === "Escape") {
              inputRef.current?.blur();
            }
          }}
          placeholder={slot.placeholder}
          aria-label={slot.placeholder}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-v2-fg outline-none placeholder:text-[hsl(var(--v2-muted-on-tint,var(--muted-foreground)))]"
        />
        {slot.filters && (
          <button
            type="button"
            aria-label={slot.filters.open ? "Hide filters" : "Show filters"}
            aria-pressed={slot.filters.open}
            onClick={() => slot.filters!.onOpenChange(!slot.filters!.open)}
            className={
              "relative flex h-6 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[calc(var(--v2-radius,var(--radius))_-_2px)] transition-colors " +
              (slot.filters.open
                ? "bg-v2-primary text-v2-primary-fg"
                : "bg-v2-primary/10 text-v2-primary hover:bg-v2-primary/20 dark:text-[hsl(var(--v2-link,var(--primary)))] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]")
            }
          >
            <SlidersHorizontal className="size-4" />
            {!slot.filters.open && slot.filters.activeCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-v2-primary text-[9px] font-semibold leading-none text-v2-primary-fg">
                {slot.filters.activeCount}
              </span>
            )}
          </button>
        )}
        {!trimmed && (
          <button
            type="button"
            onClick={() => searchEverywhere("")}
            aria-label="Search everything"
            className="hidden shrink-0 cursor-pointer rounded-[calc(var(--v2-radius,var(--radius))_-_2px)] bg-v2-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-v2-primary hover:bg-v2-primary/25 dark:text-[hsl(var(--v2-link,var(--primary)))] sm:block"
          >
            ⌘K
          </button>
        )}
      </div>
      {showEverywhere && (
        <button
          type="button"
          // mousedown, not click: the row shows only while the field has focus,
          // and a click would blur the field (hiding the row) before it lands.
          onMouseDown={(e) => {
            e.preventDefault();
            searchEverywhere(term);
          }}
          className={
            "absolute left-0 right-0 top-[calc(100%+6px)] z-50 flex cursor-pointer items-center gap-2 rounded-[var(--v2-radius-xl,0.75rem)] border bg-v2-card px-3 py-2 text-left text-[13px] shadow-sm transition-colors hover:bg-v2-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] " +
            (noLocalMatch ? "border-v2-primary/40" : "border-v2-border")
          }
        >
          <ArrowUpRight className="size-4 shrink-0 text-v2-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-v2-fg">
            {noLocalMatch && (
              <span className="text-v2-muted-fg">
                No {slot.scopeLabel ? slot.scopeLabel.toLowerCase() : "results"} match —{" "}
              </span>
            )}
            Search everywhere for <span className="font-semibold">&ldquo;{trimmed}&rdquo;</span>
          </span>
          <kbd className="shrink-0 rounded-full bg-v2-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-v2-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
            ⌘↵
          </kbd>
        </button>
      )}
    </div>
  );
}
