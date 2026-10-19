'use client';

import { useId } from 'react';

import { formatMoney } from '@nw/components/fleet/format';
import type { PriceBounds } from '@nw/components/fleet/fleet-filters';

interface PriceRangeFieldProps {
  bounds: PriceBounds;
  /** Current selection. Either end may be null, meaning "at the bound". */
  min: number | null;
  max: number | null;
  currencyCode: string | null;
  onChange: (next: { min: number | null; max: number | null }) => void;
}

/** Same step rule as v1: sane money steps derived from the real spread. */
function stepFor(spread: number): number {
  if (spread <= 20) return 1;
  if (spread <= 100) return 5;
  if (spread <= 600) return 10;
  return 25;
}

/**
 * v2 of `components/fleet/price-range-field.tsx`: two native range inputs over
 * the fleet's real daily-rate span (keyboard and screen reader for free), the
 * handles clamped a step apart. Same clamping as v1; only the paint changed.
 */
export function PriceRangeField({ bounds, min, max, currencyCode, onChange }: PriceRangeFieldProps) {
  const id = useId();
  const step = stepFor(bounds.max - bounds.min);

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

  const thumb =
    'pointer-events-none absolute inset-x-0 top-1/2 h-11 w-full -translate-y-1/2 appearance-none bg-transparent outline-none sm:h-6 ' +
    '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-5 sm:[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none ' +
    '[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-pv-primary [&::-webkit-slider-thumb]:bg-pv-card ' +
    '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-5 sm:[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none ' +
    '[&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-pv-primary [&::-moz-range-thumb]:bg-pv-card ' +
    'focus-visible:[&::-webkit-slider-thumb]:ring-[3px] focus-visible:[&::-webkit-slider-thumb]:ring-pv-primary/25 ' +
    'focus-visible:[&::-moz-range-thumb]:ring-[3px] focus-visible:[&::-moz-range-thumb]:ring-pv-primary/25';

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-[13px] font-medium tabular-nums text-pv-fg">
        <span aria-hidden>{formatMoney(lo, currencyCode)}</span>
        <span aria-hidden>{formatMoney(hi, currencyCode)}</span>
      </div>

      <div className="relative h-11 sm:h-6">
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-pv-muted" />
        <div
          aria-hidden
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-pv-primary"
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

      <p className="text-xs text-pv-muted-fg">Daily rate, before extras and fees.</p>
    </div>
  );
}
