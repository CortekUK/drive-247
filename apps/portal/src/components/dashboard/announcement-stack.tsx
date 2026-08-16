'use client';

import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'motion/react';
import { ArrowRight, Megaphone, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  useFeatureAnnouncements,
  type AnnouncementSeverity,
  type FeatureAnnouncement,
} from '@/hooks/use-feature-announcements';

/**
 * A fanned stack of feature announcements — portrait cards splayed behind each
 * other like a pile of photos.
 *
 * Three separate gestures, deliberately kept distinct:
 *   drag        → the card returns. A short drag springs back where it was; a
 *                 real flick sends it to the BACK of the deck. Dragging never
 *                 destroys anything, so the whole deck can be browsed and
 *                 re-browsed without losing a card by accident.
 *   tap         → opens the detail dialog.
 *   dismiss (×) → the only thing that makes a card go away, on the card and
 *                 again as "Got it" in the dialog.
 *
 * That split matters because drag is the easiest gesture to trigger by accident
 * and dismissal is the only irreversible one; they should not be the same
 * motion.
 */

/** How many cards are visible, including the front one. */
const VISIBLE = 3;
/** Past this distance, or this flick speed, the card goes to the back. */
const DISTANCE_THRESHOLD = 90;
const VELOCITY_THRESHOLD = 400;
/** A pointer that moved more than this between down and up was a drag, not a tap. */
const TAP_SLOP = 6;

/**
 * The fan. Index is depth — 0 is the card in front, which sits square so its
 * content stays readable; the ones behind splay alternately left and right so
 * both edges peek out rather than stacking into a single thick border.
 */
const FAN = [
  { rotate: 0, x: 0, y: 0, scale: 1 },
  { rotate: -7, x: -20, y: 10, scale: 0.965 },
  { rotate: 6.5, x: 20, y: 18, scale: 0.93 },
];

const SEVERITY_LABEL: Record<AnnouncementSeverity, string | null> = {
  critical: 'Important',
  major: 'New',
  minor: null,
  info: null,
};

/**
 * Severity keeps its own semantics — critical stays red regardless of the
 * tenant's brand, because "important" must not become "on-brand". `major` is
 * the one that rides the brand colour, since it means "new feature", which is
 * exactly what the brand accent is for.
 */
const SEVERITY_CLASS: Record<AnnouncementSeverity, string> = {
  critical: 'border-destructive/40 bg-destructive/85 text-destructive-foreground',
  major: 'border-primary/40 bg-primary/85 text-primary-foreground',
  minor: 'border-white/25 bg-black/45 text-white',
  info: 'border-white/25 bg-black/45 text-white',
};

/**
 * Depth wash, varied per card so four themed cards do not look identical. Every
 * stop is drawn from the brand ramp, so the variety stays inside the theme.
 */
const DEPTH_TINTS = [
  'from-chart-2/70',
  'from-chart-3/70',
  'from-chart-4/70',
  'from-chart-5/70',
];

/** Stable per-announcement pick, so a card keeps its wash across re-renders. */
function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return DEPTH_TINTS[h % DEPTH_TINTS.length];
}

/**
 * Artwork is roughly 80% theme / 20% photograph.
 *
 * The brand hue is laid over the photo's own luminance with `mix-blend-color`
 * at 80%, so the shape and depth of the image survive while the colour becomes
 * the tenant's. The remaining fifth of the original colour is what stops it
 * reading as a flat block of brand paint.
 *
 * A row with no image_url falls back to the ramp alone, so it still looks
 * deliberate rather than empty.
 */
function CardArtwork({ announcement }: { announcement: FeatureAnnouncement }) {
  const tint = tintFor(announcement.id);

  return (
    <>
      {announcement.image_url ? (
        <img
          src={announcement.image_url}
          alt=""
          // Without this the browser's native image drag hijacks the card drag.
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-chart-2 via-chart-3 to-chart-5">
          <Megaphone className="absolute -bottom-4 -right-3 size-32 text-white/10" />
        </div>
      )}

      {/* 80% of the colour comes from the theme. */}
      {announcement.image_url && (
        <div className="pointer-events-none absolute inset-0 bg-primary opacity-80 mix-blend-color" />
      )}

      {/* Brand-ramp depth, so the card has a light corner and a dark one. */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent mix-blend-overlay',
          tint
        )}
      />
    </>
  );
}

function CardFace({
  announcement,
  interactive,
  onDismiss,
}: {
  announcement: FeatureAnnouncement;
  interactive: boolean;
  onDismiss: () => void;
}) {
  const badge = SEVERITY_LABEL[announcement.severity] ?? null;

  return (
    <>
      <CardArtwork announcement={announcement} />

      {/* The title sits on whatever photo the announcement carries, so it needs
          its own contrast rather than trusting the image. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/15" />

      <div className="absolute inset-0 flex flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-2">
          {badge ? (
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm',
                SEVERITY_CLASS[announcement.severity]
              )}
            >
              {badge}
            </span>
          ) : (
            <span />
          )}
          {interactive && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 rounded-full bg-black/35 text-white backdrop-blur-sm hover:bg-black/55 hover:text-white"
              onPointerDownCapture={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              aria-label={`Dismiss “${announcement.title}”`}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>

        <div className="min-w-0">
          {/* Big and short. The detail lives in the dialog, so the face only has
              to carry the name of the thing. */}
          <h3 className="text-balance text-[26px] font-bold uppercase leading-[0.95] tracking-tight text-white drop-shadow-md">
            {announcement.title}
          </h3>
          {interactive && (
            <span className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-medium text-white/70">
              Tap for details
              <ArrowRight className="size-3" />
            </span>
          )}
        </div>
      </div>
    </>
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
  const isExternal = !!announcement.cta_url?.startsWith('http');

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden p-0">
        <div className="relative h-44 w-full isolate overflow-hidden">
          <CardArtwork announcement={announcement} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        </div>

        <div className="px-6 pb-2 pt-4">
          <DialogHeader>
            <DialogTitle className="text-xl">{announcement.title}</DialogTitle>
            {announcement.summary && (
              <DialogDescription className="text-sm leading-relaxed">
                {announcement.summary}
              </DialogDescription>
            )}
          </DialogHeader>

          {announcement.body_html && (
            /* Only super admins can write this table (RLS), so the HTML comes
               from us rather than from a tenant. */
            <div
              // Styled with explicit child selectors rather than `prose`:
              // @tailwindcss/typography is in package.json but never registered
              // with `@plugin` in global.css, so under Tailwind v4 the prose
              // classes resolve to nothing and paragraphs would run together.
              className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_li]:mt-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: announcement.body_html }}
            />
          )}
        </div>

        <DialogFooter className="gap-2 px-6 pb-5 sm:justify-between">
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

export function AnnouncementStack({ className }: { className?: string }) {
  const { announcements, hasDismissed, isLoading, dismiss, restore } = useFeatureAnnouncements();
  const reduceMotion = useReducedMotion();

  /** How many cards have been sent to the back. Rotates the deck; never shrinks it. */
  const [cycle, setCycle] = useState(0);
  const [detail, setDetail] = useState<FeatureAnnouncement | null>(null);
  /** Set while a real drag is in flight, so the release does not read as a tap. */
  const draggingRef = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const ordered = useMemo(() => {
    if (announcements.length === 0) return [];
    const offset = cycle % announcements.length;
    return [...announcements.slice(offset), ...announcements.slice(0, offset)];
  }, [announcements, cycle]);

  if (isLoading) return null;

  if (ordered.length === 0) {
    // Nothing to say. Offer the way back only if there is something to restore,
    // so an operator who hid a card can get it again.
    if (!hasDismissed) return null;
    return (
      <div className={cn('flex justify-center', className)}>
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

  const stack = ordered.slice(0, VISIBLE);

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    const flicked =
      Math.abs(offset.x) > DISTANCE_THRESHOLD || Math.abs(velocity.x) > VELOCITY_THRESHOLD;
    // Either way the card comes back: a flick sends it to the rear of the deck,
    // anything smaller springs home. `dragConstraints` handles the spring, so
    // there is nothing to do in the else branch.
    if (flicked && announcements.length > 1) setCycle((c) => c + 1);
  };

  return (
    <>
      {/* Extra horizontal room so the fanned corners are not clipped. */}
      <div className={cn('flex justify-center px-6 py-2', className)}>
        <div className="relative h-[320px] w-[248px] select-none">
          <AnimatePresence initial={false}>
            {stack
              // Paint back-to-front so the front card is last in the DOM and sits
              // above its siblings without a z-index per layer.
              .slice()
              .reverse()
              .map((announcement, reversedIndex) => {
                const depth = stack.length - 1 - reversedIndex; // 0 = front card
                const isTop = depth === 0;
                const pose = FAN[Math.min(depth, FAN.length - 1)];

                return (
                  <motion.div
                    key={announcement.id}
                    className={cn(
                      'absolute inset-0 isolate overflow-hidden rounded-2xl border border-border/60 bg-card shadow-lg',
                      isTop ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'
                    )}
                    style={{ zIndex: stack.length - depth }}
                    initial={false}
                    animate={{ ...pose, opacity: 1 }}
                    // Only a dismissal unmounts a card, so the exit is a simple
                    // fade-away rather than the old fling.
                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                    transition={
                      // Reduced motion shortens the transitions; it does not take
                      // the drag away. Direct manipulation the operator drives
                      // themselves is not what that setting is about.
                      reduceMotion
                        ? { duration: 0.15 }
                        : { type: 'spring', stiffness: 300, damping: 30 }
                    }
                    drag={isTop ? 'x' : false}
                    dragElastic={0.6}
                    dragConstraints={{ left: 0, right: 0 }}
                    onDragStart={() => {
                      draggingRef.current = true;
                    }}
                    onDragEnd={
                      isTop
                        ? (e, info) => {
                            handleDragEnd(e, info);
                            // Cleared after the click event would have fired.
                            window.setTimeout(() => {
                              draggingRef.current = false;
                            }, 0);
                          }
                        : undefined
                    }
                    onPointerDown={(e) => {
                      pointerStart.current = { x: e.clientX, y: e.clientY };
                    }}
                    onClick={(e) => {
                      if (!isTop) return;
                      // A click that travelled was a drag. Without this, every
                      // flick would also open the dialog.
                      const start = pointerStart.current;
                      const moved =
                        start &&
                        Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP;
                      if (draggingRef.current || moved) return;
                      setDetail(announcement);
                    }}
                    role={isTop ? 'button' : undefined}
                    tabIndex={isTop ? 0 : undefined}
                    onKeyDown={
                      isTop
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setDetail(announcement);
                            }
                          }
                        : undefined
                    }
                    aria-label={isTop ? `${announcement.title} — open details` : undefined}
                    aria-hidden={!isTop}
                  >
                    <CardFace
                      announcement={announcement}
                      interactive={isTop}
                      onDismiss={() => dismiss(announcement.id)}
                    />
                  </motion.div>
                );
              })}
          </AnimatePresence>
        </div>
      </div>

      <DetailDialog
        announcement={detail}
        onOpenChange={(open) => !open && setDetail(null)}
        onDismiss={dismiss}
      />
    </>
  );
}
