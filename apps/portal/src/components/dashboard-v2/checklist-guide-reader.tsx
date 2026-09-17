'use client';

/**
 * The setup checklist's reader — a short guide shown as a little book, one
 * page at a time, that turns its pages.
 *
 * Opened by the read button on each "Sit down with these once" row
 * (./checklist-card.tsx). The content is compiled, not fetched:
 * lib/setup-checklist-guides.ts, checked against the code on 2026-09-16.
 *
 * WHY A BOOK AND NOT A LINK TO SETTINGS. The team lead, on the icon that used
 * to be a settings slider: "we keep settings to settings; we don't educate
 * about features in settings". What an operator needs before trusting
 * auto-extension, installments, pay-as-you-go or Bonzah is a handful of short
 * points — when a renewal pauses, why a policy waits — most of which are not
 * settings at all. A page-turning brochure keeps each set of points small
 * enough to read at a glance and makes the whole thing feel finite.
 *
 * ── HOW THE PAGE TURNS ───────────────────────────────────────────────────────
 *
 * The spine is on the LEFT of the page. Both pages involved in a turn are in
 * the DOM at once (AnimatePresence), stacked in one grid cell:
 *
 *   Next      the new page already lies underneath; the old page lifts off it,
 *             rotating about the spine from 0° to -90° (edge-on) and out.
 *   Previous  the old page stays where it is; the new page swings back down
 *             onto it from -90° to 0°.
 *
 * Which of the two is on top is swapped with z-index per direction, and the
 * page being covered or uncovered dims slightly, as if in the turning page's
 * shadow. `backface-visibility: hidden` means a page past edge-on is never
 * drawn mirrored. ~450ms end to end.
 *
 * Under prefers-reduced-motion there is NO rotation at all — the two pages
 * crossfade in the same cell.
 *
 * ── WHY THE BOOK NEVER CHANGES SIZE ──────────────────────────────────────────
 *
 * The pages are different lengths. If the stage were only as tall as the page
 * showing, the dialog — centred with a -50% translate — would jump at the end
 * of every turn. So every page of the guide is also rendered INVISIBLY in the
 * same grid cell (inert, aria-hidden), which makes the stage exactly as tall as
 * the guide's longest page, and every visible page stretches to it. Like a real
 * book: all its pages are one size, and the folio sits at the foot of each.
 *
 * ── THE PORTAL ESCAPES THE `.pv` PALETTE ─────────────────────────────────────
 *
 * A Radix dialog portals to <body>, outside the dashboard's `.pv` scope, so
 * `--pv-*` resolves to nothing in here — the same reason the checklist card's
 * video dialog uses semantic theme tokens. The chrome here (title, page count,
 * buttons) uses those tokens; the PAPER is a deliberate material with its own
 * light and dark values, not a theme surface.
 *
 * Nothing in here plays, advances or animates on its own: a page only turns
 * when the operator asks it to.
 */

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
  type Variants,
} from 'motion/react';
import { BookOpenText, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui-v2/dialog';
import { cn } from '@/lib/utils';
import type { ChecklistGuide, ChecklistGuidePage } from '@/lib/setup-checklist-guides';

/** One page turn, end to end. */
export const PAGE_TURN_SECONDS = 0.45;
/** The reduced-motion crossfade. Brisk: there is nothing to watch. */
const CROSSFADE_SECONDS = 0.2;
/** How far the page being covered or uncovered dims. */
const SHADED = 'brightness(0.9)';
const LIT = 'brightness(1)';

type Turn = 1 | -1;

/**
 * A page lifting away eases in AND out: it gathers speed off the book, then
 * thins to a sliver at edge-on, so the page underneath is uncovered at a
 * steady rate. A page settling down eases out, decelerating into place.
 *
 * Measured, not guessed: a steep ease-in ([0.55, 0, 0.75, 0.3]) was traced
 * frame by frame in Chrome and the page had turned under 6° at 270ms of 450 —
 * it sat still for half the turn and then flicked away.
 */
const LIFT = { duration: PAGE_TURN_SECONDS, ease: [0.45, 0, 0.35, 1] as const };
const SETTLE = { duration: PAGE_TURN_SECONDS, ease: [0.2, 0.55, 0.3, 1] as const };
/** z-index must switch at once, never be tweened through. */
const AT_ONCE = { duration: 0 };

/**
 * `custom` is the direction of the turn. AnimatePresence hands the LATEST
 * direction to a page that is leaving, so a page that arrived going forward can
 * still leave going back.
 *
 * The "stays put" halves (the page underneath on Next, the page being covered
 * on Previous) still animate their shade. That is load-bearing as well as
 * pretty: motion finishes an animation whose start and end are equal
 * immediately, which would remove the page being covered before the turning
 * page had reached it.
 */
const FLIP: Variants = {
  enter: (turn: Turn) =>
    turn > 0
      ? { rotateY: 0, zIndex: 1, filter: SHADED }
      : { rotateY: -90, zIndex: 2, filter: SHADED },
  center: (turn: Turn) => ({
    rotateY: 0,
    zIndex: turn > 0 ? 1 : 2,
    filter: LIT,
    transition: {
      rotateY: SETTLE,
      filter: turn > 0 ? { duration: PAGE_TURN_SECONDS, ease: 'easeOut' } : SETTLE,
      zIndex: AT_ONCE,
    },
  }),
  exit: (turn: Turn) =>
    turn > 0
      ? {
          rotateY: -90,
          zIndex: 2,
          filter: SHADED,
          transition: { rotateY: LIFT, filter: LIFT, zIndex: AT_ONCE },
        }
      : {
          rotateY: 0,
          zIndex: 1,
          filter: SHADED,
          transition: { filter: SETTLE, zIndex: AT_ONCE },
        },
};

const CROSSFADE: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: CROSSFADE_SECONDS, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: CROSSFADE_SECONDS, ease: 'easeOut' } },
};

/** The spine is the page's left edge; everything turns about it. */
const FLIP_STYLE = {
  transformOrigin: 'left center',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
} as const;

/**
 * The paper itself. Spine side barely rounded, fore-edge rounded, a soft
 * shadow under it — flat UI elsewhere, but this one is meant to read as an
 * object. Warm off-white in light mode; a warm dark stone in dark mode, lifted
 * off the dialog behind it rather than a hole in it.
 */
const SHEET =
  'rounded-l-md rounded-r-2xl ring-1 ring-stone-900/[0.07] dark:ring-white/10';
const PAPER = cn(
  SHEET,
  'relative flex h-full flex-col overflow-hidden bg-[#fffdf8] px-6 pb-4 pt-6 text-stone-700',
  'shadow-[0_1px_2px_rgba(28,25,23,0.06),0_14px_30px_-16px_rgba(28,25,23,0.4)]',
  'sm:px-9 sm:pt-8',
  'dark:bg-stone-800 dark:text-stone-300',
  'dark:shadow-[0_1px_2px_rgba(0,0,0,0.5),0_14px_30px_-16px_rgba(0,0,0,0.8)]',
);

function PaperContent({
  page,
  number,
  headingId,
}: {
  page: ChecklistGuidePage;
  number: number;
  headingId?: string;
}) {
  return (
    <div className={PAPER}>
      {/* The gutter: a little shade where the page runs into the binding. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-stone-900/[0.08] to-transparent dark:from-black/35"
      />
      <h3
        id={headingId}
        className="font-heading text-[17px] font-semibold leading-snug tracking-tight text-stone-900 sm:text-lg dark:text-stone-50"
      >
        {page.heading}
      </h3>
      {/* `role="list"` because Safari drops list semantics from a list with
          `list-style: none`, and "4 items" is worth hearing. The numbers are
          drawn, so they are hidden from the list's own count. */}
      <ol role="list" className="mt-4 space-y-3 sm:mt-5 sm:space-y-3.5">
        {page.points.map((point, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed">
            <span
              aria-hidden="true"
              className="mt-[3px] flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary dark:bg-[hsl(var(--v2-link,var(--primary))_/_0.15)] dark:text-[hsl(var(--v2-link,var(--primary)))]"
            >
              {i + 1}
            </span>
            <span className="min-w-0">{point}</span>
          </li>
        ))}
      </ol>
      {/* The folio. `mt-auto` holds it to the foot of the page, which every
          page shares because the stage is as tall as the longest one. */}
      <p
        aria-hidden="true"
        className="mt-auto pt-5 text-right text-[11px] tabular-nums text-stone-400 dark:text-stone-500"
      >
        {number}
      </p>
    </div>
  );
}

function TurningPage({
  page,
  number,
  total,
  turn,
  reduceMotion,
}: {
  page: ChecklistGuidePage;
  number: number;
  total: number;
  turn: Turn;
  reduceMotion: boolean;
}) {
  // A page on its way out is still in the DOM for the length of the turn. It
  // must not be read, tabbed into or clicked in that time: only the page
  // arriving is the page.
  const isPresent = useIsPresent();
  const headingId = useId();

  return (
    <motion.section
      custom={turn}
      variants={reduceMotion ? CROSSFADE : FLIP}
      initial="enter"
      animate="center"
      exit="exit"
      style={reduceMotion ? undefined : FLIP_STYLE}
      aria-labelledby={headingId}
      aria-roledescription="page"
      aria-hidden={isPresent ? undefined : true}
      inert={!isPresent}
      data-guide-page={number}
      data-guide-page-of={total}
      // `relative z-[1]`: grid items honour z-index, and without one the
      // positioned sheets behind would paint over a page in the crossfade,
      // which sets no z-index of its own.
      className="relative z-[1] [grid-area:1/1]"
    >
      <PaperContent page={page} number={number} headingId={headingId} />
    </motion.section>
  );
}

export function ChecklistGuideReader({
  guide,
  onClose,
  onCloseAutoFocus,
}: {
  /** The guide to read, or `null` when the reader is closed. */
  guide: ChecklistGuide | null;
  onClose: () => void;
  /** Where focus goes back to — see the card, which knows the row. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  const nextRef = useRef<HTMLButtonElement>(null);

  // `shown` outlives `guide` by the length of the close animation, so the book
  // does not go blank while the dialog fades out.
  const [shown, setShown] = useState<ChecklistGuide | null>(guide);
  const [previous, setPrevious] = useState<ChecklistGuide | null>(guide);
  const [page, setPage] = useState(0);
  const [turn, setTurn] = useState<Turn>(1);

  // Every opening starts at page one — including reopening the guide that was
  // just closed on page three. Adjusted during render rather than in an
  // effect, so the first frame of the dialog is already the right page.
  if (guide !== previous) {
    setPrevious(guide);
    if (guide) {
      setShown(guide);
      setPage(0);
      setTurn(1);
    }
  }

  const pages = shown?.pages ?? [];
  const total = pages.length;
  const current = Math.min(page, Math.max(0, total - 1));
  const isFirst = current === 0;
  const isLast = current >= total - 1;

  const go = (delta: Turn) => {
    const target = current + delta;
    if (target < 0 || target >= total) return;
    setTurn(delta);
    setPage(target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Browser history (Alt+←) and text selection (Shift+→) keep their meaning.
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
    }
  };

  const currentPage = pages[current];

  return (
    <Dialog open={!!guide} onOpenChange={(open) => !open && onClose()}>
      {/* `grid-cols-[minmax(0,1fr)]` for the same reason as the video dialog:
          an `auto` column grows to its content's min-content width and pushes
          the dialog past the viewport at phone width.

          NOT `overflow-hidden`: a lifting page swings toward the viewer and
          briefly overhangs the dialog, and clipping it would cut the corner
          off the turn. Only a genuinely short viewport (a phone on its side)
          gets a scrolling dialog, and accepts that clip. */}
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Start on Next — the one thing to do on page one — rather than on
          // Previous, which has nowhere to go yet.
          event.preventDefault();
          nextRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        onKeyDown={onKeyDown}
        data-guide-reader={shown?.key}
        className="w-[92vw] max-w-[600px] grid-cols-[minmax(0,1fr)] gap-0 p-0 sm:!max-w-[600px] [@media(max-height:620px)]:max-h-[calc(100dvh-1rem)] [@media(max-height:620px)]:overflow-y-auto"
      >
        {/* `pr-14` keeps the page count clear of the dialog's own close
            button, which is absolutely positioned in this corner. */}
        <DialogHeader className="flex-row items-center gap-3 pb-1 pl-6 pr-14 pt-5 sm:pl-8">
          <DialogTitle className="flex min-w-0 flex-1 items-center gap-2 text-base leading-snug">
            {/* Dark reads --v2-link: the dark theme's `--primary` is a deep
                shade that measures 1.78:1 on the dark dialog. */}
            <BookOpenText
              aria-hidden="true"
              className="size-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
            />
            <span className="min-w-0 break-words sm:truncate">{shown?.title}</span>
          </DialogTitle>
          {/* Announced on every turn. The heading rides along for screen
              readers only, so "Page 2 of 3" is not a number with no context. */}
          <p
            aria-live="polite"
            aria-atomic="true"
            className="shrink-0 text-xs tabular-nums text-muted-foreground"
          >
            <span>{`Page ${current + 1} of ${total}`}</span>
            {currentPage && <span className="sr-only">{`: ${currentPage.heading}`}</span>}
          </p>
        </DialogHeader>

        <div className="relative px-5 pb-1 pt-4 sm:px-8 sm:pt-5">
          {/* The stage. `perspective` lives on the parent of the turning
              pages, which is what gives the turn its depth. */}
          <div
            className="relative grid grid-cols-[minmax(0,1fr)]"
            style={{ perspective: '1800px' }}
            data-page-turn={reduceMotion ? 'crossfade' : 'flip'}
          >
            {/* The rest of the book: two sheets peeking out under the page,
                on the fore-edge and the foot. */}
            <div
              aria-hidden="true"
              className={cn(
                SHEET,
                'absolute inset-0 translate-x-[7px] translate-y-[6px] bg-[#ede6d7] dark:bg-stone-900',
              )}
            />
            <div
              aria-hidden="true"
              className={cn(
                SHEET,
                'absolute inset-0 translate-x-[3.5px] translate-y-[3px] bg-[#f6f1e6] dark:bg-stone-800/70',
              )}
            />

            {/* The sizers: every page, invisible, so the stage is always the
                height of the longest one. Never read, never focused. */}
            {pages.map((sizer, i) => (
              <div
                key={`sizer-${i}`}
                aria-hidden="true"
                inert
                className="invisible [grid-area:1/1]"
              >
                <PaperContent page={sizer} number={i + 1} />
              </div>
            ))}

            {shown && currentPage && (
              <AnimatePresence initial={false} custom={turn}>
                <TurningPage
                  key={`${shown.key}-${current}`}
                  page={currentPage}
                  number={current + 1}
                  total={total}
                  turn={turn}
                  reduceMotion={reduceMotion}
                />
              </AnimatePresence>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 pb-5 pt-5 sm:px-8 sm:pb-6">
          {/* `aria-disabled`, not `disabled`, on page one. A disabled button
              drops focus to <body> the moment it disables — which is exactly
              what pressing Previous onto the first page would do — and the
              arrow keys would stop reaching the dialog with it. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => go(-1)}
            aria-disabled={isFirst || undefined}
            className="h-9 rounded-full pl-2.5 pr-4 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent dark:aria-disabled:hover:bg-transparent"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous
          </Button>

          {/* Where you are, at a glance. The count in the header is what is
              announced; this is decoration. */}
          <div aria-hidden="true" className="flex items-center gap-1.5">
            {pages.map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  i === current
                    ? 'w-4 bg-primary dark:bg-[hsl(var(--v2-link,var(--primary)))]'
                    : 'w-1.5 bg-muted-foreground/30',
                )}
              />
            ))}
          </div>

          {/* On the last page Next becomes Done and closes the book, rather
              than sitting there disabled with nowhere to go. The same element
              either way, so focus stays on it. */}
          <Button
            ref={nextRef}
            type="button"
            onClick={() => (isLast ? onClose() : go(1))}
            className={cn('h-9 rounded-full', isLast ? 'px-5' : 'pl-4 pr-2.5')}
          >
            {isLast ? 'Done' : 'Next'}
            {!isLast && <ChevronRight aria-hidden="true" className="size-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
