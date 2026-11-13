"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Fades a block in as it scrolls into view, using the Trax panel's entrance
 * (opacity plus a 12px lift, 200ms ease-out; see landing-v2.css). It plays
 * once and never on the way out. Reduced motion shows the block at rest.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      // Phones: the moment it is a little way onto the screen; a share of a tall block came far too late.
      matchMedia("(max-width: 767.98px)").matches ? { rootMargin: "0px 0px -6% 0px" } : { threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-reveal={shown ? "shown" : "hidden"} className={className}>
      {children}
    </div>
  );
}
