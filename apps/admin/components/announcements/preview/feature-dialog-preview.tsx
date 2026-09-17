'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { FEATURE_DIALOG_UI, isAnnouncementImageUrl, type AnnouncementSlide } from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';
import { HIDDEN_SCROLLBAR } from '../form-field';

/**
 * The feature dialog as the portal renders it (spec §3.4), as a static stage:
 * an absolute overlay and a centred panel instead of a Radix dialog, which must
 * never nest inside the editor's own dialog. Back / Next work.
 *
 * The panel's leading classes stand in for the ui-v2 DialogContent defaults the
 * portal merges FEATURE_DIALOG_UI.panel into.
 */
export function FeatureDialogPreview({
  title,
  slides,
  index,
  onIndexChange,
  ctaLabel,
  ctaVisible,
  showDontShowAgain,
}: {
  title: string;
  slides: readonly AnnouncementSlide[];
  index: number;
  onIndexChange: (index: number) => void;
  ctaLabel: string;
  /** The link is a valid in-portal path. */
  ctaVisible: boolean;
  /** Frequency repeats (the portal shows it only when the dialog opened by itself). */
  showDontShowAgain: boolean;
}) {
  const count = Math.max(1, slides.length);
  const i = Math.min(Math.max(0, index), count - 1);
  const slide: AnnouncementSlide = slides[i] ?? { heading: '', body: '', image_url: null };
  const last = i === count - 1;

  return (
    <>
      <div aria-hidden className={cn('absolute inset-0 z-10', FEATURE_DIALOG_UI.overlay)} />
      <div className="absolute inset-0 z-20 flex items-center justify-center">
        <div
          role="dialog"
          aria-label={title.trim() || 'Your heading'}
          className={cn('relative text-sm shadow-xl ring-1 ring-foreground/5 outline-none dark:ring-foreground/10', FEATURE_DIALOG_UI.panel)}
        >
          <SlideMedia key={i + ':' + (slide.image_url ?? '')} imageUrl={slide.image_url} />
          <button type="button" className={FEATURE_DIALOG_UI.close} aria-label="Close">
            <X className="h-4 w-4" aria-hidden />
          </button>
          {/* Appended: the editor dialog around this preview shows no scrollbars. */}
          <div className={cn(FEATURE_DIALOG_UI.body, HIDDEN_SCROLLBAR)}>
            <h2 className={FEATURE_DIALOG_UI.eyebrow}>{title.trim() || 'Your heading'}</h2>
            <h3 className={FEATURE_DIALOG_UI.heading}>{slide.heading.trim() || 'Your heading'}</h3>
            <p className={FEATURE_DIALOG_UI.text}>{slide.body.trim() || 'Your message'}</p>
            <p className="sr-only" aria-live="polite">
              Slide {i + 1} of {count}
            </p>
          </div>
          <div className={FEATURE_DIALOG_UI.footer}>
            <div className={FEATURE_DIALOG_UI.dots} aria-hidden>
              {Array.from({ length: count }, (_, d) => (
                <span key={d} className={d === i ? FEATURE_DIALOG_UI.dotActive : FEATURE_DIALOG_UI.dot} />
              ))}
            </div>
            {showDontShowAgain && (
              <button type="button" className={FEATURE_DIALOG_UI.linkButton}>
                Don&apos;t show again
              </button>
            )}
            <div className={FEATURE_DIALOG_UI.actions}>
              <button
                type="button"
                className={FEATURE_DIALOG_UI.secondaryButton}
                disabled={i === 0}
                onClick={() => onIndexChange(i - 1)}
              >
                Back
              </button>
              {!last ? (
                <button type="button" className={FEATURE_DIALOG_UI.primaryButton} onClick={() => onIndexChange(i + 1)}>
                  Next
                </button>
              ) : ctaVisible ? (
                <>
                  <button type="button" className={FEATURE_DIALOG_UI.secondaryButton}>
                    Got it
                  </button>
                  <button type="button" className={FEATURE_DIALOG_UI.primaryButton}>
                    {ctaLabel.trim() || 'Button label'}
                  </button>
                </>
              ) : (
                <button type="button" className={FEATURE_DIALOG_UI.primaryButton}>
                  Got it
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Row 1 of the panel grid: the slide image, or an empty cell so the body and footer keep their rows. */
function SlideMedia({ imageUrl }: { imageUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!isAnnouncementImageUrl(imageUrl) || failed) return <div aria-hidden="true" />;
  return (
    <div className={FEATURE_DIALOG_UI.media}>
      <img className={FEATURE_DIALOG_UI.mediaImage} src={imageUrl} alt="" decoding="async" onError={() => setFailed(true)} />
    </div>
  );
}
