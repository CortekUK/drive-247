'use client';

/**
 * Where bookings come from — the last 90 days, as a square (Sep 27 2026).
 *
 * "Like a pie chart, but the pie is a square" (Ghulam): a treemap. One square,
 * split into tiles whose areas are each source's share of the bookings — the
 * biggest takes a full-height column on the left, the rest share the column
 * beside it, stacked by their own shares. Each tile carries its own name,
 * count and percentage, so there is no legend to cross-reference.
 *
 * Sources as the data can tell them — see `useBookingSources`: the booking
 * site, the operator's own team (phone and walk-in, added in the portal), and
 * Turo.
 */

import type { BookingSource, BookingSources } from '@/hooks/use-dashboard-insights';
import { useMemo } from 'react';
import { Eyebrow } from './ui';
import { buildDemoBookingSources } from './mock';
import { AutoSkeleton } from '@/components/skeleton-v2/auto-skeleton';

const SOURCE: Record<BookingSource, { label: string; hint: string; fill: string; ink: string }> = {
  website: { label: 'Your website', hint: 'Booked and paid online', fill: 'var(--pv-accent)', ink: 'var(--pv-on-accent)' },
  team: {
    label: 'Your team',
    hint: 'Phone and walk-in',
    fill: 'color-mix(in srgb, var(--pv-accent) 22%, var(--pv-paper))',
    ink: 'var(--pv-ink)',
  },
  turo: { label: 'Turo', hint: 'Imported trips', fill: '#12a594', ink: '#fff' },
};

const GAP = 4; // px between tiles

interface Tile {
  key: BookingSource;
  n: number;
  share: number;
  /** Position and size inside the square, in percent. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Lay the sources out in the square. The largest takes a full-height column
 * as wide as its share; the others stack in the remaining column, each as
 * tall as its share of what is left. With three sources that keeps every
 * tile close to square, which is what makes the areas readable.
 */
function layout(counts: Record<BookingSource, number>): Tile[] {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (!total) return [];
  const items = (Object.keys(counts) as BookingSource[])
    .filter((k) => counts[k] > 0)
    .map((k) => ({ key: k, n: counts[k], share: counts[k] / total }))
    .sort((a, b) => b.n - a.n);

  if (items.length === 1) return [{ ...items[0], x: 0, y: 0, w: 100, h: 100 }];

  const [first, ...rest] = items;
  const firstW = first.share * 100;
  const restTotal = rest.reduce((s, r) => s + r.n, 0);
  const tiles: Tile[] = [{ ...first, x: 0, y: 0, w: firstW, h: 100 }];
  let y = 0;
  for (const r of rest) {
    const h = (r.n / restTotal) * 100;
    tiles.push({ ...r, x: firstW, y, w: 100 - firstW, h });
    y += h;
  }
  return tiles;
}

function Square({ counts }: { counts: Record<BookingSource, number> }) {
  const tiles = layout(counts);
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl">
      {tiles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl border border-dashed border-[var(--pv-line)] text-[12px] text-[var(--pv-ink-3)]">
          No bookings yet
        </div>
      )}
      {tiles.map((t) => {
        const s = SOURCE[t.key];
        // Half the gap on each inner edge (not on the square's own border), so
        // every seam between two tiles is GAP wide.
        const inset = (at: number) => (at > 0.01 && at < 99.99 ? GAP / 2 : 0);
        const small = t.w < 34 || t.h < 30;
        return (
          <div
            key={t.key}
            // Under a loading AutoSkeleton each tile is one bone, its colour off.
            data-skeleton-block=""
            title={`${s.label}: ${t.n} bookings · ${Math.round(t.share * 100)}%`}
            className="absolute flex flex-col justify-between overflow-hidden rounded-lg p-3 transition-all duration-700 ease-out motion-reduce:transition-none"
            style={{
              left: `calc(${t.x}% + ${inset(t.x)}px)`,
              top: `calc(${t.y}% + ${inset(t.y)}px)`,
              width: `calc(${t.w}% - ${inset(t.x) + inset(t.x + t.w)}px)`,
              height: `calc(${t.h}% - ${inset(t.y) + inset(t.y + t.h)}px)`,
              background: s.fill,
              color: s.ink,
            }}
          >
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold leading-tight">{s.label}</p>
              {!small && <p className="mt-0.5 truncate text-[11px] leading-tight opacity-75">{s.hint}</p>}
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className={small ? 'text-[18px] font-semibold leading-none tabular-nums' : 'text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums'}>
                {Math.round(t.share * 100)}%
              </span>
              <span className="text-[11px] tabular-nums opacity-75">{t.n}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BookingSourcesCard({ data: loadedData, isLoading }: { data: BookingSources | null; isLoading: boolean }) {
  // While loading, the sample split stands in so the skeleton has the loaded shape.
  const placeholder = useMemo(() => buildDemoBookingSources(), []);
  const data = isLoading ? placeholder : loadedData;
  const counts = data?.counts ?? { website: 0, team: 0, turo: 0 };
  const total = (Object.values(counts) as number[]).reduce((s, n) => s + n, 0);

  return (
    <div className="flex flex-col rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Where bookings come from</Eyebrow>
          <p className="mt-1 text-[12px] text-[var(--pv-ink-3)]">The last {data?.days ?? 90} days</p>
        </div>
        {data && (
          <AutoSkeleton loading={isLoading} className="text-right">
            <p className="text-[24px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--pv-ink)]">{total}</p>
            <p className="mt-1 text-[11px] text-[var(--pv-ink-3)]" data-skeleton-keep>bookings</p>
          </AutoSkeleton>
        )}
      </div>

      {/* A one-column grid, not a flex row: the square's tiles are all
          absolutely positioned, so it has no content width of its own, and
          as a flex item (or a centred grid item) its width collapsed to
          nothing. A stretched minmax(0,1fr) column gives it the card's full
          width on every screen; content-center only centres it vertically. */}
      <div className="mt-5 grid flex-1 grid-cols-[minmax(0,1fr)] content-center">
        {!data ? (
          <div aria-hidden="true" className="aspect-square w-full animate-pulse rounded-xl bg-[var(--pv-wash)] motion-reduce:animate-none" />
        ) : (
          <AutoSkeleton loading={isLoading} className="w-full">
            <Square counts={counts} />
          </AutoSkeleton>
        )}
      </div>
    </div>
  );
}
