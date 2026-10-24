'use client';

/**
 * The home page's scroll reveals. Anything marked `data-reveal` rises into
 * place the first time it scrolls into view; a `data-reveal-group` does the
 * same for each of its children in turn (styles/site.css). A revealed element
 * also starts its illustration's small one-off moves (a tick popping in, a
 * signature drawing itself).
 *
 * Nothing is hidden until this runs: the `nw-reveal` class that hides the
 * not-yet-seen parts is set here, after whatever is already on screen has been
 * marked seen, so the first paint never flashes and a page without JavaScript
 * shows everything. With reduced motion everything is marked seen at once and
 * the CSS skips the motion.
 */

import { useEffect } from 'react';

const SELECTOR = '[data-reveal], [data-reveal-group]';

export function ScrollReveal() {
  useEffect(() => {
    const root = document.documentElement;
    const targets = [...document.querySelectorAll<HTMLElement>(SELECTOR)];
    const seen = (el: Element) => el.classList.add('is-in');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targets.forEach(seen);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          seen(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    for (const el of targets) {
      const { top } = el.getBoundingClientRect();
      if (top < window.innerHeight * 0.94) seen(el);
      else observer.observe(el);
    }
    root.classList.add('nw-reveal');

    return () => {
      observer.disconnect();
      root.classList.remove('nw-reveal');
    };
  }, []);

  return null;
}
