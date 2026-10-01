'use client';

/**
 * Trax's pencilled note in the margin of a card.
 *
 * The only handwritten text on the dashboard, and meant to stay rare: at most
 * one per card, one sentence, always the single thing Trax would do next. The
 * rest of the card is the facts; this is the opinion. Setting it by hand is
 * what tells the two apart without a label.
 *
 * First person, no emojis (Trax is the voice of the app).
 */

import type { ReactNode } from 'react';
import { Caveat } from 'next/font/google';
import { cn } from '@/lib/utils';

const hand = Caveat({ subsets: ['latin'], weight: ['500', '600'], display: 'swap' });

export function MarginNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        hand.className,
        'origin-left -rotate-[0.8deg] px-6 pb-4 pt-3 text-[19px] font-medium leading-[1.15] text-[var(--pv-accent-ink)]',
        className
      )}
    >
      {children}
      <span className="ml-2 whitespace-nowrap text-[15px] text-[var(--pv-ink-3)]">— Trax</span>
    </p>
  );
}
