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
 * A draggable stack of feature announcements — flick the top card away and the
 * next one comes forward.
 *
 * Drag is the flourish, not the mechanism. Every card also has a real dismiss
 * button, because a drag-only control is unreachable by keyboard, unusable with
 * a screen reader, and awkward on a trackpad. The button is what makes this
 * operable; the drag is what makes it feel good.
 *
 * Written directly rather than pulled from Aceternity/Magic UI — those are
 * copy-paste snippets rather than packages, and `motion` was already a
 * dependency, so there is nothing to install either way.
 */

/** How many cards are visible behind the top one. */
const VISIBLE = 3;
/** Past this horizontal distance, or this flick speed, the card leaves. */
const DISTANCE_THRESHOLD = 110;
const VELOCITY_THRESHOLD = 450;

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
  critical: 'border-destructive/30 bg-destructive/10 text-destructive',
  major: 'border-primary/30 bg-primary/10 text-primary',
  minor: 'border-border bg-muted text-muted-foreground',
  info: 'border-border bg-muted text-muted-foreground',
};

function AnnouncementCard({
  announcement,
  onDismiss,
}: {
  announcement: FeatureAnnouncement;
  onDismiss: () => void;
}) {
  const badge = SEVERITY_LABEL[announcement.severity] ?? null;

  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Megaphone className="size-3.5" />
          </span>
          {badge && (
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                SEVERITY_CLASS[announcement.severity]
              )}
            >
              {badge}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
          aria-label={`Dismiss “${announcement.title}”`}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold">{announcement.title}</h3>
        {announcement.summary && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{announcement.summary}</p>
        )}
      </div>

      {announcement.cta_url && (
        <a
          href={announcement.cta_url}
          target={announcement.cta_url.startsWith('http') ? '_blank' : undefined}
          rel={announcement.cta_url.startsWith('http') ? 'noreferrer noopener' : undefined}
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
          // The card is draggable; without this a click that moves a pixel is
          // swallowed as a drag and the link never fires.
          onPointerDownCapture={(e) => e.stopPropagation()}
        >
          {announcement.cta_label || 'Find out more'}
          <ArrowRight className="size-3.5" />
        </a>
      )}
    </div>
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
      <div className={cn('flex justify-end', className)}>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" onClick={restore}>
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
      setExitX(offset.x >= 0 ? 320 : -320);
      dismiss(id);
    }
  };

  return (
    <div className={cn('relative h-[172px] select-none', className)}>
      <AnimatePresence initial={false}>
        {stack
          // Paint back-to-front so the top card is last in the DOM and sits above
          // its siblings without needing a z-index per layer.
          .slice()
          .reverse()
          .map((announcement, reversedIndex) => {
            const depth = stack.length - 1 - reversedIndex; // 0 = top card
            const isTop = depth === 0;

            return (
              <motion.div
                key={announcement.id}
                className={cn(
                  'absolute inset-x-0 top-0 h-[172px] overflow-hidden rounded-xl border bg-card',
                  isTop ? 'cursor-grab shadow-sm active:cursor-grabbing' : 'pointer-events-none'
                )}
                style={{ zIndex: stack.length - depth }}
                initial={false}
                animate={{
                  // Each card behind sits slightly lower and narrower, which is
                  // what reads as a stack.
                  y: depth * 10,
                  scale: 1 - depth * 0.04,
                  opacity: depth === 0 ? 1 : 1 - depth * 0.25,
                }}
                exit={
                  reduceMotion
                    ? { opacity: 0, transition: { duration: 0.15 } }
                    : {
                        x: exitX,
                        opacity: 0,
                        rotate: exitX > 0 ? 12 : -12,
                        transition: { duration: 0.28 },
                      }
                }
                transition={
                  // Reduced motion shortens the transitions; it does not take the
                  // drag away. Dragging is direct manipulation the operator is
                  // driving themselves, which is not what the setting is about.
                  reduceMotion
                    ? { duration: 0.15 }
                    : { type: 'spring', stiffness: 320, damping: 32 }
                }
                drag={isTop ? 'x' : false}
                dragElastic={0.7}
                dragConstraints={{ left: 0, right: 0 }}
                onDragEnd={isTop ? handleDragEnd(announcement.id) : undefined}
                whileDrag={{ cursor: 'grabbing' }}
                aria-hidden={!isTop}
              >
                <AnnouncementCard
                  announcement={announcement}
                  onDismiss={() => {
                    setExitX(320);
                    dismiss(announcement.id);
                  }}
                />
              </motion.div>
            );
          })}
      </AnimatePresence>
    </div>
  );
}
