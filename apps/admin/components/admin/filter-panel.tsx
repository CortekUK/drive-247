'use client';

/**
 * Filters, folded away until asked for.
 *
 * The pattern is the operator portal's: a filter button beside the search, and
 * the filters themselves on a card that expands under it. Before this, every
 * list page in this app wore its filters permanently — a row of labelled
 * inputs sitting between the page title and the data, on screen whether or not
 * anyone was filtering, pushing the rows an operator actually came to read
 * further down every single visit.
 *
 * ── What it does and does not own ─────────────────────────────────────────
 *
 * It owns the button, the open/closed state, the animation and the card. It
 * owns NO filter state: the page keeps its own `useState` for every value, and
 * hands the controls in as children. Nothing about what a filter does, or when
 * it applies, passes through here — which is what makes this safe to drop onto
 * a working page.
 *
 * `count` is how many filters are currently narrowing the list. The page knows
 * that, this component does not, so the page passes it. It shows as a badge on
 * the button, because filters that are folded away are filters an operator can
 * forget they set — the badge is the thing that stops "why is this list empty".
 *
 * ── The animation ─────────────────────────────────────────────────────────
 *
 * `grid-template-rows: 0fr -> 1fr` with the child at `min-h-0 overflow-hidden`,
 * which animates to the panel's OWN height without anyone measuring it or
 * hardcoding a max-height that clips the day a filter is added. It is the one
 * CSS-only way to transition to `auto`.
 *
 * `motion-reduce` drops the transition, so the panel snaps open for anyone who
 * has asked their system for less movement.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function FilterPanel({
  count = 0,
  children,
  className,
}: {
  /** How many filters are narrowing the list right now. Shown on the button. */
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  /*
   * The card stays mounted so a CSS transition has something to animate, which
   * means its controls are in the document while it is folded away. Without
   * this, Tab walks into a panel nobody can see and focus vanishes.
   *
   * `inert` is set as a DOM property rather than a JSX attribute: React 18
   * does not know it, so `inert={true}` warns and `inert=""` is dropped as
   * falsy. Neither ever reaches the element.
   */
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (cardRef.current) (cardRef.current as unknown as { inert: boolean }).inert = !open;
  }, [open]);

  return (
    <div className={cn('space-y-3', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          'inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors',
          'ring-1 ring-foreground/10 hover:bg-foreground/[0.04]',
          open ? 'bg-primary/10 text-primary ring-primary/20' : 'bg-card text-muted-foreground',
        )}
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        Filters
        {count > 0 && (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground tabular-nums">
            {count}
          </span>
        )}
      </button>

      {/*
        It TURNS OVER rather than sliding down.

        Asked for Sep 25 2026: "it flip the particular area and show filter
        option just like used in northwind rentals". The portal's panel is the
        back face of its overview row and rotates on X; this is the same motion
        for a panel with no front face to turn away from — it comes in edge-on
        and settles flat, so the area reads as turned rather than pushed open.

        A CSS transition, not framer-motion. The first version used
        `AnimatePresence` + `motion.div`, and a frame captured 110ms into the
        turn showed the card already flat: framer 12 drives transforms through
        the Web Animations API, which never produced the rotation here and left
        only the opacity fade. A plain transition is measurable, composited,
        and one dependency lighter.

        `perspective` belongs on the wrapper, never on the element that
        rotates: applied to the rotating element it lands after the transform
        and the depth is lost. That is the detail the portal's own flip warns
        about hardest.

        Height still comes from the 0fr/1fr grid, so nothing measures the
        content and no `max-h` can clip it when a filter is added.
      */}
      <div
        id={panelId}
        style={{ perspective: 1200 }}
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={cardRef}
            aria-hidden={!open}
            /* Hinged on the edge it is attached to. */
            style={{
              transformOrigin: 'top center',
              transform: open ? 'rotateX(0deg)' : 'rotateX(-82deg)',
              /* Inline, not `duration-[420ms]`. The utility class lost to the
                 150ms default that `transition-*` carries — computed style read
                 back 0.15s, which is why a frame captured 120ms into the turn
                 showed the card already flat. An inline duration cannot be
                 out-ordered in the stylesheet. */
              transitionDuration: '420ms',
            }}
            className={cn(
              'relative rounded-4xl bg-card p-5 shadow-sm ring-1 ring-foreground/10',
              'transition-[transform,opacity] ease-out motion-reduce:transition-none',
              open ? 'opacity-100' : 'opacity-0',
            )}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close filters"
              className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One labelled group inside the panel — "STATUS", "PAYMENT", "START DATE
 * RANGE". The caption is the same 11px uppercase `tracking-wider` the table
 * heads use, so a column label and a filter label read as the same rank.
 */
export function FilterGroup({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * A choice inside a group. A pill, not a `<Select>`: the portal's filter panel
 * puts every option on screen at once so the set of states a list can be in is
 * visible without opening anything.
 */
export function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'min-h-8 rounded-full px-3 text-[13px] font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
