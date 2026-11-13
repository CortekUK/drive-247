"use client";

import { useEffect, useRef, useState } from "react";

export function useFadeIn(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // Phones: the moment it is a little way onto the screen; a share of a tall block came far too late.
      matchMedia("(max-width: 767.98px)").matches ? { rootMargin: "0px 0px -6% 0px" } : { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, visible };
}
