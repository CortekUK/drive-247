'use client';

/**
 * Template 2 ("Glass") — a figure that counts up from zero the first time it
 * comes into view, wherever it sits on the page (site-v2's `CountUp` skips a
 * number already on screen at load; here the figures near the top of a page
 * count too). Once only.
 *
 * The server renders the final value, so the figure is right without
 * JavaScript, and assistive technology is only ever given the final value
 * (`aria-label`). Reduced motion shows the final value and never counts.
 * `format` sets the figure as the page does (a price in the operator's
 * currency); otherwise prefix, the number to `decimals`, suffix.
 */

import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 1200;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export function T2Count({
  to,
  decimals = 0,
  prefix = '',
  suffix = '',
  format,
  className,
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  format?: (value: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to);
      return;
    }
    setValue(0);
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION_MS);
          setValue(t === 1 ? to : to * easeOutCubic(t));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to]);

  const render = (n: number) => (format ? format(n) : `${prefix}${n.toFixed(decimals)}${suffix}`);
  // While counting, round to the figure's own precision so it never shows stray decimals.
  const shown = decimals === 0 ? Math.round(value) : value;
  return (
    <span ref={ref} className={className} aria-label={render(to)}>
      <span aria-hidden>{render(shown)}</span>
    </span>
  );
}
