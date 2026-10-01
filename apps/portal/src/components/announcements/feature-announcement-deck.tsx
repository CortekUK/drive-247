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
 * One slide at a time in a fixed 240px slot, crossfading. Auto-advance every
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

/**
 * The ACCENT variant (dashboard only): a typographic card, no scrim. A heavy
 * heading top-left, the description and link at the bottom, ink on a white
 * card (toned down from an indigo gradient on Sep 27 2026).
 *
 * When the feature has a picture it is laid UNDER that text, full bleed, with
 * no wash over it — so card art for this variant must be drawn for it: light,
 * with the top-left and bottom-left left clear (the Turo Sync art is; see
 * docs/brand/illustration-guide.md). With no picture, or one that fails, the
 * white card alone.
 */
const ACCENT_UI = {
  // Sep 27 2026: toned down to black and white — a light card with ink text and
  // a touch of accent (the link and the active dot). It stays light in dark mode too, because the card art is
  // a single light image; ink on it is the only text that reads in both themes.
  // A light touch of card (Sep 27 2026): a translucent white wash with the
  // faintest accent tint and a near-invisible hairline, no shadow. The art is a
  // transparent PNG, so the car sits on this wash rather than in a box.
  root: 'border-white/80 bg-transparent dark:bg-transparent bg-[linear-gradient(145deg,rgba(255,255,255,0.72)_0%,rgba(238,238,252,0.55)_100%)] dark:border-white/10 dark:bg-[linear-gradient(145deg,rgba(255,255,255,0.06)_0%,rgba(91,91,214,0.10)_100%)]',
  body: 'flex w-full flex-1 flex-col justify-between p-5',
  // max-w in `ch` makes a long heading stack, about two words a line
  // ("Refer / operators"), leaving the right of the card to the art.
  // leading 1 + a little bottom padding: line-clamp hides overflow, and at
  // 0.95 it sheared the descenders off the last line (the p in "operator",
  // the g in "agreements").
  title: 'line-clamp-2 max-w-[10.5ch] pb-[0.1em] text-[34px] font-black leading-[1] tracking-[-0.04em] text-neutral-950 dark:text-white',
  summary: 'truncate text-[13px] leading-5 text-neutral-600 dark:text-neutral-300',
  more: 'mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[#5b5bd6]',
  dot: 'block h-1 w-1 rounded-full bg-neutral-950/20 transition-all',
  dotActive: 'block h-1 w-2.5 rounded-full bg-[#5b5bd6] transition-all',
} as const;

export type FeatureDeckVariant = 'image' | 'accent';

/**
 * The accent card's heading reads as a stack: a title longer than about ten
 * characters breaks after its first word ("Payment / plans", "Refer /
 * operators"); a short one ("Zoho Books", "Ask Trax") stays on one line.
 * Explicit rather than width-driven, so it cannot depend on the font's metrics.
 */
const STACK_AFTER_CHARS = 10;
function stackTitle(title: string) {
  const trimmed = title.trim();
  const space = trimmed.indexOf(' ');
  if (trimmed.length <= STACK_AFTER_CHARS || space === -1) return trimmed;
  return (
    <>
      {trimmed.slice(0, space)}
      <br />
      {trimmed.slice(space + 1)}
    </>
  );
}

/** More features than this and the dots give way to a "3 / 15" counter. */
const MAX_DOTS = 6;

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
  variant,
  imageOk,
  draggable,
  reduceMotion,
  slideRef,
  onImageError,
  onOpen,
  onStep,
}: {
  feature: PortalAnnouncement;
  variant: FeatureDeckVariant;
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

  const accent = variant === 'accent';
  const imageUrl = imageOk ? feature.image_url : null;

  return (
    <motion.button
      ref={(el: HTMLButtonElement | null) => {
        if (isPresent) slideRef.current = el;
      }}
      type="button"
      className={cn(FEATURE_CARD_UI.slide, accent && 'focus-visible:ring-neutral-950', !isPresent && 'pointer-events-none')}
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
        // browser's broken-image icon. The text stays legible on it. The
        // accent card's own gradient is its fallback.
        !accent && <div aria-hidden="true" data-feature-fallback="" className={FEATURE_CARD_UI.fallback} />
      )}
      {accent ? (
        <div className={ACCENT_UI.body}>
          <h3 className={ACCENT_UI.title}>{stackTitle(feature.title)}</h3>
          <div className="min-w-0">
            <p className={ACCENT_UI.summary} title={feature.summary ?? undefined}>
              {feature.summary}
            </p>
            <span className={ACCENT_UI.more}>
              See how it works
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </span>
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}
    </motion.button>
  );
}

export function FeatureAnnouncementDeck({
  features,
  className,
  variant = 'image',
}: {
  features: PortalAnnouncement[];
  /** 'accent' = solid indigo card, no picture. Defaults to the picture card. */
  variant?: FeatureDeckVariant;
  /** Merged onto the card's root — the dashboard uses it to set the card's width. */
  className?: string;
}) {
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
        className={cn(FEATURE_CARD_UI.root, variant === 'accent' && ACCENT_UI.root, className)}
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
            variant={variant}
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

        {count > MAX_DOTS && (
          // Past MAX_DOTS the dots would run into the card's link, so a quiet
          // counter with previous / next takes their place.
          <div className={cn(FEATURE_CARD_UI.dots, 'gap-1.5')}>
            <button
              type="button"
              aria-label="Previous feature"
              onClick={() => goTo(activeIndex - 1)}
              className="flex h-5 w-4 cursor-pointer items-center justify-center rounded-full text-[13px] leading-none text-neutral-400 outline-none hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              ‹
            </button>
            <span className="text-[11px] font-medium tabular-nums text-neutral-500" aria-live="polite">
              {activeIndex + 1} / {count}
            </span>
            <button
              type="button"
              aria-label="Next feature"
              onClick={() => goTo(activeIndex + 1)}
              className="flex h-5 w-4 cursor-pointer items-center justify-center rounded-full text-[13px] leading-none text-neutral-400 outline-none hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              ›
            </button>
          </div>
        )}

        {count > 1 && count <= MAX_DOTS && (
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
                <span
                  className={
                    variant === 'accent'
                      ? i === activeIndex
                        ? ACCENT_UI.dotActive
                        : ACCENT_UI.dot
                      : i === activeIndex
                        ? FEATURE_CARD_UI.dotActive
                        : FEATURE_CARD_UI.dot
                  }
                />
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
