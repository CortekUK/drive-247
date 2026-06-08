/**
 * Bento motion tokens — the single easing/duration/spring set for the whole app.
 * Spec: design_handoff_bento/ANIMATION.md §2. Reuse these everywhere so heavy
 * motion stays consistent rather than noisy. Animate transform/opacity only.
 */

import type { Transition, Variants } from "motion/react";

export const ease = {
  spring: [0.34, 1.56, 0.64, 1] as const, // overshoot — pops (modals, toggles, toasts, checks)
  sheet: [0.32, 0.72, 0, 1] as const, // iOS sheet — travels (side/bottom sheets)
  out: [0.22, 1, 0.36, 1] as const, // standard ease-out — most enters
  inOut: [0.65, 0, 0.35, 1] as const, // symmetric — size tweens
};

export const dur = { xs: 0.12, sm: 0.18, md: 0.28, lg: 0.42, xl: 0.55 }; // seconds

export const springs: Record<string, Transition> = {
  pop: { type: "spring", stiffness: 520, damping: 30 },
  soft: { type: "spring", stiffness: 320, damping: 32 },
  snappy: { type: "spring", stiffness: 700, damping: 38 },
};

/** Parent variant for staggered tile/row entrances. */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

/** Child variant — fade-up. Pair with `staggerParent`. */
export const fadeUpChild: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: springs.soft },
};

/** Page/route enter — fade + small upward slide. */
export const routeEnter: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: dur.md, ease: ease.out } },
};

/** Auth content entrance — fade + 14px rise (spring). Re-runs on each state swap. */
export const authUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: springs.soft },
};

/** Validation error shake (x only). */
export const shake = {
  x: [0, -4, 4, -3, 3, 0],
  transition: { duration: dur.md },
};
