'use client';

/**
 * A miniature portal that repaints instantly as a tenant tries colours.
 *
 * This is the highest-leverage component on the Appearance screen. Without it a
 * tenant saves, navigates away, decides they dislike it, and messages support.
 * With it they self-serve in seconds.
 *
 * It renders the four surfaces where brand colour actually shows up — sidebar,
 * a primary button, a stat card, and a table row with a badge — because those
 * are where a bad colour first becomes obvious.
 *
 * Deliberately *not* wired to the live theme: every colour is applied inline to
 * this subtree only, so hovering a preset can never repaint the real portal or
 * leave a half-applied theme behind if the tenant navigates away.
 */

import { readableForegroundOn, shade } from '@/lib/appearance/color';
import { cn } from '@/lib/utils';

interface PortalPreviewProps {
  /** Brand colour for the mode being previewed. */
  primary: string;
  /** Sidebar / deep surface colour. */
  secondary: string;
  accent: string;
  background: string;
  mode: 'light' | 'dark';
  className?: string;
}

export function PortalPreview({
  primary,
  secondary,
  accent,
  background,
  mode,
  className,
}: PortalPreviewProps) {
  const isDark = mode === 'dark';

  const onPrimary = readableForegroundOn(primary);
  const onSidebar = readableForegroundOn(secondary);

  const surface = isDark ? shade(background, 0.06) : '#FFFFFF';
  const border = isDark ? shade(background, 0.14) : '#E9EDF2';
  const text = isDark ? '#F1F5F9' : '#0F172A';
  const muted = isDark ? '#94A3B8' : '#64748B';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border shadow-sm select-none',
        className
      )}
      style={{ background, borderColor: border }}
      aria-label={`Portal preview in ${mode} mode`}
    >
      <div className="flex h-[248px]">
        {/* Sidebar */}
        <div
          className="flex w-[86px] shrink-0 flex-col gap-1.5 p-2.5"
          style={{ background: secondary }}
        >
          <div
            className="mb-1.5 h-4 w-full rounded"
            style={{ background: onSidebar, opacity: 0.22 }}
          />
          <div
            className="flex items-center gap-1.5 rounded px-1.5 py-1"
            style={{ background: primary }}
          >
            <div
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: onPrimary }}
            />
            <div
              className="h-1 flex-1 rounded"
              style={{ background: onPrimary, opacity: 0.9 }}
            />
          </div>
          {[0.5, 0.36, 0.42, 0.3].map((opacity, i) => (
            <div key={i} className="flex items-center gap-1.5 px-1.5 py-1">
              <div
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: onSidebar, opacity }}
              />
              <div
                className="h-1 flex-1 rounded"
                style={{ background: onSidebar, opacity }}
              />
            </div>
          ))}
        </div>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
          {/* Header row: title + primary action */}
          <div className="flex items-center justify-between gap-2">
            <div
              className="h-2.5 w-24 rounded"
              style={{ background: text, opacity: 0.85 }}
            />
            <div
              className="rounded px-2.5 py-1 text-[7px] font-semibold"
              style={{ background: primary, color: onPrimary }}
            >
              New rental
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: 'Active', value: '18' },
              { label: 'Due today', value: '4' },
              { label: 'Revenue', value: '£9.2k' },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className="rounded border p-1.5"
                style={{ background: surface, borderColor: border }}
              >
                <div
                  className="text-[6px]"
                  style={{ color: muted }}
                >
                  {stat.label}
                </div>
                <div
                  className="text-[10px] font-semibold leading-tight"
                  style={{ color: i === 0 ? primary : text }}
                >
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div
            className="flex-1 overflow-hidden rounded border"
            style={{ background: surface, borderColor: border }}
          >
            <div
              className="flex items-center gap-2 px-2 py-1.5"
              style={{ background: primary, opacity: 0.1 }}
            >
              <div className="h-1 w-10 rounded" style={{ background: primary }} />
              <div className="h-1 w-8 rounded" style={{ background: primary, opacity: 0.6 }} />
            </div>
            {[
              { badge: 'Active', tint: accent },
              { badge: 'Booked', tint: primary },
              { badge: 'Due', tint: accent },
            ].map((row, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 px-2 py-1.5"
                style={{
                  borderTop: i === 0 ? undefined : `1px solid ${border}`,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ background: accent, opacity: 0.35 }}
                  />
                  <div
                    className="h-1 w-14 rounded"
                    style={{ background: text, opacity: 0.5 }}
                  />
                </div>
                <div
                  className="rounded-full px-1.5 py-0.5 text-[6px] font-medium"
                  style={{
                    background: `${row.tint}22`,
                    color: row.tint,
                  }}
                >
                  {row.badge}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
