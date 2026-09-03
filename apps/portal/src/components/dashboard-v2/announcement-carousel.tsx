'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, RotateCcw, X } from 'lucide-react';
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

/**
 * Feature announcements as a text-only carousel — no photography, just the
 * name of the thing set large on a brand wash.
 *
 * Gestures stay separate, as they were on the stack this replaces: swipe or the
 * dots move between announcements, tapping opens the detail, and only the ×
 * (or "Got it" in the dialog) makes one go away. Moving between slides must
 * never be the same motion as dismissing, because one is idle browsing and the
 * other is irreversible.
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
 */
const SEVERITY_CLASS: Record<AnnouncementSeverity, string> = {
  critical: 'border-destructive/30 bg-destructive/15 text-destructive',
  major: 'border-white/30 bg-white/15 text-white',
  minor: 'border-white/25 bg-white/10 text-white/90',
  info: 'border-white/25 bg-white/10 text-white/90',
};

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
  const isExternal = !!announcement.cta_url?.startsWith('http');

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
          /* Only super admins can write this table (it is one of the tables
             that DOES have RLS on), so the HTML comes from us rather than from
             a tenant.

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
          {announcement.cta_url && (
            <Button asChild>
              <a
                href={announcement.cta_url}
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

  if (isLoading) return null;

  if (count === 0) {
    if (!hasDismissed) return null;
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-dashed',
          className
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-muted-foreground"
          onClick={restore}
        >
          <RotateCcw className="size-3.5" />
          Show announcements
        </Button>
      </div>
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
          // and the typography are what carry the card.
          //
          // `chart-3` / `chart-5` are NOT Tailwind colour keys in this app
          // (tailwind.config.ts extends `colors` with the shadcn set only), so
          // `from-chart-3` would compile to nothing. The tokens themselves do
          // exist — styles/v2-theme.css defines --chart-1..5 under `.v2-theme`,
          // which the root layout puts on <body> for the same gated tenants —
          // so they are referenced as arbitrary values instead.
          'relative isolate flex min-h-[260px] flex-col overflow-hidden rounded-xl bg-gradient-to-br from-[hsl(var(--chart-3))] via-primary to-[hsl(var(--chart-5))] p-5 text-white shadow-sm',
          className
        )}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm',
              SEVERITY_CLASS[current.severity]
            )}
          >
            {SEVERITY_LABEL[current.severity]}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-full text-white/70 hover:bg-white/15 hover:text-white"
            onPointerDownCapture={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              dismiss(current.id);
            }}
            aria-label={`Dismiss “${current.title}”`}
          >
            <X className="size-4" />
          </Button>
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
          <div className="mt-4 flex items-center gap-1.5">
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
