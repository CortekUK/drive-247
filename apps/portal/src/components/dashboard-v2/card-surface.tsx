'use client';

/**
 * The painted background for the top card row, and the row's attention ramp.
 *
 * The top two cards share one brand gradient at different strengths, so the
 * second reads as a lighter print of the first rather than as a second,
 * unrelated purple. The third drops to a flat accent tint — at that lightness a
 * gradient is indistinguishable from a solid, so it would be dead weight.
 *
 * Every value here was chosen on screen with a slider rather than derived, so
 * they are deliberately literal: two layers per card, a colour and a lightener,
 * exactly as they were tuned.
 *
 * Sits at `-z-10`, so the host needs `relative isolate overflow-hidden` and no
 * background class of its own — that puts these layers above the host's own
 * background but below its content, and clips them to the rounded corner.
 *
 * COLOUR: `chart-3` / `chart-5` are NOT Tailwind colour keys in this app —
 * `tailwind.config.ts` extends `colors` with the shadcn set only, so
 * `from-chart-3` would compile to nothing. The tokens themselves do exist
 * (`styles/v2-theme.css` defines `--chart-1..5` under `.v2-theme`, which the
 * root layout puts on <body> for the same gated tenants), so they are referenced
 * as arbitrary values instead.
 */

import { cn } from '@/lib/utils';

export type CardId = 'announcements' | 'needs-you' | 'where-you-stand';

interface Surface {
  /** Opacity of the colour layer, 0–1. */
  heaviness: number;
  /** White laid over the colour to lighten it, 0–1. */
  lighten: number;
  /** Full brand gradient rather than a flat accent tint. */
  gradient: boolean;
}

const SURFACE: Record<CardId, Surface> = {
  announcements: { heaviness: 1, lighten: 0, gradient: true },
  'needs-you': { heaviness: 0.88, lighten: 0.2, gradient: true },
  'where-you-stand': { heaviness: 0.45, lighten: 0.34, gradient: false },
};

export function CardSurface({ cardId }: { cardId: CardId }) {
  const { heaviness, lighten, gradient } = SURFACE[cardId];

  return (
    <>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 -z-10',
          gradient &&
            'bg-gradient-to-br from-[hsl(var(--chart-3))] via-primary to-[hsl(var(--chart-5))]'
        )}
        style={{
          opacity: gradient ? heaviness : undefined,
          backgroundColor: gradient ? undefined : `hsl(var(--primary) / ${heaviness})`,
        }}
      />
      {lighten > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ backgroundColor: `rgba(255, 255, 255, ${lighten})` }}
        />
      )}
    </>
  );
}
