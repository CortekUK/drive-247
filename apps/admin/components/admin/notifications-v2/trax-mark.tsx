'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Trax's mark, as the operator portal draws it (components/trax/trax-greeting
 * TraxMark): an iridescent conic fill and, while working, a soft halo. Built
 * from --primary and --chart-* only. This app has no v2-spin-slow / v2-glow
 * keyframes, so the motion uses Tailwind's own spin and pulse.
 */
const MARK_SIZES = {
  sm: { box: 'size-7', icon: 'size-3.5', halo: '-inset-3' },
  md: { box: 'size-10', icon: 'size-5', halo: '-inset-5' },
} as const;

export function TraxMark({
  size = 'sm',
  animated = false,
  className,
}: {
  size?: keyof typeof MARK_SIZES;
  animated?: boolean;
  className?: string;
}) {
  const s = MARK_SIZES[size];
  return (
    <span
      aria-hidden
      data-slot="trax-mark"
      className={cn('relative isolate inline-flex shrink-0 items-center justify-center rounded-full', s.box, className)}
    >
      {animated && (
        <span
          className={cn(
            'pointer-events-none absolute -z-10 rounded-full opacity-60 blur-xl',
            'bg-[radial-gradient(closest-side,hsl(var(--chart-2)/0.6),hsl(var(--primary)/0.25)_60%,transparent)]',
            'animate-pulse motion-reduce:animate-none',
            s.halo,
          )}
        />
      )}
      <span className="absolute inset-0 overflow-hidden rounded-full shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.55)]">
        {/* Oversized so the square corners never show while it turns. */}
        <span
          className={cn(
            'absolute -inset-1/4',
            'bg-[conic-gradient(from_180deg,hsl(var(--chart-2)),hsl(var(--primary)),hsl(var(--chart-4)),hsl(var(--chart-1)),hsl(var(--chart-2)))]',
            'dark:bg-[conic-gradient(from_180deg,hsl(var(--chart-2)),hsl(var(--chart-3)),hsl(var(--chart-1)),hsl(var(--chart-4)),hsl(var(--chart-2)))]',
            animated && 'animate-[spin_12s_linear_infinite] motion-reduce:animate-none',
          )}
        />
      </span>
      <Sparkles
        className={cn('relative text-primary-foreground drop-shadow-[0_1px_2px_hsl(var(--chart-5)/0.55)]', s.icon)}
        strokeWidth={2}
      />
    </span>
  );
}
