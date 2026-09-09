'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui-v2/dialog';
import { cn } from '@/lib/utils';
import {
  useFeatureAnnouncements,
  type AnnouncementSeverity,
  type FeatureAnnouncement,
} from '@/hooks/use-feature-announcements';
import { AttentionWash } from './attention-wash';
import { CardSurface } from './card-surface';

/**
 * Feature announcements as a text-only carousel — no photography, just the
 * name of the thing set large on a brand wash.
 *
 * Gestures stay separate, as they were on the stack this replaces: swipe, the
 * arrows or the dots move between announcements, and tapping opens the detail.
 * Moving between slides must never be the same motion as dismissing, because
 * one is idle browsing and the other is irreversible.
 *
 * There is deliberately no × on the card face. Hiding an announcement is only
 * reachable from inside the detail dialog ("Got it, hide this"), so a stray
 * click on the dashboard can never make a product update disappear.
 */

/** Auto-advance interval. Long enough to read a title without feeling nagged. */
const ADVANCE_MS = 7000;
/** Past this distance, or this flick speed, the swipe counts. */
const DISTANCE_THRESHOLD = 70;
const VELOCITY_THRESHOLD = 350;

/**
 * The shape of the second argument motion hands a drag handler.
 *
 * Declared structurally rather than imported as `PanInfo`: `motion/react` is
 * `export * from 'framer-motion'`, and framer-motion 12.34.3 does NOT re-export
 * `PanInfo` — it lives in `motion-dom`, which is a transitive dependency this
 * app does not declare. Reaching into it would be importing from a package that
 * is not in package.json, and adding one is not on the table for this area.
 * Only `offset` and `velocity` are read here, so this is the whole contract.
 */
type DragInfo = {
  offset: { x: number; y: number };
  velocity: { x: number; y: number };
};

const SEVERITY_LABEL: Record<AnnouncementSeverity, string> = {
  critical: 'Important',
  major: 'New',
  minor: 'Update',
  info: 'Note',
};

/**
 * Severity keeps its own semantics — critical stays red regardless of the
 * tenant's brand, because "important" must not become "on-brand".
 *
 * `critical` is a SOLID red chip with white text, not a translucent tint.
 * It used to be `bg-destructive/15 text-destructive`, which is the correct
 * pattern on a white card and the wrong one here: this badge sits on the brand
 * GRADIENT, so a 15% red wash composites over indigo into a muddy plum, and
 * mid-red text on top of that had almost no luminance contrast — the one label
 * that must be read at a glance was the least legible thing on the card.
 *
 * A solid fill fixes it without giving up the semantic: the chip is still
 * unmistakably red, and white-on-red carries its own contrast regardless of
 * what brand colour the tenant has chosen for the surface underneath. The ring
 * keeps its edge from disappearing into a dark-red or maroon brand.
 *
 * The other three stay translucent white on purpose. They are not urgent, and
 * a second solid chip would compete with this one.
 */
const SEVERITY_CLASS: Record<AnnouncementSeverity, string> = {
  critical:
    'border-transparent bg-destructive text-white shadow-sm ring-1 ring-inset ring-white/20',
  major: 'border-white/30 bg-white/15 text-white',
  minor: 'border-white/25 bg-white/10 text-white/90',
  info: 'border-white/25 bg-white/10 text-white/90',
};

/**
 * The href we are willing to put in the DOM, or `null` to drop the button.
 *
 * `cta_url` is free text typed into the super-admin form and it lands in an
 * `href` unmodified. A `javascript:` or `data:` href EXECUTES on click, so a
 * paste accident — or anyone who ever gets a write on this table — becomes
 * script running in an operator's authenticated portal session. Only an
 * absolute http(s) URL or a same-origin path survives; anything else renders no
 * button at all, because a missing CTA is better than that one.
 *
 * Note this is the href only. `body_html` still goes through
 * `dangerouslySetInnerHTML` unsanitised — see the comment at that call site.
 */
function safeHref(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Same-origin path. `//evil.com` is protocol-relative and NOT same-origin,
  // so a second slash disqualifies it.
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  return null;
}

/**
 * The slot when there is nothing to show.
 *
 * NOT `null`. `home-bands.tsx` lays this band out as
 * `grid md:grid-cols-2 xl:grid-cols-3` and this card is its FIRST child, so
 * returning nothing did not leave a gap — it removed a column and pulled
 * "Attention required now" and the card after it one place left, on a band
 * whose whole point is a fixed left-to-right rhythm. That happens on the two
 * paths that matter most: the first paint of every dashboard load, and any
 * production tenant whose `feature_announcements` read comes back empty or
 * fails. An empty card is the sanctioned outcome for a missing table; a
 * disappearing card that reflows its neighbours is not.
 *
 * `children` is the restore button when something was dismissed, and nothing at
 * all while the first read is in flight — a spinner for product news would be
 * louder than the news.
 */
function EmptySlot({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      className={cn(
        // The caller passes `border-0`, which beats `border` whatever order the
        // classes are written in, so the slot is drawn with a fill rather than
        // an outline. `--pv-*` are the dashboard's own tokens, scoped to the
        // `.pv` wrapper this always renders inside.
        'flex items-center justify-center rounded-xl bg-[var(--pv-wash)]',
        className
      )}
    >
      {children}
    </div>
  );
}

function DetailDialog({
  announcement,
  onOpenChange,
  onDismiss,
}: {
  announcement: FeatureAnnouncement | null;
  onOpenChange: (open: boolean) => void;
  onDismiss: (id: string) => void;
}) {
  if (!announcement) return null;
  const href = safeHref(announcement.cta_url);
  const isExternal = !!href && /^https?:\/\//i.test(href);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            {SEVERITY_LABEL[announcement.severity]}
          </span>
          <DialogTitle className="text-2xl font-bold tracking-tight">
            {announcement.title}
          </DialogTitle>
          {announcement.summary && (
            <DialogDescription className="text-sm leading-relaxed">
              {announcement.summary}
            </DialogDescription>
          )}
        </DialogHeader>

        {announcement.body_html && (
          /* NOT SANITISED, and that is a standing risk rather than a settled
             decision — recorded here because the audit that found it could not
             close it.

             The reasoning it shipped on is that only super admins can write
             this table (it is one of the tables that DOES have RLS on), so the
             HTML comes from us rather than from a tenant. That reasoning is
             unverifiable from this repository: `feature_announcements` has no
             DDL and no policy definition anywhere in the tree (the table was
             created through the Management API), so nothing here pins the write
             policy to `is_super_admin()`.

             The booking app injects the SAME COLUMN through
             `sanitizeHtml()` (apps/booking/src/lib/sanitize-html.ts, DOMPurify),
             and the super-admin editor's own field label promises "HTML allowed
             — sanitized on render". The portal is the one reader that does
             neither. It is left alone here only because closing it means adding
             `dompurify` to apps/portal/package.json, which this area explicitly
             does not do (see the `PanInfo` note at the top of this file), and a
             hand-rolled half-sanitiser is worse than none.

             Styled with explicit child selectors rather than `prose`:
             @tailwindcss/typography is in package.json but is NOT registered in
             tailwind.config.ts — `plugins` there is `[tailwindcss-animate]`
             only — so the prose classes resolve to nothing and paragraphs would
             run together. */
          <div
            className="space-y-3 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_li]:mt-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: announcement.body_html }}
          />
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              onDismiss(announcement.id);
              onOpenChange(false);
            }}
          >
            Got it, hide this
          </Button>
          {href && (
            <Button asChild>
              <a
                href={href}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noreferrer noopener' : undefined}
              >
                {announcement.cta_label || 'Find out more'}
                <ArrowRight className="ml-1 size-4" />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AnnouncementCarousel({ className }: { className?: string }) {
  const { announcements, hasDismissed, isLoading, dismiss, restore } = useFeatureAnnouncements();
  const reduceMotion = useReducedMotion();

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [detail, setDetail] = useState<FeatureAnnouncement | null>(null);
  const [paused, setPaused] = useState(false);
  const draggingRef = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const count = announcements.length;

  const go = useCallback(
    (delta: number) => {
      setDirection(delta >= 0 ? 1 : -1);
      setIndex((i) => (count === 0 ? 0 : (i + delta + count) % count));
    },
    [count]
  );

  // Auto-advance. Paused on hover and while the dialog is open, so it never
  // moves out from under someone who is reading it, and skipped entirely under
  // reduced motion.
  useEffect(() => {
    if (reduceMotion || paused || detail || count < 2) return;
    const id = window.setInterval(() => go(1), ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion, paused, detail, count, go]);

  // A dismissal shortens the list; clamp so the index never points past the end.
  useEffect(() => {
    if (count > 0 && index >= count) setIndex(0);
  }, [count, index]);

  // Both of these used to `return null`, which silently removed a column from
  // the band's three-across grid. See `EmptySlot`.
  if (isLoading) return <EmptySlot className={className} />;

  if (count === 0) {
    if (!hasDismissed) return <EmptySlot className={className} />;
    return (
      <EmptySlot className={className}>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-muted-foreground"
          onClick={restore}
        >
          <RotateCcw className="size-3.5" />
          Show announcements
        </Button>
      </EmptySlot>
    );
  }

  const current = announcements[Math.min(index, count - 1)];

  const handleDragEnd = (_e: unknown, info: DragInfo) => {
    const { offset, velocity } = info;
    if (Math.abs(offset.x) > DISTANCE_THRESHOLD || Math.abs(velocity.x) > VELOCITY_THRESHOLD) {
      go(offset.x < 0 ? 1 : -1);
    }
    window.setTimeout(() => {
      draggingRef.current = false;
    }, 0);
  };

  return (
    <>
      <div
        className={cn(
          // The brand wash is the whole visual — with no photograph, the theme
          // and the typography are what carry the card. The gradient itself
          // lives in CardSurface below, shared with the card to its right;
          // `isolate` keeps that layer between this element's background and
          // its content.
          'relative isolate flex min-h-[260px] flex-col overflow-hidden rounded-xl p-5 text-white shadow-sm',
          className
        )}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <CardSurface cardId="announcements" />
        {/* Top rung of the row's attention ramp. White rather than a token,
            because this one sits on the brand gradient instead of on a card —
            it reads as light catching the surface. */}
        <AttentionWash hsl="0 0% 100%" level="high" />

        <div className="flex items-start gap-2">
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm',
              SEVERITY_CLASS[current.severity]
            )}
          >
            {SEVERITY_LABEL[current.severity]}
          </span>
        </div>

        {/* The slide itself. Draggable, and a tap opens the detail. */}
        <motion.div
          className="flex flex-1 cursor-grab flex-col justify-end active:cursor-grabbing"
          drag={count > 1 ? 'x' : false}
          dragElastic={0.5}
          dragConstraints={{ left: 0, right: 0 }}
          onDragStart={() => {
            draggingRef.current = true;
          }}
          onDragEnd={handleDragEnd}
          onPointerDown={(e) => {
            pointerStart.current = { x: e.clientX, y: e.clientY };
          }}
          onClick={(e) => {
            // A click that travelled was a swipe. motion's onDragStart only
            // fires past its own threshold, so the distance is checked too.
            const start = pointerStart.current;
            const moved = start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6;
            if (draggingRef.current || moved) return;
            setDetail(current);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setDetail(current);
            } else if (e.key === 'ArrowRight') {
              go(1);
            } else if (e.key === 'ArrowLeft') {
              go(-1);
            }
          }}
          aria-label={`${current.title} — open details`}
        >
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={current.id}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: direction * -24 }}
              transition={{ duration: 0.22 }}
            >
              <h3 className="text-balance text-[32px] font-bold uppercase leading-[0.92] tracking-tight drop-shadow-sm">
                {current.title}
              </h3>
              {current.summary && (
                <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-white/75">
                  {current.summary}
                </p>
              )}
              <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/70">
                Read more
                <ArrowRight className="size-3" />
              </span>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {count > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              {announcements.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setDirection(i > index ? 1 : -1);
                    setIndex(i);
                  }}
                  aria-label={`Show ${a.title}`}
                  aria-current={i === index}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
                  )}
                />
              ))}
            </div>

            {/* Kept faint on purpose — the swipe is still the primary gesture;
                these are for anyone who doesn't think to drag a card. */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous announcement"
                className="rounded-full p-1 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next announcement"
                className="rounded-full p-1 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <DetailDialog
        announcement={detail}
        onOpenChange={(open) => !open && setDetail(null)}
        onDismiss={dismiss}
      />
    </>
  );
}
