'use client';

/**
 * Insights — the five views, and the switch between them.
 *
 * The sidebar's Portal / Website pill, widened to four: a solid accent pill
 * slides under the chosen view (white icon and label on it, accent on the rest) (200ms ease-out, the app's one motion). The choice is
 * kept in the URL (`?view=`) so a link or a refresh lands on the same view.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type InsightsViewId = 'numbers' | 'pnl' | 'analytics' | 'reports' | 'trax';

// Text only — no icons (Ghulam, 2026-10-02).
const VIEWS: { id: InsightsViewId; label: string }[] = [
  { id: 'numbers', label: 'Numbers' },
  { id: 'pnl', label: 'P&L' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'reports', label: 'Reports' },
  { id: 'trax', label: 'Trax summary' },
];

const isView = (v: string | null): v is InsightsViewId => VIEWS.some((x) => x.id === v);

/** The current view, read from and written to `?view=` without a navigation. */
export function useInsightsView(): [InsightsViewId, (view: InsightsViewId) => void] {
  const [view, setViewState] = useState<InsightsViewId>('numbers');

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('view');
    if (isView(fromUrl)) setViewState(fromUrl);
  }, []);

  const setView = useCallback((next: InsightsViewId) => {
    setViewState(next);
    const url = new URL(window.location.href);
    if (next === 'numbers') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  return [view, setView];
}

export function ViewSwitch({ value, onChange }: { value: InsightsViewId; onChange: (v: InsightsViewId) => void }) {
  /*
   * Tabs as wide as their own label, not four equal columns — equal columns
   * size every tab to "Trax summary" and pad the short ones with air. The
   * pill therefore cannot be a quarter-width slide; it reads the chosen tab's
   * own box (offsetLeft / offsetWidth) and moves and resizes to it. Re-measured
   * on resize, so a font load or zoom never leaves it off its tab.
   */
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const index = Math.max(0, VIEWS.findIndex((v) => v.id === value));

  useLayoutEffect(() => {
    const measure = () => {
      const el = tabs.current[index];
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    tabs.current.forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [index]);

  return (
    <div role="tablist" aria-label="Insights view" className="relative flex rounded-full bg-muted p-0.5">
      {pill ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 left-0 rounded-full bg-primary [transition:transform_200ms_ease-out,width_200ms_ease-out] motion-reduce:transition-none"
          style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
        />
      ) : null}
      {VIEWS.map((v, i) => {
        const active = v.id === value;
        return (
          <button
            key={v.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v.id)}
            className={cn(
              'relative z-10 flex h-7 cursor-pointer items-center rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-200 motion-reduce:transition-none',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              // Chosen: white on the solid accent pill (primary-foreground, so it
              // stays legible on every brand colour in both modes). The rest:
              // the accent itself, with the dark-mode link tone for contrast.
              active
                ? 'text-primary-foreground'
                : 'text-primary hover:text-primary/80 dark:text-[hsl(var(--v2-link,var(--primary)))]',
              // Before the first measure, the chosen tab carries its own fill so
              // nothing flashes unselected.
              active && !pill && 'bg-primary',
            )}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
