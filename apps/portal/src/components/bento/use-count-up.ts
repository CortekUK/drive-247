"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

/**
 * Count-up for KPI numerals — animates from the previous value to the next.
 * Spec: ANIMATION.md §3 (KPI numbers). Honors prefers-reduced-motion by
 * snapping to the final value. Returns the live numeric value to render.
 */
export function useCountUp(to: number, duration = 0.55) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? to : 0);
  const fromRef = useRef(reduce ? to : 0);

  useEffect(() => {
    if (reduce) {
      setValue(to);
      fromRef.current = to;
      return;
    }
    const controls = animate(fromRef.current, to, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setValue(v),
    });
    fromRef.current = to;
    return () => controls.stop();
  }, [to, duration, reduce]);

  return value;
}
