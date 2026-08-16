'use client';

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from 'motion/react';
import { ArrowRight, Megaphone, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  useFeatureAnnouncements,
  type AnnouncementSeverity,
  type FeatureAnnouncement,
} from '@/hooks/use-feature-announcements';

/**
 * A fanned stack of feature announcements — portrait cards rotated behind each
 * other like a pile of photos. Flick the top card away and the next comes
 * forward.
 *
 * Drag is the flourish, not the mechanism. Every card also has a real dismiss
 * button, because a drag-only control is unreachable by keyboard, unusable with
 * a screen reader, and awkward on a trackpad. The button is what makes this
 * operable; the drag is what makes it feel good.
 *
 * Written directly against `motion`, which was already a dependency — Aceternity
 * and Magic UI are copy-paste snippets rather than packages.
 */

/** How many cards are visible, including the top one. */
const VISIBLE = 3;
/** Past this horizontal distance, or this flick speed, the card leaves. */
const DISTANCE_THRESHOLD = 110;
const VELOCITY_THRESHOLD = 450;

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

function CardFace({
  announcement,
  onDismiss,
  interactive,
}: {
  announcement: FeatureAnnouncement;
  onDismiss: () => void;
  interactive: boolean;
}) {
  const badge = SEVERITY_LABEL[announcement.severity] ?? null;
  const hasImage = !!announcement.image_url;

  return (
    <>
      {hasImage ? (
        <img
          src={announcement.image_url!}
          alt=""
          // Without this the browser's native image drag hijacks the card drag.
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        // No image on the row — fall back to a brand wash rather than an empty
        // frame, so an untagged announcement still looks deliberate.
        <div className="absolute inset-0 bg-gradient-to-br from-chart-2 via-chart-3 to-chart-5">
          <Megaphone className="absolute -bottom-4 -right-3 size-32 text-white/10" />
        </div>
      )}

      {/* Scrim — the text sits on whatever image the announcement carries, so it
          needs its own contrast rather than trusting the photo. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />

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
              onClick={onDismiss}
              onPointerDownCapture={(e) => e.stopPropagation()}
              aria-label={`Dismiss “${announcement.title}”`}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="text-balance text-base font-semibold leading-snug text-white drop-shadow">
            {announcement.title}
          </h3>
          {announcement.summary && (
            <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-white/80">
              {announcement.summary}
            </p>
          )}
          {interactive && announcement.cta_url && (
            <a
              href={announcement.cta_url}
              target={announcement.cta_url.startsWith('http') ? '_blank' : undefined}
              rel={announcement.cta_url.startsWith('http') ? 'noreferrer noopener' : undefined}
              className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-white"
              // The card is draggable; without this a click that moves a pixel is
              // swallowed as a drag and the link never fires.
              onPointerDownCapture={(e) => e.stopPropagation()}
            >
              {announcement.cta_label || 'Find out more'}
              <ArrowRight className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    </>
  );
}

export function AnnouncementStack({ className }: { className?: string }) {
  const { announcements, hasDismissed, isLoading, dismiss, restore } = useFeatureAnnouncements();
  const reduceMotion = useReducedMotion();
  const [exitX, setExitX] = useState(0);

  if (isLoading) return null;

  if (announcements.length === 0) {
    // Nothing to say. Offer the way back only if there is something to restore,
    // so an operator who flicked a card away by accident is not stuck.
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

  const stack = announcements.slice(0, VISIBLE);

  const handleDragEnd = (id: string) => (_e: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (Math.abs(offset.x) > DISTANCE_THRESHOLD || Math.abs(velocity.x) > VELOCITY_THRESHOLD) {
      setExitX(offset.x >= 0 ? 360 : -360);
      dismiss(id);
    }
  };

  return (
    // Extra horizontal room so the fanned corners are not clipped by the column.
    <div className={cn('flex justify-center px-6 py-2', className)}>
      <div className="relative h-[320px] w-[248px] select-none">
        <AnimatePresence initial={false}>
          {stack
            // Paint back-to-front so the top card is last in the DOM and sits
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
                    'absolute inset-0 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-lg',
                    isTop ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none'
                  )}
                  style={{ zIndex: stack.length - depth }}
                  initial={false}
                  animate={{ ...pose, opacity: 1 }}
                  exit={
                    reduceMotion
                      ? { opacity: 0, transition: { duration: 0.15 } }
                      : {
                          x: exitX,
                          opacity: 0,
                          rotate: exitX > 0 ? 18 : -18,
                          transition: { duration: 0.3 },
                        }
                  }
                  transition={
                    // Reduced motion shortens the transitions; it does not take
                    // the drag away. Dragging is direct manipulation the operator
                    // drives themselves, which is not what the setting is about.
                    reduceMotion
                      ? { duration: 0.15 }
                      : { type: 'spring', stiffness: 300, damping: 30 }
                  }
                  drag={isTop ? 'x' : false}
                  dragElastic={0.7}
                  dragConstraints={{ left: 0, right: 0 }}
                  onDragEnd={isTop ? handleDragEnd(announcement.id) : undefined}
                  aria-hidden={!isTop}
                >
                  <CardFace
                    announcement={announcement}
                    interactive={isTop}
                    onDismiss={() => {
                      setExitX(360);
                      dismiss(announcement.id);
                    }}
                  />
                </motion.div>
              );
            })}
        </AnimatePresence>
      </div>
    </div>
  );
}
