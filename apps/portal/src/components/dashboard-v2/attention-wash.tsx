'use client';

/**
 * The attention ramp for the top card row.
 *
 * The row reads left to right as most → more → less attention, and colour is
 * what carries that: one accent tint at three intensities, running diagonally
 * out of the card so it stays in the corner rather than creeping under the
 * text. Rank is intensity alone — the whole row stays in one colour family, so
 * urgency inside a card is free to use red without competing with the ramp.
 *
 * Sits at `-z-10`, so the host card needs `relative isolate overflow-hidden`:
 * that puts the wash above the card's own background but below its content,
 * and clips it to the rounded corner.
 */

import { cn } from '@/lib/utils';

export type WashLevel = 'high' | 'medium' | 'low';

/**
 * Hand-tuned per level. `fade` is where the diagonal runs out — a shorter fade
 * on the quieter cards keeps the colour in the corner instead of letting it
 * spread across the whole surface.
 */
const LEVEL: Record<WashLevel, { tint: number; fade: string }> = {
  high: { tint: 0.1, fade: '72%' },
  medium: { tint: 0.075, fade: '62%' },
  low: { tint: 0.04, fade: '52%' },
};

export function AttentionWash({
  hsl,
  level,
  className,
}: {
  /**
   * An HSL triplet, not a full colour — either a token (`var(--primary)`) or a
   * literal (`0 0% 100%`). Alpha is applied here so one wash can sit on a white
   * card and on a brand gradient without a second code path.
   */
  hsl: string;
  level: WashLevel;
  className?: string;
}) {
  const { tint, fade } = LEVEL[level];

  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 -z-10', className)}
      style={{
        backgroundImage: `linear-gradient(to bottom right, hsl(${hsl} / ${tint}), transparent ${fade})`,
      }}
    />
  );
}
