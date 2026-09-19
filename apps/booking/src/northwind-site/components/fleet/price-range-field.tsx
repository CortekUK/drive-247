'use client';

import { useId } from 'react';

import { formatMoney } from './format';
import type { PriceBounds } from './fleet-filters';

interface PriceRangeFieldProps {
  bounds: PriceBounds;
  /** Current selection. Either end may be null, meaning "at the bound". */
  min: number | null;
  max: number | null;
  currencyCode: string | null;
  onChange: (next: { min: number | null; max: number | null }) => void;
}

/**
 * Round the step so the handles land on sane money: £5 steps on a £50–£650
 * fleet, £1 on a narrow one. Derived from the real spread rather than fixed,
 * because a step that suits a £650 fleet is useless on a £30 one.
 */
function stepFor(spread: number): number {
  if (spread <= 20) return 1;
  if (spread <= 100) return 5;
  if (spread <= 600) return 10;
  return 25;
}

/**
 * A two-handle price filter over the fleet's REAL daily-rate span.
 *
 * Built from two native range inputs rather than a custom widget: they are
 * keyboard-operable (arrows, Home/End) and screen-reader-announced for free,
 * which a pair of divs with drag handlers is not.
 *
 * The overlap trick — `pointer-events: none` on the inputs, restored on the
 * thumbs — is what lets two full-width sliders share one track without the
 * upper one swallowing every click meant for the lower. The handles are also
 * clamped a step apart so neither can hide under the other.
 */
export function PriceRangeField({
  bounds,
  min,
  max,
  currencyCode,
  onChange,
}: PriceRangeFieldProps) {
  const id = useId();
  const step = stepFor(bounds.max - bounds.min);

  // Snap the track to whole steps so the handles can always reach both ends.
  const trackMin = Math.floor(bounds.min / step) * step;
  const trackMax = Math.ceil(bounds.max / step) * step;
  const span = Math.max(trackMax - trackMin, 1);

  const lo = min ?? trackMin;
  const hi = max ?? trackMax;

  const loPercent = ((lo - trackMin) / span) * 100;
  const hiPercent = ((hi - trackMin) / span) * 100;

  const handleLow = (value: number) => {
    const next = Math.min(value, hi - step);
    onChange({ min: next <= trackMin ? null : next, max });
  };

  const handleHigh = (value: number) => {
    const next = Math.max(value, lo + step);
    onChange({ min, max: next >= trackMax ? null : next });
  };

  // The input is the drag surface, so it is 44px tall on touch and collapses to
  // the tighter 24px track from `sm` up. The thumbs grow to match.
  const thumb =
    'pointer-events-none absolute inset-x-0 top-1/2 h-11 w-full -translate-y-1/2 appearance-none bg-transparent outline-none sm:h-6 ' +
    '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-5 sm:[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none ' +
    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white ' +
    '[&::-webkit-slider-thumb]:bg-brand-forest [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.25)] ' +
    '[&::-webkit-slider-thumb]:cursor-pointer ' +
    '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-5 sm:[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none ' +
    '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white ' +
    '[&::-moz-range-thumb]:bg-brand-forest [&::-moz-range-thumb]:cursor-pointer ' +
    'focus-visible:[&::-webkit-slider-thumb]:ring-[3px] focus-visible:[&::-webkit-slider-thumb]:ring-brand-forest/35 ' +
    'focus-visible:[&::-moz-range-thumb]:ring-[3px] focus-visible:[&::-moz-range-thumb]:ring-brand-forest/35';

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 text-xs text-brand-text-soft">
        <span aria-hidden>{formatMoney(lo, currencyCode)}</span>
        <span aria-hidden>{formatMoney(hi, currencyCode)}</span>
      </div>

      <div className="relative h-11 sm:h-6">
        <div
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-border"
        />
        <div
          aria-hidden
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-forest"
          style={{ left: `${loPercent}%`, width: `${Math.max(hiPercent - loPercent, 0)}%` }}
        />

        <input
          id={`${id}-min`}
          type="range"
          min={trackMin}
          max={trackMax}
          step={step}
          value={lo}
          onChange={(event) => handleLow(Number(event.target.value))}
          aria-label="Minimum daily rate"
          aria-valuetext={formatMoney(lo, currencyCode)}
          className={`${thumb} z-20`}
        />
        <input
          id={`${id}-max`}
          type="range"
          min={trackMin}
          max={trackMax}
          step={step}
          value={hi}
          onChange={(event) => handleHigh(Number(event.target.value))}
          aria-label="Maximum daily rate"
          aria-valuetext={formatMoney(hi, currencyCode)}
          className={`${thumb} z-10`}
        />
      </div>

      <p className="text-xs text-brand-text-subtle">
        Daily rate, before extras and fees.
      </p>
    </div>
  );
}
