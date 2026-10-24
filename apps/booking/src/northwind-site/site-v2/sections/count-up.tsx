'use client';

/**
 * A number that counts up once, the first time it scrolls into view.
 *
 * The server renders the final value, so the number is right without
 * JavaScript, for search engines and for screen readers (which are only ever
 * given the final value, via `aria-label`). On the client a number still below
 * the fold resets to zero and counts up when a third of it is visible; one
 * already on screen at load stays as it is. Reduced motion skips the count.
 */

import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 1100;

/** Fast start, soft landing. */
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export function CountUp({
  to,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return; // already seen

    setValue(0);
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION_MS);
          setValue(to * easeOutCubic(t));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to]);

  const shown = value.toFixed(decimals);
  return (
    <span ref={ref} className={className} aria-label={`${prefix}${to.toFixed(decimals)}${suffix}`}>
      <span aria-hidden>
        {prefix}
        {shown}
        {suffix}
      </span>
    </span>
  );
}
