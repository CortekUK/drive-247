'use client';

import { useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { DESK_BAND_HINT, DESK_CARD_HEIGHT_PX, DESK_GRID_CLASSES, FEATURE_CARD_UI } from '@/lib/announcements/contract';

/**
 * The dashboard feature card, built from FEATURE_CARD_UI with the portal deck's
 * DOM (spec §3.4): one slide button holding image-or-fallback, scrim and text,
 * with the dots outside it. Rotation is off in the preview.
 */
export function FeatureCardPreview({
  title,
  summary,
  imageUrl,
  cardCount,
  onOpen,
}: {
  title: string;
  summary: string;
  imageUrl: string | null;
  /** Active features the deck would hold (this one + the other active ones). Dots show above 1. */
  cardCount: number;
  onOpen: () => void;
}) {
  const heading = title.trim() || 'Your heading';
  const line = summary.trim() || 'One line about the feature';
  return (
    <section aria-roledescription="carousel" aria-label="What's new" className={FEATURE_CARD_UI.root}>
      <button type="button" className={FEATURE_CARD_UI.slide} onClick={onOpen}>
        <CardImage key={imageUrl ?? ''} imageUrl={imageUrl} />
        <div className={FEATURE_CARD_UI.scrim} />
        <div className={FEATURE_CARD_UI.content}>
          <h3 className={FEATURE_CARD_UI.title}>{heading}</h3>
          <p className={FEATURE_CARD_UI.summary} title={line}>
            {line}
          </p>
          <span className={FEATURE_CARD_UI.more}>
            See how it works <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </div>
      </button>
      {cardCount > 1 && (
        <div className={FEATURE_CARD_UI.dots}>
          {Array.from({ length: cardCount }, (_, i) => (
            <button
              key={i}
              type="button"
              className={FEATURE_CARD_UI.dotButton}
              aria-label={'Show ' + (i === 0 ? heading : 'feature ' + (i + 1)) + ' (' + (i + 1) + ' of ' + cardCount + ')'}
              aria-current={i === 0}
            >
              <span className={i === 0 ? FEATURE_CARD_UI.dotActive : FEATURE_CARD_UI.dot} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function CardImage({ imageUrl }: { imageUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!imageUrl || failed) return <div className={FEATURE_CARD_UI.fallback} />;
  return <img className={FEATURE_CARD_UI.image} src={imageUrl} alt="" decoding="async" onError={() => setFailed(true)} />;
}

/** The "On your desk" band around the card, with the two neighbour cards as grey stand-ins. */
export function DeskBandPreview({ children }: { children: ReactNode }) {
  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-semibold leading-none tracking-[-0.025em] text-neutral-950 dark:text-white">On your desk</h2>
          <p className="mt-2.5 text-[13px] leading-none text-neutral-500 dark:text-neutral-400">{DESK_BAND_HINT.withFeatures}</p>
        </div>
      </div>
      <div className={DESK_GRID_CLASSES[3]}>
        {children}
        <PlaceholderCard label="Sit down with these once" />
        <PlaceholderCard label="Reminders" />
      </div>
    </section>
  );
}

function PlaceholderCard({ label }: { label: string }) {
  return (
    <div
      aria-hidden
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
      style={{ height: DESK_CARD_HEIGHT_PX }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400 dark:text-neutral-500">{label}</p>
      {[82, 64, 74, 52].map((w) => (
        <div key={w} className="h-3 rounded-full bg-neutral-100 dark:bg-neutral-800" style={{ width: w + '%' }} />
      ))}
    </div>
  );
}
