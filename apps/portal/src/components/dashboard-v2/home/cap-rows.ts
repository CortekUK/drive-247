'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * At most `count` rows of a card's list, then it scrolls (boss, Nov 2026:
 * Requests and To do take only the room their content needs, three items at
 * most, on a phone and on a desktop alike, instead of a fixed tall box that is
 * mostly blank).
 *
 * Rows differ in height (a to-do with a reminder, a wrapped title), so the cap
 * is MEASURED: the scroller's height is held to the bottom of its `count`th
 * visible `<li>`, plus its own bottom padding. Fewer rows than that, no cap.
 * Re-measured whenever the list or the card's width changes.
 */
export function useCapRows<T extends HTMLElement = HTMLDivElement>(count = 3) {
  const ref = useRef<T>(null);
  const [max, setMax] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rows = Array.from(el.querySelectorAll<HTMLElement>(':scope ul > li')).filter((li) => li.offsetParent !== null);
      if (rows.length <= count) {
        setMax(undefined);
        return;
      }
      const top = el.getBoundingClientRect().top - el.scrollTop;
      const bottom = rows[count - 1].getBoundingClientRect().bottom;
      setMax(Math.ceil(bottom - top + parseFloat(getComputedStyle(el).paddingBottom || '0')));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [count]);

  const style: CSSProperties | undefined = max ? { maxHeight: max } : undefined;
  return { ref, style, capped: max !== undefined };
}
