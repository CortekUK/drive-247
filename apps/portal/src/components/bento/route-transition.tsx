"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { dur, ease } from "@/lib/motion";

/**
 * Route-enter transition — fade + small upward slide of the page body on
 * navigation. Spec: ANIMATION.md §3 (App shell · route change). Sidebar/header
 * stay put; only the page body re-keys on pathname.
 */
export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={pathname}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0.12 : dur.md, ease: ease.out }}
      className="flex flex-1 flex-col gap-4"
    >
      {children}
    </motion.div>
  );
}
