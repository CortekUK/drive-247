'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type PointerEvent } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { usePortalAnnouncements } from '@/hooks/use-portal-announcements';
import { FEATURE_CARD_UI, FEATURE_DECK_ROTATE_MS, type PortalAnnouncement } from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';
import { FeatureAnnouncementDialog, isFeatureImageRenderable } from './feature-announcement-dialog';

/**
 * The feature card on the dashboard's "On your desk" band: a paper-style
 * illustration with the feature's heading and one line over its lower part.
 * Clicking it opens the slides dialog (feature-announcement-dialog.tsx).
 *
 * Content comes from the super admin's Announcements page, Features tab, via
 * `usePortalAnnouncements().features`: every active feature targeted at this
 * tenant, in the admin's drag order, whether or not its dialog is still due.
 * The card stays for as long as the feature is active (meeting, rec. 1 [39:43]);
 * closing the dialog never removes it.
 *
 * ---------------------------------------------------------------------------
 * NOTHING TO SHOW, NOTHING RENDERED
 *
 * Zero features returns `null`, not an empty slot. The desk band decides its
 * grid from whether this card is there (home-bands.tsx + use-desk-feature-
 * presence.ts), so the two cards beside it stretch to fill the row instead of
 * leaving a hole. That is the user's rule (Sep 16 2026), and it replaced the
 * old carousel's "always keep a card" empty state.
 *
 * ---------------------------------------------------------------------------
 * SEVERAL FEATURES
 *
 * One slide at a time in a fixed 352px slot, crossfading. Auto-advance every
 * FEATURE_DECK_ROTATE_MS, paused while the pointer is over the card, while focus
 * is inside it, while the tab is hidden, while its dialog is open, and never
 * started under reduced motion. Dots, a swipe, or ←/→ on the focused card move
 * by hand, and a manual move stops auto-advance for the rest of the visit, as
 * on the hero-tab deck: someone who has taken the wheel should not have it
 * taken back.
 *
 * No severity pill, no badge, no dismiss and no "Show announcements" restore:
 * all four belonged to the old carousel and none of them survived the meeting.
 */

/** Past this horizontal travel a drag counts as a swipe. */
const SWIPE_THRESHOLD_PX = 60;
/** A click whose pointer travelled further than this was the end of a drag. */
const CLICK_SLOP_PX = 6;

/**
 * The second argument motion hands a drag handler, declared structurally:
 * motion/react does not re-export `PanInfo` (see the note that used to live in
 * the old announcement carousel), and only `offset` is read here.
 */
type DragInfo = { offset: { x: number; y: number } };

/**
 * Makes motion run the crossfade from JS rather than the Web Animations API.
 * With WAAPI, motion 12.34 cancels the finished fade a frame before it writes
 * the final opacity, so the card that just left flashes back at full opacity
 * (see DRIVE_FROM_JS in feature-announcement-dialog.tsx).
 */
const DRIVE_FROM_JS = () => {};

function DeckSlide({
  feature,
  imageOk,
  draggable,
  reduceMotion,
  slideRef,
  onImageError,
  onOpen,
  onStep,
}: {
  feature: PortalAnnouncement;
  imageOk: boolean;
  draggable: boolean;
  reduceMotion: boolean;
  slideRef: MutableRefObject<HTMLButtonElement | null>;
  onImageError: (url: string) => void;
  onOpen: (feature: PortalAnnouncement) => void;
  onStep: (delta: 1 | -1) => void;
}) {
  // While a slide crossfades out it is still in the DOM for 250ms. It must not
  // take a click meant for the slide arriving, or sit in the tab order.
  const isPresent = useIsPresent();
  const dragged = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Enter' || event.key === ' ') {
      // Handled here rather than left to the native click, and the default is
      // prevented so the browser does not fire that click as well.
      event.preventDefault();
      onOpen(feature);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      onStep(event.key === 'ArrowRight' ? 1 : -1);
    }
  };

  const imageUrl = imageOk ? feature.image_url : null;

  return (
    <motion.button
      ref={(el: HTMLButtonElement | null) => {
        if (isPresent) slideRef.current = el;
      }}
      type="button"
      className={cn(FEATURE_CARD_UI.slide, !isPresent && 'pointer-events-none')}
      tabIndex={isPresent ? undefined : -1}
      aria-hidden={isPresent ? undefined : true}
      data-feature-slide={feature.id}
      data-slide-state={isPresent ? 'active' : 'leaving'}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25, ease: 'easeOut' }}
      onUpdate={DRIVE_FROM_JS}
      drag={draggable && isPresent ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.35}
      onDragStart={() => {
        dragged.current = true;
      }}
      onDragEnd={(_event: unknown, info: DragInfo) => {
        if (Math.abs(info.offset.x) > SWIPE_THRESHOLD_PX) onStep(info.offset.x < 0 ? 1 : -1);
        window.setTimeout(() => {
          dragged.current = false;
        }, 0);
      }}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        pointerStart.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        // motion's onDragStart only fires past its own threshold, so a short
        // travel is checked too: a swipe that ends on the card is not a click.
        const start = pointerStart.current;
        pointerStart.current = null;
        const moved = !!start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX;
        if (dragged.current || moved) return;
        onOpen(feature);
      }}
      onKeyDown={onKeyDown}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          decoding="async"
          draggable={false}
          className={FEATURE_CARD_UI.image}
          onError={() => onImageError(imageUrl)}
        />
      ) : (
        // No image, or it failed to load: a paper-toned surface, never the
        // browser's broken-image icon. The text stays legible on it.
        <div aria-hidden="true" data-feature-fallback="" className={FEATURE_CARD_UI.fallback} />
      )}
      <div aria-hidden="true" className={FEATURE_CARD_UI.scrim} />
      <div className={FEATURE_CARD_UI.content}>
        <h3 className={FEATURE_CARD_UI.title}>{feature.title}</h3>
        {/* One line with an ellipsis; the whole line is in the tooltip and the
            dialog's slides carry the full story. */}
        <p className={FEATURE_CARD_UI.summary} title={feature.summary ?? undefined}>
          {feature.summary}
        </p>
        <span className={FEATURE_CARD_UI.more}>
          See how it works
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </span>
      </div>
    </motion.button>
  );
}

export function FeatureAnnouncementDeck({ features }: { features: PortalAnnouncement[] }) {
  const router = useRouter();
  const { recordEvent } = usePortalAnnouncements();
  const reduceMotion = useReducedMotion() === true;

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [opened, setOpened] = useState<PortalAnnouncement | null>(null);
  const [brokenImages, setBrokenImages] = useState<ReadonlySet<string>>(() => new Set());

  const featuresRef = useRef(features);
  featuresRef.current = features;
  const openedRef = useRef<PortalAnnouncement | null>(null);
  const lastIndexRef = useRef(0);
  const slideRef = useRef<HTMLButtonElement | null>(null);
  const refocusRef = useRef(false);

  const count = features.length;
  const found = currentId === null ? -1 : features.findIndex((f) => f.id === currentId);
  // The feature on screen can leave the list (the super admin deactivated it and
  // a poll landed): the one that slid into its place shows, clamped to the end.
  const activeIndex = count === 0 ? -1 : found !== -1 ? found : Math.min(lastIndexRef.current, count - 1);
  const active = activeIndex >= 0 ? features[activeIndex] : null;
  const activeId = active?.id ?? null;

  useEffect(() => {
    if (activeIndex >= 0) lastIndexRef.current = activeIndex;
    if (activeId !== null && currentId !== null && activeId !== currentId) setCurrentId(activeId);
  }, [activeId, activeIndex, currentId]);

  useEffect(() => {
    const sync = () => setDocumentHidden(document.visibilityState === 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const paused = stopped || reduceMotion || hovered || focusInside || documentHidden || opened !== null;

  // One timeout per slide on screen, so every slide gets its full interval and
  // a pause always restarts the count. Keyed on the id, not the array: a poll
  // hands back a new array and must not keep resetting the clock.
  useEffect(() => {
    if (count < 2 || paused || activeId === null) return;
    const timer = window.setTimeout(() => {
      const list = featuresRef.current;
      if (list.length < 2) return;
      const i = list.findIndex((f) => f.id === activeId);
      setCurrentId(list[(i + 1) % list.length].id);
    }, FEATURE_DECK_ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [count, paused, activeId]);

  // A keyboard user who moved with ←/→ stays on the card: the slide element is
  // replaced when the slide changes.
  useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    slideRef.current?.focus();
  }, [activeId]);

  if (count === 0 || !active) return null;

  const goTo = (target: number) => {
    const list = featuresRef.current;
    const n = list.length;
    if (n < 2) return;
    setStopped(true);
    setCurrentId(list[((target % n) + n) % n].id);
  };

  const open = (feature: PortalAnnouncement) => {
    // One dialog per open, whichever input got here first.
    if (openedRef.current) return;
    openedRef.current = feature;
    recordEvent(feature, 'card_opened');
    recordEvent(feature, 'shown');
    setOpened(feature);
  };

  const close = () => {
    openedRef.current = null;
    setOpened(null);
  };

  return (
    <>
      <section
        aria-roledescription="carousel"
        aria-label="What's new"
        data-feature-deck=""
        className={FEATURE_CARD_UI.root}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocusInside(true)}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocusInside(false);
        }}
      >
        <AnimatePresence initial={false}>
          <DeckSlide
            key={active.id}
            feature={active}
            imageOk={isFeatureImageRenderable(active.image_url) && !brokenImages.has(active.image_url)}
            draggable={count > 1}
            reduceMotion={reduceMotion}
            slideRef={slideRef}
            onImageError={(url) =>
              setBrokenImages((prev) => {
                if (prev.has(url)) return prev;
                const next = new Set(prev);
                next.add(url);
                return next;
              })
            }
            onOpen={open}
            onStep={(delta) => {
              refocusRef.current = !!slideRef.current && slideRef.current === document.activeElement;
              goTo(activeIndex + delta);
            }}
          />
        </AnimatePresence>

        {count > 1 && (
          // Outside the slide button: a button inside a button is invalid, and
          // a dot press must never open the dialog.
          <div className={FEATURE_CARD_UI.dots}>
            {features.map((feature, i) => (
              <button
                key={feature.id}
                type="button"
                className={FEATURE_CARD_UI.dotButton}
                aria-label={`Show ${feature.title} (${i + 1} of ${count})`}
                aria-current={i === activeIndex ? 'true' : undefined}
                onClick={() => goTo(i)}
              >
                <span className={i === activeIndex ? FEATURE_CARD_UI.dotActive : FEATURE_CARD_UI.dot} />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Outside the section on purpose: React bubbles focus and key events
          through portals, and the dialog must not pause or steer the deck by
          proxy (its own open state already pauses it). */}
      <FeatureAnnouncementDialog
        announcement={opened}
        source="card"
        onClose={() => {
          if (opened) recordEvent(opened, 'dismissed');
          close();
        }}
        onDontShowAgain={() => {
          // Never rendered for source="card"; kept truthful should that change.
          if (opened) recordEvent(opened, 'dont_show_again');
          close();
        }}
        onCta={(href) => {
          if (opened) recordEvent(opened, 'cta_clicked');
          close();
          router.push(href);
        }}
      />
    </>
  );
}
