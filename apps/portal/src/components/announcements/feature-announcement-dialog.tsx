'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui-v2/dialog';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import {
  FEATURE_CARD_UI,
  FEATURE_DIALOG_UI,
  isAnnouncementImageUrl,
  resolveInPortalCta,
  type AnnouncementSlide,
  type PortalAnnouncement,
} from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';

/**
 * The large "what's new" dialog: one feature, told in its slides (1-10, set by the super admin).
 *
 * Opened two ways, and the dialog itself does not care which beyond one link:
 *   - `source="card"`: the operator clicked the feature card on the dashboard
 *     desk band (feature-announcement-deck.tsx);
 *   - `source="auto"`: the announcement host opened it by itself because the
 *     feature is due for this user (announcement-dialog-host.tsx).
 *
 * It records NOTHING. Every close path calls back and the caller records the
 * event (`dismissed`, `dont_show_again`, `cta_clicked`), so the card and the
 * host cannot disagree about what a close means.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE
 *
 *   - No tour button (meeting, rec. 1 [35:12]): the optional button goes to
 *     where the feature lives, and only when the super admin entered a path.
 *   - No HTML. Heading and text are plain strings, newlines kept by
 *     `whitespace-pre-line`. The old detail dialog injected unsanitised
 *     `body_html`; that column is not read by anything any more.
 *   - No "Don't show again" when the card opened it: the card stays on the
 *     dashboard either way, so the link would promise something it cannot do.
 *     It is also hidden for "show once" items, where closing already means that.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 *
 * The panel is a three-row grid (`auto / minmax(0,1fr) / auto`) and ALWAYS has
 * three in-flow children. A slide without an image still renders a first
 * child: with only two, the footer would land in the `1fr` row and the body in
 * the `auto` one, so long text would push the footer off the bottom instead of
 * scrolling. The close button is absolutely positioned and takes no row.
 *
 * The panel keeps ONE size for the whole announcement. It is centred, so a
 * panel that shrinks from one slide to the next moves Next out from under the
 * pointer, and a second click at the same spot lands on the backdrop and
 * closes the dialog (recording a dismissal). So:
 *   - when any slide has a picture, every slide keeps the picture frame; a
 *     slide without one (or whose image failed) shows the paper surface the
 *     card uses;
 *   - every slide's text is laid out, invisibly, in the same cell as the
 *     visible one, so the text area is always as tall as the longest slide.
 * The frame's height is capped so that on a short screen (a laptop with the
 * browser's toolbars, a phone on its side) the picture gives way and the
 * heading, text and buttons still fit.
 */

/**
 * Leaves ~11.7rem for the text under the picture (1rem margin + ~4.3rem footer).
 * `isolate` lets the paper surface's `-z-10` layer paint above the frame's own
 * background instead of behind it.
 */
const MEDIA_HEIGHT_CAP = 'isolate max-h-[calc(100dvh-17rem)]';

/**
 * The contract's buttons fall back to the browser's faint grey outline, which
 * all but vanishes on the indigo pill and on white, and the close button's
 * white ring is invisible on a slide without a picture.
 */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-popover';

/**
 * Passing `onUpdate` makes motion drive the animation from JS instead of the
 * Web Animations API. With WAAPI, motion 12.34 cancels the finished animation
 * one frame before it writes the final style, so for a frame the element
 * shows its starting style again (the body blinks back to transparent).
 */
const DRIVE_FROM_JS = () => {};

/** Supabase project this portal talks to; same fallback as integrations/supabase/client.ts. */
function projectHost(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hviqoaokxvlancmftwuo.supabase.co').host;
  } catch {
    return null;
  }
}

/**
 * `isAnnouncementImageUrl` checks the storage path only, and any https host
 * passes it. The image must also come from this portal's own Supabase project:
 * otherwise a row could make every targeted operator's browser call a
 * third-party server. Used by the card deck too.
 */
export function isFeatureImageRenderable(url: unknown): url is string {
  if (!isAnnouncementImageUrl(url)) return false;
  try {
    const host = projectHost();
    return host !== null && new URL(url).host === host;
  } catch {
    return false;
  }
}

export interface FeatureAnnouncementDialogProps {
  /** kind='feature'. null = closed. Slide index resets to 0 whenever id changes. */
  announcement: PortalAnnouncement | null;
  /** 'auto' = opened by the host; 'card' = opened from the dashboard card. */
  source: 'auto' | 'card';
  /** X, Esc, outside click, "Got it". Caller records 'dismissed' and clears `announcement`. */
  onClose: () => void;
  /** Rendered only when source==='auto' && announcement.repeat_after_days !== null. Caller records 'dont_show_again'. */
  onDontShowAgain: () => void;
  /** href from resolveInPortalCta. Caller records 'cta_clicked', closes, then router.push(href). */
  onCta: (href: string) => void;
}

type Turn = 1 | -1;

export function FeatureAnnouncementDialog({
  announcement,
  source,
  onClose,
  onDontShowAgain,
  onCta,
}: FeatureAnnouncementDialogProps) {
  const reduceMotion = useReducedMotion() === true;
  const { canAccessRoute } = useManagerPermissions();

  // `shown` outlives `announcement` by the length of the close animation, so the
  // panel does not go blank while it fades out.
  const [shown, setShown] = useState<PortalAnnouncement | null>(announcement);
  const [openId, setOpenId] = useState<string | null>(announcement?.id ?? null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [turn, setTurn] = useState<Turn>(1);
  const [brokenImages, setBrokenImages] = useState<ReadonlySet<string>>(() => new Set());

  const primaryRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const refocusRef = useRef(false);
  // What had focus before the dialog opened (the dashboard card, for one).
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Every opening starts on slide one: a different feature, or the same one
  // opened again after a close. Keyed on the id rather than the object, because
  // a poll hands back a fresh copy of the same row and must not throw someone
  // reading slide three back to the start. Adjusted during render so the first
  // frame is already the right slide.
  const id = announcement?.id ?? null;
  if (id !== openId) {
    setOpenId(id);
    if (announcement) {
      setSlideIndex(0);
      setTurn(1);
    }
  }
  if (announcement && announcement !== shown) setShown(announcement);

  const slides: readonly AnnouncementSlide[] =
    shown && shown.slides.length > 0
      ? shown.slides
      : // Unreachable through the normaliser (a feature with no slide is dropped),
        // kept so a hand-built row still reads as a one-page dialog.
        shown
        ? [{ heading: shown.title, body: shown.summary ?? '', image_url: null }]
        : [];
  const total = slides.length;
  const current = Math.min(slideIndex, Math.max(0, total - 1));
  const page = slides[current] ?? null;
  const isFirst = current === 0;
  const isLast = current >= total - 1;

  const imageUrl =
    page && isFeatureImageRenderable(page.image_url) && !brokenImages.has(page.image_url) ? page.image_url : null;
  // Decided on the URLs, not on what loaded: a failed image keeps its frame.
  const keepsFrame = slides.some((slide) => isFeatureImageRenderable(slide.image_url));

  // The button renders only for a real in-portal path this viewer may open. A
  // manager without the destination's tab would otherwise click into the
  // layout's own redirect.
  const cta = shown ? resolveInPortalCta(shown.cta_url) : null;
  const showCta = !!cta && !!shown?.cta_label && canAccessRoute(cta.pathname);
  const showDontShowAgain = source === 'auto' && !!shown && shown.repeat_after_days !== null;

  const go = (delta: Turn) => {
    const target = current + delta;
    if (target < 0 || target >= total) return;
    refocusRef.current = true;
    setTurn(delta);
    setSlideIndex(target);
  };

  // Back disables on slide one and Next unmounts on the last one, and either
  // drops keyboard focus to <body>, where the arrow keys no longer reach the
  // dialog. Put it on the primary action instead.
  useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    const active = document.activeElement as HTMLElement | null;
    const content = contentRef.current;
    if (!content) return;
    const lost =
      !active || active === document.body || active === content || (active as HTMLButtonElement).disabled === true;
    if (lost) primaryRef.current?.focus();
  }, [current]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Browser history (Alt+←) and text selection (Shift+→) keep their meaning.
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
    }
  };

  return (
    <Dialog
      open={!!announcement}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {shown && page && (
        <DialogContent
          ref={contentRef}
          showCloseButton={false}
          data-feature-announcement-dialog={shown.id}
          onOpenAutoFocus={(event) => {
            // Opened from the card: start on the way forward (Next, or the last
            // slide's action), not on the close button in the corner.
            // Opened by itself (source "auto", on a timer): focus the panel, like
            // the system dialog. The operator may be typing when it appears, and
            // an Enter meant for the page must not press Got it or the CTA.
            event.preventDefault();
            const before = document.activeElement;
            returnFocusRef.current = before instanceof HTMLElement && before !== document.body ? before : null;
            if (source === 'auto') contentRef.current?.focus();
            else primaryRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            // There is no Radix trigger (the card and the host open this), so
            // Radix's own return goes nowhere and focus drops to <body>. Hand
            // it back to what had it, if that is still on the page.
            event.preventDefault();
            const target = returnFocusRef.current;
            returnFocusRef.current = null;
            if (target?.isConnected) target.focus();
          }}
          onKeyDown={onKeyDown}
          // `!`: the primitive's `data-[state=open]:animate-in` (0,2,0) outranks a
          // plain `motion-reduce:animate-none` (0,1,0), so the panel kept zooming in.
          className={cn(FEATURE_DIALOG_UI.panel, 'motion-reduce:!animate-none')}
        >
          <button type="button" aria-label="Close" className={cn(FEATURE_DIALOG_UI.close, FOCUS_RING)} onClick={onClose}>
            <X aria-hidden="true" className="size-4" />
          </button>

          {/* Row 1: the slide's picture, the paper surface in its frame, or an
              empty placeholder when no slide has a picture (see LAYOUT). */}
          {imageUrl ? (
            <div className={cn(FEATURE_DIALOG_UI.media, MEDIA_HEIGHT_CAP)}>
              <img
                key={imageUrl}
                src={imageUrl}
                alt=""
                decoding="async"
                className={FEATURE_DIALOG_UI.mediaImage}
                onError={() =>
                  setBrokenImages((prev) => {
                    if (prev.has(imageUrl)) return prev;
                    const next = new Set(prev);
                    next.add(imageUrl);
                    return next;
                  })
                }
              />
            </div>
          ) : keepsFrame ? (
            <div aria-hidden="true" className={cn(FEATURE_DIALOG_UI.media, MEDIA_HEIGHT_CAP)}>
              <div data-feature-media-paper="" className={FEATURE_CARD_UI.fallback} />
            </div>
          ) : (
            <div aria-hidden="true" />
          )}

          {/* Row 2: scrolls when a slide's text is longer than the screen. */}
          <div className={FEATURE_DIALOG_UI.body}>
            {/* `leading-5` appended: the eyebrow is the feature title, up to 60
                characters, and it wraps on a phone. The primitive's
                `leading-none` would stack those lines on top of each other. */}
            <DialogTitle className={cn(FEATURE_DIALOG_UI.eyebrow, 'leading-5')}>{shown.title}</DialogTitle>
            {/* Every slide's text in one grid cell: the hidden copies size the
                cell to the longest slide (see LAYOUT), the visible one sits on
                top. The copies are invisible and aria-hidden, so neither eyes,
                find-in-page nor a screen reader meet them. */}
            <div className="grid grid-cols-[minmax(0,1fr)]">
              {slides.map((slide, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  data-slide-sizer=""
                  className="invisible col-start-1 row-start-1 flex flex-col gap-3"
                >
                  <h3 className={FEATURE_DIALOG_UI.heading}>{slide.heading}</h3>
                  <p className={FEATURE_DIALOG_UI.text}>{slide.body}</p>
                </div>
              ))}
              <motion.div
                key={`${shown.id}:${current}`}
                className="col-start-1 row-start-1 flex flex-col gap-3"
                initial={reduceMotion ? false : { opacity: 0, x: turn * 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                onUpdate={DRIVE_FROM_JS}
              >
                <h3 className={FEATURE_DIALOG_UI.heading}>{page.heading}</h3>
                <DialogDescription className={FEATURE_DIALOG_UI.text}>{page.body}</DialogDescription>
              </motion.div>
            </div>
            <p className="sr-only" aria-live="polite">
              {`Slide ${current + 1} of ${total}`}
            </p>
          </div>

          {/* Row 3: always visible, whatever the body does. */}
          <div className={FEATURE_DIALOG_UI.footer}>
            {/* Dots and the link share one left-hand group: as three flex
                children, a phone's wrapped actions row let justify-between push
                the link to the right edge on the last slide only. */}
            <div className="flex items-center gap-3">
              <div aria-hidden="true" className={FEATURE_DIALOG_UI.dots}>
                {slides.map((_, i) => (
                  <span key={i} className={i === current ? FEATURE_DIALOG_UI.dotActive : FEATURE_DIALOG_UI.dot} />
                ))}
              </div>

              {showDontShowAgain && (
                <button
                  type="button"
                  className={cn(FEATURE_DIALOG_UI.linkButton, FOCUS_RING, 'rounded-sm')}
                  onClick={onDontShowAgain}
                >
                  {"Don't show again"}
                </button>
              )}
            </div>

            <div className={FEATURE_DIALOG_UI.actions}>
              <button
                type="button"
                className={cn(FEATURE_DIALOG_UI.secondaryButton, FOCUS_RING)}
                onClick={() => go(-1)}
                disabled={isFirst}
              >
                Back
              </button>
              {!isLast ? (
                <button
                  ref={primaryRef}
                  type="button"
                  className={cn(FEATURE_DIALOG_UI.primaryButton, FOCUS_RING)}
                  onClick={() => go(1)}
                >
                  Next
                </button>
              ) : showCta && cta ? (
                <>
                  <button type="button" className={cn(FEATURE_DIALOG_UI.secondaryButton, FOCUS_RING)} onClick={onClose}>
                    Got it
                  </button>
                  <button
                    ref={primaryRef}
                    type="button"
                    className={cn(FEATURE_DIALOG_UI.primaryButton, FOCUS_RING)}
                    onClick={() => onCta(cta.href)}
                  >
                    {shown.cta_label}
                  </button>
                </>
              ) : (
                <button
                  ref={primaryRef}
                  type="button"
                  className={cn(FEATURE_DIALOG_UI.primaryButton, FOCUS_RING)}
                  onClick={onClose}
                >
                  Got it
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
